"use server";

import { getActiveTenant } from "@/lib/auth";
import { paraE164BR } from "@/lib/phone";
import { salvarCredencial, desligarCanal, credencialDoCanal } from "@/lib/credenciais";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * LIGAR O CANAL OFICIAL — a credencial da empresa, e o teste antes do primeiro
 * cliente real.
 *
 * ⚠ A ORDEM AQUI É A SEGURANÇA. O `ESTADO_DO_PROJETO` diz, desde que o
 * provedor foi escrito: *"escrito contra a documentação, NUNCA EXECUTADO
 * contra a API real… a primeira coisa a fazer quando houver credencial é
 * mandar UMA mensagem para o próprio número antes de ligar para qualquer
 * contato real."*
 *
 * Este arquivo transforma essa frase em botão. Salvar não liga nada sozinho —
 * ligar é ter credencial válida, e a única prova de que ela é válida é uma
 * mensagem que chegou.
 */

async function adminDaEmpresa() {
  const m = await getActiveTenant();
  if (!m?.tenant || (m.role !== "owner" && m.role !== "admin")) return null;
  return m;
}

export async function salvarCanal(formData: FormData) {
  const m = await adminDaEmpresa();
  if (!m) redirect("/painel/automacao?erro=Sem+permissao");

  const r = await salvarCredencial(m.tenant!.id, m.membershipId, {
    token: String(formData.get("token") ?? ""),
    phoneId: String(formData.get("phone_id") ?? ""),
    verifyToken: String(formData.get("verify_token") ?? ""),
    appSecret: String(formData.get("app_secret") ?? ""),
    instagramAccountId: String(formData.get("instagram_account_id") ?? ""),
    instagramToken: String(formData.get("instagram_token") ?? ""),
  });

  revalidatePath("/painel/automacao");
  if (!r.ok) redirect(`/painel/automacao?erro=${encodeURIComponent(r.erro ?? "Falha ao salvar")}`);
  redirect("/painel/automacao?canal=salvo");
}

export async function desligar() {
  const m = await adminDaEmpresa();
  if (!m) redirect("/painel/automacao?erro=Sem+permissao");
  await desligarCanal(m.tenant!.id);
  revalidatePath("/painel/automacao");
  redirect("/painel/automacao?canal=desligado");
}

/**
 * O TESTE — e ele usa MODELO, não texto livre, por um motivo que decide tudo.
 *
 * A Cloud API só aceita texto livre para quem escreveu para a empresa nas
 * últimas 24 HORAS. Fora dessa janela, só modelo aprovado pela Meta. Como o
 * teste acontece justamente antes de existir qualquer conversa, texto livre
 * falharia **mesmo com a credencial certa** — e o erro seria lido como
 * "credencial errada", mandando alguém procurar problema onde não tem.
 *
 * `hello_world` é o modelo que toda conta nova da Meta já traz aprovado. Se
 * ele chegar, três coisas ficam provadas de uma vez: o token vale, o número
 * está ativo, e a conta pode enviar.
 *
 * ⚠ E O QUE ESTE TESTE NÃO PROVA: que o toque proativo da fila vai funcionar.
 * Aquele também precisa de modelo aprovado, com o texto da cadência dentro —
 * e isso é trabalho de cadastro na Meta, não de código.
 */
export async function testarCanal(
  numeroDestino: string,
): Promise<{ ok: boolean; mensagem: string }> {
  const m = await adminDaEmpresa();
  if (!m) return { ok: false, mensagem: "Só dono ou administrador pode testar o canal." };

  const cred = await credencialDoCanal(m.tenant!.id);
  if (!cred) {
    return { ok: false, mensagem: "Salve o token e o ID do número antes de testar." };
  }

  const num = paraE164BR(numeroDestino);
  if (!num.ok) return { ok: false, mensagem: `Número do teste: ${num.motivo}` };

  try {
    const resp = await fetch(
      `https://graph.facebook.com/${cred.versao}/${cred.phoneId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: num.digitos,
          type: "template",
          template: { name: "hello_world", language: { code: "en_US" } },
        }),
      },
    );

    const corpo = await resp.json().catch(() => ({}));
    if (resp.ok) {
      const id = (corpo as { messages?: { id: string }[] })?.messages?.[0]?.id ?? "(sem id)";
      return {
        ok: true,
        mensagem: `Enviado. A Meta aceitou e devolveu o id ${id}. Confira se a mensagem CHEGOU no aparelho — a API aceitar não é a mesma coisa que o cliente receber.`,
      };
    }

    // ⚠ O ERRO DA META VAI INTEIRO PARA A TELA, e é de propósito. Ele diz
    // exatamente o que falta ("token expirado", "número não registrado",
    // "modelo não existe") e resumir isso num "falhou" transformaria dez
    // minutos de conserto numa tarde de adivinhação.
    const err = (corpo as { error?: { message?: string; code?: number; error_subcode?: number } })?.error;

    // ⚠ A VERSÃO DA API VAI NA MENSAGEM, e custou uma tarde não estar lá.
    //
    // Com a versão aposentada, a Meta responde *"Object with ID ... does not
    // exist, cannot be loaded due to missing permissions"* — uma frase que
    // aponta para credencial e permissão e não diz uma palavra sobre versão.
    // O token estava certo e o ID do número também; a URL é que era velha.
    //
    // ⚠ O 190 É O MAIS COMUM DE TODOS E O QUE MENOS PARECE O QUE É.
    //
    // O token que a Meta gera na tela de Configuração da API é TEMPORÁRIO e
    // morre num HORÁRIO FIXO — não 24 horas depois de você clicar. Quem gerou
    // às 11h da manhã descobre à tarde que "parou de funcionar", e a mensagem
    // em inglês fala de "session", palavra que ninguém associa a token colado
    // num formulário.
    //
    // A frase da Meta traz a hora exata da expiração, então ela vai inteira.
    const dica = err?.code === 190
      ? " ⚠ O TOKEN EXPIROU. O da tela de Configuração da API é temporário e morre num horário fixo. Gere outro na Meta (WhatsApp → Configuração da API → Gerar token), cole aqui e salve — leva um minuto. Para não repetir todo dia, o passo 8 do guia acima mostra como criar o permanente."
      : err?.code === 100
        ? ` ⚠ Esta chamada usou a API ${cred.versao}. Se o token e o ID do número estiverem certos, a versão pode estar aposentada — confira qual a Meta mostra no exemplo de código dela e me avise.`
        : "";

    return {
      ok: false,
      mensagem: `A Meta recusou (HTTP ${resp.status}): ${err?.message ?? JSON.stringify(corpo).slice(0, 300)}${err?.code ? ` [código ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ""}]` : ""}${dica}`,
    };
  } catch (e) {
    return { ok: false, mensagem: `Não consegui falar com a Meta: ${e instanceof Error ? e.message : String(e)}` };
  }
}
