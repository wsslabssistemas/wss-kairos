"use client";

import { useState } from "react";
import { AvisoDeCota } from "@/app/painel/AvisoDeCota";
import { gerarAbordagem, saveInteraction, type AiAnswer } from "./ai-actions";
import { CopyButton } from "./CopyButton";

export default function Abordar({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limite, setLimite] = useState<string | null>(null);
  const [data, setData] = useState<AiAnswer | null>(null);
  const [saved, setSaved] = useState(false);
  /**
   * ⚠ O TEXTO QUE VAI DE FATO SAIR. Mesmo defeito do `GerarIA` e, aqui, com
   * consequência maior: esta é a ABERTURA, a mensagem que mais é adaptada
   * porque depende do que a pessoa sabe daquele cliente. Sem campo, a
   * adaptação sumia e o histórico guardava a versão que nunca foi enviada.
   */
  const [textoFinal, setTextoFinal] = useState("");

  const run = async () => {
    setLoading(true);
    setError(null);
    setLimite(null);
    setData(null);
    setSaved(false);
    try {
      const res = await gerarAbordagem(contactId);
      if (res.ok) setData(res.data);
      else if ("limite" in res) setLimite(res.mensagem);
      else setError(res.error);
    } catch (e) {
      setError("Falha ao chamar o motor: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card mt-16" style={{ borderColor: "var(--border-brand)", background: "var(--brand-gradient-soft)" }}>
      <div className="between wrap" style={{ gap: 10, alignItems: "center" }}>
        <div>
          <strong>Primeiro contato com {contactName}</strong>
          <p className="text-dim" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Ele ainda não falou com você. Aqui a IA escreve a abordagem de abertura —
            você não precisa colar mensagem nenhuma.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={run} disabled={loading}>
          {loading ? "Escrevendo…" : "✨ Gerar primeira abordagem"}
        </button>
      </div>

      {limite && <AvisoDeCota mensagem={limite} />}
      {error && <p className="badge badge-danger mt-16">{error}</p>}

      {data && (
        <div className="mt-16 stack" style={{ gap: 12 }}>
          {data.escalar ? (
            <div className="card" style={{ borderColor: "rgba(234,181,77,0.35)", background: "rgba(234,181,77,0.06)" }}>
              <div className="badge badge-warn">Faltam fatos no seu DNA</div>
              <p style={{ marginTop: 10, marginBottom: 6, fontSize: 14 }}>
                Para abordar alguém que não te conhece, o sistema precisa saber o que você vende e qual seu diferencial.
              </p>
              {data.faltam_fatos.length > 0 && (
                <ul className="text-dim" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  {data.faltam_fatos.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              )}
            </div>
          ) : (
            <div className="card" style={{ background: "var(--bg-elev)" }}>
              <div className="eyebrow">Mensagem de abertura — pode editar antes de mandar</div>
              <textarea
                value={textoFinal || data.resposta_sugerida}
                onChange={(e) => setTextoFinal(e.target.value)}
                rows={Math.min(14, Math.max(4, Math.ceil((textoFinal || data.resposta_sugerida).length / 60) + 1))}
                style={{ width: "100%", marginTop: 10, lineHeight: 1.55, resize: "vertical" }}
              />
              {textoFinal.trim() && textoFinal.trim() !== data.resposta_sugerida.trim() && (
                <p className="text-dim" style={{ fontSize: 12, margin: "6px 0 0" }}>
                  ✏️ Você adaptou a abertura — ao registrar, isso vira lição para o sistema.
                </p>
              )}
              <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
                <CopyButton text={textoFinal || data.resposta_sugerida} />
                {saved ? (
                  <span className="badge badge-success">Registrado ✓</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={async () => {
                      // Grava o que saiu, com o par sugerido x enviado.
                      const r = await saveInteraction(
                        contactId,
                        "",
                        textoFinal || data.resposta_sugerida,
                        data.tecnica,
                        data.resposta_sugerida,
                      );
                      setSaved(r.ok);
                    }}
                  >
                    Registrar envio
                  </button>
                )}
              </div>
            </div>
          )}

          {data.explicacao && (
            <div className="card" style={{ background: "var(--bg-elev)" }}>
              <div className="eyebrow">Por que abordar assim</div>
              <p className="text-dim" style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>{data.explicacao}</p>
              {data.tecnica && <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}><strong>Técnica:</strong> {data.tecnica}</p>}
            </div>
          )}

          {data.proximo_passo && (
            <p className="badge badge-brand" style={{ whiteSpace: "normal", lineHeight: 1.5, padding: "8px 12px" }}>
              Próximo passo: {data.proximo_passo}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
