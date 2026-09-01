import "server-only";
import type { CredencialCanal } from "@/lib/credenciais";

/**
 * O PERFIL DO NÚMERO — a foto e os dados que a pessoa vê antes de responder.
 *
 * ⚠ POR QUE ISTO VIROU CÓDIGO, e não instrução de tela da Meta.
 *
 * O fundador tentou trocar o nome de exibição no WhatsApp Manager e levou um
 * erro de autorização da própria Meta — e, junto, viu que **o número não tem
 * logo nenhuma**. Numa reativação, o que a ex-aluna vê antes de decidir se
 * abre é o nome e a foto: número sem foto, com nome errado, é o retrato de
 * golpe. É a parte da campanha que não depende de texto nenhum e decide se o
 * texto vai ser lido.
 *
 * ⚠ O NOME DE EXIBIÇÃO NÃO ESTÁ AQUI, e não é esquecimento: **ele não tem
 * API.** Trocar o nome exige a tela da Meta e passa por revisão — é decisão
 * deles sobre a identidade de quem manda. Foto, descrição, endereço, e-mail e
 * site, sim: são do perfil comercial, e o perfil comercial é editável por API.
 *
 * ⚠ E A FOTO NÃO SOBE DIRETO. A Meta exige um "handle": o arquivo é enviado
 * primeiro para o serviço de upload retomável (que pertence ao APP, não ao
 * número) e só o identificador devolvido é que entra no perfil. Duas chamadas,
 * e a primeira precisa do id do app — que não guardamos, e por isso é
 * descoberto a partir do próprio token (ver `idDoApp`).
 */

/**
 * ⚠ A META CONTA BYTES, NÃO LETRAS — e essa diferença travou duas telas.
 *
 * O fundador encurtou a descrição até o contador da própria Meta mostrar
 * **492/512** e a gravação continuou falhando. Pelo nosso painel veio o motivo
 * escrito: *"Param description must be at most 512 characters long"*.
 *
 * Os dois contadores estavam certos e medindo coisas diferentes. Em português
 * quase toda frase tem acento, e em UTF-8 **cada acento ocupa 2 bytes**: "é",
 * "ç", "ã", "õ". Um texto de 492 letras com 30 acentos passa de 520 bytes. A
 * régua da Meta é o byte; a da tela era a letra.
 *
 * ⚠ E É PIOR EM PORTUGUÊS QUE EM INGLÊS, o que explica por que isso não é
 * problema conhecido: em inglês letra e byte coincidem quase sempre, então o
 * contador da Meta funciona lá e mente aqui.
 */
export function tamanhoEmBytes(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

/** Os tetos da Meta, em BYTES. */
export const LIMITES = { about: 139, description: 512, address: 256, email: 128, website: 256 };

export type PerfilDoCanal = {
  about?: string;
  description?: string;
  address?: string;
  email?: string;
  websites?: string[];
  vertical?: string;
  profile_picture_url?: string;
};

const CAMPOS = "about,address,description,email,profile_picture_url,websites,vertical";

/** Lê o perfil que está no ar hoje. */
export async function lerPerfil(
  cred: CredencialCanal,
): Promise<{ ok: true; perfil: PerfilDoCanal } | { ok: false; motivo: string }> {
  try {
    const r = await fetch(
      `https://graph.facebook.com/${cred.versao}/${cred.phoneId}/whatsapp_business_profile?fields=${CAMPOS}`,
      { headers: { Authorization: `Bearer ${cred.token}` }, cache: "no-store" },
    );
    const j = (await r.json()) as { data?: PerfilDoCanal[]; error?: { message?: string } };
    if (!r.ok) return { ok: false, motivo: j?.error?.message ?? `A Meta respondeu ${r.status}.` };
    return { ok: true, perfil: j.data?.[0] ?? {} };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}

/** Grava os campos de texto do perfil. Só manda o que veio preenchido. */
export async function gravarPerfil(
  cred: CredencialCanal,
  campos: Partial<PerfilDoCanal> & { profile_picture_handle?: string },
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const corpo: Record<string, unknown> = { messaging_product: "whatsapp" };
  for (const [k, v] of Object.entries(campos)) {
    // ⚠ Vazio NÃO é enviado. Mandar string vazia APAGA o campo na Meta, e a
    // tela mostra os valores atuais em campos que a pessoa pode deixar em
    // branco sem querer apagar nada.
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    corpo[k] = v;
  }
  if (Object.keys(corpo).length <= 1) return { ok: false, motivo: "Nada para gravar." };

  try {
    const r = await fetch(
      `https://graph.facebook.com/${cred.versao}/${cred.phoneId}/whatsapp_business_profile`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      },
    );
    const j = (await r.json()) as { success?: boolean; error?: { message?: string } };
    if (!r.ok) return { ok: false, motivo: j?.error?.message ?? `A Meta respondeu ${r.status}.` };
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * O ESTADO DO NÚMERO NA META — qualidade, degrau de envio e nome aprovado.
 *
 * ⚠ POR QUE ISTO VIROU TELA. A qualidade do número é o instrumento que decide
 * se a campanha continua ou para, e a única forma de vê-la era o WhatsApp
 * Manager — que respondeu ao fundador *"You don't have access. This feature
 * isn't available to you yet"*. O dado que governa a decisão mais cara da
 * operação estava atrás de uma tela que o dono do número não consegue abrir.
 *
 * Os mesmos campos que aquela tela mostra vêm do nó do número, com o token que
 * já temos. Não é atalho: é tirar a decisão da dependência de uma interface
 * que a Meta muda de lugar.
 *
 * ⚠ E O `verified_name` VEM JUNTO DE PROPÓSITO. É o nome que a pessoa lê antes
 * de decidir se abre — e é onde está escrito "Be Fitness2". Ver na própria
 * tela do produto o que o cliente vê é diferente de acreditar que está certo.
 */
export type EstadoDoNumero = {
  verified_name?: string;
  display_phone_number?: string;
  quality_rating?: string;
  name_status?: string;
  code_verification_status?: string;
  messaging_limit_tier?: string;
  platform_type?: string;
};

export async function estadoDoNumero(
  cred: CredencialCanal,
): Promise<{ ok: true; estado: EstadoDoNumero } | { ok: false; motivo: string }> {
  const campos =
    "verified_name,display_phone_number,quality_rating,name_status," +
    "code_verification_status,messaging_limit_tier,platform_type";
  try {
    const r = await fetch(
      `https://graph.facebook.com/${cred.versao}/${cred.phoneId}?fields=${campos}`,
      { headers: { Authorization: `Bearer ${cred.token}` }, cache: "no-store" },
    );
    const j = (await r.json()) as EstadoDoNumero & { error?: { message?: string } };
    if (!r.ok) return { ok: false, motivo: j?.error?.message ?? `A Meta respondeu ${r.status}.` };
    return { ok: true, estado: j };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * O ID DO APP, descoberto a partir do token.
 *
 * ⚠ Ele não está guardado em lugar nenhum — e pedir mais um campo a quem já
 * colou token, id do número, chave secreta e token de verificação seria a
 * quinta caixa de um formulário que já é o gargalo da instalação. O `debug_token`
 * devolve o app dono do token, então a informação já estava ao alcance.
 */
export async function idDoApp(cred: CredencialCanal): Promise<string | null> {
  try {
    const r = await fetch(
      `https://graph.facebook.com/${cred.versao}/debug_token?input_token=${encodeURIComponent(cred.token)}`,
      { headers: { Authorization: `Bearer ${cred.token}` }, cache: "no-store" },
    );
    const j = (await r.json()) as { data?: { app_id?: string } };
    return j?.data?.app_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Sobe a imagem e devolve o handle que o perfil aceita.
 *
 * ⚠ SÃO DUAS CHAMADAS PORQUE A META EXIGE ASSIM: primeiro abre-se uma sessão
 * de upload declarando tamanho e tipo, depois manda-se os bytes. O que volta é
 * um `h:...` — e é ele, não a imagem, que entra no perfil.
 */
export async function subirImagem(
  cred: CredencialCanal,
  appId: string,
  arquivo: { bytes: ArrayBuffer; tipo: string },
): Promise<{ ok: true; handle: string } | { ok: false; motivo: string }> {
  try {
    const sessao = await fetch(
      `https://graph.facebook.com/${cred.versao}/${appId}/uploads` +
        `?file_length=${arquivo.bytes.byteLength}` +
        `&file_type=${encodeURIComponent(arquivo.tipo)}`,
      { method: "POST", headers: { Authorization: `Bearer ${cred.token}` } },
    );
    const js = (await sessao.json()) as { id?: string; error?: { message?: string } };
    if (!sessao.ok || !js.id) {
      return { ok: false, motivo: js?.error?.message ?? "A Meta não abriu a sessão de upload." };
    }

    const envio = await fetch(`https://graph.facebook.com/${cred.versao}/${js.id}`, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${cred.token}`,
        file_offset: "0",
        "Content-Type": arquivo.tipo,
      },
      body: arquivo.bytes,
    });
    const je = (await envio.json()) as { h?: string; error?: { message?: string } };
    if (!envio.ok || !je.h) {
      return { ok: false, motivo: je?.error?.message ?? "A Meta não devolveu o identificador da imagem." };
    }
    return { ok: true, handle: je.h };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * OS MODELOS APROVADOS, lidos da Meta.
 *
 * ⚠ POR QUE ISTO É A FONTE, e o texto do repositório não é.
 *
 * Em 31/ago o corpo dos modelos passou a ser guardado no histórico, para a IA
 * parar de responder a um "Oi sim" sem saber qual era a pergunta. Só que o
 * texto veio RECONSTRUÍDO do arquivo onde nós escrevemos os modelos antes de
 * submetê-los — e a Meta é quem manda a mensagem de verdade. Um texto
 * reaprovado lá e não atualizado aqui faria o histórico registrar uma conversa
 * que não aconteceu.
 *
 * A leitura exige o WABA id, que não é nenhuma das quatro caixas da instalação
 * e que três caminhos de descoberta pela API recusaram. Ele chega sozinho no
 * `entry[].id` de todo webhook (ver `guardarWabaId`).
 *
 * ⚠ E A DIFERENÇA NÃO ERA SÓ TEÓRICA: o corpo aprovado tem quebra de linha no
 * MEIO das frases, e a reconstrução tinha juntado as linhas com espaço. Mesmo
 * tamanho, texto diferente — o tipo de divergência que ninguém encontra
 * olhando.
 */
export async function modelosAprovados(
  cred: CredencialCanal,
  wabaId: string,
): Promise<{ ok: true; modelos: { nome: string; corpo: string }[] } | { ok: false; motivo: string }> {
  try {
    const r = await fetch(
      `https://graph.facebook.com/${cred.versao}/${wabaId}/message_templates` +
      `?limit=100&fields=name,status,language,components`,
      { headers: { Authorization: `Bearer ${cred.token}` }, cache: "no-store" },
    );
    const j = (await r.json()) as {
      data?: { name?: string; status?: string; language?: string; components?: { type?: string; text?: string }[] }[];
      error?: { message?: string };
    };
    if (!r.ok) return { ok: false, motivo: j?.error?.message ?? `A Meta respondeu ${r.status}.` };

    const modelos: { nome: string; corpo: string }[] = [];
    for (const t of j.data ?? []) {
      // ⚠ SÓ APROVADO E SÓ pt_BR. Modelo em revisão ou recusado não é o que
      // sai; guardar o texto dele no histórico registraria uma fala que nunca
      // existiu. E `hello_world`, que a Meta cria sozinha, é en_US.
      if (t.status !== "APPROVED" || t.language !== "pt_BR") continue;
      const corpo = (t.components ?? []).find((c) => c.type === "BODY")?.text ?? "";
      if (t.name && corpo) modelos.push({ nome: t.name, corpo });
    }
    return { ok: true, modelos };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}
