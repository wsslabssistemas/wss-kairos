import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { getSkillFormConfig } from "@/lib/skill";
import { computeAlerts } from "@/lib/agenda";
import { lerTudo } from "@/lib/paginado";
import AgendaCalendar, { type CalItem } from "./AgendaCalendar";
import AssinarCalendario from "./AssinarCalendario";
import { gerarEnderecoCalendario, removerEnderecoCalendario } from "./actions";
import { cancelarCompromisso, bloquearHorario, removerBloqueio } from "./horarios-actions";
import Jornada from "./Jornada";
import { dataHoraLocal, horaMinutoLocal } from "@/lib/fuso";

function localISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ prof?: string; ok?: string; erro?: string }>;
}) {
  const sp = await searchParams;
  const profSel = sp.prof ?? "";
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) {
    return (
      <main>
        <h1>Agenda</h1>
        <p className="text-dim">Sem empresa vinculada.</p>
      </main>
    );
  }

  const { stages, scheduling } = await getSkillFormConfig(tenant.skill_key);
  const phasedKeys = stages.filter((s) => s.phases?.length).map((s) => s.key);

  const supabase = await createClient();
  // ⚠ PAGINADO. Daqui saem os compromissos do calendário. Cortada em 1.000
  // linhas, a agenda simplesmente NÃO MOSTRA a visita marcada de quem ficou de
  // fora — e agenda que esconde compromisso não parece quebrada, parece vazia.
  const data = await lerTudo<{ id: string; name: string; journey_stage: string; stage_entered_at: string }>(
    (de, ate) => supabase
      .from("contacts")
      .select("id, name, journey_stage, stage_entered_at")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .in("journey_stage", phasedKeys.length ? phasedKeys : ["__none__"])
      .order("id")
      .range(de, ate),
    { rotulo: "contatos da agenda" },
  );

  // Endereço secreto do calendário (assinatura no Google/Apple/Outlook).
  const { data: tRow } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", tenant.id)
    .maybeSingle();
  const calToken =
    ((tRow?.settings as { calendar_token?: string } | null)?.calendar_token) ?? "";
  const isAdmin = membership.role === "owner" || membership.role === "admin";
  // O endereço do calendário precisa ser absoluto. Deriva do domínio em que o
  // app está sendo servido — funciona em produção e no desenvolvimento.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");

  // Jornada de trabalho e compromissos marcados (segmentos com hora marcada).
  let regras: { weekday: number; starts_at: string; ends_at: string }[] = [];
  let profissionais: { id: string; nome: string; temAgenda: boolean }[] = [];
  let bloqueios: { id: string; starts_at: string; ends_at: string; reason: string | null; membership_id: string | null }[] = [];
  let compromissos: {
    id: string; starts_at: string; service: string | null; origem: string;
    contact_id: string | null; contato: { name: string } | null;
  }[] = [];
  if (scheduling?.enabled) {
    const [{ data: r }, { data: ap }, { data: mem }, { data: todasRegras }, { data: blk }] = await Promise.all([
      (profSel
        ? supabase.from("availability_rules").select("weekday, starts_at, ends_at").eq("tenant_id", tenant.id).eq("membership_id", profSel)
        : supabase.from("availability_rules").select("weekday, starts_at, ends_at").eq("tenant_id", tenant.id).is("membership_id", null)
      ).eq("active", true).order("weekday"),
      supabase
        .from("appointments")
        .select("id, starts_at, service, origem, contact_id, contato:contacts(name)")
        .eq("tenant_id", tenant.id)
        .in("status", ["agendado", "confirmado"])
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(20),
      supabase.from("memberships").select("id, user:profiles(full_name, email)").eq("tenant_id", tenant.id).eq("status", "active"),
      supabase.from("availability_rules").select("membership_id").eq("tenant_id", tenant.id).eq("active", true).not("membership_id", "is", null),
      supabase.from("availability_blocks").select("id, starts_at, ends_at, reason, membership_id").eq("tenant_id", tenant.id).gte("ends_at", new Date().toISOString()).order("starts_at").limit(20),
    ]);
    regras = (r as typeof regras | null) ?? [];
    compromissos = (ap as unknown as typeof compromissos | null) ?? [];
    bloqueios = (blk as typeof bloqueios | null) ?? [];
    const comAgenda = new Set(((todasRegras as { membership_id: string }[] | null) ?? []).map((x) => x.membership_id));
    profissionais = ((mem as { id: string; user: { full_name: string | null; email: string | null } | null }[] | null) ?? [])
      .map((m) => ({ id: m.id, nome: m.user?.full_name ?? m.user?.email ?? "—", temAgenda: comAgenda.has(m.id) }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

  const alerts = computeAlerts(data, stages);

  const items: CalItem[] = alerts.map((a) => ({
    contactId: a.contactId,
    name: a.name,
    stageLabel: a.stageLabel,
    phaseLabel: a.phaseLabel,
    dateISO: localISO(a.date),
  }));

  const atrasados = alerts.filter((a) => a.days < 0);
  const hoje = alerts.filter((a) => a.days === 0);

  return (
    <main>
      <h1>Agenda</h1>
      <p className="text-dim" style={{ marginTop: 4 }}>
        Toques a fazer, calculados das fases da jornada de cada contato.
      </p>

      {(atrasados.length > 0 || hoje.length > 0) && (
        <div className="row wrap mt-16" style={{ gap: 10 }}>
          {atrasados.length > 0 && (
            <span className="badge badge-danger">{atrasados.length} atrasado{atrasados.length === 1 ? "" : "s"}</span>
          )}
          {hoje.length > 0 && (
            <span className="badge badge-warn">{hoje.length} para hoje</span>
          )}
          <span className="row wrap" style={{ gap: 8 }}>
            {[...atrasados, ...hoje].slice(0, 5).map((a, i) => (
              <Link key={`${a.contactId}-${i}`} href={`/painel/contatos/${a.contactId}`} className="badge">
                {a.name} · {a.phaseLabel}
              </Link>
            ))}
          </span>
        </div>
      )}

      {/* Jornada de trabalho: é o que permite o motor oferecer horário */}
      {scheduling?.enabled && (
        <Jornada
          regras={regras}
          profissionais={profissionais}
          selecionado={profSel}
          podeEditar={isAdmin || profSel === membership.membershipId}
        />
      )}

      {/* ⚠ FOLGA DE PROFISSIONAL SÓ EXISTE ONDE SE AGENDA PROFISSIONAL.
          O fundador disse que este bloco é inútil para academia, e está certo
          — mas o motivo é estrutural, não de gosto. Numa barbearia o cliente
          marca COM UM BARBEIRO: a folga dele apaga horários reais. Numa
          academia o aluno vem dentro do horário de funcionamento; quem estiver
          na recepção atende. Cobrar folga ali é pedir cadastro que não muda
          nada, e cadastro que não muda nada ensina a ignorar a tela.
          O manifesto já sabia disso: `offer_by_turno: true` é exatamente a
          declaração "aqui não se marca hora com pessoa, se marca turno". A
          tela passa a obedecer o dado em vez de o segmento ser adivinhado no
          código — Lei 1. */}
      {scheduling?.enabled && !scheduling?.offer_by_turno && (isAdmin || profSel === membership.membershipId) && (
        <div className="card mt-16">
          <p className="eyebrow" style={{ marginBottom: 4 }}>Folgas e bloqueios</p>
          <p className="text-dim" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
            Almoço, folga, feriado ou compromisso. O sistema deixa de oferecer esses horários.
          </p>
          {bloqueios.length > 0 && (
            <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
              {bloqueios.map((b) => (
                <span key={b.id} className="badge" style={{ padding: "6px 10px" }}>
                  {dataHoraLocal(b.starts_at)}
                  {"–"}
                  {horaMinutoLocal(b.ends_at)}
                  {b.reason ? ` · ${b.reason}` : ""}
                  {b.membership_id ? ` · ${profissionais.find((p) => p.id === b.membership_id)?.nome ?? ""}` : " · casa"}
                  <form action={removerBloqueio} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="linklike text-faint" style={{ fontSize: 11, marginLeft: 6 }}>✕</button>
                  </form>
                </span>
              ))}
            </div>
          )}
          <form action={bloquearHorario} className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
            <input type="hidden" name="profissional" value={profSel} />
            <label className="text-dim" style={{ fontSize: 12, width: 150 }}>
              <span style={{ display: "block", marginBottom: 4 }}>Dia</span>
              <input type="date" name="dia" required />
            </label>
            <label className="text-dim" style={{ fontSize: 12, width: 110 }}>
              <span style={{ display: "block", marginBottom: 4 }}>De</span>
              <input type="time" name="de" defaultValue="12:00" required />
            </label>
            <label className="text-dim" style={{ fontSize: 12, width: 110 }}>
              <span style={{ display: "block", marginBottom: 4 }}>Até</span>
              <input type="time" name="ate" defaultValue="13:00" required />
            </label>
            <label className="text-dim grow" style={{ fontSize: 12, minWidth: 140 }}>
              <span style={{ display: "block", marginBottom: 4 }}>Motivo (opcional)</span>
              <input name="motivo" placeholder="Almoço, folga…" />
            </label>
            <button type="submit" className="btn btn-sm">Bloquear</button>
          </form>
        </div>
      )}

      {/* Compromissos marcados */}
      {scheduling?.enabled && compromissos.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Próximos compromissos</h2>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr><th>Quando</th><th>Cliente</th><th>Serviço</th><th>Origem</th><th></th></tr>
              </thead>
              <tbody>
                {compromissos.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {dataHoraLocal(a.starts_at)}
                    </td>
                    <td>
                      {a.contact_id ? (
                        <Link href={`/painel/contatos/${a.contact_id}`}>{a.contato?.name ?? "—"}</Link>
                      ) : "—"}
                    </td>
                    <td className="text-dim">{a.service ?? "—"}</td>
                    <td>
                      <span className={a.origem === "motor" ? "badge badge-brand" : "badge"}>
                        {a.origem === "motor" ? "fechado pela IA" : a.origem}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <form action={cancelarCompromisso}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="back" value="/painel/agenda" />
                        <button type="submit" className="linklike text-faint" style={{ fontSize: 12 }}>cancelar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Assinatura no calendário do celular (Google, Apple, Outlook) */}
      {isAdmin && (
        <div className="card mt-24">
          <div className="between wrap" style={{ gap: 10, alignItems: "baseline" }}>
            <div>
              <p className="eyebrow" style={{ margin: 0 }}>Ver no seu Google Agenda</p>
              <p className="text-dim" style={{ margin: "4px 0 0", fontSize: 13 }}>
                Os toques e retornos aparecem no calendário que você já usa no
                celular, atualizando sozinhos.
              </p>
            </div>
            <form action={calToken ? removerEnderecoCalendario : gerarEnderecoCalendario}>
              <button type="submit" className={calToken ? "linklike" : "btn btn-sm btn-primary"} style={calToken ? { fontSize: 12, color: "var(--danger)" } : undefined}>
                {calToken ? "desativar" : "Gerar endereço"}
              </button>
            </form>
          </div>

          {calToken ? (
            <>
              <AssinarCalendario url={`${siteUrl}/calendario/${calToken}`} />
              <p className="text-faint" style={{ marginTop: 14, marginBottom: 0, fontSize: 12 }}>
                Este endereço é secreto — quem tiver o link vê sua agenda. Não
                publique. Se vazar, clique em <strong>desativar</strong> e gere outro.
              </p>
            </>
          ) : (
            <p className="text-faint mt-8" style={{ fontSize: 12 }}>
              Gera um endereço privado que você adiciona uma vez no seu calendário.
            </p>
          )}
        </div>
      )}

      {/* O calendário aparece sempre — mesmo vazio ele é a visão do mês. */}
      {alerts.length === 0 && (
        <p className="text-faint mt-16" style={{ fontSize: 13 }}>
          Nenhum toque pendente no momento. Ao mover um contato para uma etapa com
          fases, os lembretes aparecem aqui automaticamente.
        </p>
      )}

      <div className="mt-16">
        <AgendaCalendar items={items} />
      </div>
    </main>
  );
}
