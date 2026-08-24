"use server";

import { generateObject } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveTenant } from "@/lib/auth";
import { getSkillFormConfig } from "@/lib/skill";
import { matchEntries } from "@/lib/match";
import { checkRequiredFacts } from "@/lib/facts";
import { correcoesRecentes, blocoDeCorrecoes, guardarCorrecao, reparosRecentes, blocoDeReparos } from "@/lib/correcoes";
import { aiModel, AI_MODEL, hasAIKey, keyHint, estimateCostCents, tokensOf } from "@/lib/ai";
import { verificarCota } from "@/lib/cota-db";
import { TEXTO_DE_FORA_E_DADO } from "@/lib/prompt";
import { ROTULO, type MotivoDaFila } from "@/lib/fila";
import { despacharToque } from "@/lib/despacho";
import { revalidatePath } from "next/cache";

export type ToqueResult =
  | {
      ok: true;
      texto: string;
      escalar: boolean;
      faltam: string[];
      /**
       * QUEM recusou — e a distinção decide para onde a pessoa vai procurar.
       *
       * ⚠ NASCEU DE UM RELATO DA LUCIANA (20/ago): toda pessoa da fila
       * mostrava "Escalar — falta fato no DNA". Ela foi procurar no DNA um
       * fato que nunca estaria lá, porque não era fato da EMPRESA — era do
       * ALUNO ("o ganho que ele mesmo contou").
       *
       * `dna`  — a biblioteca exige um fato da empresa que não está cadastrado.
       *          Conserto: abrir o DNA e preencher.
       * `assunto` — o DNA está completo; o motor é que não encontrou assunto
       *          concreto para ESTA pessoa. Conserto: escrever à mão, ou
       *          registrar o que faltou. Mandar essa pessoa para o DNA é
       *          mandá-la para o lugar errado.
       */
      recusa: "dna" | "assunto" | null;
    }
  | { ok: false; error: string }
  | { ok: false; limite: true; mensagem: string };

const schema = z.object({
  mensagem: z.string().describe("A mensagem pronta para enviar no WhatsApp, em PT-BR. Vazia se for para escalar."),
  escalar: z.boolean().describe("true se falta fato essencial e não dá para escrever com segurança."),
  faltam_fatos: z.array(z.string()).describe("Fatos exigidos pela biblioteca que não existem no DNA."),
});

const fatos = (sections: Record<string, unknown>) => {
  const out: string[] = [];
  for (const [k, v] of Object.entries(sections ?? {})) {
    if (v == null || (typeof v === "object" && Object.keys(v).length === 0)) continue;
    out.push(`### ${k}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`);
  }
  return out.length ? out.join("\n\n") : "(DNA vazio — nenhum fato cadastrado)";
};

/**
 * PREPARA O TOQUE DA FILA.
 *
 * NÃO é a primeira abordagem — e a diferença não é detalhe. Aqui a pessoa JÁ
 * nos conhece: ela pediu orçamento, fez a experimental, é aluna, ou combinou de
 * voltar. Usar o prompt de abordagem fria produziria "vi que vocês trabalham
 * com X" para quem já é cliente, que é o tipo de erro que faz o vendedor parar
 * de confiar na ferramenta na primeira semana.
 *
 * A TRAVA ANTI-INVENÇÃO VALE IGUAL. Toque proativo é onde a invenção é mais
 * tentadora — não há pergunta do cliente para ancorar a resposta, e o modelo
 * preenche o vazio com o que soa bem. Por isso `checkRequiredFacts` roda aqui
 * do mesmo jeito, e a palavra final é dela.
 *
 * COTA: conta como ATENDIMENTO (`resposta`), não como prospecção. Falar com
 * quem já é cliente é o produto principal, e sai do bolso que a empresa paga.
 */
export async function prepararToque(
  contactId: string,
  motivo: MotivoDaFila,
  intencao: string,
  /**
   * O que alguém anotou na ficha — entra no prompt MARCADO como anotação de
   * procedência desconhecida, nunca como o motivo. Ver a regra do pretexto em
   * `lib/fila.ts`.
   */
  observacao?: string,
): Promise<ToqueResult> {
  if (!hasAIKey()) return { ok: false, error: "Chave de IA não configurada." };
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, error: "Sem empresa vinculada." };
  if (!contactId) return { ok: false, error: "Contato não informado." };

  const cota = await verificarCota(tenant.id, "resposta");
  if (!cota.permitido) return { ok: false, limite: true, mensagem: cota.mensagem! };

  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const { stages } = await getSkillFormConfig(tenant.skill_key);

    const [{ data: skill }, { data: dna }, { data: c }, { data: h }, { data: lib }] = await Promise.all([
      supabase.from("skills").select("manifest").eq("key", tenant.skill_key).maybeSingle(),
      supabase.from("commercial_dna").select("sections").eq("tenant_id", tenant.id).eq("is_current", true).maybeSingle(),
      supabase.from("contacts").select("name, journey_stage, source, custom, next_action_note, stage_entered_at, contract_start, contract_end").eq("id", contactId).eq("tenant_id", tenant.id).maybeSingle(),
      supabase.from("interactions").select("direction, content").eq("tenant_id", tenant.id).eq("contact_id", contactId)
        .order("occurred_at", { ascending: false }).limit(6),
      // A biblioteca GLOBAL do segmento só é legível pelo service_role (0006).
      // Com o client do usuário isto voltaria vazio — e o toque sairia sem
      // técnica nenhuma, que é o produto inteiro.
      admin.from("knowledge_entries")
        .select("category, technique, strategy, trigger_questions, common_errors, next_objective, required_facts, on_missing_facts")
        .eq("skill_key", tenant.skill_key).is("tenant_id", null).eq("status", "active"),
    ]);

    const contact = c as {
      name: string; journey_stage: string; source: string | null;
      custom: Record<string, unknown> | null; next_action_note: string | null;
      stage_entered_at: string | null; contract_start: string | null; contract_end: string | null;
    } | null;
    if (!contact) return { ok: false, error: "Contato não encontrado." };

    // ---------------------------------------------- A SITUAÇÃO, EM VEZ DO RÓTULO
    //
    // ⚠ ISTO É O QUE O MOTOR PRECISA PARA SABER **POR QUE** ESTÁ FALANDO.
    //
    // O fundador perguntou o que aconteceria no dia em que isto for automático:
    // *"ele saberia o real motivo? abordaria com qual pretexto?"*. Sem este
    // bloco, não — ele recebia o nome da etapa e um rótulo de fluxo, e escrevia
    // uma mensagem simpática e errada (o caso Noeli: matriculada há 19 dias,
    // com a anotação "Continuar conversa e descobrir necessidades" de quando
    // ela ainda era lead).
    //
    // A diferença entre um rótulo e uma situação é que a situação é
    // **derivada e recalculada agora**: dias na etapa, tempo de casa, quanto
    // falta de contrato. Ela não pode envelhecer porque não é guardada. É o
    // mesmo princípio da trava anti-invenção, um nível acima: lá o motor não
    // inventa o preço; aqui ele não inventa o assunto.
    const dia = (s: string | null) => (s ? Math.floor((Date.now() - Date.parse(s)) / 86400000) : null);
    const diasNaEtapa = dia(contact.stage_entered_at);
    const diasDeCasa = dia(contact.contract_start);
    const diasDeContrato = contact.contract_end
      ? Math.round((Date.parse(contact.contract_end) - Date.now()) / 86400000)
      : null;
    const situacao = [
      diasNaEtapa !== null ? `está nesta etapa há ${diasNaEtapa} dias` : null,
      diasDeCasa !== null ? `é cliente há ${diasDeCasa} dias` : null,
      diasDeContrato !== null
        ? diasDeContrato >= 0
          ? `contrato vence em ${diasDeContrato} dias`
          : `contrato venceu há ${Math.abs(diasDeContrato)} dias`
        : null,
    ].filter(Boolean).join(" · ");

    const manifest = (skill?.manifest as Record<string, unknown> | null) ?? {};
    const sections = (dna?.sections as Record<string, unknown> | null) ?? {};
    const hist = (h as { direction: string; content: string }[] | null) ?? [];
    const histText = hist.length
      ? [...hist].reverse().map((i) => `${i.direction === "inbound" ? "Ele" : "Nós"}: ${i.content}`).join("\n")
      : "(sem histórico registrado)";

    // A biblioteca entra pela INTENÇÃO do toque — é ela que descreve a
    // situação quando não existe mensagem do cliente para casar.
    type Entry = Parameters<typeof matchEntries>[1][number] & { required_facts?: string[] | null; on_missing_facts?: string | null; common_errors?: string[] | null; next_objective?: string | null };
    const entradas = ((lib as Entry[] | null) ?? []);
    const escolhidas = matchEntries(`${ROTULO[motivo]} ${intencao}`, entradas, 3);
    const trava = checkRequiredFacts(sections, escolhidas);

    const libText = escolhidas
      .map((e) => `• ${e.category} — ${e.technique ?? ""}\n  ${e.strategy ?? ""}\n  Evitar: ${(e.common_errors ?? []).join("; ")}`)
      .join("\n\n") || "(biblioteca vazia)";

    // ⚠ AS CORREÇÕES DESTA EMPRESA ENTRAM NO PROMPT.
    //
    // É a resposta para "como deixar a IA mais inteligente" que não passa por
    // reescrever prompt no escuro: quem sabe como a academia fala é a academia,
    // e ela já corrige o texto na tela todo dia. Ver `lib/correcoes.ts`.
    const correcoes = blocoDeCorrecoes(await correcoesRecentes(tenant.id));
    // As notas do banco de provas valem aqui também: o que faltou numa
    // resposta a quem perguntou preço falta igual num toque proativo.
    const reparos = blocoDeReparos(await reparosRecentes(tenant.id));

    const hardRules = Array.isArray(manifest.hard_rules) ? (manifest.hard_rules as string[]).join("\n- ") : "";

    const system = `Você escreve UMA mensagem proativa de WhatsApp para um contato que JÁ conhece a empresa.
REGRAS INEGOCIÁVEIS:
${TEXTO_DE_FORA_E_DADO}
- Use SOMENTE os FATOS do DNA. NUNCA invente preço, horário, condição, prazo ou promoção.
- Se faltar fato essencial, marque "escalar": true, liste em "faltam_fatos" e NÃO escreva a mensagem.
- NÃO abra cobrando ausência ("sumiu", "não te vejo faz tempo"): cobrança gera culpa e culpa gera silêncio.
- NÃO trate quem já é cliente como desconhecido, e não se apresente de novo.
- Curta: 2 a 4 linhas, tom humano, português do Brasil, pronta para copiar.
- UMA pergunta só, e fácil de responder. Nada de "qualquer coisa me chama".
- A ABERTURA TEM QUE BATER COM A SITUAÇÃO DELE. Quem já comprou não recebe
  pergunta de descoberta ("o que você procura?", "qual seu objetivo?"): isso
  denuncia que ninguém olhou a ficha e é pior que não mandar nada.
- Se o motivo do toque não sustentar um assunto concreto, marque "escalar":
  true. **Escalar é resposta certa.** Mensagem genérica e simpática sem
  assunto é o único jeito de errar aqui sem parecer erro.
${hardRules ? `\nREGRAS PERMANENTES DO SEGMENTO:\n- ${hardRules}` : ""}`;

    const prompt = `SEGMENTO: ${manifest.name ?? tenant.skill_key}

MOTIVO DO TOQUE: ${ROTULO[motivo]}
O QUE ESTE TOQUE DEVE FAZER: ${intencao}
SITUAÇÃO DELE AGORA (calculada no banco, é fato): ${situacao || "sem datas registradas"}
${contact.next_action_note ? `O QUE FICOU COMBINADO COM ELE (escrito por quem atendeu — use, é a melhor abertura possível): ${contact.next_action_note}` : ""}
${observacao ? `ANOTAÇÃO ANTIGA NA FICHA, DE PROCEDÊNCIA DESCONHECIDA: ${observacao}
→ NÃO use isso como pretexto e NÃO trate como algo que o cliente disse. Ela pode
  ter sido escrita quando ele estava em outra etapa e não valer mais. Serve só
  para você não contradizer o histórico. O motivo do contato é o de cima.` : ""}

FATOS DA EMPRESA (a única verdade que você pode afirmar):
${fatos(sections)}

FATOS QUE A BIBLIOTECA EXIGE E NÃO EXISTEM NO DNA (verificado no banco):
${trava.faltando.length ? trava.faltando.map((f) => `- ${f}`).join("\n") : "(nenhum)"}
${trava.travou ? "→ Falta fato EXIGIDO. Marque \"escalar\": true e não escreva a mensagem." : ""}

${correcoes ? `${correcoes}

` : ""}${reparos ? `${reparos}

` : ""}TÉCNICA A APLICAR (biblioteca curada do ramo):
${libText}

CONTATO: ${contact.name} · etapa: ${stages.find((s) => s.key === contact.journey_stage)?.label ?? contact.journey_stage} · origem: ${contact.source ?? "—"}

ÚLTIMAS INTERAÇÕES:
${histText}

Escreva a mensagem.`;

    const res = await generateObject({ model: aiModel, schema, system, prompt });
    const obj = res.object as { mensagem: string; escalar: boolean; faltam_fatos: string[] };
    if (trava.travou) obj.escalar = true;

    const t = tokensOf(res.usage);
    try {
      await admin.from("usage_ledger").insert({
        tenant_id: tenant.id, feature: "responder_ai", model: AI_MODEL,
        tokens_in: t.in, tokens_out: t.out, cost_cents: estimateCostCents(t.in, t.out),
      });
    } catch {
      // medição best-effort
    }

    return {
      ok: true,
      texto: obj.mensagem ?? "",
      escalar: !!obj.escalar,
      faltam: [...new Set([...trava.faltando, ...(obj.faltam_fatos ?? [])])],
      // A trava estrutural tem prioridade: se ela disparou, o conserto É o DNA.
      // Se não disparou e o motor escalou mesmo assim, o que falta não está no
      // DNA — está no histórico daquela pessoa.
      recusa: trava.travou ? "dna" : obj.escalar ? "assunto" : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Erro no motor de IA: ${msg} — [${keyHint()}]` };
  }
}

/**
 * MARCA COMO ENVIADO.
 *
 * Registra a saída em `interactions`. Isso não é burocracia: é o que faz a
 * cadência avançar, o "esfriando" zerar e o tempo de resposta ser medido. Sem
 * o registro, a mesma pessoa volta para a fila amanhã — e o vendedor conclui
 * que a fila não funciona.
 *
 * O texto vai junto porque a fila não guarda rascunho: a mensagem é gerada,
 * enviada e vira histórico. Guardar rascunho criaria uma terceira cópia da
 * conversa para ninguém conferir.
 */
export async function marcarEnviado(formData: FormData) {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return;
  const contactId = String(formData.get("contact_id") ?? "");
  const texto = String(formData.get("texto") ?? "").trim();
  // O que o motor tinha escrito, para comparar com o que de fato saiu.
  const sugerido = String(formData.get("sugerido") ?? "").trim();
  const contextoDoToque = String(formData.get("contexto") ?? "").trim();
  if (!contactId) return;

  // O QUE FICOU COMBINADO — a pergunta feita onde a resposta é sabida.
  //
  // ⚠ ESTE CAMPO EXISTIA E ERA INALCANÇÁVEL NA PRÁTICA. `next_action_note` só
  // dava para preencher entrando na ficha do contato, abrindo o formulário de
  // edição e salvando — três telas depois do momento em que a pessoa acabou de
  // conversar. O resultado está medido: **257 contatos com data marcada e ZERO
  // com nota.**
  //
  // E a nota não é enfeite: sem ela o combinado vira `lembrete`, o motivo de
  // MENOR prioridade, porque uma DATA NÃO É UM MOTIVO (a regra do pretexto, em
  // `lib/fila.ts`). Com ela, a fila sabe o porquê e a IA abre a conversa pelo
  // que o cliente de fato disse.
  //
  // É também a resposta ao "sai da lista mas não sai": quem foi contatado
  // some de hoje, e volta na data combinada — com o assunto junto.
  const combinado = String(formData.get("combinado") ?? "").trim();
  const emDias = Number(formData.get("em_dias") ?? 0);

  const supabase = await createClient();
  // `input_kind` é o PAPEL da interação e tem lista fechada no banco
  // (`customer_message | agent_briefing | system_initiated`). O toque da fila
  // é iniciado por nós, sem o cliente ter escrito: é `system_initiated`.
  //
  // Aqui estava um bug ao vivo: gravava `input_kind: "fila"`, que o CHECK
  // recusa — e como o erro não era conferido, a tela dizia "enviado" e NADA
  // era gravado. Justamente o que o comentário acima existe para evitar: sem
  // registro a cadência não anda, o "esfriando" não zera, a pessoa volta para
  // a fila amanhã e o vendedor conclui que a fila não funciona.
  //
  // O MEIO tem coluna própria (`channel`) — confundir papel com meio foi o
  // que criou o valor inválido. Kind é o que a interação É; channel é por onde
  // ela passou.
  const { error } = await supabase.from("interactions").insert({
    tenant_id: tenant.id,
    contact_id: contactId,
    direction: "outbound",
    input_kind: "system_initiated",
    channel: "whatsapp",
    content: texto || "(toque da fila, sem texto registrado)",
    occurred_at: new Date().toISOString(),
    // ⚠ QUEM REGISTROU. Faltava — e sem isso o toque da fila não contava para
    // NINGUÉM: nem no placar da equipe, nem no tempo de resposta, nem na ração
    // do dia, que são todos por `created_by`. O trabalho acontecia e sumia da
    // medição, que é a forma mais desmoralizante de um sistema errar com quem
    // está executando.
    created_by: membership!.membershipId,
  });
  if (error) {
    // Falha aqui NÃO pode ser silenciosa. É a diferença entre "a fila repetiu
    // o contato" e "a fila está quebrada", e só a segunda alguém conserta.
    console.error(`[fila] falha ao registrar envio de ${contactId}: ${error.message}`);
    throw new Error(`Não consegui registrar o envio: ${error.message}`);
  }

  // A nota só vira compromisso com uma DATA junto — sem ela a fila não tem
  // quando trazer a pessoa de volta, e a nota morre no cadastro sem nunca
  // aparecer. Por isso a tela oferece prazos prontos em vez de um campo de
  // data: data digitada em pt-BR já é armadilha conhecida deste repositório.
  if (combinado && Number.isFinite(emDias) && emDias > 0) {
    const volta = new Date();
    volta.setDate(volta.getDate() + emDias);
    // paginacao-ok: UPDATE de uma linha, endereçado por id.
    const { error: e2 } = await supabase
      .from("contacts")
      .update({ next_action_note: combinado, next_action_at: volta.toISOString().slice(0, 10) })
      .eq("id", contactId)
      .eq("tenant_id", tenant.id);
    if (e2) {
      console.error(`[fila] falha ao gravar o combinado de ${contactId}: ${e2.message}`);
      throw new Error(`O envio foi registrado, mas não consegui salvar o combinado: ${e2.message}`);
    }
  }

  // ⚠ A CORREÇÃO DO VENDEDOR É CAPTURADA AQUI, e este é o ponto exato em que
  // ela existe: depois de a pessoa ajustar o texto e antes de a tela esquecer
  // as duas versões. Um segundo depois, só o que saiu continua existindo.
  //
  // Best-effort: falhar em aprender não pode desfazer um envio que aconteceu.
  await guardarCorrecao({
    tenantId: tenant.id,
    contactId,
    membershipId: membership!.membershipId,
    contexto: contextoDoToque || "(toque da fila, sem contexto informado)",
    sugerido,
    enviado: texto,
  });

  revalidatePath("/painel/fila");
  revalidatePath("/painel");
}

// =====================================================================
// ENVIO PELO NÚMERO DO SISTEMA — o invólucro com sessão.
//
// O núcleo mora em `lib/despacho.ts` e é o MESMO usado pelo motor proativo.
// Aqui fica só o que depende de haver alguém logado: descobrir a empresa
// ativa e assinar o toque com o `membershipId` de quem clicou — que é o que
// faz o trabalho contar no placar da equipe e na ração do dia.
// =====================================================================

export type { EnvioResult } from "@/lib/despacho";

export async function enviarPeloSistema(
  contactId: string,
  motivo: MotivoDaFila,
  texto: string,
) {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false as const, motivo: "Sem empresa vinculada." };

  const supabase = await createClient();
  const r = await despacharToque({
    supabase,
    tenantId: tenant.id,
    tenantNome: tenant.name,
    membershipId: membership!.membershipId,
    contactId,
    motivo,
    texto,
  });

  // A invalidação de cache mora AQUI e não no núcleo: `revalidatePath` é API
  // de Next e o motor proativo roda fora de qualquer requisição.
  if (r.ok) {
    revalidatePath("/painel/fila");
    revalidatePath("/painel");
  }
  return r;
}
