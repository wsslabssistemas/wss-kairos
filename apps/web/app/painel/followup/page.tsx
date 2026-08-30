import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { getSkillFormConfig } from "@/lib/skill";
import { computeDueTouches, historicoPorContato } from "@/lib/cadence";
import { linkDeWhatsApp } from "@/lib/envio";
import { lerTudo } from "@/lib/paginado";

export const metadata = { title: "Follow-up" };

type Contact = {
  id: string;
  name: string;
  phone: string | null;
  owner_id: string | null;
  journey_stage: string;
  stage_entered_at: string;
};

export default async function FollowUpPage({
  searchParams,
}: {
  searchParams: Promise<{ resp?: string }>;
}) {
  const { resp = "" } = await searchParams;
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) {
    return (<main><h1>Follow-up</h1><p className="text-dim">Sem empresa vinculada.</p></main>);
  }

  const { stages, cadences } = await getSkillFormConfig(tenant.skill_key);
  const supabase = await createClient();

  const [cData, ixData, { data: mData }] = await Promise.all([
    // ⚠ PAGINADO, e a metade que faltava. Em 14/ago as `interactions` desta
    // tela foram paginadas e os `contacts` não — e é a lista de contatos que
    // decide QUEM aparece. Cortada em 1.000, a pessoa que devia toque
    // simplesmente não estava na tela: sem linha, sem aviso, sem como
    // desconfiar.
    lerTudo<Contact>((de, ate) => supabase
      .from("contacts")
      .select("id, name, phone, owner_id, journey_stage, stage_entered_at")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order("id")
      .range(de, ate), { rotulo: "contatos do follow-up" }),
    // ⚠ PAGINADO. `ultimo` sai daqui e decide quem esta devendo toque. Cortado
    // em 1.000 linhas arbitrarias, quem ja foi contatado voltaria para a lista.
    lerTudo<{ contact_id: string | null; occurred_at: string; direction: string }>((de, ate) => supabase
      .from("interactions")
      .select("contact_id, occurred_at, direction")
      .eq("tenant_id", tenant.id)
      .order("occurred_at", { ascending: false })
      .range(de, ate), { rotulo: "interacoes do follow-up" }),
    supabase
      .from("memberships")
      .select("id, user:profiles(full_name, email)")
      .eq("tenant_id", tenant.id)
      .eq("status", "active"),
  ]);

  const contacts = cData;
  const ix = ixData;
  const membros = ((mData as { id: string; user: { full_name: string | null; email: string | null } | null }[] | null) ?? [])
    .map((m) => ({ id: m.id, nome: m.user?.full_name ?? m.user?.email ?? "—" }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  // ⚠ ESTA TELA QUITAVA DIFERENTE DA FILA, e as duas mostram a mesma coisa.
  //
  // Aqui o "último toque" contava só o que SAIU; na Fila, qualquer interação.
  // Efeito: o cliente respondia, a Fila dava o assunto por resolvido e o
  // Follow-up continuava cobrando o mesmo toque — duas listas divergentes, e
  // divergência entre listas não parece defeito, parece duas listas.
  //
  // A regra da casa é a da Fila (`lib/fila.ts`): o toque proativo existe para
  // a conversa acontecer; se ela aconteceu, o motivo foi cumprido. As duas
  // passam a usar o mesmo cálculo.
  const { ultimo, toques } = historicoPorContato(
    ix,
    Object.fromEntries(contacts.map((c) => [c.id, c.stage_entered_at])),
  );

  const alvo = resp ? contacts.filter((c) => c.owner_id === resp) : contacts;
  const pendentes = computeDueTouches(alvo, ultimo, stages, cadences, toques);

  const nomeDe = (id: string | null) => membros.find((m) => m.id === id)?.nome ?? "Sem responsável";
  const waLink = (phone: string | null) => linkDeWhatsApp(phone);

  const atrasadosGraves = pendentes.filter((p) => p.overdueDays >= 7).length;

  return (
    <main>
      <div className="between">
        <h1>Follow-up</h1>
        {membros.length > 1 && (
          <form method="get" className="row" style={{ gap: 8 }}>
            <select name="resp" defaultValue={resp} style={{ width: "auto", padding: "5px 9px", fontSize: 13 }}>
              <option value="">Todos</option>
              {membros.map((m) => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </select>
            <button type="submit" className="btn btn-sm">Filtrar</button>
          </form>
        )}
      </div>
      {/* ⚠ ESTA TELA É CONSULTA, NÃO EXECUÇÃO — e dizer isso resolve uma dúvida
          real do fundador em 29/ago: *"os vendedores focam estritamente na fila
          de envio, como fica a aba follow-up, quem olha para ela?"*.
          Ninguém precisa olhar para trabalhar: tudo que está aqui já entra na
          FILA DE ENVIO, com gerador de mensagem e registro, na ordem certa.
          O valor desta tela é o COMPLEMENTO: a fila mostra o que fazer hoje;
          aqui se vê quem está há mais tempo sem atenção. Tela sem papel escrito
          vira tela que alguém abre por engano e não sabe o que fazer. */}
      <p className="text-dim" style={{ marginTop: 4 }}>
        Quem está esperando uma resposta sua. A maior parte das vendas não se
        perde por preço — se perde por silêncio.
      </p>
      <p className="badge" style={{ whiteSpace: "normal", textAlign: "left", marginTop: 10 }}>
        <strong>Esta tela é para consultar, não para executar.</strong> Todo mundo que
        aparece aqui já está na <Link href="/painel/fila">Fila de envio</Link>, com mensagem
        pronta e registro. Use esta aqui para enxergar quem está esquecido há mais tempo.
      </p>

      <div className="stat-grid mt-24">
        <div className="card">
          <div className="stat-num" style={{ color: pendentes.length ? "var(--warn)" : undefined }}>{pendentes.length}</div>
          <div className="stat-label">Toques pendentes</div>
        </div>
        <div className="card">
          <div className="stat-num" style={{ color: atrasadosGraves ? "var(--danger)" : undefined }}>{atrasadosGraves}</div>
          <div className="stat-label">Atrasados 7 dias ou mais</div>
        </div>
        <div className="card">
          <div className="stat-num">{contacts.length}</div>
          <div className="stat-label">Contatos na base</div>
        </div>
      </div>

      {pendentes.length === 0 ? (
        <div className="card mt-24">
          <p style={{ margin: 0 }}>Ninguém esperando resposta. Sua base está em dia. 👏</p>
          <p className="text-dim" style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>
            Os toques aparecem aqui conforme as cadências do seu segmento vencem.
          </p>
        </div>
      ) : (
        <div className="stack mt-24" style={{ gap: 12 }}>
          {pendentes.map((p) => {
            const wa = waLink(p.phone);
            const grave = p.overdueDays >= 7;
            return (
              <div key={p.contactId} className="card" style={grave ? { borderColor: "rgba(242,99,95,0.35)" } : undefined}>
                <div className="between wrap" style={{ gap: 10, alignItems: "flex-start" }}>
                  <div className="grow" style={{ minWidth: 200 }}>
                    <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
                      <Link href={`/painel/contatos/${p.contactId}`}><strong>{p.name}</strong></Link>
                      <span className="badge">{p.stageLabel}</span>
                      {!p.semCadencia && (
                        <span className="badge badge-brand">toque {p.stepNumber} de {p.totalSteps}</span>
                      )}
                      {membros.length > 1 && (
                        <span className="text-faint" style={{ fontSize: 12 }}>{nomeDe(p.ownerId)}</span>
                      )}
                    </div>
                    <p className="text-dim" style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5 }}>
                      {p.intent}
                    </p>
                  </div>
                  <span className={grave ? "badge badge-danger" : "badge badge-warn"} style={{ whiteSpace: "nowrap" }}>
                    {p.daysSince}d sem contato
                  </span>
                </div>
                <div className="row wrap mt-16" style={{ gap: 10, alignItems: "center" }}>
                  <Link href={`/painel/responder?customer=${p.contactId}`} className="btn btn-sm btn-primary">
                    Responder
                  </Link>
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-sm" style={{ background: "#25D366", color: "#0b2e13", border: "none" }}>
                      WhatsApp
                    </a>
                  )}
                  {p.overdueDays > 0 && (
                    <span className="text-faint" style={{ fontSize: 12 }}>
                      o toque venceu há {p.overdueDays} dia{p.overdueDays === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
