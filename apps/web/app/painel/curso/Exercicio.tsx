"use client";

import { useState } from "react";
import { salvarExercicio } from "./actions";
import { dataLocal } from "@/lib/fuso";

type Recomendacao = { estrategia: string; tecnica: string; erros: string[]; proximoPasso: string };

/**
 * O exercício de fim de módulo.
 *
 * ESCREVER ANTES DE VER É O MÉTODO, não um detalhe de fluxo. Quem lê a
 * recomendação primeiro conclui que teria escrito aquilo — e não teria. É a
 * mesma prática de recuperação do quiz, agora em resposta aberta: o esforço de
 * produzir a resposta é o que ensina; comparar depois é o que corrige.
 *
 * Por isso a recomendação não existe no estado inicial do componente e só
 * chega depois de salvar. Não há atalho na tela — e não há gabarito escondido
 * no HTML para quem abrir o inspetor.
 */
export default function Exercicio({
  moduleKey,
  situacao,
  escola,
  recomendacao,
  fatos,
  autoavaliacao,
  jaFeito,
}: {
  moduleKey: string;
  situacao: string;
  escola: string | null;
  recomendacao: Recomendacao;
  fatos: { caminho: string; tem: boolean }[];
  autoavaliacao: string[];
  jaFeito: { resposta: string; updated_at: string } | null;
}) {
  const [resposta, setResposta] = useState("");
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [revelado, setRevelado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await salvarExercicio(moduleKey, situacao, resposta, marcados);
      if (r.ok) setRevelado(true);
      else setErro(r.error);
    } catch (e) {
      setErro("Falha ao salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setOcupado(false);
    }
  };

  const faltando = fatos.filter((f) => !f.tem);

  return (
    <>
      <div className="card mt-16">
        <p className="eyebrow" style={{ margin: 0 }}>A mensagem que chegou</p>
        <blockquote
          style={{
            margin: "12px 0 0",
            padding: "14px 18px",
            borderLeft: "3px solid var(--border-brand)",
            background: "var(--surface-2)",
            borderRadius: "0 8px 8px 0",
            fontSize: 16,
            lineHeight: 1.6,
          }}
        >
          {situacao}
        </blockquote>
      </div>

      <div className="card mt-16">
        <p className="eyebrow" style={{ margin: 0 }}>Sua resposta</p>
        <p className="text-dim" style={{ margin: "6px 0 12px", fontSize: 14 }}>
          Escreva como você responderia de verdade, para mandar agora. Depois de salvar, você vê o
          que a biblioteca recomenda para esta situação no seu ramo — e compara.
        </p>
        <textarea
          value={resposta}
          onChange={(e) => setResposta(e.target.value)}
          disabled={revelado}
          rows={6}
          placeholder="Escreva aqui a mensagem que você mandaria…"
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: 15,
            lineHeight: 1.6,
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />

        {!revelado && (
          <>
            {autoavaliacao.length > 0 && resposta.trim().length >= 20 && (
              <div className="mt-16">
                <p className="text-faint" style={{ fontSize: 12, margin: "0 0 8px" }}>
                  Antes de ver a recomendação — releia o que escreveu e marque o que é verdade:
                </p>
                <div className="stack" style={{ gap: 6 }}>
                  {autoavaliacao.map((p, i) => (
                    <label key={i} className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5 }}>
                      <input
                        type="checkbox"
                        checked={!!marcados[p]}
                        onChange={(e) => setMarcados((m) => ({ ...m, [p]: e.target.checked }))}
                        style={{ marginTop: 3 }}
                      />
                      <span>{p}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {erro && <p className="badge badge-danger mt-16">{erro}</p>}

            <div className="row mt-16" style={{ gap: 10, alignItems: "center" }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={ocupado || resposta.trim().length < 20}
                onClick={enviar}
              >
                {ocupado ? "Salvando…" : "Salvar e ver a recomendação"}
              </button>
              {resposta.trim().length < 20 && (
                <span className="text-faint" style={{ fontSize: 12 }}>escreva a sua resposta primeiro</span>
              )}
            </div>
          </>
        )}
      </div>

      {revelado && (
        <div className="card mt-16" style={{ borderColor: "var(--border-brand)" }}>
          <div className="between" style={{ alignItems: "baseline" }}>
            <p className="eyebrow" style={{ margin: 0 }}>O que a biblioteca recomenda aqui</p>
            {escola && <span className="badge">{escola.replace(/_/g, " ")}</span>}
          </div>

          {recomendacao.tecnica && (
            <p style={{ margin: "12px 0 4px", fontSize: 15, fontWeight: 600 }}>{recomendacao.tecnica}</p>
          )}
          {recomendacao.estrategia && (
            <p className="text-dim" style={{ margin: 0, fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
              {recomendacao.estrategia}
            </p>
          )}

          {recomendacao.erros.length > 0 && (
            <>
              <p className="eyebrow mt-16" style={{ margin: "20px 0 6px" }}>O que costuma dar errado</p>
              <ul className="text-dim" style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
                {recomendacao.erros.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </>
          )}

          {recomendacao.proximoPasso && (
            <p className="text-dim mt-16" style={{ fontSize: 14 }}>
              <strong>Próximo passo:</strong> {recomendacao.proximoPasso}
            </p>
          )}

          {/* O DNA entra como fato, e a AUSÊNCIA dele também é informação: o
              aluno descobre um buraco do próprio cadastro fazendo uma aula —
              que é a melhor hora possível para descobrir. */}
          {fatos.length > 0 && (
            <div className="mt-16" style={{ padding: "12px 14px", borderRadius: 10, background: "var(--surface-2)" }}>
              <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600 }}>
                Os fatos que esta resposta exige da SUA empresa
              </p>
              <ul className="text-dim" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                {fatos.map((f) => (
                  <li key={f.caminho}>
                    <code>{f.caminho}</code> — {f.tem ? "está no seu DNA" : "FALTA no seu DNA"}
                  </li>
                ))}
              </ul>
              {faltando.length > 0 && (
                <p className="text-dim" style={{ margin: "8px 0 0", fontSize: 13 }}>
                  Enquanto {faltando.length === 1 ? "esse fato faltar" : "esses fatos faltarem"}, o sistema
                  se recusa a afirmar isso numa resposta real — e você também deveria.{" "}
                  <a href="/painel/dna">Cadastrar agora →</a>
                </p>
              )}
            </div>
          )}

          <div className="row wrap mt-16" style={{ gap: 10 }}>
            <a href="/painel/curso" className="btn btn-sm btn-primary">Voltar ao curso</a>
            <a href="/painel/responder" className="btn btn-sm btn-ghost">Praticar no Responder →</a>
          </div>
        </div>
      )}

      {!revelado && jaFeito && (
        <p className="text-faint mt-16" style={{ fontSize: 12 }}>
          Você já fez este exercício em {dataLocal(jaFeito.updated_at)}. Refazer
          guarda uma resposta nova — e comparar as duas é onde dá para ver o que mudou.
        </p>
      )}
    </>
  );
}
