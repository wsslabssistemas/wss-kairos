import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SONDAS, temPermissao } from "@/lib/permissoes";
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
  /**
   * O estado de cada modelo na Meta, quando esta rodada leu.
   *
   * ⚠ VAI JUNTO NO RETORNO, e isso evita uma segunda chamada à Meta só para
   * alertar. Quem chama passa para `vigiarAlertas`, que roda logo depois —
   * um dado, uma leitura, dois usos. `undefined` quando não houve leitura
   * nesta batida (o normal: ela acontece uma vez por hora).
   */
  modelos?: { nome: string; status: string }[];
  /**
   * As permissões que hoje faltam e PASSARAM a funcionar nesta leitura.
   *
   * ⚠ Só as liberadas entram. Avisar todo dia que uma permissão continua
   * faltando é a metralhadora que faz a pessoa criar regra de caixa de
   * entrada — e a partir daí nenhum alerta desta casa chega em ninguém.
   */
  permissoes?: { permissao: string; destrava: string }[];
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
    const modelosLidos = await conferirModelos(admin, tenantId, cred, agora);

    // ⚠ AS PERMISSÕES QUE FALTAM, MEDIDAS PELO EFEITO. O estado de uma revisão
    // de app só é legível com token de APLICATIVO, e o segredo mora na Vercel
    // marcado como sensível — o caminho de "perguntar o status" está fechado
    // por construção. Então a gente TENTA a chamada que a permissão libera.
    //
    // Best-effort e de leitura pura: falhar aqui não pode impedir o vigia de
    // conferir a saúde do número, que é o motivo principal desta função.
    const permitidas = await conferirPermissoes(admin, tenantId);

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

    // ⚠ E O TOKEN DO INSTAGRAM É OUTRO, E É ELE QUE VENCE.
    //
    // A primeira versão disto vigiava só a credencial do canal — que é a do
    // WhatsApp, e cujo token costuma ser PERMANENTE. O do Instagram vale 60
    // dias. Ou seja: a peça construída para avisar sobre expiração estava
    // olhando o token que não expira e ignorando o que expira.
    //
    // Achado por uma pergunta do fundador, uma hora depois de ele colar o
    // token: "já está pronto?". Não estava.
    let validadeIg: Awaited<ReturnType<typeof validadeDoToken>> | null = null;
    try {
      // paginacao-ok: uma linha, chave primária.
      const { data: seg } = await admin
        .from("tenant_secrets")
        .select("instagram_token")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const tokenIg = (seg as { instagram_token?: string | null } | null)?.instagram_token?.trim();
      // Empresa sem Instagram não é falha: é o estado normal de quase todas.
      if (tokenIg) validadeIg = await validadeDoToken({ ...cred, token: tokenIg });
    } catch { validadeIg = null; }
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
      token_ig_expira_em: validadeIg?.ok ? validadeIg.expiraEm?.toISOString() ?? null : null,
      token_ig_valido: validadeIg?.ok ? validadeIg.valido : null,
    };

    const { error } = await admin.from("canal_verificacoes").insert(linha);
    if (error) console.error(`[vigia] nao registrou: ${error.message}`);

    return {
      tenantId,
      perguntou: true,
      // O estado dos modelos, quando esta batida leu. Quem chama passa para o
      // alarme — um dado, uma leitura, dois usos.
      modelos: modelosLidos,
      permissoes: permitidas,
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
    .select("ok, quality_rating, name_status, messaging_limit_tier, verified_name, erro, occurred_at, token_expira_em, token_valido, token_ig_expira_em, token_ig_valido")
    .eq("tenant_id", tenantId)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as {
    ok: boolean; quality_rating: string | null; name_status: string | null;
    messaging_limit_tier: string | null; verified_name: string | null;
    erro: string | null; occurred_at: string;
    token_expira_em: string | null; token_valido: boolean | null;
    token_ig_expira_em: string | null; token_ig_valido: boolean | null;
  } | null) ?? null;
}


/**
 * Quantas horas entre duas leituras dos modelos na Meta.
 *
 * ⚠ ERA 24, E VIROU 1 EM 5/set. Vinte e quatro horas bastavam quando isto só
 * servia para copiar o CORPO dos aprovados — texto de modelo não muda sozinho.
 * Agora a leitura também é o que descobre **mudança de estado**, e aí o atraso
 * vira o produto: o dono submete dois modelos, eles são aprovados às 11h, e ele
 * fica sabendo no dia seguinte. Uma chamada por hora não custa nada.
 */
const MODELOS_INTERVALO_H = 1;

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
): Promise<{ nome: string; status: string }[] | undefined> {
  let situacaoLida: { nome: string; status: string }[] | undefined;
  try {
    if (!cred) return undefined;
    // paginacao-ok: uma linha, chave primária.
    const { data: seg } = await admin
      .from("tenant_secrets")
      .select("whatsapp_waba_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const wabaId = (seg as { whatsapp_waba_id?: string | null } | null)?.whatsapp_waba_id;
    if (!wabaId) return undefined;

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
      if (Number.isFinite(horas) && horas >= 0 && horas < MODELOS_INTERVALO_H) return undefined;
    }

    const r = await modelosAprovados(cred, wabaId);
    if (!r.ok) {
      console.warn(`[vigia] nao li os modelos aprovados: ${r.motivo}`);
      return undefined;
    }
    situacaoLida = r.situacao;
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
  return situacaoLida;
}

/** Quantas horas entre duas conferências de permissão. */
const PERMISSOES_INTERVALO_H = 12;

/**
 * Testa as permissões que faltam e devolve as que PASSARAM a funcionar.
 *
 * ⚠ DUAS VEZES POR DIA basta: aprovação de permissão leva dias, e a notícia
 * chegar seis horas depois não muda nada. O que não pode é chegar semana que
 * vem — que era o caso, porque não chegava nunca.
 */
async function conferirPermissoes(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<{ permissao: string; destrava: string }[]> {
  try {
    // paginacao-ok: uma linha, chave primária.
    const { data } = await admin
      .from("tenant_secrets")
      .select("facebook_page_id, facebook_token")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const seg = data as { facebook_page_id?: string | null; facebook_token?: string | null } | null;
    const pagina = seg?.facebook_page_id?.trim();
    const token = seg?.facebook_token?.trim();
    if (!pagina || !token) return [];

    // ⚠ O RELÓGIO SAI DO PRÓPRIO ALERTA. `alertas_enviados` já guarda quando
    // cada aviso saiu; usar isso como memória evita uma tabela nova para um
    // dado que vale meio dia. Sem registro nenhum, sonda — é a primeira vez.
    const desde = new Date(Date.now() - PERMISSOES_INTERVALO_H * 3_600_000).toISOString();
    const { data: recente } = await admin
      .from("alertas_enviados")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("tipo", "permissao_sonda")
      .gte("enviado_em", desde)
      .limit(1);
    if ((recente ?? []).length > 0) return [];

    const liberadas: { permissao: string; destrava: string }[] = [];
    for (const s of SONDAS) {
      const tem = await temPermissao(s.permissao, pagina, token);
      if (tem === true) liberadas.push({ permissao: s.permissao, destrava: s.destrava });
    }

    // Marca que sondou. Linha de controle, não de alerta: `entregue` fica
    // false e ninguém recebe nada por ela.
    await admin.from("alertas_enviados").insert({
      tenant_id: tenantId,
      tipo: "permissao_sonda",
      chave: new Date().toISOString().slice(0, 13),
      entregue: false,
      erro: "controle de frequência da sonda, não é alerta",
    });

    return liberadas;
  } catch (e) {
    console.warn(`[vigia] nao consegui sondar permissoes: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}
