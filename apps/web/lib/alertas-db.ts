import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ultimaVerificacao } from "@/lib/vigia-canal";
import { alertasDoEstado, filtrarJaAvisados, silencioDe, type Alerta } from "@/lib/alertas";

// A ENTREGA DO ALERTA — quem recebe, por onde vai, e o que fica registrado.
//
// ⚠ ONDE ISTO RODA: junto do vigia do canal, em TODA batida do agendador — e
// fora do espaçamento, pelo mesmo motivo que `vigiarCanal`. O espaçamento
// governa quanta mensagem sai; alarme é outra pergunta, e ela precisa de
// resposta justamente nas batidas em que nada sai.
//
// ⚠ E É BEST-EFFORT DO INÍCIO AO FIM. Falhar em avisar não pode derrubar a
// rodada: o pior alerta possível é o que impede a campanha de funcionar.

/** Só avisa sobre decisão pendente que já está esperando há isto. */
const IDADE_MINIMA_MIN = 15;

/**
 * Confere o estado da empresa e dispara o que for novo.
 *
 * Devolve quantos alertas saíram — para o log da rodada, e para o dia em que
 * alguém perguntar se o alarme está vivo.
 */
export async function vigiarAlertas(tenantId: string, agora = new Date()): Promise<number> {
  try {
    const admin = createAdminClient();

    // ⚠ A ÚLTIMA BATIDA QUALQUER, inclusive a recusada pelo espaçamento. É a
    // mesma consulta da tela, e é ela que faz o alarme tocar em uma hora em
    // vez de 26: "o motor não trabalhou" e "o agendador está morto" tinham a
    // mesma cara em 27/ago.
    //
    // paginacao-ok: `.limit(1)` com ORDER BY — é a última linha, não acervo.
    const { data: batida } = await admin
      .from("motor_execucoes")
      .select("occurred_at")
      .eq("tenant_id", tenantId)
      .eq("origem", "agendador")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // ⚠ ESTA BATIDA É A DE AGORA, e por isso o alerta de agendador mudo quase
    // nunca sai daqui: quem está chamando é o próprio agendador. Ele só toca
    // quando o relógio RESERVA (`pg_cron` do Supabase) chama depois de o
    // GitHub ficar uma hora calado — que é exatamente o cenário que o reserva
    // foi instalado para cobrir. Sem os dois relógios, este alerta seria um
    // vigia vigiando a si mesmo.
    const ultima = (batida as { occurred_at: string } | null)?.occurred_at ?? null;
    const minutosSemBatida = ultima
      ? Math.floor((agora.getTime() - Date.parse(ultima)) / 60_000)
      : null;

    // As decisões da fase 2 esperando gente, com uma idade mínima: avisar no
    // segundo seguinte atropelaria quem já está com a tela aberta resolvendo.
    const limite = new Date(agora.getTime() - IDADE_MINIMA_MIN * 60_000).toISOString();
    // paginacao-ok: recorte de alarme, `.limit()` explícito e ordenado.
    const { data: pend } = await admin
      .from("respostas_automaticas")
      .select("id, porque, contacts(name)")
      .eq("tenant_id", tenantId)
      .eq("decisao", "escalou")
      .is("visto_em", null)
      .lte("occurred_at", limite)
      .order("occurred_at", { ascending: false })
      .limit(10);

    const decisoesPendentes = ((pend as unknown[] | null) ?? []).map((r) => {
      const l = r as { id: string; porque: string; contacts?: { name?: string } | { name?: string }[] | null };
      const c = Array.isArray(l.contacts) ? l.contacts[0] : l.contacts;
      return { id: l.id, nome: c?.name ?? "(contato sem nome)", porque: l.porque };
    });

    const verificacao = await ultimaVerificacao(tenantId);
    const diasDoToken =
      verificacao?.token_expira_em
        ? Math.floor((Date.parse(verificacao.token_expira_em) - agora.getTime()) / 86_400_000)
        : null;

    const candidatos = alertasDoEstado({
      minutosSemBatida,
      decisoesPendentes,
      qualidade: verificacao?.quality_rating ?? null,
      diasDoToken,
    });
    if (candidatos.length === 0) return 0;

    // O que já foi avisado, dentro da maior janela de silêncio que existe —
    // uma consulta só, em vez de uma por alerta.
    const maiorJanela = Math.max(...candidatos.map((a) => silencioDe(a.tipo)));
    const desde = new Date(agora.getTime() - maiorJanela * 3_600_000).toISOString();
    // paginacao-ok: recorte por janela de tempo curta, com ORDER BY e limite.
    const { data: ja } = await admin
      .from("alertas_enviados")
      .select("tipo, chave, enviado_em")
      .eq("tenant_id", tenantId)
      .gte("enviado_em", desde)
      .order("enviado_em", { ascending: false })
      .limit(200);

    const novos = filtrarJaAvisados(
      candidatos,
      (ja as { tipo: string; chave: string; enviado_em: string }[] | null) ?? [],
      agora,
    );
    if (novos.length === 0) return 0;

    const destinos = await quemRecebe(tenantId);

    for (const a of novos) {
      const r = await entregar(a, destinos);
      // ⚠ O REGISTRO ACONTECE MESMO QUANDO A ENTREGA FALHA, e é de propósito.
      // Sem chave de e-mail configurada, todo alerta falharia e todo alerta
      // seria tentado de novo a cada 15 minutos, para sempre. Registrar a
      // tentativa preserva a janela de silêncio — e a coluna `erro` conta a
      // verdade para a tela: o alerta EXISTIU, só não foi entregue.
      await admin.from("alertas_enviados").insert({
        tenant_id: tenantId,
        tipo: a.tipo,
        chave: a.chave,
        destino: destinos.join(", ") || null,
        entregue: r.ok,
        erro: r.ok ? null : r.motivo,
      });
      if (!r.ok) console.warn(`[alertas] ${a.tipo} nao entregue: ${r.motivo}`);
    }

    return novos.length;
  } catch (e) {
    // Engole o próprio erro, como `vigiarCanal`: falhar em avisar não pode
    // impedir uma mensagem de sair.
    console.warn(`[alertas] falhei ao vigiar ${tenantId}: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

/**
 * Para quem vai o alerta: donos e administradores da empresa.
 *
 * ⚠ NÃO É O VENDEDOR. Alerta de token vencendo e de agendador mudo é assunto
 * de quem pode CONSERTAR — mandar para quem só executa produz a pior reação
 * possível: a pessoa acha que está quebrado e para de usar.
 */
async function quemRecebe(tenantId: string): Promise<string[]> {
  const admin = createAdminClient();
  // paginacao-ok: donos e admins de UMA empresa — no máximo um punhado.
  const { data } = await admin
    .from("memberships")
    .select("role, profiles(email)")
    .eq("tenant_id", tenantId)
    .in("role", ["owner", "admin"])
    .limit(50);

  const emails = ((data as unknown[] | null) ?? [])
    .map((m) => {
      const l = m as { profiles?: { email?: string } | { email?: string }[] | null };
      const p = Array.isArray(l.profiles) ? l.profiles[0] : l.profiles;
      return (p?.email ?? "").trim();
    })
    .filter((e) => e.includes("@"));

  return [...new Set(emails)];
}

/**
 * Manda o alerta por e-mail (Resend).
 *
 * ⚠ SEM `RESEND_API_KEY` ELE NÃO SAI — e isso é dito, nunca escondido. A
 * ausência da chave é a diferença entre "não houve alerta" e "houve alerta e
 * ninguém foi avisado", e as duas se parecem exatamente com nada. Por isso a
 * falha vira linha em `alertas_enviados` com o motivo escrito, e não um
 * `return` silencioso: campo ausente é indistinguível de campo que não foi
 * feito, e alarme ausente é indistinguível de tudo em ordem.
 */
async function entregar(
  a: Alerta,
  destinos: string[],
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const chave = process.env.RESEND_API_KEY;
  if (!chave) {
    return {
      ok: false,
      motivo:
        "RESEND_API_KEY não configurada na Vercel — o alerta foi produzido e não foi entregue.",
    };
  }
  if (destinos.length === 0) {
    return { ok: false, motivo: "Nenhum dono ou administrador com e-mail nesta empresa." };
  }

  const remetente = process.env.ALERTAS_REMETENTE ?? "Kairós <alertas@wsslabs.com.br>";
  const marca = a.gravidade === "urgente" ? "🔴" : "🟡";

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: remetente,
        to: destinos,
        subject: `${marca} ${a.titulo}`,
        // Texto puro de propósito: alerta é para ler no celular, às vezes de
        // madrugada. HTML bonito atrasa a leitura e não muda nada.
        text: `${a.corpo}\n\n— Kairós, automaticamente. Você recebe isto porque é dono ou administrador da empresa.`,
      }),
      cache: "no-store",
    });
    if (!r.ok) {
      return { ok: false, motivo: `Resend devolveu ${r.status}: ${(await r.text()).slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}
