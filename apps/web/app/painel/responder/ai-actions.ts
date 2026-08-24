"use server";

import { generateObject } from "ai";
import { medir, notaParaOMotor, type Evento } from "@/lib/aprendizado";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveTenant } from "@/lib/auth";
import { getSkillFormConfig } from "@/lib/skill";
import { matchEntries } from "@/lib/match";
import { resolveSchool, loadSchools, schoolsBlock, type StrategyMap } from "@/lib/schools";
import { checkRequiredFacts } from "@/lib/facts";
import { lerQualificacao, blocoParaPrompt } from "@/lib/qualificacao";
import { aiModel, AI_MODEL, hasAIKey, keyHint, estimateCostCents, tokensOf } from "@/lib/ai";
import { TEXTO_DE_FORA_E_DADO } from "@/lib/prompt";
import { verificarCota } from "@/lib/cota-db";
import { reparosRecentes, blocoDeReparos } from "@/lib/correcoes";
import { revalidatePath } from "next/cache";
import { opcoesDeHorario, marcarCompromisso } from "../agenda/horarios-actions";
import { lerTudo } from "@/lib/paginado";

export type GerarResult =
  | { ok: true; data: AiAnswer }
  | { ok: false; error: string }
  // COTA ATINGIDA NÃO É ERRO — e a diferença não é cosmética. Se o teto
  // aparecesse em vermelho como falha, a empresa em teste concluiria que o
  // sistema quebrou e sumiria, que é exatamente o oposto do que o teto existe
  // para fazer. O produto não parou: o cockpit manual custa zero e continua.
  | { ok: false; limite: true; mensagem: string };

export type AiAnswer = {
  resposta_sugerida: string;
  objetivo: string;
  explicacao: string;
  tecnica: string;
  proximo_passo: string;
  etapa_jornada: string;
  emocao: string;
  status_sugerido: string;
  motivo_status: string;
  faltam_fatos: string[];
  escalar: boolean;
  horario_escolhido: string;
};

const schema = z.object({
  resposta_sugerida: z.string().describe("A resposta pronta para o vendedor copiar e enviar ao cliente, em PT-BR, natural e concisa. Vazia se for para escalar."),
  objetivo: z.string().describe("O objetivo desta resposta em uma frase."),
  explicacao: z.string().describe("Por que esta resposta funciona — ensina o vendedor."),
  tecnica: z.string().describe("A técnica de venda escolhida e o mestre de referência (ex.: Puppy Dog Close — Tracy)."),
  proximo_passo: z.string().describe("O próximo passo recomendado após esta resposta."),
  etapa_jornada: z.string().describe("A etapa da jornada em que o cliente parece estar."),
  emocao: z.string().describe("A emoção dominante identificada no cliente."),
  status_sugerido: z.string().describe("A CHAVE de uma etapa da jornada para avançar o cliente, ou string vazia se não houver avanço claro."),
  motivo_status: z.string().describe("Por que sugeriu esse avanço de etapa, ou string vazia."),
  faltam_fatos: z.array(z.string()).describe("Fatos necessários que NÃO estão no DNA e seriam precisos para responder com segurança."),
  escalar: z.boolean().describe("true se faltam fatos essenciais e a resposta deve ser escalada a um humano em vez de inventada."),
  horario_escolhido: z.string().describe("Se o cliente ACEITOU um horário da lista de livres, a data e hora exatas em AAAA-MM-DDTHH:MM. Vazio se ele ainda não escolheu."),
});

function fatos(sections: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(sections ?? {})) {
    if (v == null || (typeof v === "object" && Object.keys(v).length === 0)) continue;
    out.push(`### ${k}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`);
  }
  return out.length ? out.join("\n\n") : "(DNA vazio — nenhum fato cadastrado)";
}

export async function gerarResposta(input: {
  contactId?: string;
  message: string;
  /**
   * ⚠ O CORTE DO HISTÓRICO — só existe para o BANCO DE PROVAS, e sem ele a
   * medição inteira mente.
   *
   * A tela de responder é o caso normal: a mensagem é a última, e "todo o
   * histórico" e "o histórico até esta mensagem" são a mesma coisa.
   *
   * No banco de provas não são. Julgar uma mensagem do dia 21 às 14h com o
   * histórico de HOJE entrega ao modelo tudo o que aconteceu DEPOIS — e ele
   * responde continuando uma conversa que ainda não tinha acontecido. Foi
   * exatamente o que o fundador pegou: para *"gostaria de mais informações"*,
   * a sugestão veio *"só reforçando as opções que tinha comentado"*, porque as
   * opções foram comentadas duas horas mais tarde.
   *
   * Ele disse a frase que fecha o assunto: *"não faz sentido fazer a
   * simulação, porque ela não mostra o que realmente aconteceu"*. Estava
   * certo. Medição com vazamento do futuro é pior que nenhuma medição — ela
   * produz um número com aparência de rigor.
   */
  ateISO?: string;
}): Promise<GerarResult> {
  if (!hasAIKey()) return { ok: false, error: "Chave de IA não configurada (AI_API_KEY)." };
  const message = (input.message ?? "").trim();
  if (!message) return { ok: false, error: "Cole a mensagem do cliente." };

  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, error: "Sem empresa vinculada." };

  // O PORTÃO, ANTES DE QUALQUER TOKEN. Verificar depois seria medir o prejuízo.
  const cota = await verificarCota(tenant.id, "resposta");
  if (!cota.permitido) return { ok: false, limite: true, mensagem: cota.mensagem! };

  try {
  const supabase = await createClient();
  const { stages, fields } = await getSkillFormConfig(tenant.skill_key);

  // A biblioteca CURADA do segmento (tenant_id null) é lida com service_role.
  // Ela nunca pode chegar ao browser — a policy de `knowledge_entries` só a
  // libera para service_role justamente por isso (P0 do 0006). Sem esta
  // busca, os 8 segmentos curados ficavam no banco sem nunca alimentar o
  // motor: só a biblioteca própria da empresa era usada.
  const admin = createAdminClient();
  const [{ data: skill }, { data: dna }, { data: entriesData }, { data: seedData }] = await Promise.all([
    supabase.from("skills").select("manifest").eq("key", tenant.skill_key).maybeSingle(),
    supabase.from("commercial_dna").select("sections").eq("tenant_id", tenant.id).eq("is_current", true).maybeSingle(),
    supabase
      .from("knowledge_entries")
      .select("category, school, trigger_questions, strategy, technique, answer, common_errors, next_objective, required_facts, on_missing_facts, hard_rules")
      .eq("tenant_id", tenant.id)
      .eq("source", "tenant")
      .eq("status", "active"),
    admin
      .from("knowledge_entries")
      .select("category, school, trigger_questions, strategy, technique, answer, common_errors, next_objective, required_facts, on_missing_facts, hard_rules")
      .is("tenant_id", null)
      .eq("skill_key", tenant.skill_key)
      .eq("status", "active"),
  ]);

  const manifest = (skill?.manifest as Record<string, unknown> | null) ?? {};
  const sections = (dna?.sections as Record<string, unknown> | null) ?? {};

  // Recuperação: as entradas mais relevantes para a mensagem (controla custo).
  type Entry = {
    category: string;
    school: string | null;
    trigger_questions: string[] | null;
    strategy: string | null;
    technique: string | null;
    answer: string | null;
    common_errors: string[] | null;
    next_objective: string | null;
    required_facts: string[] | null;
    on_missing_facts: string | null;
    hard_rules: string[] | null;
  };
  // A biblioteca da empresa vem primeiro: ela conhece o caso dela melhor que a
  // curadoria genérica do segmento. A do segmento entra como base.
  const allEntries = [
    ...((entriesData as Entry[] | null) ?? []),
    ...((seedData as Entry[] | null) ?? []),
  ];
  const picked = matchEntries(message, allEntries, 8);
  const usadas = picked.length ? picked : allEntries.slice(0, 6);

  // Qual escola governa cada situação NESTE segmento (o orquestrador em dado).
  const strategyMap = (manifest.strategy_map as StrategyMap | undefined) ?? null;
  const dicionario = await loadSchools();
  const escolas = usadas.map((e) => resolveSchool(e, strategyMap));

  // A TRAVA ANTI-INVENÇÃO, EM CÓDIGO. Cruza o que a biblioteca exige
  // (`required_facts`) com o que o DNA tem. Antes disto o campo era buscado do
  // banco e nunca usado: quem decidia escalar era o julgamento do modelo.
  const trava = checkRequiredFacts(sections, usadas);

  const library = usadas
    .map(
      (e, i) =>
        `Categoria: ${e.category}\nEscola: ${escolas[i] ?? "—"}\nGatilho: ${(e.trigger_questions ?? []).join(" / ")}\nEstratégia: ${e.strategy ?? ""}\nTécnica: ${e.technique ?? ""}\nResposta modelo: ${e.answer ?? ""}\nErros a evitar: ${(e.common_errors ?? []).join("; ")}\nPróximo passo: ${e.next_objective ?? ""}`,
    )
    .join("\n---\n");

  // Contexto do cliente + histórico.
  let contactBlock = "Nenhum cliente selecionado — trate como primeiro contato.";
  // QUALIFICAÇÃO DE COMPRA: o que se sabe do negócio e o que falta descobrir.
  // Vazio quando o segmento não usa (barbearia não tem processo de aprovação).
  let qualificacaoBlock = "";
  // Cada profissional tem a sua agenda: as vagas oferecidas precisam ser as
  // DELE, não as da casa. O contato pertence a um responsável.
  let donoDoContato: string | null = null;
  // A ORIGEM DO CONTATO SOBE DE ESCOPO. Ela é o recorte obrigatório da
  // medição de aprendizado (convênio 9% de resposta × WhatsApp 54%), e o
  // `contact` daqui é local ao `if`.
  let origemDoContato: string | null = null;
  if (input.contactId) {
    const [{ data: c }, { data: h }] = await Promise.all([
      supabase.from("contacts").select("name, journey_stage, owner_id, custom, source").eq("id", input.contactId).eq("tenant_id", tenant.id).maybeSingle(),
      (() => {
        // paginacao-ok: sao "os 10 da tela" — decisao de produto, nao leitura
        // de tabela inteira. O `.limit(10)` esta no fim da cadeia; a trava nao
        // o enxerga porque o encadeamento foi quebrado para caber o corte de
        // data. O limite continua ali, e continua sendo dez.
        let q = supabase
          .from("interactions")
          .select("direction, content, occurred_at")
          .eq("tenant_id", tenant.id)
          .eq("contact_id", input.contactId);
        // Estritamente ANTES da mensagem julgada. `lt`, nunca `lte`: a própria
        // mensagem já vai no prompt como "MENSAGEM DO CLIENTE", e repeti-la no
        // histórico faria o modelo achar que ela foi dita duas vezes.
        if (input.ateISO) q = q.lt("occurred_at", input.ateISO);
        return q.order("occurred_at", { ascending: false }).limit(10);
      })(),
    ]);
    const contact = c as {
      name: string;
      journey_stage: string;
      owner_id: string | null;
      custom: Record<string, unknown> | null;
      source: string | null;
    } | null;
    origemDoContato = contact?.source ?? null;
    const hist = (h as { direction: string; content: string; occurred_at: string }[] | null) ?? [];
    const stageLabel = stages.find((s) => s.key === contact?.journey_stage)?.label ?? contact?.journey_stage;
    const histText = hist.length
      ? hist
          .reverse()
          .map((i) => `${i.direction === "inbound" ? "Cliente" : "Nós"}: ${i.content}`)
          .join("\n")
      : "Sem histórico anterior.";
    donoDoContato = contact?.owner_id ?? null;
    contactBlock = `Cliente: ${contact?.name ?? "?"}\nEtapa atual: ${stageLabel}\nHISTÓRICO (não repita abordagens já usadas; evolua a conversa):\n${histText}`;
    qualificacaoBlock = blocoParaPrompt(lerQualificacao(fields, contact?.custom));
  }

  // Horários livres: sem isto o motor escala para um humano toda vez que
  // alguém quer marcar — e no modo automático a venda não fecha.
  let horarios = "";
  try {
    // O formato (hora exata ou turno) vem do manifesto do ramo — ver
    // `opcoesDeHorario`. Aqui só interessa que sejam opções reais.
    const opcoes = await opcoesDeHorario(4, donoDoContato);
    if (opcoes.length) horarios = opcoes.join(" | ");
  } catch {
    // agenda é complemento; se falhar, o motor segue sem oferecer horário
  }

  /**
   * ⚠ A REGRA DE HORÁRIO VEM DO SEGMENTO, e a versão fixa dela produziu um
   * erro real em 20/ago: o motor respondeu *"Segunda à tarde infelizmente não
   * temos horário livre"* para uma lead da academia.
   *
   * O prompt mandava, literalmente, "diga que aquele já está ocupado" para
   * qualquer horário fora da lista sugerida. Numa academia isso é **invenção
   * de um fato negativo**: não existe grade de atendimento para consultar, e o
   * próprio manifesto diz que todo horário aberto vale porque nenhum está
   * disputado.
   *
   * A trava anti-invenção sempre olhou para o lado de afirmar demais (preço,
   * condição, promoção). Este é o lado oposto e ninguém tinha olhado: **negar
   * uma coisa que existe.** E ele é pior de detectar — a lead desiste na hora,
   * não reclama, e nada aparece em tela nenhuma.
   *
   * Onde o recurso É disputado (clínica, salão: um profissional atende um por
   * vez), a lista de livres é exaustiva e "não está livre" é fato. Por isso a
   * chave é do manifesto, não do código.
   */
  const agendaDoRamo = (manifest.scheduling ?? {}) as { todo_horario_aberto_vale?: boolean };
  const regraDeHorario = agendaDoRamo.todo_horario_aberto_vale
    ? "- Horário: a lista de HORÁRIOS LIVRES é apenas SUGESTÃO — neste ramo o atendimento é por ordem de chegada, dentro do horário de funcionamento, e NADA está disputado. Se o cliente pedir um dia ou turno que cai dentro do funcionamento (ver os FATOS), **confirme que dá**. NUNCA diga que está ocupado, cheio ou sem vaga: o sistema não tem essa informação, e negar horário que existe faz a pessoa desistir na hora. Só se o pedido cair FORA do funcionamento, diga o horário em que a empresa abre."
    : "- Horário SÓ pode ser oferecido a partir da lista de HORÁRIOS REALMENTE LIVRES. Nunca invente data nem confirme um horário que não esteja lá. Se o cliente pedir um que não está na lista, diga que **aquele horário não está livre na agenda** (não afirme o motivo) e ofereça DOIS da lista — nunca deixe a pessoa sem opção concreta.";

  // Catálogo: itens que casam com o que o cliente pediu. É extensão da trava
  // anti-invenção — preço e estoque só podem sair daqui.
  let catalogo = "";
  const termos = message
    .toLowerCase()
    .replace(/[^\wàáâãéêíóôõúç\s-]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 6);
  if (termos.length) {
    const ors = termos.flatMap((t) => [`name.ilike.%${t}%`, `sku.ilike.%${t}%`, `brand.ilike.%${t}%`]).join(",");
    const { data: itens } = await supabase
      .from("catalog_items")
      .select("sku, name, brand, unit, price_cents, stock_qty")
      .eq("tenant_id", tenant.id)
      .eq("active", true)
      .or(ors)
      .limit(12);
    const lista = (itens as { sku: string | null; name: string; brand: string | null; unit: string | null; price_cents: number | null; stock_qty: number | null }[] | null) ?? [];
    if (lista.length) {
      catalogo = lista
        .map((i) => {
          const preco = i.price_cents != null ? `R$ ${(i.price_cents / 100).toFixed(2).replace(".", ",")}` : "preço não cadastrado";
          const estoque = i.stock_qty != null ? `${i.stock_qty}${i.unit ? " " + i.unit : ""} em estoque` : "estoque não informado";
          return `- ${i.name}${i.brand ? ` (${i.brand})` : ""}${i.sku ? ` [cód. ${i.sku}]` : ""}: ${preco}, ${estoque}`;
        })
        .join("\n");
    }
  }

  // Aprendizado por feedback: respostas que JÁ converteram (reuso do que funciona).
  const { data: winData } = await supabase
    .from("interactions")
    .select("content, technique")
    .eq("tenant_id", tenant.id)
    .eq("direction", "outbound")
    .in("outcome", ["ganhou", "avancou"])
    .order("occurred_at", { ascending: false })
    .limit(4);
  const winners = ((winData as { content: string; technique: string | null }[] | null) ?? [])
    .map((w) => `Técnica: ${w.technique ?? "—"}\nResposta que converteu: ${w.content}`)
    .join("\n---\n");

  // ------------------------------------------------ O QUE JÁ SE OBSERVOU AQUI
  //
  // ⚠ O CICLO QUE FALTAVA — e ele entra COM FREIO.
  //
  // 846 interações do piloto já tinham escola E desfecho no banco, e nenhuma
  // linha lia isso: o motor aplicava técnica curada por opinião e nunca
  // descobria se funcionou nesta casa.
  //
  // O que entra no prompt não é um ranking. `notaParaOMotor` devolve `null`
  // sempre que a amostra não sustenta — que é a maioria das vezes — e quando
  // devolve texto, o texto se declara **observação, não instrução**. A
  // biblioteca continua decidindo a técnica.
  //
  // MEDE RESPOSTA, NÃO FECHAMENTO. Fechamento são 14 eventos no piloto
  // inteiro: qualquer leitura ali coroaria a escola com 1 acerto em 14 usos.
  // Resposta são centenas — e é o que a tese do produto pede, porque a perda
  // medida é silêncio, não objeção.
  //
  // E O RECORTE É POR ORIGEM, obrigatoriamente: convênio tem 9% de resposta
  // contra 54% do WhatsApp na base real. Somar as duas mede duas coisas
  // diferentes e chama de uma.
  let notaDoAprendizado: string | null = null;
  try {
    // ⚠ PAGINADO. Amostra cortada em 1.000 linhas ARBITRARIAS faria a
    // medicao declarar "sustenta" sobre um recorte que ninguem escolheu — e
    // a peca inteira existe para nao afirmar sem base.
    const linhas = await lerTudo<{ contact_id: string | null; outcome: string | null; schools: string[] | null }>(
      (de, ate) => supabase
        .from("interactions")
        .select("contact_id, outcome, schools")
        .eq("tenant_id", tenant.id)
        .not("outcome", "is", null)
        .order("occurred_at", { ascending: false })
        .range(de, ate),
      { rotulo: "interacoes do aprendizado" },
    );
    const ids = [...new Set(linhas.map((l) => l.contact_id).filter(Boolean))] as string[];
    // ⚠ EM LOTES, e o `.slice(0, 1000)` que estava aqui não era um limite: era
    // o corte do PostgREST escrito à mão, com a mesma consequência silenciosa.
    //
    // Contato sem origem no mapa cai no recorte errado — e a origem é
    // justamente a variável que o fundador impôs como obrigatória, porque
    // convênio tem 9% de resposta contra 54% do WhatsApp. Perder a origem de
    // parte da amostra é somar as duas coisas de volta, exatamente o erro que
    // o recorte existe para não cometer.
    //
    // 500 por lote deixa folga contra o teto de 1.000 linhas da resposta e
    // contra o tamanho da URL do `in()`.
    const origemDe = new Map<string, string | null>();
    for (let i = 0; i < ids.length; i += 500) {
      // paginacao-ok: o lote é de 500 ids e a resposta tem no máximo 500
      // linhas — metade do teto do PostgREST. É a própria paginação, feita
      // pela lista de ids em vez de por faixa.
      const { data: orig } = await supabase
        .from("contacts").select("id, source").in("id", ids.slice(i, i + 500));
      for (const c of (orig as { id: string; source: string | null }[] | null) ?? []) {
        origemDe.set(c.id, c.source);
      }
    }

    // Só o recorte da origem DESTE contato — comparar com a média de todas as
    // origens é o erro que a regra do fundador proíbe.
    const minhaOrigem = origemDoContato?.trim() || null;
    const eventos: Evento[] = linhas
      .filter((l) => Array.isArray(l.schools) && l.schools.length && l.outcome)
      .map((l) => ({
        escolas: l.schools as string[],
        desfecho: l.outcome as string,
        origem: origemDe.get(l.contact_id ?? "") ?? null,
        etapa: null,
      }))
      .filter((e) => (minhaOrigem ? (e.origem ?? "").trim() === minhaOrigem : true));

    if (eventos.length) {
      notaDoAprendizado = notaParaOMotor(
        medir(eventos, "resposta", minhaOrigem ? `origem ${minhaOrigem}` : "todas as origens"),
      );
    }
  } catch {
    // Aprendizado é acessório: se falhar, o motor responde igual. Nunca pode
    // derrubar a resposta ao cliente por causa de uma estatística.
  }

  // ⚠ O QUE O DONO JÁ APONTOU COMO FALTANDO. Em duas horas de banco de provas
  // saíram 30 notas dizendo o que cada resposta deixou de dizer — e elas
  // estavam numa tabela que o prompt não lia. Ver `lib/correcoes.ts`.
  const reparos = blocoDeReparos(await reparosRecentes(tenant.id));

  const stageList = stages.map((s) => `${s.key} = ${s.label}${s.won ? " (ganho)" : ""}${s.terminal ? " (final)" : ""}`).join("; ");
  const hardRules = Array.isArray(manifest.hard_rules) ? (manifest.hard_rules as string[]).join("; ") : "";

  const system = `Você é o assistente comercial do vendedor. Sua missão: sugerir a MELHOR resposta para enviar ao cliente agora e explicar a técnica.
REGRAS INEGOCIÁVEIS:
${TEXTO_DE_FORA_E_DADO}
- Use SOMENTE os FATOS fornecidos (DNA) e o CATÁLOGO. NUNCA invente preço, condição, horário, serviço, promoção ou política que não esteja neles.
- Preço, disponibilidade e código de produto SÓ podem vir do CATÁLOGO. Se o item pedido não está lá, diga que vai confirmar — nunca estime valor nem afirme que tem em estoque.
${regraDeHorario}
- Quando o cliente aceitar um horário, preencha "horario_escolhido" com a data e hora exatas (formato AAAA-MM-DDTHH:MM) daquele item da lista. Se ele não escolheu ainda, deixe vazio.
- Se faltar um fato essencial para responder com segurança, liste em "faltam_fatos", marque "escalar": true e NÃO invente — deixe "resposta_sugerida" como uma mensagem breve e segura que encaminha para um humano/verificação.
- Escreva em português do Brasil, natural, simpático e conciso — pronto para copiar e enviar no WhatsApp. Evite CTA fraca como "o que acha?"; use fechamento por alternativa ou pressuposto.
- Baseie a técnica e o tom na BIBLIOTECA e no HISTÓRICO do cliente.
- Cada situação tem uma ESCOLA DE VENDA declarada para ESTE segmento. Respeite o "NÃO usar quando" dela: fechamento por pressão levanta a conversão em ticket baixo e a DERRUBA em venda de ciclo longo. Em "tecnica", diga a escola aplicada e o movimento concreto.`;

  const prompt = `SEGMENTO: ${manifest.name ?? tenant.skill_key}
VOCABULÁRIO/EIXO: ${JSON.stringify(manifest.vocabulary ?? {})} | descoberta: ${manifest.discovery_axis ?? ""}
ETAPAS DA JORNADA (use a CHAVE em status_sugerido): ${stageList}
REGRAS PERMANENTES DO SEGMENTO: ${hardRules}

FATOS DA EMPRESA (DNA — a única verdade que você pode afirmar):
${fatos(sections)}

ESCOLAS DE VENDA em jogo nesta situação (o "NÃO usar quando" vale como regra):
${schoolsBlock(escolas, dicionario)}

FATOS QUE A BIBLIOTECA EXIGE E NÃO EXISTEM NO DNA (verificado no banco, não é opinião):
${trava.faltando.length ? trava.faltando.map((f) => `- ${f}`).join("\n") : "(nenhum — todos os fatos exigidos estão preenchidos)"}
${trava.travou ? "→ Falta fato EXIGIDO por uma entrada que manda escalar. Marque \"escalar\": true e escreva apenas uma mensagem curta e segura que encaminha para verificação humana. NÃO redija a resposta comercial." : ""}

BIBLIOTECA COMERCIAL (estratégia e técnicas — a base das respostas):
${library || "(biblioteca vazia)"}
${reparos ? `
${reparos}` : ""}
${notaDoAprendizado ? `
${notaDoAprendizado}` : ""}

HORÁRIOS SUGERIDOS pela agenda (ofereça DOIS destes quando o assunto for marcar):
${horarios || "(agenda não configurada — não ofereça horário específico; combine que vai confirmar)"}

CATÁLOGO — itens da empresa que casam com o pedido (preço e estoque SÓ podem sair daqui):
${catalogo || "(nenhum item do catálogo casou com a mensagem — não afirme preço nem disponibilidade de produto)"}

RESPOSTAS QUE JÁ CONVERTERAM NESTA EMPRESA (reuse o que funcionou com clientes parecidos, adaptando ao contexto atual):
${winners || "(ainda sem histórico de conversões registrado)"}

CONTEXTO DO CLIENTE:
${contactBlock}
${qualificacaoBlock ? `\n${qualificacaoBlock}\n` : ""}
MENSAGEM DO CLIENTE (responda a isto):
"""${message}"""

Analise e gere a melhor resposta agora.`;

  const res = await generateObject({ model: aiModel, schema, system, prompt });
  const object = res.object as AiAnswer;
  const usage = res.usage;

  // Valida o status sugerido contra as etapas reais do manifesto.
  const validKeys = new Set(stages.map((s) => s.key));
  if (!validKeys.has(object.status_sugerido)) object.status_sugerido = "";

  // A trava tem a palavra final. O modelo pode escalar por conta própria, mas
  // NÃO pode deixar de escalar quando a biblioteca exige um fato que o DNA não
  // tem — essa decisão é do dado, não do julgamento dele.
  if (trava.travou) object.escalar = true;
  // O caminho verificado no banco vem primeiro. O que o modelo escreveu só
  // entra se falar de outra coisa — senão a lista repete "pricing.plans" e
  // "pricing.plans (detalhamento dos valores)" como se fossem dois problemas.
  const doModelo = (object.faltam_fatos ?? []).filter(
    (f) => !trava.faltando.some((c) => f.trim().toLowerCase().startsWith(c.toLowerCase())),
  );
  object.faltam_fatos = [...new Set([...trava.faltando, ...doModelo])];

  // Registra custo/tokens no ledger (por empresa). A usage_ledger só aceita
  // escrita do service_role (RLS) — por isso o admin client. Best-effort: se
  // faltar a chave de service_role, a geração não quebra.
  const t = tokensOf(usage);
  try {
    const admin = createAdminClient();
    await admin.from("usage_ledger").insert({
      tenant_id: tenant.id,
      feature: "responder_ai",
      model: AI_MODEL,
      tokens_in: t.in,
      tokens_out: t.out,
      cost_cents: estimateCostCents(t.in, t.out),
    });
  } catch {
    // medição é best-effort; não interrompe a resposta ao vendedor
  }

  return { ok: true, data: object };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Erro no motor de IA: ${msg} — [${keyHint()}]` };
  }
}

// PRIMEIRA ABORDAGEM (proativo): não existe mensagem do cliente — nós iniciamos.
// Usado para contatos vindos de prospecção/licitações.
export async function gerarAbordagem(contactId: string): Promise<GerarResult> {
  if (!hasAIKey()) return { ok: false, error: "Chave de IA não configurada (AI_API_KEY)." };
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, error: "Sem empresa vinculada." };
  if (!contactId) return { ok: false, error: "Selecione o contato." };

  // Prospecção tem cota PRÓPRIA e DIÁRIA: aqui o risco não é o mês, é o lote.
  const cota = await verificarCota(tenant.id, "prospeccao");
  if (!cota.permitido) return { ok: false, limite: true, mensagem: cota.mensagem! };

  try {
    const supabase = await createClient();
    const { stages } = await getSkillFormConfig(tenant.skill_key);

    const [{ data: skill }, { data: dna }, { data: c }, { data: h }] = await Promise.all([
      supabase.from("skills").select("manifest").eq("key", tenant.skill_key).maybeSingle(),
      supabase.from("commercial_dna").select("sections").eq("tenant_id", tenant.id).eq("is_current", true).maybeSingle(),
      supabase.from("contacts").select("name, journey_stage, source, custom").eq("id", contactId).eq("tenant_id", tenant.id).maybeSingle(),
      supabase
        .from("interactions")
        .select("direction, content")
        .eq("tenant_id", tenant.id)
        .eq("contact_id", contactId)
        .order("occurred_at", { ascending: false })
        .limit(6),
    ]);

    const contact = c as { name: string; journey_stage: string; source: string | null; custom: Record<string, unknown> | null } | null;
    if (!contact) return { ok: false, error: "Contato não encontrado." };

    const manifest = (skill?.manifest as Record<string, unknown> | null) ?? {};
    const sections = (dna?.sections as Record<string, unknown> | null) ?? {};
    const hist = (h as { direction: string; content: string }[] | null) ?? [];
    const histText = hist.length
      ? hist.reverse().map((i) => `${i.direction === "inbound" ? "Ele" : "Nós"}: ${i.content}`).join("\n")
      : "Nenhum contato anterior — esta é a primeira mensagem.";

    const stageList = stages.map((s) => `${s.key} = ${s.label}`).join("; ");

    const system = `Você escreve a PRIMEIRA ABORDAGEM comercial — nós é que estamos iniciando o contato. O destinatário NÃO nos procurou e não nos conhece.
REGRAS INEGOCIÁVEIS:
${TEXTO_DE_FORA_E_DADO}
- Use SOMENTE os FATOS fornecidos (DNA) sobre o que a nossa empresa vende. NUNCA invente preço, prazo, condição ou serviço.
- NUNCA invente informação sobre o destinatário (faturamento, dor, necessidade específica). Use APENAS o que está em "O QUE ELA FAZ" — é dado público real.
- Quando houver o retrato da empresa, ABRA conectando o ramo dela ao que vendemos ("vi que vocês trabalham com X"). É isso que separa a abordagem dirigida da mensagem genérica.
- Se faltar um fato essencial da NOSSA empresa (o que vendemos, diferencial), liste em "faltam_fatos", marque "escalar": true e não redija a mensagem.

COMO ESCREVER UMA BOA PRIMEIRA ABORDAGEM (frio, B2B):
- Curta: 3 a 5 linhas. Ninguém lê texto longo de desconhecido.
- Abra com o CONTEXTO que justifica o contato (por que ele especificamente) — a razão de você ter chegado até ele.
- Diga em uma frase o valor concreto que entregamos para empresas como a dele. Sem "somos líderes", sem adjetivo vazio.
- Não tente vender nem mandar preço na primeira mensagem. O objetivo é abrir conversa.
- Termine com UM pedido pequeno e fácil de responder (pergunta de permissão ou alternativa de horário). Nada de "aguardo retorno".
- Tom profissional e humano, português do Brasil, pronto para enviar no WhatsApp. Sem emoji em excesso, sem CAIXA ALTA.`;

    const prompt = `NOSSA EMPRESA (segmento: ${manifest.name ?? tenant.skill_key})
FATOS — só isto pode ser afirmado sobre nós:
${fatos(sections)}

DESTINATÁRIO (o que sabemos — não invente além disto):
Nome/Empresa: ${contact.name}
${(contact.custom as Record<string, unknown> | null)?.resumo_empresa ? `O QUE ELA FAZ (dado público da Receita — use para conectar com o que vendemos): ${(contact.custom as Record<string, unknown>).resumo_empresa}` : ""}
Origem: ${contact.source ?? "prospecção"}
Etapa: ${stages.find((s) => s.key === contact.journey_stage)?.label ?? contact.journey_stage}
${contact.custom && Object.keys(contact.custom).length ? `Outros dados: ${JSON.stringify(contact.custom)}` : ""}

HISTÓRICO:
${histText}

ETAPAS DA JORNADA (chave para status_sugerido): ${stageList}

Escreva a primeira mensagem de abordagem para este contato.
Em "explicacao", explique ao vendedor por que a abordagem foi construída assim.
Em "proximo_passo", diga o que fazer se ele responder e o que fazer se não responder.
Deixe "status_sugerido" vazio.`;

    const res = await generateObject({ model: aiModel, schema, system, prompt });
    const object = res.object as AiAnswer;
    object.status_sugerido = "";

    const t = tokensOf(res.usage);
    try {
      const admin = createAdminClient();
      await admin.from("usage_ledger").insert({
        tenant_id: tenant.id,
        feature: "primeira_abordagem",
        model: AI_MODEL,
        tokens_in: t.in,
        tokens_out: t.out,
        cost_cents: estimateCostCents(t.in, t.out),
      });
    } catch {
      // medição best-effort
    }

    return { ok: true, data: object };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Erro no motor de IA: ${msg} — [${keyHint()}]` };
  }
}

// Salva a interação (pergunta do cliente + resposta) no histórico do contato.
// Sem redirect — chamada direto pelo componente de IA.
export async function saveInteraction(
  contactId: string,
  inbound: string,
  outbound: string,
  technique?: string,
): Promise<{ ok: boolean; id?: string }> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant || !contactId) return { ok: false };

  const supabase = await createClient();
  const base = {
    tenant_id: tenant.id,
    contact_id: contactId,
    created_by: membership!.membershipId,
    channel: "whatsapp",
  };

  if (inbound.trim()) {
    await supabase.from("interactions").insert({
      ...base,
      direction: "inbound",
      input_kind: "customer_message",
      content: inbound.trim(),
    });
  }

  let id: string | undefined;
  if (outbound.trim()) {
    const { data, error } = await supabase
      .from("interactions")
      .insert({
        ...base,
        direction: "outbound",
        input_kind: "agent_briefing",
        content: outbound.trim(),
        technique: technique?.trim() || null,
      })
      .select("id")
      .single();
    if (error) return { ok: false };
    id = (data as { id: string }).id;
  }

  revalidatePath(`/painel/contatos/${contactId}`);
  revalidatePath("/painel/responder");
  return { ok: true, id };
}

// Registra o desfecho CANONICO de um atendimento (0044). A chave e de
// processo, nao de mercado; o rotulo do ramo fica na tela.
// É o feedback que alimenta o "aprender o que converte".
export async function setOutcome(
  interactionId: string,
  outcome: "respondeu" | "avancou" | "ganhou" | "perdeu_decisao" | "perdeu_silencio",
): Promise<{ ok: boolean }> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant || !interactionId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("interactions")
    .update({ outcome })
    .eq("id", interactionId)
    .eq("tenant_id", tenant.id);
  revalidatePath("/painel/responder");
  return { ok: !error };
}

// Aplica o avanço de etapa sugerido pela IA (registra no histórico da jornada).
export async function applyStage(
  contactId: string,
  toStage: string,
  reason: string,
): Promise<{ ok: boolean }> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant || !contactId || !toStage) return { ok: false };

  const supabase = await createClient();
  const { data: cur } = await supabase
    .from("contacts")
    .select("journey_stage")
    .eq("id", contactId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  const from = (cur as { journey_stage: string } | null)?.journey_stage ?? null;
  if (from === toStage) return { ok: true };

  await supabase
    .from("contacts")
    .update({ journey_stage: toStage, stage_entered_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("tenant_id", tenant.id);
  await supabase.from("contact_stage_history").insert({
    tenant_id: tenant.id,
    contact_id: contactId,
    from_stage: from,
    to_stage: toStage,
    reason: reason || "Avanço sugerido pela IA",
    triggered_by: "ai_detected",
  });

  revalidatePath(`/painel/contatos/${contactId}`);
  revalidatePath("/painel/funil");
  return { ok: true };
}
