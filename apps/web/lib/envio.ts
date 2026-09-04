// CAMADA DE ENVIO — uma porta só para a mensagem sair.
//
// POR QUE ELA EXISTE
// Até aqui o produto montava `https://wa.me/...` em SEIS telas, cada uma com
// a própria ideia de como normalizar o número — e uma delas corrompia números
// de DDD 55. Quando o envio deixar de ser só link, seriam seis lugares para
// mudar e seis chances de esquecer um.
//
// A decisão do fundador (ago/2026) é que o canal ainda não está escolhido: a
// API oficial da Meta é o caminho recomendado, mas a verificação sairia no
// CNPJ da Be Fitness, e isso resolve o piloto sem resolver o produto. Enquanto
// a escolha não fecha, o código precisa poder trocar de canal sem reescrever
// tela nenhuma. É exatamente para isso que esta camada serve.
//
// O QUE ELA **NÃO** FAZ, de propósito
// Ela não finge que os dois modos são iguais. Mandar por API e abrir o
// WhatsApp para um humano clicar são coisas diferentes, e achatar as duas num
// `enviar()` que devolve `true` esconderia a diferença que mais importa neste
// produto: hoje **quem aperta enviar é uma pessoa**. Por isso o resultado diz
// o MODO, e a tela é obrigada a lidar com os dois.

import { paraE164BR } from "./phone";
import { higienizarParametro } from "./modelo";

export { higienizarParametro, primeiroNome } from "./modelo";

export type Canal = "link_humano" | "cloud_api";

export type Destino = {
  telefone: string | null | undefined;
  texto: string;
};

export type ResultadoEnvio =
  /**
   * O texto está pronto e o número é válido: falta uma PESSOA clicar.
   * `link` abre o WhatsApp com a mensagem escrita.
   */
  | { ok: true; modo: "humano"; canal: Canal; link: string; e164: string; ajuste?: string }
  /** A mensagem saiu sozinha pela API. `id` é o identificador do provedor. */
  | { ok: true; modo: "automatico"; canal: Canal; id: string; e164: string; ajuste?: string }
  /** Não dá para enviar, e o motivo é legível por quem está na tela. */
  | { ok: false; motivo: string };

/**
 * ⚠ TER CREDENCIAL NÃO PODE LIGAR O CANAL SOZINHO — e a primeira versão disto
 * ligava (achado em 16/ago/2026, a partir de uma pergunta do fundador).
 *
 * Ele perguntou se, com a Be Fitness no automático, os vendedores poderiam
 * continuar usando o sistema normalmente — eles atendem pelo número ANTIGO da
 * academia, o do aplicativo. A pergunta expôs o defeito: `canalDe` devolvia
 * `cloud_api` assim que existisse credencial. Ou seja, **salvar o token trocaria
 * o número de saída da empresa inteira**, em silêncio, no mesmo instante.
 *
 * O efeito no cliente é o pior possível: ele receberia a mensagem do sistema
 * por um número novo e a resposta da recepcionista por outro. Do lado dele não
 * são dois canais da academia — são dois desconhecidos.
 *
 * São DUAS decisões diferentes e o código tratava como uma:
 *   • **por onde SAI** (link que abre o WhatsApp da pessoa × número do sistema);
 *   • **quem DISPARA** (uma pessoa clicando × o motor sozinho).
 *
 * A segunda é `automation.mode`. Esta função responde só a primeira, e o padrão
 * é o link humano mesmo com credencial salva: ligar exige alguém escolher.
 *
 * E A CREDENCIAL É POR EMPRESA desde 15/ago. Era `WHATSAPP_CANAL` no ambiente,
 * uma chave global: o comentário antigo dizia que canal é decisão de
 * infraestrutura e não de cliente, e isso continua verdade para o PROVEDOR —
 * mas não para o NÚMERO. Cada empresa tem o seu, verificado no CNPJ dela, e a
 * entrada já era assim (o webhook acha o tenant pelo `phone_number_id`).
 *
 * Sem credencial, o canal é o link humano — que não é degradação, é o modo
 * padrão do produto: *a inteligência é nossa, o envio é humano.*
 */
export function canalDe(
  credencial: CredencialDoCanal | null | undefined,
  usarNumeroDoSistema = false,
): Canal {
  return usarNumeroDoSistema && credencial?.token && credencial?.phoneId
    ? "cloud_api"
    : "link_humano";
}

/** O mínimo que o envio precisa saber. Vem de `lib/credenciais.ts`. */
export type CredencialDoCanal = { token: string; phoneId: string; versao?: string };

/**
 * Prepara (ou faz) o envio de uma mensagem.
 *
 * Devolve SEMPRE um resultado, nunca lança: esta função é chamada no meio de
 * telas de lista, e uma exceção por telefone mal cadastrado derrubaria a fila
 * inteira por causa de uma linha.
 */
export async function enviarMensagem(
  destino: Destino,
  credencial?: CredencialDoCanal | null,
): Promise<ResultadoEnvio> {
  const texto = (destino.texto ?? "").trim();
  if (!texto) return { ok: false, motivo: "Mensagem vazia." };

  const num = paraE164BR(destino.telefone);
  if (!num.ok) return { ok: false, motivo: num.motivo };

  const canal = canalDe(credencial);

  if (canal === "cloud_api") {
    const r = await enviarPelaCloudAPI(num.digitos, texto, credencial!);
    return r.ok
      ? { ok: true, modo: "automatico", canal, id: r.id, e164: num.e164, ajuste: num.ajuste }
      : { ok: false, motivo: r.motivo };
  }

  return {
    ok: true,
    modo: "humano",
    canal,
    link: `https://wa.me/${num.digitos}?text=${encodeURIComponent(texto)}`,
    e164: num.e164,
    ajuste: num.ajuste,
  };
}

/**
 * Só o link, para as telas que hoje mostram um botão e não registram envio.
 * Devolve `null` quando o número não serve — link de WhatsApp com número
 * inválido abre uma tela de erro, e tela de erro no meio de uma lista faz a
 * pessoa abandonar a lista.
 */
export function linkDeWhatsApp(telefone: string | null | undefined, texto?: string): string | null {
  const num = paraE164BR(telefone);
  if (!num.ok) return null;
  return texto
    ? `https://wa.me/${num.digitos}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/${num.digitos}`;
}

// ---------------------------------------------------------------------
// PROVEDOR: WhatsApp Cloud API (Meta)
//
// ✅ PROVADO EM CAMPO em 17/ago/2026 — a Be Fitness envia e recebe por aqui,
// com mensagem real de ida e volta. O comentário anterior dizia "nunca
// executado contra a API real" e citava uma `canalAtivo()` que não existe mais
// (quem decide o canal é `canalDe`, acima, e a chave global virou credencial
// por empresa). Ficou mentindo por uma entrega inteira: comentário desatualizado
// é a mesma armadilha do estado duplicado — apodrece em silêncio e ensina o
// errado para toda conversa nova.
//
// A JANELA DE 24 HORAS é a regra que decide o custo e o que pode ser dito:
// responder quem escreveu nas últimas 24h é texto livre; iniciar conversa
// fora disso exige MODELO aprovado pela Meta e é cobrado. **Esta função manda
// texto livre — ou seja, ela só serve para RESPONDER.**
//
// O toque proativo da fila (follow-up, recompra, renovação, reativação) vive
// FORA da janela por definição, e precisa de `type: "template"`, que ainda não
// existe aqui. Os textos já estão escritos e esperando aprovação da Meta em
// `docs/blueprint/MODELOS_WHATSAPP.md` — inclusive a decisão de que o modelo
// ABRE a janela e não vende, e a recusa deliberada de criar modelo para o
// motivo `lembrete`.
// ---------------------------------------------------------------------

type EnvioProvedor = { ok: true; id: string } | { ok: false; motivo: string };

export async function enviarPelaCloudAPI(
  digitos: string,
  texto: string,
  credencial: CredencialDoCanal,
): Promise<EnvioProvedor> {
  const { token, phoneId } = credencial;
  const versao = credencial.versao ?? "v25.0";

  if (!token || !phoneId) {
    return { ok: false, motivo: "Canal oficial ligado mas sem credencial desta empresa." };
  }

  try {
    const resp = await fetch(`https://graph.facebook.com/${versao}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: digitos,
        type: "text",
        text: { preview_url: false, body: texto },
      }),
    });

    const corpo = (await resp.json().catch(() => null)) as
      | { messages?: { id: string }[]; error?: { message?: string; code?: number } }
      | null;

    if (!resp.ok) {
      // O erro da Meta vai INTEIRO para quem está na tela. Trocar por "erro ao
      // enviar" economizaria uma linha e custaria a única informação que
      // resolve o problema — o código dela diz se é token vencido, número não
      // registrado ou janela de 24h fechada, e cada um tem conserto diferente.
      const detalhe = corpo?.error?.message ?? `HTTP ${resp.status}`;
      return { ok: false, motivo: `A Meta recusou: ${detalhe}` };
    }

    const id = corpo?.messages?.[0]?.id;
    if (!id) return { ok: false, motivo: "A Meta aceitou mas não devolveu identificador da mensagem." };
    return { ok: true, id };
  } catch (e) {
    return { ok: false, motivo: `Falha de rede ao falar com a Meta: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------------------------------------------------------------------
// ENVIO POR MODELO — o que abre conversa fora da janela de 24 horas.
//
// É a outra metade do canal, e a que o produto precisa: a fila vive FORA da
// janela por definição, porque ela existe para falar com quem parou de falar.
//
// ⚠ O MODELO NÃO CARREGA A MENSAGEM, ELE CARREGA A CHAVE. O texto é fixo e
// aprovado pela Meta; só as variáveis mudam. Quem responde abre a janela, e a
// conversa de verdade — com o DNA e a biblioteca — acontece em texto livre
// depois. Ver `docs/blueprint/MODELOS_WHATSAPP.md`, inclusive o porquê de o
// modelo não vender: material de venda dentro de um `UTILITY` faz a Meta
// recategorizar em silêncio e cobrar 9,2× mais.
// ---------------------------------------------------------------------

export type ResultadoModelo =
  | { ok: true; id: string }
  | {
      ok: false;
      motivo: string;
      /**
       * `131049` — a PESSOA atingiu o limite de marketing dela, que é
       * adaptativo pela taxa de leitura. **Não é falha nossa e não é erro de
       * configuração.** Tratar como erro genérico e reenviar é o caminho para
       * bloqueio temporário de entrega: a Meta pune a insistência, não a
       * tentativa. Quem chama deve deixar a pessoa para outro dia.
       */
      limitePorUsuario?: boolean;
    };

export async function enviarModeloPelaCloudAPI(
  digitos: string,
  modelo: string,
  /** Os valores de `{{1}}`, `{{2}}`… NA ORDEM. Já higienizados. */
  parametros: string[],
  credencial: CredencialDoCanal,
  idioma = "pt_BR",
): Promise<ResultadoModelo> {
  const { token, phoneId } = credencial;
  const versao = credencial.versao ?? "v25.0";

  if (!token || !phoneId) {
    return { ok: false, motivo: "Canal oficial ligado mas sem credencial desta empresa." };
  }
  if (!modelo.trim()) {
    return { ok: false, motivo: "Sem nome de modelo aprovado para este motivo." };
  }

  // A higienização acontece de novo aqui, e de propósito: esta função é
  // pública e alguém vai chamá-la de outro lugar. Trava que depende de quem
  // chama lembrar dela não é trava.
  const limpos: string[] = [];
  for (const p of parametros) {
    const h = higienizarParametro(p);
    if (!h.ok) return { ok: false, motivo: h.motivo };
    limpos.push(h.valor);
  }

  try {
    const resp = await fetch(`https://graph.facebook.com/${versao}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: digitos,
        type: "template",
        template: {
          name: modelo,
          language: { code: idioma },
          components: limpos.length
            ? [{ type: "body", parameters: limpos.map((text) => ({ type: "text", text })) }]
            : [],
        },
      }),
    });

    const corpo = (await resp.json().catch(() => null)) as
      | { messages?: { id: string }[]; error?: { message?: string; code?: number } }
      | null;

    if (!resp.ok) {
      const code = corpo?.error?.code;
      const detalhe = corpo?.error?.message ?? `HTTP ${resp.status}`;
      if (code === 131049) {
        return {
          ok: false,
          limitePorUsuario: true,
          motivo:
            "A Meta segurou esta mensagem: esta pessoa já recebeu o limite de mensagens de " +
            "marketing dela neste período. Não é erro de configuração — ela volta para a fila " +
            "e a próxima tentativa deve esperar pelo menos 24h.",
        };
      }
      // O erro da Meta vai INTEIRO para quem está na tela, pelo mesmo motivo
      // do envio de texto: o código dela diz se é modelo não aprovado, número
      // não registrado ou variável recusada, e cada um tem conserto diferente.
      return { ok: false, motivo: `A Meta recusou: ${detalhe}` };
    }

    const id = corpo?.messages?.[0]?.id;
    if (!id) return { ok: false, motivo: "A Meta aceitou mas não devolveu identificador da mensagem." };
    return { ok: true, id };
  } catch (e) {
    return { ok: false, motivo: `Falha de rede ao falar com a Meta: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------------------------------------------------------------------
// O ENVIO PELO DIRECT — Instagram e Messenger.
//
// ⚠ POR QUE ISTO NÃO EXISTIA, e o que a falta custava. Os dois canais foram
// ligados em 2 e 3/set e só RECEBIAM: a única função que falava com a Meta
// postava em `/{phoneId}/messages` do WhatsApp, e a tela de Conversas gravava
// `channel: "whatsapp"` fixo. Resultado medido em 4/set: **10 contatos do
// Instagram na base, todos sem telefone** — e quem tentasse responder um deles
// de dentro do Kairós recebia uma recusa falando de TELEFONE INVÁLIDO.
// Diagnóstico errado, que é o tipo de aviso que ninguém lê na segunda vez.
//
// O fundador nomeou o valor: *"normalmente recebemos mensagens através desses
// canais em horários que a academia já está fechada"*. É exatamente a hora em
// que a automação ganha — e era a única parte do plano que dependia de código,
// não da Meta.
//
// ⚠ AQUI SÓ EXISTE RESPOSTA. Não há modelo aprovado nem envio proativo no
// Instagram e no Messenger: a plataforma só entrega dentro da janela de 24h
// depois que a PESSOA escreve (7 dias com a marca de atendimento humano).
// Campanha de reativação não roda nesses canais, e prometer isso seria vender
// o que a plataforma não entrega.
// ---------------------------------------------------------------------

export type CredencialDoDirect = {
  /** `instagram_account_id` ou `facebook_page_id` — de quem a mensagem sai. */
  contaId: string;
  /** `instagram_token` (IGAA…) ou o token da PÁGINA (EAA…). */
  token: string;
  versao?: string;
};

/**
 * Responde um direct do Instagram ou do Messenger.
 *
 * `destinatarioId` é o id da pessoa NAQUELA plataforma — IGSID no Instagram,
 * PSID no Facebook. Não é telefone, e o mesmo ser humano tem um id diferente
 * em cada uma: usar o do outro canal manda a mensagem para outra pessoa.
 */
export async function enviarPeloDirect(
  plataforma: "instagram" | "facebook",
  destinatarioId: string,
  texto: string,
  credencial: CredencialDoDirect,
): Promise<EnvioProvedor> {
  const { contaId, token } = credencial;
  const versao = credencial.versao ?? "v21.0";

  if (!token || !contaId) {
    return {
      ok: false,
      motivo: `O canal do ${plataforma === "instagram" ? "Instagram" : "Facebook"} não está configurado nesta empresa.`,
    };
  }
  if (!destinatarioId) {
    return { ok: false, motivo: "Esta conversa não tem o id da pessoa na plataforma." };
  }

  // ⚠ SÃO DOIS HOSTS POSSÍVEIS, E EU JÁ CHUTEI O ERRADO UMA VEZ. A "API do
  // Instagram com login do Instagram" — que é a configuração desta conta —
  // responde em `graph.instagram.com`; `graph.facebook.com` é o caminho de
  // quem entra pelo login do Facebook. Com o host errado a busca do nome
  // falhava em silêncio e as duas primeiras pessoas reais viraram
  // "Instagram 869579".
  //
  // Tentar os dois, na ordem provável, custa uma chamada extra só quando o
  // primeiro recusa — e evita repetir o mesmo dia de investigação. O Messenger
  // só existe no `graph.facebook.com`.
  const hosts =
    plataforma === "instagram"
      ? [`https://graph.instagram.com/${versao}`, `https://graph.facebook.com/${versao}`]
      : [`https://graph.facebook.com/${versao}`];

  const corpoDaMensagem = JSON.stringify({
    recipient: { id: destinatarioId },
    // ⚠ `RESPONSE` declara à Meta que isto responde alguém que escreveu — que
    // é literalmente o único uso permitido aqui. Marcar como `UPDATE` ou
    // `MESSAGE_TAG` seria pedir para tratar resposta como notificação, e é o
    // caminho curto para a conta ser restringida.
    messaging_type: "RESPONSE",
    message: { text: texto },
  });

  let ultimoErro = "";
  for (const base of hosts) {
    try {
      const resp = await fetch(`${base}/${contaId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: corpoDaMensagem,
      });

      const corpo = (await resp.json().catch(() => null)) as
        | { message_id?: string; error?: { message?: string; code?: number } }
        | null;

      if (!resp.ok) {
        // O erro da Meta vai INTEIRO, como no WhatsApp: o código dela diz se é
        // token vencido, janela fechada ou permissão faltando, e cada um tem
        // conserto diferente. "Erro ao enviar" não conserta nada.
        ultimoErro = corpo?.error?.message ?? `HTTP ${resp.status}`;
        continue;
      }

      const id = corpo?.message_id;
      // ⚠ SUCESSO SEM ID NÃO É SUCESSO. Sem `message_id` não há como casar o
      // eco que a Meta devolve depois — e o eco não reconhecido vira mensagem
      // duplicada no histórico do cliente.
      if (!id) {
        ultimoErro = "A Meta respondeu OK e não devolveu o id da mensagem.";
        continue;
      }
      return { ok: true, id };
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e);
    }
  }

  return { ok: false, motivo: ultimoErro || "Não consegui falar com a Meta." };
}
