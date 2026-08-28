import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDoCanal } from "@/lib/credenciais";
import { estadoDoNumero } from "@/lib/perfil-canal";
import { avaliarSaude, type Veredito } from "@/lib/saude-canal";

/**
 * O VIGIA DO CANAL — quem pergunta se ele ainda está de pé.
 *
 * ⚠ POR QUE PERGUNTAR, SE O WEBHOOK JÁ AVISA. Porque o webhook avisa em
 * segundos ENQUANTO o transporte está vivo, e emudece exatamente quando ele
 * morre. Assinatura desativada pela Meta, token expirado, número restringido:
 * em nenhum desses casos chega evento — e "nenhum evento" é indistinguível de
 * "ninguém escreveu hoje".
 *
 * ⚠ É A MESMA CLASSE DO AGENDADOR QUE PULOU, na peça que faltava. Fechamos o
 * silêncio de quem DISPARA (`0066`/`0067`) e deixamos aberto o de quem RECEBE.
 * E o de receber é pior: mensagem que não sai vira reclamação de dentro de
 * casa; mensagem que não chega é alguém que escreveu, não foi respondido e foi
 * embora — sem ninguém saber que ele escreveu.
 *
 * ⚠ ELE NÃO CONSERTA NADA. Não troca token, não reconfigura webhook, não
 * reenvia. Religar sozinho um canal derrubado pela plataforma transforma
 * restrição temporária em definitiva. O vigia informa; a decisão é de gente.
 *
 * ⚠ E É BEST-EFFORT NO CAMINHO DO ENVIO. Falhar em vigiar não pode impedir uma
 * mensagem de sair: o vigia roda ao lado da rodada, nunca antes dela.
 */

/** Não perguntar mais que isso — a resposta da Meta não muda de minuto a minuto. */
const INTERVALO_MIN = 30;

export type ResultadoDaVigia = {
  tenantId: string;
  perguntou: boolean;
  /** Por que não perguntou, quando não perguntou. */
  porque?: string;
  veredito?: Veredito;
};

export async function vigiarCanal(tenantId: string, agora = new Date()): Promise<ResultadoDaVigia> {
  const admin = createAdminClient();

  try {
    // ⚠ SEM CANAL CONFIGURADO NÃO HÁ O QUE VIGIAR, e isso não é falha: é o
    // estado normal de quem ainda usa o link humano. Gravar "erro" aqui encheria
    // a tela de alarme falso — e alarme que toca à toa é alarme desligado.
    const cred = await credencialDoCanal(tenantId);
    if (!cred) return { tenantId, perguntou: false, porque: "Empresa sem canal oficial configurado." };

    // paginacao-ok: `.limit(1)` com ORDER BY — a última verificação, não acervo.
    const { data: ultima } = await admin
      .from("canal_verificacoes")
      .select("occurred_at")
      .eq("tenant_id", tenantId)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const quando = (ultima as { occurred_at?: string } | null)?.occurred_at;
    if (quando) {
      const min = (agora.getTime() - Date.parse(quando)) / 60_000;
      if (Number.isFinite(min) && min >= 0 && min < INTERVALO_MIN) {
        return { tenantId, perguntou: false, porque: `Perguntado há ${Math.floor(min)} min.` };
      }
    }

    const r = await estadoDoNumero(cred);
    // Uma forma só para os dois casos: o inserto tem sempre as mesmas colunas,
    // e o que muda é o conteúdo. Duas formas diferentes fariam o TypeScript
    // discutir e, pior, deixariam colunas fora do registro conforme o caminho.
    const linha = {
      tenant_id: tenantId,
      ok: r.ok,
      quality_rating: r.ok ? r.estado.quality_rating ?? null : null,
      name_status: r.ok ? r.estado.name_status ?? null : null,
      messaging_limit_tier: r.ok ? r.estado.messaging_limit_tier ?? null : null,
      verified_name: r.ok ? r.estado.verified_name ?? null : null,
      erro: r.ok ? null : r.motivo,
    };

    const { error } = await admin.from("canal_verificacoes").insert(linha);
    if (error) console.error(`[vigia] nao registrou: ${error.message}`);

    return {
      tenantId,
      perguntou: true,
      veredito: avaliarSaude(r.ok ? { ok: true, ...r.estado } : { ok: false, erro: r.motivo }),
    };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error(`[vigia] falhou para ${tenantId}: ${erro}`);
    return { tenantId, perguntou: false, porque: erro };
  }
}

/** A última resposta que a Meta deu sobre este número. */
export async function ultimaVerificacao(tenantId: string) {
  const admin = createAdminClient();
  // paginacao-ok: `.limit(1)` com ORDER BY.
  const { data } = await admin
    .from("canal_verificacoes")
    .select("ok, quality_rating, name_status, messaging_limit_tier, verified_name, erro, occurred_at")
    .eq("tenant_id", tenantId)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as {
    ok: boolean; quality_rating: string | null; name_status: string | null;
    messaging_limit_tier: string | null; verified_name: string | null;
    erro: string | null; occurred_at: string;
  } | null) ?? null;
}
