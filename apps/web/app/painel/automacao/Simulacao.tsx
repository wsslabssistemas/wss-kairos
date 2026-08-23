"use client";

import { useState } from "react";
import { simularMotor, naoContatar, type SimulacaoResult } from "./simular-actions";

/**
 * O BOTÃO QUE FALTAVA.
 *
 * ⚠ O fundador configurou 10 mensagens/dia, escolheu "Simulação" e foi
 * procurar onde apertar. Não havia nada: o modo era gravado e nada o lia. Este
 * componente é a dívida sendo paga.
 *
 * ⚠ E ELE MOSTRA OS BARRADOS COM O MOTIVO DE CADA UM. "Sairiam 7" sozinho não
 * deixa conferir nada — quem lê não sabe se os outros 30 foram poupados pela
 * regra certa ou sumiram por um defeito. Lista sem os excluídos é a mesma
 * armadilha da fila que só encolhe: parece trabalho em dia, é erro invisível.
 */
export function Simulacao({ modo }: { modo: "off" | "simulation" | "auto" }) {
  const [r, setR] = useState<SimulacaoResult | null>(null);
  const [rodando, setRodando] = useState(false);
  const [tirados, setTirados] = useState<Record<string, string>>({});
  const [erroAoTirar, setErroAoTirar] = useState<string | null>(null);

  // Quantos o RECORTE de data barrou. Eles não entram na lista nominal — são
  // centenas com o mesmo motivo — e aparecem numa linha só, logo acima dela.
  const foraDoRecorte = r && r.ok ? r.linhas.filter((l) => l.recorte).length : 0;

  /**
   * ⚠ O MOTIVO É PEDIDO NA HORA, e não é burocracia.
   *
   * Marcação sem justificativa é a que ninguém tem coragem de desfazer seis
   * meses depois, quando já não lembra por que aquela pessoa está de fora. Um
   * `prompt` é feio, e é honesto: obriga a escrever antes de excluir, no
   * momento em que a razão está fresca.
   */
  const tirar = async (contactId: string, nome: string) => {
    const motivo = window.prompt(
      `Por que ${nome} não deve receber mensagem?\n\nEx.: convênio, aluga sala, pediu para não receber, nunca foi aluno.`,
      "",
    );
    if (motivo === null) return;
    setErroAoTirar(null);
    const res = await naoContatar(contactId, motivo);
    if (res.ok) setTirados((t) => ({ ...t, [contactId]: motivo.trim() }));
    else setErroAoTirar(res.erro);
  };

  const rodar = async () => {
    setRodando(true);
    setR(null);
    try {
      setR(await simularMotor());
    } catch (e) {
      setR({ ok: false, erro: e instanceof Error ? e.message : String(e) });
    } finally {
      setRodando(false);
    }
  };

  return (
    <div className="card mt-16" style={{ borderColor: "var(--border-brand)" }}>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Ver quem sairia agora</p>

      <p className="text-dim" style={{ marginTop: 0, fontSize: 14 }}>
        Roda o motor <strong>sem enviar nada</strong> e mostra a lista de quem sairia
        pelo número da empresa neste momento — e, para cada pessoa que ficou de fora,
        o motivo. Nada é enviado nem registrado: dá para apertar quantas vezes quiser.
      </p>

      {modo === "off" && (
        <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left" }}>
          O modo está <strong>Desligado</strong> — a simulação vai devolver "a automação
          está desligada" e mais nada. Escolha <strong>Simulação</strong> acima e salve
          as regras antes de rodar.
        </p>
      )}

      <button type="button" className="btn btn-primary" onClick={rodar} disabled={rodando}>
        {rodando ? "calculando…" : "▶ Rodar simulação"}
      </button>

      {r && !r.ok && (
        <p className="badge badge-danger" style={{ marginTop: 12, whiteSpace: "normal", textAlign: "left" }}>
          {r.erro}
        </p>
      )}

      {r && r.ok && (
        <div style={{ marginTop: 16 }}>
          <div className="row wrap" style={{ gap: 10, alignItems: "baseline" }}>
            <span className={r.sairiam > 0 ? "badge badge-success" : "badge"}>
              {r.sairiam} sairiam agora
            </span>
            <span className="text-faint" style={{ fontSize: 13 }}>
              de {r.avaliados} avaliados
            </span>
          </div>

          {/* O `porque` do plano explica o caso em que NADA sai — fora da janela
              de horário, teto do dia esgotado, modo desligado. Sem ele, uma
              lista vazia é indistinguível de um defeito. */}
          <p className="text-dim" style={{ fontSize: 13, marginTop: 8 }}>{r.porque}</p>

          {erroAoTirar && (
            <p className="badge badge-danger" style={{ marginTop: 8, whiteSpace: "normal", textAlign: "left" }}>
              {erroAoTirar}
            </p>
          )}

          {/* ⚠ O RECORTE DA CAMPANHA, EM UMA LINHA SÓ.
              São centenas de pessoas barradas pelo MESMO motivo — uma linha por
              pessoa enterraria os poucos vereditos que alguém precisa de fato
              ler (o cooldown, o "sem telefone", o "já falamos ontem"). Aqui ele
              aparece com a contagem e o número de dias: some é que não pode. */}
          {foraDoRecorte > 0 && (
            <p
              className="text-dim"
              style={{
                fontSize: 13,
                marginTop: 8,
                padding: "8px 10px",
                border: "1px solid var(--border)",
                borderRadius: 6,
              }}
            >
              <strong>{foraDoRecorte}</strong> ficaram de fora pelo <strong>recorte de data</strong>{" "}
              da campanha — saíram antes do prazo configurado em{" "}
              <em>Reativação: só quem saiu nos últimos (dias)</em>, ali em cima. Eles não
              sumiram: voltam a ser candidatos no dia em que você aumentar o recorte.
            </p>
          )}

          {r.avaliados === 0 ? (
            <p className="text-dim" style={{ fontSize: 14, marginBottom: 0 }}>
              Nenhum contato da fila está marcado para sair pelo número da empresa. Isso
              é o esperado se só a <strong>reativação</strong> estiver ligada e ninguém
              estiver na etapa de ex-aluno com toque vencido — confira em{" "}
              <strong>Por onde cada motivo sai</strong>, logo acima.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
              {[...r.linhas]
                .filter((l) => !l.recorte)
                .sort((a, b) => Number(b.sai) - Number(a.sai))
                .map((l) => {
                  const foraAgora = tirados[l.contactId];
                  return (
                    <li
                      key={l.contactId}
                      style={{
                        padding: "10px 0",
                        borderTop: "1px solid var(--border)",
                        opacity: foraAgora ? 0.5 : 1,
                      }}
                    >
                      <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                        <span
                          className={foraAgora ? "badge" : l.sai ? "badge badge-success" : "badge"}
                          style={{ minWidth: 64, justifyContent: "center" }}
                        >
                          {foraAgora ? "fora" : l.sai ? "sai" : "fica"}
                        </span>
                        <strong style={{ fontSize: 14 }}>{l.nome}</strong>
                        <span className="text-faint grow" style={{ fontSize: 12 }}>{l.motivo}</span>
                        {!foraAgora && (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => tirar(l.contactId, l.nome)}
                          >
                            Não contatar
                          </button>
                        )}
                      </div>

                      {foraAgora && (
                        <p className="text-faint" style={{ fontSize: 12, margin: "4px 0 0 72px" }}>
                          Fora de todas as listas — motivo: &ldquo;{foraAgora}&rdquo;. Some da fila
                          do vendedor também.
                        </p>
                      )}

                      {!foraAgora && !l.sai && (
                        <p className="text-dim" style={{ fontSize: 12, margin: "4px 0 0 72px" }}>
                          {l.motivoDaRecusa}
                        </p>
                      )}

                      {/* ⚠ O TELEFONE INTERPRETADO — o último lugar onde alguém
                          olha antes do lote sair. `paraE164BR` avisa quando
                          acrescenta o nono dígito a um cadastro antigo, e esse
                          aviso foi feito para uma tela com gente na frente. No
                          automático não há gente: o motor deriva e envia. São
                          13% da base nessa situação. */}
                      {!foraAgora && l.telefoneAjustado && (
                        <p className="badge badge-warn" style={{ margin: "6px 0 0 72px", whiteSpace: "normal", textAlign: "left", fontSize: 11 }}>
                          Telefone: {l.telefoneAjustado}
                        </p>
                      )}

                      {!foraAgora && l.telefoneInvalido && (
                        <p className="badge badge-danger" style={{ margin: "6px 0 0 72px", whiteSpace: "normal", textAlign: "left", fontSize: 11 }}>
                          Não vai sair — {l.telefoneInvalido}
                        </p>
                      )}

                      {/* ⚠ O QUE VAI SER PREENCHIDO NESTA PESSOA.
                          O corpo do modelo é fixo, mora na Meta e foi aprovado
                          por ela — copiá-lo para cá criaria uma segunda fonte do
                          mesmo texto, e as duas divergiriam no dia em que alguém
                          editasse o modelo lá. O que varia, e o que de fato pode
                          sair errado, são as variáveis. */}
                      {!foraAgora && l.sai && (
                        <p className="text-faint" style={{ fontSize: 11, margin: "4px 0 0 72px" }}>
                          modelo <code>{l.modelo}</code> · {"{{1}}"} = <strong>{l.variaveis[0]}</strong>
                          {" · "}{"{{2}}"} = <strong>{l.variaveis[1]}</strong>
                        </p>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
