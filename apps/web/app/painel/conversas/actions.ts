"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { credencialDoCanal, credencialDoDirect } from "@/lib/credenciais";
import { rotaDaResposta } from "@/lib/roteamento";
import { janelaDeAtendimento } from "@/lib/whatsapp-webhook";
import { enviarPelaCloudAPI, enviarPeloDirect } from "@/lib/envio";
import { gerarResposta } from "../responder/ai-actions";
import { getSkillFormConfig } from "@/lib/skill";
import { ajustarRetorno } from "@/lib/retorno";
import { guardarCorrecao, origemDaMensagem } from "@/lib/correcoes";
import { paraE164BR } from "@/lib/phone";
import { registrarEnvio } from "@/lib/custo_mensagem-db";
import { revalidatePath } from "next/cache";

// ⚠ `maxDuration` NÃO PODE MORAR AQUI. Arquivo `"use server"` só exporta
// função assíncrona — qualquer outra exportação quebra o BUILD, não o
// typecheck. O tempo da função é declarado na PÁGINA que invoca a ação
// (`conversas/page.tsx`), e é lá que ele está.

export type RespostaResult =
  | { ok: true; id: string }
  | { ok: false; motivo: string };

/**
 * RESPONDER PELO NÚMERO OFICIAL — a metade que faltava do canal.
 *
 * ⚠ POR QUE ISTO É O ITEM MAIS IMPORTANTE DA AUTOMAÇÃO, e não um detalhe de
 * conveniência.
 *
 * Até aqui o produto sabia MANDAR pelo número da empresa e não sabia
 * RESPONDER por ele. Quem escrevesse para o número do sistema só podia ser
 * atendido pelo WhatsApp pessoal de um vendedor — outro número, do lado do
 * cliente outra pessoa. E o caso que expõe isso é o que o fundador levantou:
 * **o cliente que pede para falar com um humano.** Ele pede socorro e o
 * socorro chega de um desconhecido.
 *
 * Automatizar a saída sem ter a volta é construir uma máquina de gerar
 * conversas que ninguém consegue continuar. Por isso esta ação vem ANTES do
 * motor proativo.
 *
 * ⚠ E ELA NÃO ESCOLHE CANAL. `rotaDaResposta` não tem configuração: a resposta
 * sai por onde a conversa está. Uma chave para desligar isso seria uma chave
 * para quebrar conversa pela metade.
 */
/**
 * GERA A SUGESTÃO PARA ESTA CONVERSA — sem enviar nada.
 *
 * ⚠ ELA EXISTE PORQUE O FLUXO QUE O FUNDADOR PEDIU PULAVA DE TELA. A conversa
 * mora aqui e a geração morava no *Responder*: para aprovar uma resposta ele
 * precisava sair, achar o contato de novo, colar a mensagem e voltar. Com uma
 * ou duas respostas por dia dá para levar; com dez, ninguém faz.
 *
 * ⚠ E ELA PEGA A ÚLTIMA MENSAGEM **DELE**, não a última da conversa. Gerar em
 * cima da nossa própria mensagem faria o motor responder a si mesmo.
 */
export async function gerarSugestaoDaConversa(
  contactId: string,
): Promise<
  | {
      ok: true; texto: string; escalar: boolean; faltam: string[]; retornoEm: string;
      /**
       * ⚠ O HORÁRIO QUE ELE ACEITOU — e ele NÃO EXISTIA nesta tela.
       *
       * `marcarCompromisso` estava ligado só na tela *Responder*, onde alguém
       * cola a mensagem à mão. Na conversa do canal — que é por onde a campanha
       * inteira acontece — a IA lia "pode ser terça de manhã", escrevia a
       * confirmação, e **nada ia para a agenda**.
       *
       * É a mesma falha que o fundador acabou de pegar com a equipe: duas
       * pessoas fizeram a semana experimental e ninguém cadastrou, então o
       * sistema não lembrou de ninguém por dez dias. Só que aqui seria o
       * sistema cometendo o erro que ele existe para impedir.
       */
      horarioEscolhido: string;
    }
  | { ok: false; motivo: string }
> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, motivo: "Sem empresa vinculada." };
  if (!contactId) return { ok: false, motivo: "Contato não informado." };

  const supabase = await createClient();
  // paginacao-ok: uma linha, a mais recente, endereçada por índice.
  const { data: ult } = await supabase
    .from("interactions")
    .select("content")
    .eq("tenant_id", tenant.id)
    .eq("contact_id", contactId)
    .eq("direction", "inbound")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const mensagem = ((ult as { content: string | null } | null)?.content ?? "").trim();
  if (!mensagem) return { ok: false, motivo: "Ele ainda não escreveu nada nesta conversa." };

  const r = await gerarResposta({ contactId, message: mensagem });
  if (!r.ok) return { ok: false, motivo: "limite" in r ? r.mensagem : r.error };

  // ⚠ `texto` PODE VIR VAZIO, e isso é a trava anti-invenção agindo. Quem
  // chama precisa distinguir "não escreveu" de "falhou" — testar a verdade da
  // string aqui repetiria o defeito de 20/ago, em que a tela ficava idêntica
  // depois do clique e a pessoa concluía que o botão estava quebrado.
  return {
    ok: true,
    texto: r.data.resposta_sugerida ?? "",
    escalar: !!r.data.escalar,
    faltam: r.data.faltam_fatos ?? [],
    // A data que ELE disse, lida da frase dele. Sugestão para uma pessoa
    // confirmar — nunca gravação automática.
    //
    // ⚠ E QUANDO ELE FALOU SÓ DO MÊS, quem escolhe o dia é a REGRA DA CASA:
    // primeira segunda-feira. O modelo classifica se houve dia ou não; a
    // aritmética de calendário é do código. Ver `lib/retorno.ts`.
    retornoEm: /^\d{4}-\d{2}-\d{2}$/.test(r.data.retorno_em ?? "")
      ? ajustarRetorno(r.data.retorno_em, !!r.data.retorno_vago)
      : "",
    horarioEscolhido: (r.data.horario_escolhido ?? "").trim(),
  };
}

/**
 * REGISTRA O QUE FICOU COMBINADO — a data em que ELE disse que volta.
 *
 * ⚠ POR QUE ISTO FALTAVA, e a falta apareceu na primeira resposta real da
 * campanha. A Nanci avisou que retorna em setembro. A conversa foi respondida
 * e **nada foi registrado**: sem data, sem anotação, ela segue como ex-aluna
 * qualquer. Em setembro ninguém lembraria — e o fundador perguntou exatamente
 * isso: *"será que o sistema identificou esse agendamento e já registrou?"*.
 *
 * ⚠ A DATA VAI PARA `next_action_at` E A FRASE PARA `next_action_note`, e as
 * duas importam. `lib/fila.ts` só chama de **combinado** — o motivo de
 * prioridade MÁXIMA — quando existe nota; sem ela vira `lembrete` genérico. A
 * nota é o pretexto da conversa seguinte: "você tinha dito que voltava em
 * setembro" abre a mensagem sozinha, e furar uma data que a PESSOA marcou é o
 * mais caro que existe aqui.
 *
 * ⚠ E QUEM CONFIRMA É GENTE. A IA sugere a data lendo a frase dela; quem
 * aperta é quem leu a conversa. Gravar direto pela leitura do modelo criaria
 * compromisso que ninguém combinou — e compromisso inventado vira mensagem
 * cobrando algo que a pessoa nunca disse.
 */
/**
 * DECLARA QUE AQUELA CONVERSA NÃO PRECISA MAIS DE RESPOSTA.
 *
 * ⚠ POR QUE ISTO É UM BOTÃO E NÃO UMA DEDUÇÃO. A Daniela fechou com um
 * "Combinado" depois de já ter sido respondida — para a tela, a última
 * mensagem é dela e ela está esperando; para quem lê, a conversa acabou.
 *
 * Pedir para a IA classificar o fecho custaria uma chamada em toda mensagem
 * que chega, e o erro tem lados muito diferentes: fechar por engano SOME com
 * alguém que esperava resposta, que é o defeito mais caro desta tela. Um
 * clique de quem leu custa dois segundos e não erra.
 *
 * ⚠ E NÃO ARQUIVA A PESSOA. Se ela escrever depois, volta para a lista na
 * hora — a comparação é com a data, não com um interruptor.
 */
/**
 * REGISTRA POR QUE A PESSOA PAROU.
 *
 * ⚠ A CHAVE É VALIDADA CONTRA O MANIFESTO, nunca aceita crua. Chave inventada
 * viraria uma categoria de uma pessoa só, e o valor deste campo é justamente
 * poder somar: "41 saíram por preço" decide a campanha seguinte; "41 motivos
 * diferentes" não decide nada.
 *
 * ⚠ E A FRASE DELA VAI JUNTO. A chave soma; a frase é o pretexto da próxima
 * conversa. *"Você tinha me dito que ia começar a fazer hora extra"* abre a
 * mensagem sozinha — "motivo: tempo" não abre nada.
 */
export async function registrarMotivoDeSaida(entrada: {
  contactId: string;
  motivo: string;
  texto?: string;
}): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, motivo: "Sem empresa vinculada." };

  const { churnReasons } = await getSkillFormConfig(tenant.skill_key);
  const valida = (churnReasons as { key: string }[]).some((r) => r.key === entrada.motivo);
  if (!valida) return { ok: false, motivo: "Motivo desconhecido para este ramo." };

  const supabase = await createClient();
  // paginacao-ok: UPDATE de UMA linha, endereçada por chave primária. O
  // `.select("id")` existe para conferir que a gravação alcançou alguém.
  const { data, error } = await supabase
    .from("contacts")
    .update({
      motivo_saida: entrada.motivo,
      motivo_saida_texto: entrada.texto?.trim() || null,
      motivo_saida_em: new Date().toISOString(),
    })
    .eq("id", entrada.contactId)
    .eq("tenant_id", tenant.id)
    .select("id");

  if (error) return { ok: false, motivo: error.message };
  if (!data?.length) return { ok: false, motivo: "Contato não encontrado nesta empresa." };

  revalidatePath("/painel/conversas");
  revalidatePath(`/painel/contatos/${entrada.contactId}`);
  return { ok: true };
}

export async function encerrarAtendimento(
  contactId: string,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, motivo: "Sem empresa vinculada." };

  const supabase = await createClient();
  // paginacao-ok: UPDATE de UMA linha, endereçada por chave primária. O
  // `.select("id")` devolve no máximo um registro — existe para conferir que a
  // gravação alcançou alguém, não para listar.
  const { data, error } = await supabase
    .from("contacts")
    .update({ atendimento_encerrado_em: new Date().toISOString() })
    .eq("id", contactId)
    .eq("tenant_id", tenant.id)
    .select("id");

  if (error) return { ok: false, motivo: error.message };
  if (!data?.length) return { ok: false, motivo: "Contato não encontrado nesta empresa." };

  revalidatePath("/painel/conversas");
  return { ok: true };
}

export async function registrarCombinado(entrada: {
  contactId: string;
  data: string;
  nota: string;
}): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, motivo: "Sem empresa vinculada." };

  const data = (entrada.data ?? "").trim();
  const nota = (entrada.nota ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, motivo: "Data inválida." };
  if (!nota) {
    return {
      ok: false,
      motivo: "Escreva o que ficou combinado — sem isso a conversa seguinte não tem assunto.",
    };
  }

  const supabase = await createClient();
  // `.select()` porque escrita sem erro conferido é escrita que você ACHA que
  // fez — e esta decide se a pessoa volta a aparecer na fila.
  const { data: linhas, error } = await supabase
    .from("contacts")
    .update({
      next_action: "Retorno combinado",
      next_action_at: data,
      next_action_note: nota,
      // ⚠ REGISTRAR O COMBINADO TAMBÉM ENCERRA. Quem marcou a data fez o que
      // a conversa pedia — deixá-la na lista de "aguardando" faria a pessoa
      // procurar, todo dia, o que já resolveu.
      atendimento_encerrado_em: new Date().toISOString(),
    })
    .eq("id", entrada.contactId)
    .eq("tenant_id", tenant.id)
    .select("id");

  if (error) return { ok: false, motivo: error.message };
  if (!linhas?.length) return { ok: false, motivo: "Contato não encontrado nesta empresa." };

  revalidatePath("/painel/conversas");
  revalidatePath("/painel/fila");
  revalidatePath(`/painel/contatos/${entrada.contactId}`);
  return { ok: true };
}

export async function responderPeloCanal(
  contactId: string,
  texto: string,
  /**
   * O que a IA tinha sugerido, quando a resposta veio dela.
   *
   * ⚠ É O QUE FECHA O CICLO DE APRENDIZADO SEM DEPENDER DE NINGUÉM LEMBRAR.
   * Se o texto enviado difere do sugerido, a diferença é uma correção — e ela
   * é guardada aqui, no momento em que acontece. Pedir que alguém registre
   * depois é o mesmo que não ter.
   */
  sugerido?: string,
): Promise<RespostaResult> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, motivo: "Sem empresa vinculada." };
  if (!contactId) return { ok: false, motivo: "Contato não informado." };

  const limpo = (texto ?? "").trim();
  if (!limpo) return { ok: false, motivo: "Mensagem vazia." };

  const supabase = await createClient();

  const [{ data: c }, credencial] = await Promise.all([
    // paginacao-ok: uma linha, endereçada pela chave primária do contato.
    supabase
      .from("contacts")
      // ⚠ AS TRÊS CHAVES DA MESMA PESSOA. Telefone, IGSID e PSID: a mesma
      // pessoa tem um id em cada plataforma, e a resposta sai por onde a
      // conversa está — nunca por onde é mais fácil.
      .select("phone, instagram_id, facebook_id")
      .eq("id", contactId)
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    credencialDoCanal(tenant.id),
  ]);
  const contact = c as {
    phone: string | null;
    instagram_id: string | null;
    facebook_id: string | null;
  } | null;
  if (!contact) return { ok: false, motivo: "Contato não encontrado." };

  // ⚠ A JANELA VEM DA ÚLTIMA MENSAGEM **DELE PELO CANAL OFICIAL**, e as duas
  // condições importam. `direction=inbound` porque a nossa própria mensagem
  // não reabre janela nenhuma — a Meta recusaria o texto livre seguinte com um
  // erro que se lê como credencial errada. E `external_id not null` porque
  // mensagem colada no Responder à mão também é inbound, e ela NÃO passou pela
  // Meta: contar como janela aberta faria o sistema tentar responder por um
  // canal onde a conversa nunca esteve.
  //
  // paginacao-ok: uma linha, a mais recente, endereçada por índice.
  const { data: entrada } = await supabase
    .from("interactions")
    // ⚠ O CANAL VEM JUNTO, e é ele que decide por onde a resposta sai. A
    // pergunta "por onde a conversa está" tem uma resposta só, e ela está na
    // última mensagem dela — não numa configuração e não no que a ficha tem
    // preenchido.
    .select("occurred_at, channel")
    .eq("tenant_id", tenant.id)
    .eq("contact_id", contactId)
    .eq("direction", "inbound")
    .not("external_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ultima = entrada as { occurred_at: string; channel: string | null } | null;
  const quando = ultima?.occurred_at ?? null;
  const canalDaConversa = (ultima?.channel ?? "whatsapp") as "whatsapp" | "instagram" | "facebook";
  const janela = janelaDeAtendimento(quando);

  // ⚠ A CREDENCIAL QUE IMPORTA É A DO CANAL DESTA CONVERSA. Perguntar pelo
  // token do WhatsApp para responder um direct do Instagram faria a empresa
  // que só tem Instagram receber *"o canal oficial não está configurado"* —
  // recusa certa pelo motivo errado, que manda a pessoa consertar o que não
  // está quebrado.
  const credencialDoDirectDaConversa =
    canalDaConversa === "whatsapp" ? null : await credencialDoDirect(tenant.id, canalDaConversa);

  const rota = rotaDaResposta({
    temCredencial: canalDaConversa === "whatsapp" ? !!credencial : !!credencialDoDirectDaConversa,
    conversaNoCanalOficial: !!quando,
    janelaAberta: janela.aberta,
  });

  if (rota.via !== "cloud_api_texto") return { ok: false, motivo: rota.porque };

  // ⚠ A RESPOSTA SAI POR ONDE A CONVERSA ESTÁ. Instagram e Messenger não têm
  // telefone: derivar E.164 de uma ficha sem telefone devolvia *"telefone
  // inválido"* para quem tinha escrito pelo direct — diagnóstico errado, e
  // erro de diagnóstico é o que ensina a pessoa a ignorar o aviso da próxima
  // vez. Foram 10 contatos do Instagram nessa situação até 4/set.
  let envio: { ok: true; id: string } | { ok: false; motivo: string };
  if (canalDaConversa === "instagram" || canalDaConversa === "facebook") {
    const direct = credencialDoDirectDaConversa;
    if (!direct) {
      return {
        ok: false,
        motivo:
          canalDaConversa === "instagram"
            ? "A conversa é do Instagram e esta empresa não tem a conta e o token do Instagram salvos em Automação → Canal oficial."
            : "A conversa é do Facebook e esta empresa não tem a página e o token da página salvos em Automação → Canal oficial.",
      };
    }
    const destinatario =
      canalDaConversa === "instagram" ? contact.instagram_id : contact.facebook_id;
    envio = await enviarPeloDirect(canalDaConversa, destinatario ?? "", limpo, direct);
  } else {
    const num = paraE164BR(contact.phone);
    if (!num.ok) return { ok: false, motivo: num.motivo };
    envio = await enviarPelaCloudAPI(num.digitos, limpo, credencial!);
  }
  if (!envio.ok) return { ok: false, motivo: envio.motivo };

  // A mensagem JÁ SAIU. Falhar em registrar não a desfaz, então o erro sobe
  // para a tela em vez de sumir: sem registro, a conversa fica com um buraco e
  // a cadência não quita.
  const { error } = await supabase.from("interactions").insert({
    tenant_id: tenant.id,
    contact_id: contactId,
    direction: "outbound",
    // É RESPOSTA A UMA PESSOA, não iniciativa do sistema. O `input_kind` é o
    // que separa tempo de resposta de toque proativo na Gestão — trocar um
    // pelo outro estragaria a métrica que o produto vende.
    input_kind: "agent_briefing",
    // ⚠ O CANAL REAL, nunca "whatsapp" fixo. Gravar tudo como WhatsApp fazia a
    // conversa do Instagram parecer conversa de WhatsApp no histórico — e a
    // janela de 24h da próxima resposta seria calculada contra o canal errado.
    channel: canalDaConversa,
    external_id: envio.id,
    content: limpo,
    occurred_at: new Date().toISOString(),
    created_by: membership!.membershipId,
    // ⚠ O NÚMERO QUE AUTORIZA O AUTOMÁTICO.
    //
    // Sem esta coluna, "aceitei a sugestão sem mexer" é indistinguível de
    // "escrevi do zero" — as duas viram uma linha `outbound` igual. E é
    // exatamente essa diferença que decide se dá para tirar a pessoa do meio.
    //
    // `ai_edits` guarda só as EDITADAS, de propósito: mensagem idêntica não é
    // lição, e encheria o bloco do prompt de ruído. Mas para a DECISÃO, as
    // idênticas são o sinal — são elas que dizem que a IA acertou sozinha.
    origem_ia: origemDaMensagem(sugerido, limpo),
  });
  if (error) {
    console.error(`[conversas] resposta ${envio.id} SAIU mas não registrou: ${error.message}`);
    return {
      ok: false,
      motivo: `A mensagem foi enviada, mas eu não consegui registrar: ${error.message}`,
    };
  }

  // Resposta em texto livre é `servico`: grátis até 1º/out/2026, cobrada
  // depois. Medir desde já é o que faz a virada não ser surpresa.
  //
  // ⚠ INSTAGRAM E MESSENGER NÃO ENTRAM NA CONTA. A Meta cobra conversa no
  // WhatsApp Business; direct não é cobrado. Somar os três infla o gasto
  // previsto e, pior, faz o TETO de mensagens frear a campanha do WhatsApp por
  // causa de conversa que não custou nada — freio certo, motivo inventado.
  if (canalDaConversa === "whatsapp") {
    await registrarEnvio(tenant.id, { temModelo: false });
  }

  // ⚠ A CORREÇÃO É GUARDADA AQUI, no instante em que ela existe.
  //
  // Se o texto enviado difere do que a IA sugeriu, alguém acabou de ensinar o
  // motor — e esse é o sinal que o produto inteiro persegue. `guardarCorrecao`
  // é best-effort e só grava quando houve mudança de verdade: mensagem enviada
  // igualzinha é confirmação, não lição.
  if (sugerido?.trim()) {
    await guardarCorrecao({
      tenantId: tenant.id,
      contactId,
      membershipId: membership!.membershipId,
      contexto: "Resposta pelo canal oficial, dentro da janela de 24h.",
      sugerido,
      enviado: limpo,
    });
  }

  revalidatePath("/painel/conversas");
  revalidatePath("/painel/correcoes");
  revalidatePath(`/painel/contatos/${contactId}`);
  return { ok: true, id: envio.id };
}
