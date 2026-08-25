"use client";

import { useState } from "react";
import Link from "next/link";
import { rodarAgora, type RodadaResult } from "./rodar-actions";

/**
 * O BOTÃO DE ENVIAR — e ele existe porque a falta dele já enganou duas vezes.
 *
 * ⚠ A PRIMEIRA VEZ: o fundador configurou 10 mensagens/dia, escolheu
 * "Simulação" e foi procurar onde apertar. Não havia nada — o modo era gravado
 * e ninguém o lia. Nasceu daí a tela de simulação.
 *
 * ⚠ A SEGUNDA VEZ FOI HOJE: ele tirou as pessoas erradas da lista, escolheu
 * "Automático" e disse — *"não vi um botão de enviar, e não sei se enviou ou
 * não"*. E não tinha enviado: o motor roda por agenda (9h e 17h), então
 * escolher o modo não dispara nada. Entre a escolha e o primeiro envio havia
 * até oito horas de silêncio, e silêncio é indistinguível de defeito.
 *
 * ⚠ ELE OBEDECE O MODO SALVO, e essa é a parte que ensina. Se a empresa está
 * em Simulação, o botão roda e diz que nada saiu POR ISSO. Um botão que
 * enviasse mesmo em simulação transformaria a trava num enfeite; um botão que
 * se recusasse a rodar não explicaria nada.
 */
export function RodarAgora({ modo }: { modo: "off" | "simulation" | "auto" }) {
  const [r, setR] = useState<RodadaResult | null>(null);
  const [rodando, setRodando] = useState(false);

  const vaiEnviar = modo === "auto";

  const executar = async () => {
    if (vaiEnviar) {
      const ok = window.confirm(
        "Isto envia mensagens DE VERDADE agora, pelo número da empresa, para as pessoas " +
          "da fila — até o teto do dia.\n\nConfere se você já leu os nomes na simulação. Enviar?",
      );
      if (!ok) return;
    }
    setRodando(true);
    setR(null);
    try {
      setR(await rodarAgora());
    } catch (e) {
      setR({ ok: false, erro: e instanceof Error ? e.message : String(e) });
    } finally {
      setRodando(false);
    }
  };

  return (
    <div className="card mt-16" style={{ borderColor: "var(--border-brand)" }}>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Rodar o motor agora</p>

      <p className="text-dim" style={{ marginTop: 0, fontSize: 14 }}>
        O motor roda sozinho <strong>de segunda a sexta, às 9h e às 17h</strong>. Este botão
        antecipa a próxima rodada — útil no dia em que você acabou de ajustar a lista e não
        quer esperar.
      </p>

      {/* ⚠ O MODO SALVO APARECE AQUI, coladinho no botão. Escolher no
          formulário acima e não salvar é o erro mais fácil de cometer nesta
          tela — e o que se vê depois é "não enviou", que se lê como defeito. */}
      {modo !== "auto" && (
        <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left" }}>
          A empresa está salva como{" "}
          <strong>{modo === "off" ? "Desligado" : "Simulação"}</strong>, então{" "}
          <strong>nada vai sair</strong> — nem por este botão, nem às 17h. Para enviar de
          verdade: escolha <strong>Automático</strong> lá em cima e clique em{" "}
          <strong>Salvar regras</strong>. Trocar a opção sem salvar não muda nada.
        </p>
      )}

      <button
        type="button"
        className={vaiEnviar ? "btn btn-primary" : "btn"}
        onClick={executar}
        disabled={rodando}
      >
        {rodando ? "rodando…" : vaiEnviar ? "▶ Enviar agora" : "▶ Rodar (não vai enviar)"}
      </button>

      {r && !r.ok && (
        <p className="badge badge-danger" style={{ marginTop: 12, whiteSpace: "normal", textAlign: "left" }}>
          {r.erro}
        </p>
      )}

      {r && r.ok && (
        <div style={{ marginTop: 14 }}>
          <div className="row wrap" style={{ gap: 10, alignItems: "baseline" }}>
            <span className={r.enviadas > 0 ? "badge badge-success" : "badge"}>
              {r.enviadas} enviada(s)
            </span>
            {r.falhas.length > 0 && (
              <span className="badge badge-danger">{r.falhas.length} falharam</span>
            )}
            <span className="text-faint" style={{ fontSize: 13 }}>
              {r.avaliados} avaliados · {r.escolhidos} escolhidos pelas regras
            </span>
          </div>

          {/* Mesma regra da simulação: quando nada saiu, o motivo é o assunto
              — e ele quase nunca é "não tem ninguém". Em 25/ago, às 8h22, era
              a janela de horário, escrita em cinza embaixo de um placar. */}
          {r.enviadas === 0 && r.escolhidos === 0 ? (
            <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left", marginTop: 8 }}>
              <strong>Nada saiu:</strong> {r.porque}
            </p>
          ) : (
            <p className="text-dim" style={{ fontSize: 13, marginTop: 8 }}>{r.porque}</p>
          )}

          {r.simulado && (
            <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left" }}>
              Rodou em <strong>simulação</strong>: os cálculos foram feitos e{" "}
              <strong>nenhuma mensagem saiu</strong>. É o modo salvo da empresa que manda,
              não este botão.
            </p>
          )}

          {/* ⚠ AS FALHAS VÊM COM O MOTIVO INTEIRO DA META. Numa campanha paga,
              falha é dinheiro gasto sem conversa — e resumir aqui esconderia a
              única informação que permite consertar. */}
          {r.falhas.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {r.falhas.map((f) => (
                <li key={f.nome} className="text-dim" style={{ fontSize: 12, padding: "4px 0" }}>
                  <strong>{f.nome}</strong>: {f.motivo}
                </li>
              ))}
            </ul>
          )}

          {r.enviadas > 0 && (
            <p className="text-dim" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
              Acompanhe a entrega em <Link href="/painel/conversas">Canal oficial</Link> — o
              status (enviada, entregue, lida) chega sozinho, e quando alguém responder o
              aviso aparece em qualquer tela.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
