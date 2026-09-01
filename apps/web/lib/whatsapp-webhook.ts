// O WEBHOOK DO WHATSAPP — a metade que RECEBE.
//
// Envio e recebimento não são simétricos, e a diferença decide a segurança.
// Enviar é uma chamada nossa para a Meta, autenticada por token: se o token
// estiver errado, não sai. Receber é a Meta (ou QUALQUER UM) chamando um
// endereço público nosso — e um endereço público que grava no banco sem
// conferir quem chamou é uma porta para escrever conversa falsa no histórico
// de um cliente pagante.
//
// Por isso este arquivo é quase todo verificação, e por isso ele é PURO:
// assinatura e desmontagem do pacote são funções sem rede e sem banco, para
// poderem ser testadas com um pacote de mentira. O que sobra na rota é só
// "isto é válido? então grave".
//
// A LEI 1 VALE AQUI. Nada neste arquivo sabe o que é aluno, matrícula ou
// plano — ele fala de mensagem, contato e empresa.

import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------
// 1. A ASSINATURA
// ---------------------------------------------------------------------

/**
 * Confere o `X-Hub-Signature-256` que a Meta manda.
 *
 * É HMAC-SHA256 do CORPO CRU com o App Secret. "Corpo cru" não é preciosismo:
 * se a rota fizer `JSON.parse` e depois `JSON.stringify` para conferir, a
 * ordem das chaves e os espaços mudam, o hash muda, e a verificação passa a
 * rejeitar pacote legítimo — o tipo de defeito que se conserta desligando a
 * verificação, que é o pior desfecho possível.
 *
 * A comparação é `timingSafeEqual` porque comparar hash com `===` vaza, pelo
 * TEMPO da resposta, quantos caracteres iniciais estavam certos. É um ataque
 * lento e chato, e é exatamente por isso que ninguém percebe que está
 * acontecendo.
 */
/**
 * De qual NÚMERO o pacote fala — lido do corpo cru, sem confiar nele.
 *
 * ⚠ ISTO RODA ANTES DA ASSINATURA SER CONFERIDA, e é a única coisa que pode.
 * O segredo que valida a assinatura é da empresa, e descobrir a empresa exige
 * ler o `phone_number_id`, que só existe dentro do corpo. Ler para ESCOLHER A
 * CHAVE é diferente de confiar no conteúdo: quem mentir esse campo só escolhe
 * contra qual segredo vai ser conferido, e a assinatura dele não bate com
 * nenhum.
 *
 * Devolve `null` em qualquer formato inesperado — inclusive JSON inválido. A
 * consequência de `null` é a recusa, que é o lado certo para errar.
 */
export function phoneNumberIdDoPacote(corpoCru: string): string | null {
  try {
    const p = JSON.parse(corpoCru) as {
      entry?: { changes?: { value?: { metadata?: { phone_number_id?: unknown } } }[] }[];
    };
    const id = p?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export function assinaturaConfere(
  corpoCru: string,
  cabecalho: string | null | undefined,
  appSecret: string | null | undefined,
): { ok: true } | { ok: false; motivo: string } {
  if (!appSecret) return { ok: false, motivo: "WHATSAPP_APP_SECRET não configurado." };
  if (!cabecalho) return { ok: false, motivo: "Pedido sem assinatura." };
  if (!cabecalho.startsWith("sha256=")) {
    return { ok: false, motivo: "Assinatura em formato desconhecido." };
  }

  const recebida = cabecalho.slice("sha256=".length).trim();
  const esperada = createHmac("sha256", appSecret).update(corpoCru, "utf8").digest("hex");

  // `timingSafeEqual` exige o mesmo comprimento e explode se diferir; com
  // hexadecimal de tamanho fixo, comprimento diferente já é assinatura
  // inválida — então a checagem vem antes e devolve o mesmo "não confere".
  if (recebida.length !== esperada.length) return { ok: false, motivo: "Assinatura não confere." };

  const iguais = timingSafeEqual(Buffer.from(recebida, "utf8"), Buffer.from(esperada, "utf8"));
  return iguais ? { ok: true } : { ok: false, motivo: "Assinatura não confere." };
}

/**
 * A verificação de posse do endereço, que a Meta faz UMA vez ao cadastrar.
 * Ela chama com `hub.mode=subscribe` e um token combinado; devolvemos o
 * desafio em texto puro para provar que o endereço é nosso.
 */
export function respostaDoDesafio(
  params: URLSearchParams,
  tokenEsperado: string | null | undefined,
): { ok: true; desafio: string } | { ok: false; motivo: string } {
  // ⚠ A MENSAGEM É LIDA NA TELA DA META, POR QUEM ESTÁ CONFIGURANDO — e a
  // versão anterior mandava a pessoa procurar uma variável de ambiente que não
  // é mais o caminho. Quem vê isto está no Business Manager, travado, sem
  // acesso ao servidor: a instrução tem que dizer o que fazer NO PRODUTO.
  //
  // E a ORDEM é a armadilha real: a Meta valida o token no instante em que se
  // clica "Verificar e salvar", então ele precisa já estar salvo aqui ANTES.
  // Quem faz na ordem inversa recebe 403 e conclui que o endereço está errado.
  const comoResolver =
    "Salve o mesmo token em Automação → Canal oficial, no Kairós, ANTES de clicar em " +
    "\"Verificar e salvar\" aqui. A Meta confere na hora do clique.";
  if (!tokenEsperado) {
    return { ok: false, motivo: `Nenhum token de verificação cadastrado. ${comoResolver}` };
  }
  if (params.get("hub.mode") !== "subscribe") return { ok: false, motivo: "Modo inesperado." };
  if (params.get("hub.verify_token") !== tokenEsperado) {
    return { ok: false, motivo: `Token de verificação diferente do que está salvo. ${comoResolver}` };
  }
  const desafio = params.get("hub.challenge");
  if (!desafio) return { ok: false, motivo: "Sem desafio." };
  return { ok: true, desafio };
}

// ---------------------------------------------------------------------
// 2. O PACOTE
// ---------------------------------------------------------------------

export type MensagemRecebida = {
  /** Identificador da Meta (`wamid...`). É a chave contra duplicata. */
  wamid: string;
  /** Quem mandou, em dígitos E.164 (a Meta já entrega assim). */
  de: string;
  /** Nome do perfil do WhatsApp, quando vem. Útil para cadastrar quem é novo. */
  nome: string | null;
  /**
   * O texto da mensagem — ou, para mídia, uma DESCRIÇÃO do que chegou.
   *
   * Ver a nota de `desmontarPacote`: áudio e imagem não são baixados, mas
   * precisam existir como interação. O conteúdo aqui é o que o vendedor lê na
   * ficha para saber que há algo esperando no WhatsApp.
   */
  texto: string;
  /** `text` ou o tipo de mídia da Meta (`audio`, `image`, `document`…). */
  tipo: string;
  /**
   * O id da mídia na Meta, quando a mensagem é mídia. `null` para texto.
   *
   * ⚠ ELE VALE POUCO TEMPO. A Meta guarda o arquivo por alguns dias e a URL
   * de download é temporária — quem quiser o conteúdo baixa agora ou não
   * baixa mais. Hoje só o áudio é usado (ver `lib/audio.ts`); os outros ficam
   * aqui porque descartar o id é jogar fora a única chance de buscá-los.
   */
  midiaId: string | null;
  quando: Date;
  /** O número DA EMPRESA que recebeu — é o que diz de qual tenant é. */
  phoneNumberId: string;
  /**
   * ⚠ DE ONDE A PESSOA VEIO DE VERDADE — e o WhatsApp não é a resposta.
   *
   * O fundador nomeou: *"uma coisa é vir apenas do whats, mas o whats foi o
   * MEIO de contato; o lugar real pode ser a campanha do Meta"*. Registrar
   * todo mundo como "whatsapp" é registrar o telefone como origem de todo
   * cliente — e a origem é a única variável que ele impôs como obrigatória na
   * medição, porque convênio tem 9% de resposta contra 54% do WhatsApp.
   *
   * Quando alguém clica num anúncio "Clique para WhatsApp", a Meta manda um
   * bloco `referral` junto da PRIMEIRA mensagem, com o anúncio que originou o
   * clique. Ele vem uma vez só — se for descartado ali, a informação não
   * existe em lugar nenhum depois.
   */
  origem: OrigemDoContato | null;
};

/** O anúncio que trouxe a pessoa, quando ela veio de um. */
export type OrigemDoContato = {
  /** `ad` (anúncio) ou `post` (publicação orgânica). */
  tipo: string;
  /** O identificador do anúncio na Meta — é por ele que se compara campanha. */
  anuncioId: string | null;
  /** O título que ela leu antes de clicar. É o que a IA pode retomar. */
  titulo: string | null;
  corpo: string | null;
  /** A publicação de onde veio o clique. */
  url: string | null;
};

export type StatusDeEnvio = {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  quando: Date;
  erro: string | null;
  phoneNumberId: string;
};

export type PacoteDoWebhook = {
  mensagens: MensagemRecebida[];
  status: StatusDeEnvio[];
  /** O que veio e não sabemos tratar. Contado, não ignorado — ver nota abaixo. */
  ignorados: string[];
  /**
   * ⚠ O ID DA CONTA DO WHATSAPP BUSINESS (WABA), que estava chegando e sendo
   * jogado fora.
   *
   * `entry[].id` do pacote da Meta É o WABA id. Ele não está em lugar nenhum
   * das credenciais que a pessoa cola (token, id do número, chave secreta,
   * token de verificação), e sem ele não dá para ler os MODELOS APROVADOS pela
   * API (`GET /{waba_id}/message_templates`) — que é o que faria o corpo dos
   * modelos vir da Meta em vez de ser reconstruído do repositório.
   *
   * Tentei descobrir por três caminhos e os três recusam: o campo
   * `whatsapp_business_account` no id do número, os `granular_scopes` do
   * `debug_token` e as duas arestas de WABA do app. E ele estava no corpo de
   * toda mensagem recebida, o tempo inteiro.
   *
   * Mesma ideia do `idDoApp` em `lib/perfil-canal.ts`: **descobrir em vez de
   * pedir mais uma caixa no formulário**, que já é o gargalo da instalação.
   */
  wabaId: string | null;
};

/**
 * Desmonta o pacote da Meta.
 *
 * NUNCA LANÇA. Um webhook que devolve erro faz a Meta reenviar, e reenviar um
 * pacote que sempre quebra vira laço infinito — com a Meta desativando a
 * assinatura depois de tantas falhas. Pacote estranho é registrado em
 * `ignorados` e a rota responde 200: aceitar e não entender é melhor que
 * recusar e ser desligado.
 *
 * `ignorados` existe para que "áudio, imagem e figurinha chegaram e ninguém
 * viu" seja um NÚMERO em algum lugar, e não um silêncio. Hoje só texto é
 * tratado — o cliente que responde com áudio é caso real e frequente, e essa
 * lacuna precisa ser visível antes de alguém reclamar.
 */
/**
 * O id do arquivo, que a Meta põe dentro do bloco do próprio tipo:
 * `{ type: "audio", audio: { id, mime_type } }`.
 *
 * ⚠ LÊ PELO TIPO DECLARADO, não varrendo o objeto atrás de qualquer `id`. O
 * `mm.id` da mensagem também é um id e não é este — trocar os dois faria o
 * download pedir um arquivo que não existe, com erro que parece da Meta.
 */
function idDaMidia(mm: unknown, tipo: string): string | null {
  const bloco = (mm as Record<string, unknown> | null)?.[tipo];
  const id = (bloco as { id?: unknown } | null)?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function desmontarPacote(corpo: unknown): PacoteDoWebhook {
  const out: PacoteDoWebhook = { mensagens: [], status: [], ignorados: [], wabaId: null };
  const raiz = corpo as { object?: string; entry?: unknown[] } | null;
  if (!raiz || raiz.object !== "whatsapp_business_account" || !Array.isArray(raiz.entry)) {
    out.ignorados.push("pacote fora do formato do WhatsApp Business");
    return out;
  }

  for (const entrada of raiz.entry) {
    // ⚠ AQUI MORA O WABA ID. Vale para pacote de mensagem e de status — todo
    // webhook desta assinatura carrega o mesmo. O primeiro que aparecer serve.
    const idDaEntrada = (entrada as { id?: unknown })?.id;
    if (!out.wabaId && typeof idDaEntrada === "string" && idDaEntrada.trim()) {
      out.wabaId = idDaEntrada.trim();
    }

    const changes = (entrada as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;

    for (const mudanca of changes) {
      const m = mudanca as { field?: string; value?: Record<string, unknown> };
      if (m.field !== "messages" || !m.value) {
        if (m.field) out.ignorados.push(`campo "${m.field}"`);
        continue;
      }

      const v = m.value;
      const phoneNumberId =
        ((v.metadata as { phone_number_id?: string } | undefined)?.phone_number_id) ?? "";

      // Nome do perfil: a Meta manda numa lista separada, casada por `wa_id`.
      const perfis = new Map<string, string>();
      for (const c of (v.contacts as unknown[] | undefined) ?? []) {
        const ct = c as { wa_id?: string; profile?: { name?: string } };
        if (ct.wa_id && ct.profile?.name) perfis.set(ct.wa_id, ct.profile.name);
      }

      for (const msg of (v.messages as unknown[] | undefined) ?? []) {
        const mm = msg as {
          id?: string; from?: string; timestamp?: string; type?: string;
          text?: { body?: string };
          referral?: {
            source_type?: string; source_id?: string; source_url?: string;
            headline?: string; body?: string;
          };
        };
        if (!mm.id || !mm.from) continue;

        const tipo = mm.type ?? "desconhecido";
        const corpo = mm.type === "text" ? mm.text?.body?.trim() : null;

        // ⚠ MÍDIA VIRA INTERAÇÃO, e antes ela SUMIA — com um efeito muito
        // pior do que "o vendedor não vê a foto".
        //
        // Qualquer mensagem do cliente ABRE A JANELA DE 24 HORAS. Descartar o
        // áudio fazia o sistema achar que a janela continuava fechada: o
        // cliente respondia por áudio, a janela abria de verdade na Meta, e o
        // produto se recusava a responder dizendo que precisava de modelo
        // aprovado. **Quem responde por áudio não podia ser atendido** — e
        // responder por áudio é o caso mais comum que existe no WhatsApp
        // brasileiro.
        //
        // NÃO BAIXAMOS A MÍDIA, de propósito: baixar exige armazenamento,
        // custa, e guarda dado pessoal do cliente sem necessidade. O que fica
        // registrado é que ALGO chegou, com o tipo — o suficiente para a
        // janela abrir, para a cadência quitar e para o vendedor saber que há
        // algo esperando no aplicativo.
        const DESCRICAO: Record<string, string> = {
          audio: "(áudio recebido — ouça no WhatsApp)",
          image: "(imagem recebida — veja no WhatsApp)",
          video: "(vídeo recebido — veja no WhatsApp)",
          document: "(documento recebido — abra no WhatsApp)",
          sticker: "(figurinha recebida)",
          location: "(localização recebida — veja no WhatsApp)",
          contacts: "(contato compartilhado — veja no WhatsApp)",
        };

        const texto = corpo || DESCRICAO[tipo] || `(mensagem do tipo "${tipo}" — veja no WhatsApp)`;

        // Continua contado, porque "chegou mídia" é informação de operação: se
        // metade das respostas for áudio, isso muda o que o produto precisa
        // fazer. O que mudou é que agora ela também vira conversa.
        if (!corpo) out.ignorados.push(`mensagem do tipo "${tipo}"`);

        out.mensagens.push({
          wamid: mm.id,
          de: mm.from,
          nome: perfis.get(mm.from) ?? null,
          texto,
          tipo,
          midiaId: idDaMidia(mm, tipo),
          quando: paraData(mm.timestamp),
          phoneNumberId,
          // ⚠ SÓ VEM NA PRIMEIRA MENSAGEM depois do clique no anúncio. Não é
          // consultável depois: ou se guarda agora, ou a origem some.
          origem: mm.referral
            ? {
                tipo: mm.referral.source_type ?? "ad",
                anuncioId: mm.referral.source_id ?? null,
                titulo: mm.referral.headline ?? null,
                corpo: mm.referral.body ?? null,
                url: mm.referral.source_url ?? null,
              }
            : null,
        });
      }

      for (const st of (v.statuses as unknown[] | undefined) ?? []) {
        const s = st as {
          id?: string; status?: string; timestamp?: string;
          errors?: { title?: string; message?: string }[];
        };
        if (!s.id || !s.status) continue;
        if (!["sent", "delivered", "read", "failed"].includes(s.status)) {
          out.ignorados.push(`status "${s.status}"`);
          continue;
        }
        out.status.push({
          wamid: s.id,
          status: s.status as StatusDeEnvio["status"],
          quando: paraData(s.timestamp),
          erro: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? null,
          phoneNumberId,
        });
      }
    }
  }

  return out;
}

/** A Meta manda epoch em SEGUNDOS, como string. Multiplicar por 1000 ou a data cai em 1970. */
function paraData(ts: string | undefined): Date {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

// ---------------------------------------------------------------------
// 3. A JANELA DE 24 HORAS
//
// A regra da Meta que decide o que pode ser dito e quanto custa: respondendo
// alguém que escreveu nas últimas 24h, texto livre e sem cobrança. Fora
// disso, só MODELO aprovado, e cobrado.
//
// Isto não é detalhe de faturamento — é o que separa o produto em dois. O
// Responder (reagir a quem escreveu) cabe na janela quase sempre. A fila
// (follow-up, recompra, renovação) vive FORA dela por definição: ela existe
// justamente para falar com quem parou de falar. Ou seja: o coração do
// produto é o caso que precisa de modelo aprovado.
//
// Descobrir isso na hora de ligar seria descobrir tarde. Fica escrito aqui.
// ---------------------------------------------------------------------

export type Janela = {
  aberta: boolean;
  /** Minutos restantes, ou `null` se já fechou (ou nunca abriu). */
  minutosRestantes: number | null;
  /** O que a tela deve dizer a quem vai enviar. */
  aviso: string | null;
};

export const JANELA_HORAS = 24;

export function janelaDeAtendimento(
  ultimaEntrada: Date | string | null | undefined,
  agora: Date = new Date(),
): Janela {
  if (!ultimaEntrada) {
    return {
      aberta: false,
      minutosRestantes: null,
      aviso: "Este contato nunca escreveu por aqui — só dá para iniciar com modelo aprovado pela Meta.",
    };
  }

  const t = ultimaEntrada instanceof Date ? ultimaEntrada : new Date(ultimaEntrada);
  if (Number.isNaN(t.getTime())) {
    return { aberta: false, minutosRestantes: null, aviso: "Data da última mensagem inválida." };
  }

  const limite = t.getTime() + JANELA_HORAS * 3600_000;
  const faltam = Math.floor((limite - agora.getTime()) / 60_000);

  if (faltam <= 0) {
    return {
      aberta: false,
      minutosRestantes: null,
      aviso: "Faz mais de 24h que ele escreveu: texto livre não sai, só modelo aprovado.",
    };
  }

  // Menos de duas horas é o intervalo em que a pessoa monta a mensagem, sai
  // para o café e volta com a janela fechada. Avisar antes custa uma linha.
  const aviso =
    faltam <= 120
      ? `A janela de 24h fecha em ${faltam < 60 ? `${faltam} min` : `${Math.floor(faltam / 60)}h`}.`
      : null;

  return { aberta: true, minutosRestantes: faltam, aviso };
}
