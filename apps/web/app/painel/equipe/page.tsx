import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { getSkillFormConfig } from "@/lib/skill";
import { changeRole, gerarLinkDeAcesso, salvarRacao } from "./actions";
import { lerRacao, RACAO_MAXIMA } from "@/lib/racao";
import { stagesForaDeJogo } from "@/lib/recurrence";
import { computePlacar } from "@/lib/placar";
import { PlacarDaEquipe } from "./Placar";
import LinkDoConvite from "./LinkDoConvite";
import { lerTudo } from "@/lib/paginado";

type Member = {
  id: string;
  role: string;
  user: { full_name: string | null; email: string | null } | null;
};

const ROLES = ["owner", "admin", "manager", "agent"];

export default async function EquipePage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string; ok?: string; erro?: string; enviado?: string }>;
}) {
  const sp = await searchParams;
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) {
    return (
      <main>
        <h1 style={{ fontSize: 24, marginTop: 0 }}>Equipe</h1>
        <p style={{ opacity: 0.85 }}>Sem empresa vinculada.</p>
      </main>
    );
  }
  const isAdmin = membership.role === "owner" || membership.role === "admin";

  const { stages } = await getSkillFormConfig(tenant.skill_key);
  const wonKeys = new Set(stages.filter((s) => s.won).map((s) => s.key));
  const terminalKeys = stagesForaDeJogo(stages);

  const supabase = await createClient();
  const { data: members } = await supabase
    .from("memberships")
    .select("id, role, user:profiles(full_name, email)")
    .eq("tenant_id", tenant.id)
    .eq("status", "active");
  // Janela de 30 dias: placar é sobre o mês corrente de trabalho, não sobre a
  // história inteira. Somar tudo desde sempre premia quem está há mais tempo.
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const hojeISO = new Date().toISOString().slice(0, 10);
  // ⚠ PAGINADO, e UMA LEITURA SÓ. Eram duas varreduras de `contacts` na mesma
  // tela — uma para a carteira, outra para o mapa de dono — e nenhuma das duas
  // paginada. Em 14/ago as `interactions` daqui foram corrigidas e os contatos
  // ficaram para trás: metade do placar passou a ser contada certa sobre uma
  // base cortada em 1.000 linhas ARBITRÁRIAS.
  //
  // Num placar isso é pior que em qualquer outra tela: o número de uma pessoa
  // aparece para os colegas dela, menor do que foi, **e ela não tem como
  // contestar um número que o sistema afirma.**
  const [contatos, ixData, { data: tRow }] = await Promise.all([
    lerTudo<{ id: string; owner_id: string | null; journey_stage: string; created_at: string; next_action_at: string | null }>(
      (de, ate) => supabase
        .from("contacts")
        .select("id, owner_id, journey_stage, created_at, next_action_at")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .order("id")
        .range(de, ate),
      { rotulo: "contatos do placar" },
    ),
    // ⚠ PAGINADO. O placar mostra o desempenho de UMA PESSOA para os colegas
    // dela. Cortar o array faz um vendedor aparecer com menos atendimento do
    // que teve — e ele nao tem como contestar um numero que o sistema afirma.
    lerTudo<{ contact_id: string | null; direction: string; occurred_at: string; input_kind: string }>((de, ate) => supabase
      .from("interactions")
      .select("contact_id, direction, occurred_at, input_kind")
      .eq("tenant_id", tenant.id)
      .gte("occurred_at", desde)
      .order("occurred_at", { ascending: true })
      .range(de, ate), { rotulo: "interacoes do placar" }),
    supabase.from("tenants").select("settings").eq("id", tenant.id).maybeSingle(),
  ]);
  const racaoAtual = lerRacao((tRow?.settings ?? null) as Record<string, unknown> | null);

  const team = (members as Member[] | null) ?? [];
  const owned = contatos;
  const mine = (id: string) => owned.filter((c) => c.owner_id === id);
  const cadastros = (id: string) => mine(id).length;
  const matriculas = (id: string) =>
    mine(id).filter((c) => wonKeys.has(c.journey_stage)).length;
  const emAberto = (id: string) =>
    mine(id).filter((c) => !terminalKeys.has(c.journey_stage)).length;

  // -------------------------------------------------------------- O PLACAR
  //
  // Um ATENDIMENTO é uma mensagem que ENTROU; a resposta é a primeira saída
  // depois dela. Medir assim, e não por registro manual, é o que faz o tempo
  // de resposta existir sem ninguém preencher nada — e registro manual de
  // tempo é o campo que todo mundo esquece justamente nos dias corridos, que
  // são os dias em que ele importaria.
  const ownerDe = new Map<string, string | null>(contatos.map((r) => [r.id, r.owner_id]));

  const ix = ixData;
  const atendimentos: { ownerId: string | null; entradaISO: string; respostaISO: string | null }[] = [];
  const aguardando = new Map<string, string>();
  for (const i of ix) {
    if (!i.contact_id) continue;
    if (i.direction === "inbound") {
      // ⚠ BRIEFING NÃO É ATENDIMENTO. O texto que a equipe digita no campo de
      // mensagem ("faça uma proposta de retorno para a aluna") é `agent_note`
      // desde a `0068`. Contá-lo aqui dava DUAS distorções na mesma linha: um
      // atendimento a mais no placar de quem escreveu, e um tempo de resposta
      // de segundos, porque a pessoa estava respondendo a si mesma.
      //
      // ⚠ E NUM PLACAR ISSO É PIOR, pelo motivo escrito no topo deste arquivo:
      // o número aparece para os colegas, e ninguém tem como contestar um
      // número que o sistema afirma. Aqui ele inflava a favor de quem usa mais
      // a ferramenta, que é o oposto do que o placar deveria medir.
      if (i.input_kind !== "customer_message") continue;
      // Só a PRIMEIRA de uma sequência: três mensagens seguidas do cliente são
      // um atendimento, não três, e contar três inflaria o volume de quem
      // atende gente ansiosa.
      if (!aguardando.has(i.contact_id)) aguardando.set(i.contact_id, i.occurred_at);
    } else if (aguardando.has(i.contact_id)) {
      atendimentos.push({
        ownerId: ownerDe.get(i.contact_id) ?? null,
        entradaISO: aguardando.get(i.contact_id)!,
        respostaISO: i.occurred_at,
      });
      aguardando.delete(i.contact_id);
    }
  }
  // Entrada SEM resposta também é atendimento — e é justamente ela que não
  // pode sumir da conta: se sumisse, quem não respondeu ninguém apareceria com
  // tempo de resposta ótimo.
  for (const [cid, entrada] of aguardando) {
    atendimentos.push({ ownerId: ownerDe.get(cid) ?? null, entradaISO: entrada, respostaISO: null });
  }

  const placar = computePlacar(
    team.map((m) => ({ id: m.id, nome: m.user?.full_name ?? m.user?.email ?? "—" })),
    atendimentos,
    owned.map((c) => ({
      ownerId: c.owner_id,
      ganho: wonKeys.has(c.journey_stage),
      combinadoAtrasado: !!c.next_action_at && c.next_action_at < hojeISO && !terminalKeys.has(c.journey_stage),
      novoNoPeriodo: c.created_at >= desde,
    })),
  );

  const inviteLink = sp.convite ? decodeURIComponent(sp.convite) : null;
  const enviadoPara = sp.enviado ? decodeURIComponent(sp.enviado) : null;

  return (
    <main>
      <div className="between">
        <h1>Equipe</h1>
        {isAdmin && (
          <Link href="/painel/equipe/adicionar" className="btn btn-sm btn-primary">
            + Adicionar
          </Link>
        )}
      </div>

      <PlacarDaEquipe placar={placar} periodo="últimos 30 dias" />

      {/* ⚠ O RITMO DO TIME, e ele é decisão de quem responde pelo resultado.
          A fila do vendedor mostra a ração do dia em vez do acervo inteiro —
          ver `lib/racao.ts` para os três motivos. Aqui é onde o número se
          ajusta depois de medir o que o time de fato dá conta. */}
      {isAdmin && (
        <div className="card mt-16">
          <p className="eyebrow" style={{ marginBottom: 6 }}>Ritmo do time</p>
          <form action={salvarRacao} className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
            <label className="text-dim" style={{ fontSize: 13 }}>
              <span style={{ display: "block", marginBottom: 4 }}>Pessoas por dia, por vendedor</span>
              <input
                type="number"
                name="racao_dia"
                min={1}
                max={RACAO_MAXIMA}
                defaultValue={racaoAtual}
                style={{ width: 90 }}
              />
            </label>
            <button type="submit" className="btn btn-sm">Salvar</button>
          </form>
          <p className="text-faint" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            É o teto do que o sistema <strong>pede</strong> por dia — ninguém fica impedido de
            falar com mais gente. Lista grande demais faz a pessoa parar de executar, e
            centenas de mensagens em poucos dias é o padrão que faz o WhatsApp banir o
            número da empresa.
          </p>
        </div>
      )}

      {/* ⚠ "ENVIEI" PRECISA SER DIFERENTE DE "PRONTO". Quem escolheu e-mail
          fica sem link nenhum na tela — e sem esta faixa não teria como saber
          se ainda precisa mandar alguma coisa para a pessoa. */}
      {enviadoPara && (
        <div className="card mt-16" style={{ borderColor: "var(--border-brand)" }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <span className="badge badge-success" style={{ marginRight: 8 }}>Convite enviado</span>
            O e-mail foi para <strong>{enviadoPara}</strong>. Ela cria a senha por lá —
            você não precisa mandar mais nada.
          </p>
          <p className="text-faint" style={{ fontSize: 12, margin: "8px 0 0" }}>
            Se não chegar em alguns minutos, peça para conferir o spam. E se
            preferir resolver na hora, o botão <strong>Gerar acesso</strong> ao
            lado do nome dela cria um link para você mandar direto.
          </p>
        </div>
      )}

      {inviteLink && (
        <div className="card mt-16" style={{ borderColor: "var(--border-brand)" }}>
          <p style={{ margin: "0 0 8px", fontSize: 13 }}>
            <span className="badge badge-success" style={{ marginRight: 8 }}>Link gerado</span>
            Envie este link para a pessoa (WhatsApp, e-mail) — ela define a própria senha.
            <strong> Ela não precisa esperar e-mail nenhum.</strong>
          </p>
          <LinkDoConvite link={inviteLink} />
        </div>
      )}
      {sp.ok === "racao" && <p className="badge badge-success mt-16">Ritmo salvo: {racaoAtual} por dia, por vendedor.</p>}
      {sp.ok && sp.ok !== "racao" && <p className="badge badge-success mt-16">Membro vinculado.</p>}
      {sp.erro && <p className="badge badge-danger mt-16">{sp.erro}</p>}

      <div className="card mt-24" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Papel</th>
              <th style={{ textAlign: "right" }}>Cadastros</th>
              <th style={{ textAlign: "right" }}>Em aberto</th>
              <th style={{ textAlign: "right" }}>Matrículas</th>
              {isAdmin && <th style={{ textAlign: "right" }}>Ações</th>}
            </tr>
          </thead>
          <tbody>
            {team.map((mem) => (
              <tr key={mem.id}>
                <td>
                  {mem.user?.full_name ?? mem.user?.email ?? "—"}
                  {mem.user?.full_name && (
                    <span className="text-faint" style={{ fontSize: 12 }}> · {mem.user?.email}</span>
                  )}
                </td>
                <td>
                  {isAdmin && mem.id !== membership.membershipId ? (
                    <form action={changeRole.bind(null, mem.id)} className="row" style={{ gap: 6 }}>
                      <select name="role" defaultValue={mem.role} style={{ width: "auto", padding: "5px 8px", fontSize: 13 }}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn-sm btn-ghost">Salvar</button>
                    </form>
                  ) : (
                    <span className="badge">{mem.role}</span>
                  )}
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{cadastros(mem.id)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{emAberto(mem.id)}</td>
                <td style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{matriculas(mem.id)}</td>
                {isAdmin && (
                  <td style={{ textAlign: "right" }}>
                    {mem.id !== membership.membershipId ? (
                      <div className="row" style={{ gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
                        {/* Destrava a pessoa na hora, sem depender de e-mail —
                            que foi o que travou a equipe em 10/ago. */}
                        <form action={gerarLinkDeAcesso.bind(null, mem.id)}>
                          <button type="submit" className="btn btn-sm btn-ghost" style={{ whiteSpace: "nowrap" }}>
                            Gerar acesso
                          </button>
                        </form>
                        <Link href={`/painel/equipe/${mem.id}/remover`} style={{ color: "var(--danger)", fontSize: 13 }}>
                          Remover
                        </Link>
                      </div>
                    ) : (
                      <span className="text-faint" style={{ fontSize: 13 }}>você</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-faint" style={{ marginTop: 20, fontSize: 13 }}>
        Cadastros e matrículas vêm dos contatos de cada vendedor. Tempo de resposta
        entra com o histórico de atendimentos.
      </p>
    </main>
  );
}
