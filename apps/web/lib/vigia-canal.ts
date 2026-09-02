import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDoCanal } from "@/lib/credenciais";
import { estadoDoNumero, validadeDoToken, modelosAprovados } from "@/lib/perfil-canal";
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

    // ⚠ E OS MODELOS APROVADOS SÃO CONFERIDOS JUNTO, no máximo uma vez por
    // dia. É o que impede o corpo guardado em `modelos_canal` de envelhecer:
    // um texto reaprovado na Meta e não atualizado aqui faz o histórico
    // registrar uma conversa que não aconteceu, e a IA responder a ela.
    //
    // Uma vez por dia, e não a cada batida: são 40 batidas por dia e o texto
    // de um modelo muda em semanas, quando muda. Falhar aqui é engolido de
    // propósito — vigiar modelo não pode impedir vigiar a saúde do número.
    await conferirModelos(admin, tenantId, cred, agora);

    const r = await estadoDoNumero(cred);

    // ⚠ A VALIDADE DO TOKEN VAI JUNTO, na mesma passada. Token vencido não dá
    // erro visível: a Meta recusa, o motor registra falha, e do lado de fora
    // aparece como "o sistema parou de responder". Perguntar aqui é o que
    // transforma um silêncio futuro em manutenção agendada — e ninguém precisa
    // ANOTAR data nenhuma, que era o pedido do fundador.
    //
    // Best-effort: falhar em saber a validade não pode impedir o registro da
    // saúde do número, que é o motivo principal desta função existir.
    let validade: Awaited<ReturnType<typeof validadeDoToken>> | null = null;
    try { validade = await validadeDoToken(cred); } catch { validade = null; }
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
      // `null` quando não deu para perguntar OU quando o token não vence
      // (`expires_at: 0`, dos permanentes). São casos diferentes com o mesmo
      // valor, e `token_valido` é o que os separa.
      token_expira_em: validade?.ok ? validade.expiraEm?.toISOString() ?? null : null,
      token_valido: validade?.ok ? validade.valido : null,
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
    .select("ok, quality_rating, name_status, messaging_limit_tier, verified_name, erro, occurred_at, token_expira_em, token_valido")
    .eq("tenant_id", tenantId)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as {
    ok: boolean; quality_rating: string | null; name_status: string | null;
    messaging_limit_tier: string | null; verified_name: string | null;
    erro: string | null; occurred_at: string;
    token_expira_em: string | null; token_valido: boolean | null;
  } | null) ?? null;
}


/** Quantas horas entre duas leituras dos modelos aprovados. */
const MODELOS_INTERVALO_H = 24;

/**
 * Traz da Meta o corpo dos modelos aprovados e guarda em `modelos_canal`.
 *
 * ⚠ SÓ COM WABA ID. Ele chega sozinho no `entry[].id` do webhook — antes da
 * primeira mensagem recebida ele não existe, e aí não há o que conferir.
 *
 * ⚠ E ELE GRAVA POR EMPRESA (`tenant_id` preenchido), nunca por cima do texto
 * do produto: duas academias podem ter modelos de mesmo nome com textos
 * diferentes, e sobrescrever a linha global faria o texto de uma valer para a
 * outra. A linha da empresa é a que o envio lê primeiro.
 */
async function conferirModelos(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  cred: Awaited<ReturnType<typeof credencialDoCanal>>,
  agora: Date,
): Promise<void> {
  try {
    if (!cred) return;
    // paginacao-ok: uma linha, chave primária.
    const { data: seg } = await admin
      .from("tenant_secrets")
      .select("whatsapp_waba_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const wabaId = (seg as { whatsapp_waba_id?: string | null } | null)?.whatsapp_waba_id;
    if (!wabaId) return;

    // paginacao-ok: `.limit(1)` com ORDER BY — a leitura mais recente.
    const { data: ultima } = await admin
      .from("modelos_canal")
      .select("atualizado_em")
      .eq("tenant_id", tenantId)
      .order("atualizado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    const quando = (ultima as { atualizado_em?: string } | null)?.atualizado_em;
    if (quando) {
      const horas = (agora.getTime() - Date.parse(quando)) / 3_600_000;
      if (Number.isFinite(horas) && horas >= 0 && horas < MODELOS_INTERVALO_H) return;
    }

    const r = await modelosAprovados(cred, wabaId);
    if (!r.ok) {
      console.warn(`[vigia] nao li os modelos aprovados: ${r.motivo}`);
      return;
    }
    // ⚠ ATUALIZA E SÓ ENTÃO INSERE — nada de `upsert` com `onConflict`.
    //
    // A regra da casa nasceu de um estrago: `upsert` com `onConflict` sobre um
    // índice que o PostgREST não consegue expressar falhou em SILÊNCIO por
    // dias, com 200 devolvido à Meta e a frase do cliente sumindo. O índice
    // daqui não é parcial e provavelmente funcionaria — mas "provavelmente"
    // não é critério para uma gravação que ninguém olha.
    //
    // E o `.select()` aqui é o que diz se a linha existia: sem ele, `update`
    // que não achou nada é indistinguível de `update` que achou.
    for (const m of r.modelos) {
      const { data: mexidas, error: erroUpd } = await admin
        .from("modelos_canal")
        .update({ corpo: m.corpo, origem: "meta", atualizado_em: agora.toISOString() })
        .eq("tenant_id", tenantId)
        .eq("nome", m.nome)
        .select("id");
      if (erroUpd) {
        console.warn(`[vigia] nao atualizei o modelo ${m.nome}: ${erroUpd.message}`);
        continue;
      }
      if ((mexidas ?? []).length > 0) continue;

      const { error: erroIns } = await admin
        .from("modelos_canal")
        .insert({ tenant_id: tenantId, nome: m.nome, corpo: m.corpo, origem: "meta", atualizado_em: agora.toISOString() });
      if (erroIns) console.warn(`[vigia] nao guardei o modelo ${m.nome}: ${erroIns.message}`);
    }
  } catch (e) {
    console.warn(`[vigia] falha ao conferir modelos: ${e instanceof Error ? e.message : String(e)}`);
  }
}
