"use client";

import { useState } from "react";
import { ROTULO, type MotivoDaFila } from "@/lib/fila";
import type { RoteamentoPorMotivo } from "@/lib/roteamento";
import { efeitoDoRoteamento } from "./simular-actions";

/**
 * O QUE MUDA SE EU MARCAR — o número antes da decisão.
 *
 * ⚠ POR QUE ELE PRECISOU EXISTIR. As caixas de "por onde cada motivo sai" pedem
 * uma decisão com duas consequências reais: a pessoa passa a receber de OUTRO
 * número, e a Meta passa a COBRAR. A tela explicava as duas em palavras e não
 * dizia nenhum número — marcar era apostar.
 *
 * ⚠ E A SEGUNDA COLUNA É A QUE MAIS IMPORTA: "alcança 72 · manda para 9".
 * Alcance é quanta gente o motivo tem hoje; **manda** é quanta gente tem TEXTO
 * PRÓPRIO para o toque dela. A diferença entre os dois é exatamente o que quase
 * me fez ligar a renovação travada — a trava certa aplicada ao número errado.
 *
 * ⚠ E É SOB DEMANDA. Montar a fila lê contatos e interações inteiros; pendurar
 * isso em toda abertura da Automação somaria mais uma tela lenta a um produto
 * onde a lentidão já foi medida e reclamada.
 */
export function EfeitoDoRoteamento({ roteamento }: { roteamento: RoteamentoPorMotivo }) {
  const [linhas, setLinhas] = useState<
    { motivo: MotivoDaFila; pessoas: number; comModelo: number; custoCents: number }[] | null
  >(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const calcular = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await efeitoDoRoteamento();
      if (r.ok) setLinhas(r.linhas);
      else setErro(r.erro);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  };

  const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

  return (
    <div style={{ margin: "12px 0 4px" }}>
      {linhas === null ? (
        <button type="button" className="btn btn-sm" onClick={calcular} disabled={carregando}>
          {carregando ? "calculando…" : "Calcular o que muda em cada motivo"}
        </button>
      ) : (
        <div className="card" style={{ background: "var(--bg-elev)", padding: "10px 14px" }}>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>A fila de hoje, por motivo</p>
          <ul className="stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
            {linhas.map((l) => (
              <li key={l.motivo} style={{ fontSize: 13 }}>
                <strong>{ROTULO[l.motivo]}</strong>
                {roteamento[l.motivo] && <span className="badge badge-success" style={{ marginLeft: 6 }}>já sai pelo sistema</span>}
                <br />
                <span className="text-dim">
                  {l.pessoas === 0 ? (
                    "ninguém na fila agora"
                  ) : (
                    <>
                      alcança <strong>{l.pessoas}</strong>
                      {" · "}
                      {/* ⚠ ESTA É A LINHA QUE EVITA LIGAR ALGO TRAVADO. Sem
                          texto próprio para o toque, o motor RECUSA — e a tela
                          precisa dizer isso ANTES, não depois. */}
                      {l.comModelo === l.pessoas ? (
                        <>manda para <strong>{l.comModelo}</strong></>
                      ) : (
                        <span style={{ color: "var(--danger)" }}>
                          manda para <strong>{l.comModelo}</strong> — {l.pessoas - l.comModelo} sem modelo do toque
                        </span>
                      )}
                      {l.comModelo > 0 && <> · ~{reais(l.custoCents)}</>}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            É a fila de <strong>hoje</strong>, não uma projeção — e o valor é a tarifa de
            marketing da Meta para quem sai fora da janela de 24h. Pelo WhatsApp do vendedor
            continua custando zero.
          </p>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ marginTop: 8 }}
            onClick={calcular}
            disabled={carregando}
          >
            {carregando ? "atualizando…" : "atualizar"}
          </button>
        </div>
      )}
      {erro && <p className="badge badge-danger" style={{ whiteSpace: "normal", textAlign: "left" }}>{erro}</p>}
    </div>
  );
}
