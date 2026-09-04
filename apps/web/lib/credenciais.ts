import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// A CREDENCIAL DO CANAL, POR EMPRESA — e ela nunca chega ao browser.
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE, e por que ele é `server-only`.
//
// O envio pelo WhatsApp era configurado por variável de ambiente: **um número
// para o sistema inteiro**. A entrada já era por empresa (o webhook acha o
// tenant pelo `phone_number_id` do pacote), então saída global e entrada por
// empresa estavam inconsistentes — com dois clientes, as mensagens dos dois
// sairiam do mesmo número.
//
// E o lugar óbvio para guardar, `tenants.settings`, é o lugar errado: a policy
// `tenants_select` libera a linha inteira para QUALQUER membro. Um token da
// Meta manda mensagem em nome da academia, para qualquer número, sem passar
// pelo produto — os três recepcionistas leriam o segredo com uma chamada do
// próprio navegador.
//
// Mora em `tenant_secrets` (0056), com RLS ligada e NENHUMA policy: em Postgres
// isso nega para todo papel que sofre RLS. Só o `service_role` alcança, daqui,
// do servidor. É a mesma regra da biblioteca curada no `0006`, pelo mesmo
// motivo: **o que não precisa chegar ao browser não chega.**
//
// O `server-only` no topo é a trava mecânica disso: se alguém importar este
// arquivo num componente de cliente, o build QUEBRA em vez de vazar o token
// para o bundle.

/**
 * ⚠ A VERSÃO DA GRAPH API — e ela causou uma tarde de diagnóstico errado.
 *
 * Estava fixa em `v21.0`, escrita quando o provedor foi redigido contra a
 * documentação. A Meta aposenta versão antiga, e chamar uma aposentada devolve
 * **"Object with ID ... does not exist, cannot be loaded due to missing
 * permissions"** — uma mensagem que aponta para credencial e permissão, e não
 * diz uma palavra sobre versão. O token estava certo (302 caracteres,
 * começando em `EAA`) e o ID do número também; a URL é que era velha.
 *
 * O valor vem do que o console da própria Meta gera hoje, no snippet de curl
 * daquela conta. Quando a Meta subir de novo, este número sobe junto — e a
 * variável de ambiente continua existindo para trocar sem esperar deploy.
 */
export const VERSAO_GRAPH = process.env.WHATSAPP_API_VERSION ?? "v25.0";

export type CredencialCanal = {
  token: string;
  phoneId: string;
  /** A versão da Graph API. Muda de tempos em tempos e não vale migration. */
  versao: string;
};

/**
 * A credencial da empresa, ou `null` quando ela não configurou o canal.
 *
 * `null` não é erro: é o estado normal de quem ainda envia pelo link humano.
 * Quem chama decide o que fazer com a ausência — e o que ele deve fazer é
 * continuar no `wa.me`, nunca falhar.
 */
export async function credencialDoCanal(tenantId: string): Promise<CredencialCanal | null> {
  const admin = createAdminClient();
  // paginacao-ok: uma linha, chave primária.
  const { data, error } = await admin
    .from("tenant_secrets")
    .select("whatsapp_token, whatsapp_phone_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    // Falha de leitura NÃO pode virar "canal desligado" em silêncio: isso
    // mandaria a empresa de volta para o link humano sem ninguém saber por quê.
    console.error(`[credenciais] falha ao ler o canal de ${tenantId}: ${error.message}`);
    return null;
  }
  const token = data?.whatsapp_token?.trim();
  const phoneId = data?.whatsapp_phone_id?.trim();
  if (!token || !phoneId) return null;

  return { token, phoneId, versao: VERSAO_GRAPH };
}

/**
 * O app secret da empresa — o que valida a assinatura do webhook.
 *
 * ⚠ SEM ELE, O WEBHOOK RECUSA TUDO, e isso é de propósito: `assinaturaConfere`
 * nega quando não há segredo, porque liberar sem conferência transformaria o
 * único endereço público do produto numa porta para escrever no histórico de
 * um cliente pagante. Foi essa recusa (correta) que apareceu na tela da Meta
 * como *"não foi possível entregar a mensagem, confira seus webhooks"* enquanto
 * o segredo ainda era variável de ambiente.
 */
export async function appSecretDoCanal(tenantId: string): Promise<string | null> {
  const admin = createAdminClient();
  // paginacao-ok: uma linha, chave primária.
  const { data } = await admin
    .from("tenant_secrets").select("whatsapp_app_secret")
    .eq("tenant_id", tenantId).maybeSingle();
  return data?.whatsapp_app_secret?.trim() || null;
}

/**
 * De quem é o número que recebeu — e o app secret dele, para conferir a
 * assinatura.
 *
 * O webhook precisa dos dois ANTES de confiar no corpo do pacote, e o
 * `phone_number_id` é a única pista de origem que existe.
 */
export async function empresaDoNumero(
  phoneNumberId: string,
): Promise<{ tenantId: string; appSecret: string | null } | null> {
  const admin = createAdminClient();
  // paginacao-ok: busca exata pelo id do número — no máximo uma linha.
  const { data } = await admin
    .from("tenant_secrets")
    .select("tenant_id, whatsapp_app_secret")
    .eq("whatsapp_phone_id", phoneNumberId)
    .maybeSingle();
  if (!data) return null;
  return { tenantId: data.tenant_id, appSecret: data.whatsapp_app_secret?.trim() || null };
}

/** O token de verificação do webhook, escolhido por quem configurou. */
export async function verifyTokenDoCanal(tenantId: string): Promise<string | null> {
  const admin = createAdminClient();
  // paginacao-ok: uma linha, chave primária.
  const { data } = await admin
    .from("tenant_secrets").select("whatsapp_verify_token")
    .eq("tenant_id", tenantId).maybeSingle();
  return data?.whatsapp_verify_token?.trim() || null;
}

/**
 * O que a TELA pode saber — e note o que não está aqui: o token.
 *
 * O `phone_id` volta INTEIRO, e os segredos não voltam nunca — nem mascarados.
 *
 * A separação é por natureza, não por precaução: o Phone Number ID aparece
 * aberto na própria tela da Meta, então esconder só criava dúvida sobre se
 * tinha salvo. Já token e chave secreta mandam mensagem em nome da empresa —
 * e token mascarado na tela é token que alguém tenta copiar e cola errado em
 * outro lugar.
 */
export async function statusDoCanal(tenantId: string): Promise<{
  configurado: boolean;
  phoneId: string | null;
  temVerifyToken: boolean;
  temAppSecret: boolean;
  atualizadoEm: string | null;
  /** O ID da conta do Instagram aparece INTEIRO na tela: não é segredo, é
      identificador — e ver o número salvo é como se confere que é o certo. */
  contaInstagram: string | null;
  temTokenInstagram: boolean;
  paginaFacebook: string | null;
  temTokenFacebook: boolean;
}> {
  const admin = createAdminClient();
  // paginacao-ok: uma linha, chave primária.
  const { data } = await admin
    .from("tenant_secrets")
    .select("whatsapp_token, whatsapp_phone_id, whatsapp_verify_token, whatsapp_app_secret, updated_at, instagram_account_id, instagram_token, facebook_page_id, facebook_token")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const phoneId = data?.whatsapp_phone_id?.trim() ?? null;
  return {
    configurado: !!data?.whatsapp_token?.trim() && !!phoneId,
    phoneId,
    temVerifyToken: !!data?.whatsapp_verify_token?.trim(),
    temAppSecret: !!data?.whatsapp_app_secret?.trim(),
    atualizadoEm: data?.updated_at ?? null,
    contaInstagram: data?.instagram_account_id?.trim() || null,
    temTokenInstagram: !!data?.instagram_token?.trim(),
    paginaFacebook: data?.facebook_page_id?.trim() || null,
    temTokenFacebook: !!data?.facebook_token?.trim(),
  };
}

/**
 * Grava a credencial.
 *
 * Campo em branco NÃO apaga o que já existe — quem abre a tela para trocar só
 * o `phone_id` não pode perder o token por deixar o campo vazio. Para
 * desligar o canal existe `desligarCanal`, que é explícito.
 */
export async function salvarCredencial(
  tenantId: string,
  membershipId: string,
  campos: {
    token?: string; phoneId?: string; verifyToken?: string; appSecret?: string;
    /** Conta e token do Instagram — o mesmo cofre, o mesmo formulário. */
    instagramAccountId?: string; instagramToken?: string;
    /** Página e token do Facebook — mesmo cofre, mesmo formulário. */
    facebookPageId?: string; facebookToken?: string;
  },
): Promise<{ ok: boolean; erro?: string }> {
  const admin = createAdminClient();
  const patch: Record<string, unknown> = {
    tenant_id: tenantId,
    updated_at: new Date().toISOString(),
    updated_by: membershipId,
  };
  if (campos.token?.trim()) patch.whatsapp_token = campos.token.trim();
  if (campos.phoneId?.trim()) patch.whatsapp_phone_id = campos.phoneId.trim();
  if (campos.verifyToken?.trim()) patch.whatsapp_verify_token = campos.verifyToken.trim();
  if (campos.appSecret?.trim()) patch.whatsapp_app_secret = campos.appSecret.trim();
  // ⚠ CAMPO EM BRANCO NÃO APAGA, aqui como nos de cima. Formulário que
  // reenvia o que já existe transforma "salvar uma coisa" em "regravar
  // tudo" — foi assim que uma aba antiga trocou o número da empresa.
  if (campos.instagramAccountId?.trim()) patch.instagram_account_id = campos.instagramAccountId.trim();
  if (campos.instagramToken?.trim()) patch.instagram_token = campos.instagramToken.trim();
  if (campos.facebookPageId?.trim()) patch.facebook_page_id = campos.facebookPageId.trim();
  if (campos.facebookToken?.trim()) patch.facebook_token = campos.facebookToken.trim();

  const { error } = await admin.from("tenant_secrets").upsert(patch, { onConflict: "tenant_id" });
  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

/** Desliga o canal desta empresa. Explícito, e volta todo mundo para o `wa.me`. */
export async function desligarCanal(tenantId: string): Promise<{ ok: boolean; erro?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("tenant_secrets")
    .update({ whatsapp_token: null, whatsapp_phone_id: null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId);
  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

/**
 * GUARDA O WABA ID DESCOBERTO NO WEBHOOK — uma vez, sem incomodar ninguém.
 *
 * ⚠ `entry[].id` de todo pacote da Meta É o ID da conta do WhatsApp Business,
 * e ele não é nenhuma das quatro caixas que a pessoa cola na instalação. Sem
 * ele não dá para ler os modelos aprovados pela API, e o corpo deles fica
 * reconstruído do repositório (ver `modelos_canal`, migration 0070).
 *
 * ⚠ SÓ ESCREVE SE ESTIVER VAZIO. Se um dia o valor mudar de verdade, isso é
 * evento raro e merece ser visto por gente — sobrescrever a cada webhook faria
 * uma troca inesperada passar sem ninguém notar, que é o oposto do que este
 * projeto faz com credencial.
 *
 * ⚠ E FALHAR AQUI NÃO PODE DERRUBAR O WEBHOOK. Isto é conveniência: a
 * mensagem do cliente vale infinitamente mais que a descoberta do id.
 */
export async function guardarWabaId(tenantId: string, wabaId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    // paginacao-ok: uma linha, chave primária.
    const { data } = await admin
      .from("tenant_secrets")
      .select("whatsapp_waba_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if ((data as { whatsapp_waba_id?: string | null } | null)?.whatsapp_waba_id) return;

    const { error } = await admin
      .from("tenant_secrets")
      .update({ whatsapp_waba_id: wabaId })
      .eq("tenant_id", tenantId);
    if (error) console.warn(`[whatsapp] nao guardei o waba id: ${error.message}`);
    else console.info(`[whatsapp] waba id descoberto e guardado para o tenant ${tenantId}`);
  } catch (e) {
    console.warn(`[whatsapp] falha ao guardar o waba id: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * A credencial de um DIRECT — Instagram ou Messenger.
 *
 * ⚠ SÃO COFRES DIFERENTES DO WHATSAPP, e por isso uma função própria em vez de
 * um campo a mais em `credencialDoCanal`. Quem responde um direct não precisa
 * do token do WhatsApp, e devolver os dois juntos faria uma tela pedir
 * credencial de WhatsApp para responder no Instagram — e recusar por falta
 * dela, que é a recusa com o diagnóstico errado.
 *
 * `null` quando falta conta ou token: quem chama DIZ o que falta, com o nome
 * da tela onde se resolve. Nunca cai em outro canal por conta própria.
 */
export async function credencialDoDirect(
  tenantId: string,
  plataforma: "instagram" | "facebook",
): Promise<{ contaId: string; token: string } | null> {
  const admin = createAdminClient();
  // paginacao-ok: uma linha, chave primária.
  const { data, error } = await admin
    .from("tenant_secrets")
    .select("instagram_account_id, instagram_token, facebook_page_id, facebook_token")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // ⚠ ERRO DE LEITURA NÃO VIRA "NÃO CONFIGURADO". São coisas diferentes, e
  // tratá-las igual manda alguém configurar de novo o que já estava certo.
  if (error) {
    console.error(`[credenciais] nao consegui ler o direct de ${tenantId}: ${error.message}`);
    return null;
  }

  const contaId =
    plataforma === "instagram"
      ? data?.instagram_account_id?.trim()
      : data?.facebook_page_id?.trim();
  const token =
    plataforma === "instagram" ? data?.instagram_token?.trim() : data?.facebook_token?.trim();

  if (!contaId || !token) return null;
  return { contaId, token };
}
