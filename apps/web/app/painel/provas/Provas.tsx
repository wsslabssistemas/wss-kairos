"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { proximaProva, julgar, type Prova, type Veredito } from "./actions";
import { dataHoraLocal } from "@/lib/fuso";

/**
 * O JULGAMENTO, UMA MENSAGEM POR VEZ.
 *
 * ⚠ O VEREDITO VEM ANTES DA NOTA, e os três botões são a tela inteira. Caixa
 * de texto como resposta principal produz acervo que ninguém soma — e o que
 * falta aqui é justamente poder somar. A nota existe para o caso concreto,
 * ao lado, nunca no lugar.
 *
 * ⚠ E "ESCALOU" APARECE COM DESTAQUE. Quando a trava anti-invenção recusa
 * escrever, a tela precisa dizer isso em vez de mostrar uma sugestão vazia —
 * é literalmente o defeito de 20/ago, em que `{texto && ...}` não renderizava
 * nem a mensagem nem o aviso e a pessoa concluía que o botão estava quebrado.
 * Recusa é o produto funcionando, e quem julga precisa poder distinguir isso
 * de erro grave.
 */
export function Provas({
  placar,
}: {
  placar: { enviaria: number; ajustaria: number; erro_grave: number; escalou: number; descartadas: number };
}) {
  const [prova, setProva] = useState<Prova | null>(null);
  const [nota, setNota] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [acabou, setAcabou] = useState<string | null>(null);
  const [sessao, setSessao] = useState({ enviaria: 0, ajustaria: 0, erro_grave: 0, descartada: 0 });
  const router = useRouter();

  const total = placar.enviaria + placar.ajustaria + placar.erro_grave;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const puxar = async () => {
    setCarregando(true);
    setErro(null);
    setAcabou(null);
    setNota("");
    try {
      const r = await proximaProva();
      if (r.ok) setProva(r.prova);
      else if (r.acabou) { setProva(null); setAcabou(r.mensagem); }
      else setErro(r.erro);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  };

  const decidir = async (veredito: Veredito) => {
    if (!prova) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await julgar({ prova, veredito, nota });
      if (!r.ok) { setErro(r.erro); return; }
      setSessao((s) => ({ ...s, [veredito]: s[veredito] + 1 }));
      setProva(null);
      setNota("");
      // ⚠ SEM ISTO O PLACAR DE CIMA NUNCA MUDAVA. Ele vem do servidor como
      // propriedade, e `revalidatePath` sozinho não redesenha um componente de
      // cliente já montado. O fundador julgou 73 mensagens vendo o contador
      // parado — e concluiu, com razão, que talvez nada estivesse salvando.
      // Trabalho que não aparece na tela é indistinguível de trabalho perdido.
      router.refresh();
      await puxar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div>
      {/* O PLACAR — é o produto desta tela. O resto é o caminho até ele. */}
      <div className="card" style={{ borderColor: "var(--border-brand)" }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>O número que decide</p>
        {total === 0 ? (
          <p className="text-dim" style={{ margin: 0, fontSize: 14 }}>
            Nenhuma mensagem julgada ainda. <strong>Trinta bastam</strong> para o resultado
            parar de mudar — e você pode parar quando quiser: doze julgamentos já dizem
            alguma coisa, zero não dizem nada.
          </p>
        ) : (
          <>
            <div className="row wrap" style={{ gap: 10, alignItems: "baseline" }}>
              <span className="badge badge-success">{placar.enviaria} enviaria ({pct(placar.enviaria)}%)</span>
              <span className="badge badge-warn">{placar.ajustaria} ajustaria ({pct(placar.ajustaria)}%)</span>
              <span className={placar.erro_grave ? "badge badge-danger" : "badge"}>
                {placar.erro_grave} erro grave ({pct(placar.erro_grave)}%)
              </span>
              <span className="text-faint" style={{ fontSize: 13 }}>
                de {total} mensagens reais
                {placar.descartadas > 0 && <> · {placar.descartadas} descartadas</>}
              </span>
            </div>
            <p className="text-dim" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
              {placar.escalou > 0 && (
                <>
                  <strong>{placar.escalou}</strong> delas o motor <strong>se recusou a responder</strong> por
                  falta de fato — recusa é o produto funcionando, não defeito.{" "}
                </>
              )}
              {/* ⚠ A LEITURA VEM ESCRITA, senão cada pessoa inventa a sua. Um
                  único erro grave em trinta não é "3% de erro": é uma mensagem
                  errada saindo no nome da empresa a cada trinta, sem ninguém
                  olhando. */}
              <strong>Como ler:</strong> um único <em>erro grave</em> é motivo para NÃO ligar o
              automático — no automático ninguém revisa, então esse erro sai inteiro para o
              cliente. <em>Ajustaria</em> em excesso significa que o automático mandaria
              mensagem morna; abaixo de ~10% dá para conviver.
            </p>
          </>
        )}
      </div>

      {(sessao.enviaria + sessao.ajustaria + sessao.erro_grave + sessao.descartada) > 0 && (
        <p className="text-faint" style={{ fontSize: 12, marginTop: 8 }}>
          Nesta sessão: {sessao.enviaria} enviaria · {sessao.ajustaria} ajustaria ·{" "}
          {sessao.erro_grave} erro grave
          {sessao.descartada > 0 && <> · {sessao.descartada} descartadas</>}.
        </p>
      )}

      {erro && (
        <p className="badge badge-danger mt-16" style={{ whiteSpace: "normal", textAlign: "left" }}>
          {erro}
        </p>
      )}

      {acabou && (
        <p className="badge mt-16" style={{ whiteSpace: "normal", textAlign: "left" }}>
          {acabou}
        </p>
      )}

      {!prova && !acabou && (
        <button type="button" className="btn btn-primary mt-16" onClick={puxar} disabled={carregando}>
          {carregando ? "gerando…" : "▶ Puxar a próxima mensagem real"}
        </button>
      )}

      {prova && (
        <div className="card mt-16">
          <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
            <strong style={{ fontSize: 15 }}>{prova.nome}</strong>
            <span className="text-faint" style={{ fontSize: 12 }}>
              escreveu em {dataHoraLocal(prova.quando)}
            </span>
          </div>

          <p className="eyebrow" style={{ marginTop: 16, marginBottom: 6 }}>A mensagem dele</p>
          <p
            style={{
              margin: 0,
              padding: "10px 12px",
              borderRadius: 8,
              background: "var(--bg-elev)",
              fontSize: 14,
              whiteSpace: "pre-wrap",
            }}
          >
            {prova.mensagem}
          </p>

          <p className="eyebrow" style={{ marginTop: 16, marginBottom: 6 }}>O que a IA responderia</p>

          {prova.escalou && (
            <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left", marginBottom: 8 }}>
              O motor <strong>se recusou a redigir</strong> e mandou escalar para uma pessoa
              {prova.faltamFatos.length > 0 && <> — falta: {prova.faltamFatos.join(", ")}</>}.
              Isso é a trava anti-invenção agindo. Julgue se a recusa fazia sentido AQUI.
            </p>
          )}

          <p
            style={{
              margin: 0,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--border-brand)",
              fontSize: 14,
              whiteSpace: "pre-wrap",
            }}
          >
            {prova.sugestao.trim() ? prova.sugestao : "(o motor não escreveu nada)"}
          </p>

          <label className="label mt-16" htmlFor="nota">O que estava errado, se estava (opcional)</label>
          <input
            id="nota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="ex.: ofereceu horário que ele não pediu; tom formal demais"
            disabled={carregando}
          />

          <div className="row wrap mt-16" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={carregando} onClick={() => decidir("enviaria")}>
              ✓ Enviaria como está
            </button>
            <button type="button" className="btn" disabled={carregando} onClick={() => decidir("ajustaria")}>
              ✎ Ajustaria antes
            </button>
            <button type="button" className="btn btn-ghost" disabled={carregando} onClick={() => decidir("erro_grave")}>
              ✕ Erro grave
            </button>
          </div>

          {/* ⚠ A SAÍDA PARA O QUE NUNCA FOI PERGUNTA.
              A base do piloto grava anotação da equipe como mensagem de
              entrada — "renovou semestral" é uma delas — e nenhum campo separa
              as duas: as 1.180 entradas são todas `customer_message`. Como o
              dado não distingue, quem distingue é quem julga. Fica fora do
              placar: julgar a IA contra uma anotação é medir a resposta para
              uma pergunta que ninguém fez. */}
          <button
            type="button"
            className="btn btn-sm btn-ghost mt-16"
            disabled={carregando}
            onClick={() => decidir("descartada")}
          >
            ↷ Isso não é mensagem de cliente — descartar
          </button>

          <p className="text-faint" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            Nada é enviado. A mensagem já foi respondida no passado — aqui só se mede o que a
            IA teria feito.
          </p>
        </div>
      )}
    </div>
  );
}
