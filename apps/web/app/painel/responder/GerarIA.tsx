"use client";

import { useState } from "react";
import { AvisoDeCota } from "@/app/painel/AvisoDeCota";
import { gerarResposta, applyStage, saveInteraction, setOutcome, type AiAnswer } from "./ai-actions";
import { marcarCompromisso } from "../agenda/horarios-actions";
import { CopyButton } from "./CopyButton";
import { FUSO_PADRAO } from "@/lib/fuso";

// Chave CANÔNICA no banco (0044), rótulo legível na tela. A separação entre
// "disse não" e "parou de responder" é o que permite ao M2 responder se a
// perda foi de objeção ou de follow-up — e são remédios opostos.
const OUTCOMES: {
  key: "respondeu" | "avancou" | "ganhou" | "perdeu_decisao" | "perdeu_silencio";
  label: string;
}[] = [
  { key: "respondeu", label: "Respondeu" },
  { key: "avancou", label: "Avançou de etapa" },
  { key: "ganhou", label: "Fechou" },
  { key: "perdeu_decisao", label: "Disse não" },
  { key: "perdeu_silencio", label: "Parou de responder" },
];

type StageLite = { key: string; label: string };

export default function GerarIA({
  contactId,
  message,
  stages,
}: {
  contactId?: string;
  message: string;
  stages: StageLite[];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limite, setLimite] = useState<string | null>(null);
  const [data, setData] = useState<AiAnswer | null>(null);
  const [applied, setApplied] = useState(false);
  const [usedMessage, setUsedMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [outcome, setOutcomeSel] = useState<string | null>(null);
  const [marcado, setMarcado] = useState(false);

  const run = async () => {
    // Lê a caixa de texto ao vivo (não depende de clicar em "Buscar" antes).
    const el = typeof document !== "undefined"
      ? (document.getElementById("msg") as HTMLTextAreaElement | null)
      : null;
    const msg = (el?.value ?? message ?? "").trim();
    if (!msg) {
      setError("Cole a mensagem do cliente na caixa acima.");
      return;
    }
    setLoading(true);
    setError(null);
    setLimite(null);
    setData(null);
    setApplied(false);
    setSaved(false);
    setSavedId(null);
    setOutcomeSel(null);
    setMarcado(false);
    setUsedMessage(msg);
    try {
      const res = await gerarResposta({ contactId, message: msg });
      if (res.ok) setData(res.data);
      else if ("limite" in res) setLimite(res.mensagem);
      else setError(res.error);
    } catch (e) {
      setError("Falha ao chamar o motor: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  const stageLabel = (k: string) => stages.find((s) => s.key === k)?.label ?? k;

  return (
    <div className="mt-16">
      <button
        type="button"
        className="btn btn-primary"
        onClick={run}
        disabled={loading}
      >
        {loading ? "Gerando resposta…" : "✨ Gerar com IA"}
      </button>

      {limite && <AvisoDeCota mensagem={limite} />}
      {error && <p className="badge badge-danger mt-16">{error}</p>}

      {data && (
        <div className="mt-16 stack" style={{ gap: 12 }}>
          {data.escalar ? (
            <div className="card" style={{ borderColor: "rgba(234,181,77,0.35)", background: "rgba(234,181,77,0.06)" }}>
              <div className="badge badge-warn">Escalar para humano</div>
              <p style={{ marginTop: 10, marginBottom: 6 }}>
                O motor não redigiu porque faltam fatos no DNA — e não inventa (trava anti-invenção).
              </p>
              {data.faltam_fatos.length > 0 && (
                <ul className="text-dim" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  {data.faltam_fatos.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
              {data.resposta_sugerida && (
                <p className="text-dim" style={{ marginTop: 10, marginBottom: 0, whiteSpace: "pre-line" }}>
                  Mensagem segura: {data.resposta_sugerida}
                </p>
              )}
            </div>
          ) : (
            <div className="card" style={{ borderColor: "var(--border-brand)", background: "var(--brand-gradient-soft)" }}>
              <div className="eyebrow">Resposta sugerida (IA)</div>
              <p style={{ whiteSpace: "pre-line", marginTop: 10, lineHeight: 1.55 }}>{data.resposta_sugerida}</p>
              <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
                <CopyButton text={data.resposta_sugerida} />
                {contactId ? (
                  saved ? (
                    <span className="badge badge-success">Salvo no histórico ✓</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={async () => {
                        const r = await saveInteraction(contactId, usedMessage, data.resposta_sugerida, data.tecnica);
                        setSaved(r.ok);
                        setSavedId(r.id ?? null);
                      }}
                    >
                      Registrar no cliente
                    </button>
                  )
                ) : (
                  <span className="text-faint" style={{ fontSize: 13 }}>
                    selecione um cliente acima para salvar no histórico
                  </span>
                )}
              </div>
              {savedId && (
                <div className="mt-16">
                  <p className="eyebrow" style={{ marginBottom: 8 }}>
                    Deu no quê? (ensina o sistema o que converte)
                  </p>
                  {outcome ? (
                    <span className="badge badge-success">Resultado registrado: {OUTCOMES.find((o) => o.key === outcome)?.label}</span>
                  ) : (
                    <div className="row wrap" style={{ gap: 8 }}>
                      {OUTCOMES.map((o) => (
                        <button
                          key={o.key}
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={async () => {
                            const r = await setOutcome(savedId, o.key);
                            if (r.ok) setOutcomeSel(o.key);
                          }}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {data.explicacao && (
            <div className="card">
              <div className="eyebrow">Por que esta resposta</div>
              <p className="text-dim" style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>{data.explicacao}</p>
              {data.tecnica && <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}><strong>Técnica:</strong> {data.tecnica}</p>}
            </div>
          )}

          <div className="row wrap" style={{ gap: 8 }}>
            {data.etapa_jornada && <span className="badge">Etapa: {data.etapa_jornada}</span>}
            {data.emocao && <span className="badge">Emoção: {data.emocao}</span>}
            {data.proximo_passo && <span className="badge badge-brand">Próximo: {data.proximo_passo}</span>}
          </div>

          {/* O elo que faltava: a IA fechou o horário — basta confirmar. */}
          {contactId && data.horario_escolhido && !marcado && (
            <div className="card" style={{ borderColor: "var(--border-brand)", background: "var(--brand-gradient-soft)" }}>
              <div className="between wrap" style={{ gap: 10, alignItems: "center" }}>
                <div>
                  <div className="badge badge-brand">Horário acertado na conversa</div>
                  <p style={{ margin: "8px 0 0", fontSize: 14 }}>
                    <strong>{new Date(data.horario_escolhido).toLocaleString("pt-BR", { timeZone: FUSO_PADRAO, weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={async () => {
                    const r = await marcarCompromisso({
                      contactId,
                      quandoISO: data.horario_escolhido,
                      origem: "motor",
                    });
                    if (r.ok) setMarcado(true);
                    else setError(r.error ?? "Não consegui marcar.");
                  }}
                >
                  Confirmar na agenda
                </button>
              </div>
            </div>
          )}
          {marcado && <p className="badge badge-success">Compromisso marcado na agenda ✓</p>}

          {contactId && data.status_sugerido && !applied && (
            <div className="card" style={{ borderColor: "rgba(123,212,90,0.35)", background: "rgba(123,212,90,0.06)" }}>
              <div className="between wrap" style={{ gap: 10 }}>
                <div>
                  <div className="badge badge-success">Avanço de jornada detectado</div>
                  <p style={{ margin: "8px 0 0", fontSize: 14 }}>
                    Avançar para <strong>{stageLabel(data.status_sugerido)}</strong>
                    {data.motivo_status ? ` — ${data.motivo_status}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    const r = await applyStage(contactId, data.status_sugerido, data.motivo_status);
                    if (r.ok) setApplied(true);
                  }}
                >
                  Atualizar jornada
                </button>
              </div>
            </div>
          )}
          {applied && <p className="badge badge-success">Jornada atualizada.</p>}
        </div>
      )}
    </div>
  );
}
