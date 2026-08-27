import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { getSkillFormConfig } from "@/lib/skill";
import { displayPhone } from "@/lib/phone";
import { linkDeWhatsApp } from "@/lib/envio";
import JourneyBar from "@/components/JourneyBar";
import { deleteContact, moveStage, updateStageStart } from "../actions";
import { registrarAtendimento, excluirAtendimento } from "../../atendimentos/actions";
import { brl } from "@/lib/money";
import { dataLocal } from "@/lib/fuso";

type Atendimento = {
  id: string;
  service: string;
  value_cents: number;
  occurred_at: string;
  performed_by: string | null;
};

type ContactRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  journey_stage: string;
  stage_entered_at: string;
  created_at: string;
  custom: Record<string, string> | null;
};

export default async function ContatoDetalhe({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const { id } = await params;
  const { ok, erro } = await searchParams;
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) {
    return (
      <main>
        <p className="text-dim">Sem empresa vinculada.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("contacts")
    .select("id, name, phone, email, source, journey_stage, stage_entered_at, created_at, custom")
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!data) notFound();
  const c = data as unknown as ContactRow;

  const { fields, stages, services } = await getSkillFormConfig(tenant.skill_key);

  // Atendimentos com valor + equipe (para atribuir quem executou).
  const [{ data: atData }, { data: memData }, { data: skillRow }] = await Promise.all([
    supabase
      .from("services_rendered")
      .select("id, service, value_cents, occurred_at, performed_by")
      .eq("tenant_id", tenant.id)
      .eq("contact_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("memberships")
      .select("id, user:profiles(full_name, email)")
      .eq("tenant_id", tenant.id)
      .eq("status", "active"),
    supabase.from("skills").select("manifest").eq("key", tenant.skill_key).maybeSingle(),
  ]);

  const atendimentos = (atData as Atendimento[] | null) ?? [];
  const totalCliente = atendimentos.reduce((s, a) => s + (a.value_cents ?? 0), 0);
  const membros = ((memData as { id: string; user: { full_name: string | null; email: string | null } | null }[] | null) ?? [])
    .map((m) => ({ id: m.id, nome: m.user?.full_name ?? m.user?.email ?? "—" }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  // Sugestões de serviço: o campo de catálogo do próprio segmento (dado).
  const catalogo = (skillRow?.manifest as { contact_fields?: { key: string; options?: string[] }[] } | null)
    ?.contact_fields?.find((f) => f.key === "servico_preferido")?.options ?? [];
  const sugestoesServico = [...new Set([...catalogo, ...atendimentos.map((a) => a.service)])];

  const custom = c.custom ?? {};
  const stageLabel = stages.find((s) => s.key === c.journey_stage)?.label ?? c.journey_stage;
  const del = deleteContact.bind(null, id);
  const move = moveStage.bind(null, id);
  const wa = linkDeWhatsApp(c.phone);

  const rows: { label: string; value: string }[] = [
    { label: "Telefone", value: displayPhone(c.phone) },
    { label: "E-mail", value: c.email ?? "—" },
    { label: "Origem", value: c.source ?? "—" },
    { label: "Criado em", value: dataLocal(c.created_at) },
    ...fields.map((f) => ({ label: f.label, value: custom[f.key] ?? "—" })),
  ];

  return (
    <main style={{ maxWidth: 620 }}>
      <Link href="/painel/contatos" className="text-dim" style={{ fontSize: 13 }}>
        ← Contatos
      </Link>

      <div className="between mt-8">
        <div className="row" style={{ gap: 10 }}>
          <h1>{c.name}</h1>
          <span className="badge">{stageLabel}</span>
        </div>
        <div className="row" style={{ gap: 12 }}>
          {wa && (
            <a className="btn btn-sm" href={wa} target="_blank" rel="noopener noreferrer" style={{ background: "#25D366", color: "#0b2e13", border: "none" }}>
              WhatsApp
            </a>
          )}
          <Link href={`/painel/responder?customer=${c.id}`} className="btn btn-sm btn-primary">
            Responder
          </Link>
          <Link href={`/painel/contatos/${c.id}/editar`} className="text-dim" style={{ fontSize: 14 }}>
            Editar
          </Link>
          <form action={del}>
            <button type="submit" className="linklike" style={{ fontSize: 14, color: "var(--danger)" }}>
              Excluir
            </button>
          </form>
        </div>
      </div>

      {/* Jornada */}
      <div className="card mt-24">
        <JourneyBar stages={stages} current={c.journey_stage} />
        <form action={move} className="row wrap mt-16" style={{ gap: 8 }}>
          <span className="text-dim" style={{ fontSize: 13 }}>Mover para</span>
          <select name="to_stage" defaultValue={c.journey_stage} style={{ width: "auto", flex: "0 1 auto" }}>
            {stages.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <input name="reason" placeholder="Motivo (opcional)" className="grow" style={{ minWidth: 140 }} />
          <button type="submit" className="btn btn-sm">Mover</button>
        </form>
      </div>

      {/* Dados */}
      <dl className="card mt-16" style={{ margin: "16px 0 0" }}>
        {rows.map((r, i) => (
          <div
            key={r.label}
            className="between"
            style={{ padding: "9px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none", fontSize: 14 }}
          >
            <dt className="text-dim" style={{ width: 140 }}>{r.label}</dt>
            <dd className="grow" style={{ margin: 0, textAlign: "right" }}>{r.value}</dd>
          </div>
        ))}
      </dl>

      {/* Linha do tempo da fase */}
      {(() => {
        const stageDef = stages.find((s) => s.key === c.journey_stage);
        if (!stageDef?.phases || stageDef.phases.length === 0) return null;
        const startEditor = updateStageStart.bind(null, id);
        const start = c.stage_entered_at ? new Date(c.stage_entered_at) : null;
        const DAY = 86400000;
        return (
          <section className="card mt-16">
            <div className="between" style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 15 }}>{stageDef.label} — linha do tempo</h2>
            </div>
            <form action={startEditor} className="row" style={{ gap: 8, marginBottom: 14 }}>
              <span className="text-dim" style={{ fontSize: 13 }}>Início</span>
              <input type="date" name="start" defaultValue={start ? start.toISOString().slice(0, 10) : ""} style={{ width: "auto" }} />
              <button type="submit" className="btn btn-sm btn-ghost">Salvar</button>
            </form>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {stageDef.phases.map((ph) => {
                const d = start ? new Date(start.getTime() + ph.offset_days * DAY) : null;
                const due = d ? Math.round((d.getTime() - Date.now()) / DAY) : null;
                return (
                  <li key={ph.key} className="between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                    <span>
                      {ph.label} <span className="text-faint" style={{ fontSize: 12 }}>(dia {ph.offset_days})</span>
                    </span>
                    <span className={due !== null && due < 0 ? "badge badge-danger" : due === 0 ? "badge badge-warn" : "text-dim"}>
                      {d ? d.toLocaleDateString("pt-BR") : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })()}

      {/* Atendimentos com valor — só nos segmentos que o manifesto habilita */}
      {services?.enabled && (
      <section style={{ marginTop: 32 }}>
        <div className="between" style={{ alignItems: "baseline" }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>{services?.label ?? "Atendimentos"}</h2>
          {atendimentos.length > 0 && (
            <span className="text-dim" style={{ fontSize: 13 }}>
              {atendimentos.length} · total {brl(totalCliente)}
            </span>
          )}
        </div>

        {ok === "atendimento" && <p className="badge badge-success mt-16">Atendimento registrado.</p>}
        {erro && <p className="badge badge-danger mt-16">{erro}</p>}

        {atendimentos.length > 0 && (
          <div className="card mt-16" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th><th>Serviço</th>
                  {membros.length > 1 && <th>Profissional</th>}
                  <th style={{ textAlign: "right" }}>Valor</th><th></th>
                </tr>
              </thead>
              <tbody>
                {atendimentos.map((a) => (
                  <tr key={a.id}>
                    <td className="text-dim">{dataLocal(a.occurred_at)}</td>
                    <td>{a.service}</td>
                    {membros.length > 1 && (
                      <td className="text-dim">{membros.find((m) => m.id === a.performed_by)?.nome ?? "—"}</td>
                    )}
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(a.value_cents)}</td>
                    <td style={{ textAlign: "right" }}>
                      <form action={excluirAtendimento}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="back" value={`/painel/contatos/${c.id}`} />
                        <button type="submit" className="linklike text-faint" style={{ fontSize: 12 }}>excluir</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form action={registrarAtendimento} className="card mt-16">
          <p className="eyebrow" style={{ marginBottom: 10 }}>Registrar {(services?.item_label ?? "atendimento").toLowerCase()}</p>
          <input type="hidden" name="contact_id" value={c.id} />
          <input type="hidden" name="back" value={`/painel/contatos/${c.id}`} />
          <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
            <label className="grow text-dim" style={{ fontSize: 13, minWidth: 160 }}>
              <span style={{ display: "block", marginBottom: 5 }}>{services?.item_label ?? "Serviço"}</span>
              <input name="service" list="servicos-sugeridos" placeholder="Ex.: corte" required />
            </label>
            <datalist id="servicos-sugeridos">
              {sugestoesServico.map((s) => <option key={s} value={s} />)}
            </datalist>
            <label className="text-dim" style={{ fontSize: 13, width: 110 }}>
              <span style={{ display: "block", marginBottom: 5 }}>Valor (R$)</span>
              <input name="value" inputMode="decimal" placeholder="45,00" required />
            </label>
            <label className="text-dim" style={{ fontSize: 13, width: 150 }}>
              <span style={{ display: "block", marginBottom: 5 }}>Data</span>
              <input type="date" name="occurred_at" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
            {membros.length > 1 && (
              <label className="text-dim" style={{ fontSize: 13, width: 170 }}>
                <span style={{ display: "block", marginBottom: 5 }}>Profissional</span>
                <select name="performed_by" defaultValue={membership!.membershipId}>
                  {membros.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              </label>
            )}
            <button type="submit" className="btn btn-primary">Registrar</button>
          </div>
        </form>
      </section>
      )}

      <p className="text-faint" style={{ marginTop: 20, fontSize: 12 }}>
        Cada mudança de etapa é registrada no histórico da jornada. Os toques aparecem na Agenda.
      </p>
    </main>
  );
}
