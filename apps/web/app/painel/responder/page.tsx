import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { getSkillFormConfig } from "@/lib/skill";
import { matchEntries, distinctCategories } from "@/lib/match";
import { displayPhone } from "@/lib/phone";
import { linkDeWhatsApp } from "@/lib/envio";
import JourneyBar from "@/components/JourneyBar";
import { hasAIKey } from "@/lib/ai";
import { CopyButton } from "./CopyButton";
import GerarIA from "./GerarIA";
import { MoverEtapa } from "./MoverEtapa";
import Abordar from "./Abordar";
import { logInteraction } from "./actions";
import { dataLocal } from "@/lib/fuso";

// Tela que chama IA declara o tempo da função: sem isto a Vercel mata a
// geração no meio e o botão fica girando sem erro nenhum. Ver `fila/page.tsx`.
export const maxDuration = 60;

type Entry = {
  id: string;
  category: string;
  trigger_questions: string[] | null;
  answer: string | null;
  strategy: string | null;
  technique: string | null;
  next_objective: string | null;
};

type ContactLite = { id: string; name: string; journey_stage: string; phone: string | null };
type Interaction = { id: string; direction: string; content: string; occurred_at: string };

export default async function ResponderPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; customer?: string; salvo?: string; quem?: string }>;
}) {
  const { q = "", customer = "", salvo, quem = "" } = await searchParams;
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) {
    return (
      <main>
        <h1>Responder</h1>
        <p className="text-dim">Sem empresa vinculada.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { stages } = await getSkillFormConfig(tenant.skill_key);

  const [{ data: entriesData }, { data: contactsData }] = await Promise.all([
    supabase
      .from("knowledge_entries")
      .select("id, category, trigger_questions, answer, strategy, technique, next_objective")
      .eq("tenant_id", tenant.id)
      .eq("source", "tenant")
      .eq("status", "active")
      .not("answer", "is", null),
    // paginacao-ok: os 40 da busca ou os 300 do começo — decisão de PRODUTO,
    // não tentativa de pegar tudo. Nada aqui é contado nem somado: é a lista
    // de escolha do seletor, e a busca por nome é o caminho para achar quem
    // não está nos primeiros 300. Trazer a base inteira é justamente o que o
    // comentário abaixo explica que não se deve fazer.
    //
    // BUSCA POR NOME, NÃO LISTA INTEIRA. Com 3.000 contatos um `<select>` é
    // impossível de usar — e carregar os 3.000 a cada abertura da tela mais
    // usada do produto deixa tudo lento para todo mundo. Com busca, traz 40;
    // sem busca, traz os 300 primeiros só para quem tem base pequena
    // continuar rolando a lista como antes.
    (() => {
      let base = supabase
        .from("contacts")
        .select("id, name, journey_stage, phone")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null);
      const termo = quem.replace(/[,()%*]/g, "").trim();
      if (termo) base = base.ilike("name", `%${termo}%`);
      return base.order("name").limit(termo ? 40 : 300);
    })(),
  ]);

  const entries = (entriesData as Entry[] | null) ?? [];
  const contacts = (contactsData as ContactLite[] | null) ?? [];
  const matches = q ? matchEntries(q, entries) : [];
  const categories = distinctCategories(entries);

  // O CONTATO VINCULADO PODE NÃO ESTAR NA BUSCA. Se a pessoa filtrou por
  // outro nome, o cliente já selecionado sairia da lista e a tela perderia
  // jornada e histórico no meio do atendimento. Busca-se ele à parte.
  let contact = customer ? contacts.find((c) => c.id === customer) ?? null : null;
  if (customer && !contact) {
    const { data: um } = await supabase
      .from("contacts").select("id, name, journey_stage, phone")
      .eq("id", customer).eq("tenant_id", tenant.id).is("deleted_at", null).maybeSingle();
    contact = (um as ContactLite | null) ?? null;
    if (contact) contacts.unshift(contact);
  }
  let history: Interaction[] = [];
  if (contact) {
    const { data: h } = await supabase
      .from("interactions")
      .select("id, direction, content, occurred_at")
      .eq("tenant_id", tenant.id)
      .eq("contact_id", contact.id)
      .order("occurred_at", { ascending: false })
      .limit(6);
    history = (h as Interaction[] | null) ?? [];
  }

  const stageLabel = (k: string) => stages.find((s) => s.key === k)?.label ?? k;
  const wa = contact ? linkDeWhatsApp(contact.phone) : null;
  // Prospecção: o contato nunca nos escreveu — somos nós que iniciamos.
  const primeiroContato = !!contact && !history.some((h) => h.direction === "inbound");

  return (
    <main style={{ maxWidth: 760 }}>
      <div className="between">
        <div>
          <h1>Responder</h1>
          <p className="text-dim" style={{ marginTop: 4 }}>
            Escolha o cliente, cole a mensagem e receba a melhor resposta da sua
            biblioteca. Você revisa e manda pelo WhatsApp.
          </p>
        </div>
      </div>

      {/* Contexto do cliente selecionado */}
      {contact && (
        <div className="card mt-16">
          <div className="between">
            <div className="row" style={{ gap: 10 }}>
              <strong style={{ fontSize: 16 }}>{contact.name}</strong>
              <span className="badge">{stageLabel(contact.journey_stage)}</span>
            </div>
            <div className="row" style={{ gap: 12 }}>
              {wa ? (
                <a className="btn btn-sm" href={wa} target="_blank" rel="noopener noreferrer" style={{ background: "#25D366", color: "#0b2e13", border: "none" }}>
                  WhatsApp
                </a>
              ) : (
                <>
                  <a
                    className="btn btn-sm btn-ghost"
                    href={`https://www.google.com/search?q=${encodeURIComponent(contact.name + " telefone contato")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Procurar o telefone no Google"
                  >
                    Buscar telefone
                  </a>
                  <Link href={`/painel/contatos/${contact.id}/editar`} className="btn btn-sm btn-ghost">
                    Completar cadastro
                  </Link>
                </>
              )}
              <Link href={`/painel/contatos/${contact.id}`} className="text-dim" style={{ fontSize: 13 }}>
                ver ficha →
              </Link>
            </div>
          </div>
          <div className="mt-16" style={{ paddingBottom: 4 }}>
            <JourneyBar stages={stages} current={contact.journey_stage} />
            <MoverEtapa
              contactId={contact.id}
              atual={contact.journey_stage}
              stages={stages.map((s) => ({ key: s.key, label: s.label }))}
            />
          </div>
          {history.length > 0 && (
            <div className="mt-16">
              <p className="eyebrow" style={{ marginBottom: 8 }}>Últimas interações</p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {history.map((h) => (
                  <li key={h.id} style={{ display: "flex", gap: 10, padding: "6px 0", fontSize: 13, borderBottom: "1px solid var(--border)" }}>
                    <span className={h.direction === "inbound" ? "badge" : "badge badge-brand"} style={{ alignSelf: "flex-start" }}>
                      {h.direction === "inbound" ? "cliente" : "nós"}
                    </span>
                    <span
                      className="grow"
                      style={{
                        color: "var(--text-dim)",
                        whiteSpace: "pre-line",
                        overflowWrap: "anywhere",
                        minWidth: 0,
                      }}
                    >
                      {h.content}
                    </span>
                    <span className="text-faint" style={{ whiteSpace: "nowrap" }}>
                      {dataLocal(h.occurred_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {history.length === 0 && (
            <p className="text-faint mt-8" style={{ fontSize: 13 }}>
              Primeiro atendimento deste cliente — sem histórico ainda.
            </p>
          )}
        </div>
      )}

      {/* Modo proativo: nós iniciamos o contato (prospecção) */}
      {contact && primeiroContato && hasAIKey() && (
        <Abordar contactId={contact.id} contactName={contact.name} />
      )}

      {/* Console — responder mensagem recebida */}
      <form method="get" className="mt-16">
        {contact && primeiroContato && (
          <p className="text-faint" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
            Se ele já tiver te respondido, cole a mensagem abaixo.
          </p>
        )}
        <label className="label">Cliente (opcional — traz jornada e histórico)</label>
        <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <input
            name="quem"
            defaultValue={quem}
            placeholder="Digite o nome e aperte Enter"
            className="grow"
            style={{ minWidth: 180 }}
          />
          <select name="customer" defaultValue={customer} style={{ width: "auto", minWidth: 220 }}>
            <option value="">— sem vincular —</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {stageLabel(c.journey_stage)}
              </option>
            ))}
          </select>
        </div>
        <p className="text-faint" style={{ fontSize: 12, margin: "6px 0 0" }}>
          {quem
            ? `Mostrando ${contacts.length} de quem tem "${quem}" no nome.`
            : contacts.length >= 300
              ? "Mostrando os 300 primeiros. Digite o nome acima para achar quem você quer."
              : `${contacts.length} contato(s).`}
        </p>

        <label className="label" style={{ marginTop: 14 }}>Mensagem do cliente</label>
        <textarea
          id="msg"
          name="q"
          defaultValue={q}
          rows={4}
          placeholder="Cole aqui a mensagem que o cliente enviou… (ex.: achei caro, tem aula experimental?)"
          style={{ resize: "vertical" }}
        />
        <button type="submit" className="btn btn-primary" style={{ marginTop: 10 }}>
          Buscar resposta
        </button>
      </form>

      {salvo && (
        <p className="badge badge-success mt-16">Atendimento registrado no histórico do cliente.</p>
      )}

      {/* Motor de IA (gera resposta personalizada; usa DNA + biblioteca + histórico) */}
      {hasAIKey() && (
        <GerarIA
          contactId={contact?.id}
          message={q}
          stages={stages.map((s) => ({ key: s.key, label: s.label }))}
        />
      )}

      {/* Biblioteca (busca manual, sem custo) */}
      {q && matches.length === 0 && (
        <div className="card mt-24">
          <p style={{ marginBottom: 12 }}>
            Não achei uma resposta pronta pra <strong>“{q}”</strong>. Navegue por categoria:
          </p>
          <div className="row wrap" style={{ gap: 8 }}>
            {categories.map((cat) => (
              <Link key={cat} href={`/painel/responder?q=${encodeURIComponent(cat)}${customer ? `&customer=${customer}` : ""}`} className="badge" style={{ padding: "6px 11px" }}>
                {cat}
              </Link>
            ))}
          </div>
        </div>
      )}

      {matches.map((m, i) => (
        <div key={m.id} className="card mt-16">
          <div className="eyebrow">
            {i === 0 ? "Melhor resposta" : "Alternativa"} · {m.category}
            {m.technique ? ` · ${m.technique}` : ""}
          </div>
          <p style={{ whiteSpace: "pre-line", marginTop: 12, lineHeight: 1.55 }}>{m.answer}</p>
          <div className="row" style={{ gap: 12, marginTop: 8 }}>
            <CopyButton text={m.answer ?? ""} />
            {contact && (
              <form action={logInteraction}>
                <input type="hidden" name="contact_id" value={contact.id} />
                <input type="hidden" name="inbound" value={q} />
                <input type="hidden" name="outbound" value={m.answer ?? ""} />
                <button type="submit" className="btn btn-sm btn-ghost">
                  Registrar no cliente
                </button>
              </form>
            )}
          </div>
          {m.next_objective && (
            <p className="text-dim" style={{ marginTop: 12, fontSize: 13 }}>
              Objetivo: {m.next_objective}
            </p>
          )}
        </div>
      ))}
    </main>
  );
}
