import Link from "next/link";
import { Extrair } from "./Extrair";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { dataLocal } from "@/lib/fuso";

type DnaSection = {
  key: string;
  label: string;
  required?: boolean;
};

export default async function DnaPage() {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;

  if (!tenant) {
    return (
      <main>
        <h1 style={{ fontSize: 24, marginTop: 0 }}>DNA</h1>
        <p style={{ opacity: 0.85 }}>Sem empresa vinculada.</p>
      </main>
    );
  }

  const supabase = await createClient();

  // Manifesto da Skill instalada (RLS: só quem instalou lê).
  const { data: skill } = await supabase
    .from("skills")
    .select("manifest")
    .eq("key", tenant.skill_key)
    .limit(1)
    .maybeSingle();

  // DNA corrente da empresa (RLS: só a própria empresa).
  const { data: dna } = await supabase
    .from("commercial_dna")
    .select("sections, section_updated_at")
    .eq("tenant_id", tenant.id)
    .eq("is_current", true)
    .maybeSingle();

  const sections =
    (skill?.manifest as { dna_sections?: DnaSection[] } | null)?.dna_sections ??
    [];
  const filled = (dna?.sections as Record<string, unknown> | null) ?? {};
  const carimbos = (dna?.section_updated_at as Record<string, string> | null) ?? {};

  // A trava anti-invenção garante que o motor só afirma o que está no DNA —
  // mas não sabe se o que está lá ainda é verdade. Preço de seis meses atrás
  // é afirmado com a mesma confiança do de ontem. Daí o alerta.
  const MESES_PARA_REVISAR = 6;
  const diasDesde = (iso: string | undefined) => {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  };
  const idade = (key: string) => diasDesde(carimbos[key]);
  const velha = (key: string) => {
    const d = idade(key);
    return d != null && d > MESES_PARA_REVISAR * 30;
  };
  const isFilled = (key: string) => {
    const v = filled[key];
    if (v == null) return false;
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return String(v).length > 0;
  };

  const paraRevisar = sections.filter((s) => isFilled(s.key) && velha(s.key));
  const prontas = sections.filter((s) => isFilled(s.key)).length;
  const pct = sections.length ? Math.round((prontas / sections.length) * 100) : 0;

  return (
    <main style={{ maxWidth: 640 }}>
      <div className="between">
        <h1>DNA da empresa</h1>
        <Link href="/painel/dna/editar" className="btn btn-sm btn-primary">
          Editar DNA
        </Link>
      </div>
      <p className="text-dim" style={{ marginTop: 4 }}>
        Os fatos que o sistema pode afirmar. O que não estiver aqui, ele não inventa —
        escala para um humano.
      </p>

      <div className="card mt-16">
        <div className="between" style={{ marginBottom: 10 }}>
          <strong>{prontas}/{sections.length} seções preenchidas</strong>
          <span className="brand-text" style={{ fontWeight: 700 }}>{pct}%</span>
        </div>

      {/* ⚠ O ATALHO DE QUEM ESTÁ COMEÇANDO. Trinta campos vazios é a tela que
          faz alguém fechar o produto no primeiro dia — e é o que mantém Darvil
          e Feltros paradas. Colar um texto e conferir dez campos é outra
          tarefa. */}
      {["owner", "admin", "manager"].includes(membership!.role) && <Extrair />}
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${pct}%`, transition: "width .4s ease" }} />
        </div>
      </div>

      {paraRevisar.length > 0 && (
        <div className="card mt-16" style={{ borderColor: "rgba(234,181,77,0.35)", background: "rgba(234,181,77,0.06)" }}>
          <div className="badge badge-warn">Revisar</div>
          <p style={{ marginTop: 10, marginBottom: 6 }}>
            {paraRevisar.length === 1 ? "Uma seção está" : `${paraRevisar.length} seções estão`} sem
            atualização há mais de {MESES_PARA_REVISAR} meses.
          </p>
          <p className="text-dim" style={{ margin: 0, fontSize: 14 }}>
            O sistema não inventa — mas afirma o que está aqui com toda a confiança, mesmo que
            esteja velho. Preço e horário desatualizados viram promessa errada ao cliente.
          </p>
        </div>
      )}

      <div className="card mt-16">
        {sections.map((s, i) => {
          const ok = isFilled(s.key);
          const dias = idade(s.key);
          return (
            <div
              key={s.key}
              className="row"
              style={{ gap: 10, padding: "11px 0", borderBottom: i < sections.length - 1 ? "1px solid var(--border)" : "none" }}
            >
              <span className={ok ? "badge badge-success" : "badge badge-danger"}>
                {ok ? "preenchido" : "falta"}
              </span>
              <span className="grow">{s.label}</span>
              {ok && dias != null && (
                <span
                  className={velha(s.key) ? "badge badge-warn" : "text-faint"}
                  style={{ fontSize: 11, whiteSpace: "nowrap" }}
                  title={`Atualizado em ${dataLocal(carimbos[s.key])}`}
                >
                  {dias === 0 ? "hoje" : dias === 1 ? "ontem" : `há ${dias} dias`}
                </span>
              )}
              {s.required && <span className="text-faint" style={{ fontSize: 11 }}>obrigatória</span>}
            </div>
          );
        })}
      </div>
    </main>
  );
}
