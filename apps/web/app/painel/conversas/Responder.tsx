"use client";

import { useState } from "react";
import { responderPeloCanal, gerarSugestaoDaConversa } from "./actions";

/**
 * A CAIXA DE RESPOSTA — e o relógio da janela ao lado dela.
 *
 * ⚠ O RELÓGIO NÃO É ENFEITE. Passadas 24h desde a última mensagem do cliente,
 * a Meta simplesmente não entrega texto livre. Quem está escrevendo precisa
 * saber disso ANTES de escrever, não depois de perder a mensagem — o aviso de
 * "menos de 2h" existe porque esse é o intervalo em que a pessoa monta a
 * resposta, sai para o café e volta com a janela fechada.
 *
 * E o campo não guarda rascunho entre recargas de propósito: rascunho salvo é
 * o começo da aba antiga que regrava valor velho por cima do novo.
 */
export function Responder({
  contactId,
  podeResponder,
  motivoDoBloqueio,
  aviso,
}: {
  contactId: string;
  podeResponder: boolean;
  motivoDoBloqueio: string | null;
  aviso: string | null;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [gerando, setGerando] = useState(false);
  /**
   * O que a IA sugeriu, guardado separado do que está na caixa.
   *
   * ⚠ SÃO DUAS COISAS DIFERENTES e a diferença É a lição: se no fim o texto
   * enviado não for igual a este, alguém corrigiu o motor — e a correção vai
   * junto no envio, sem depender de ninguém lembrar de registrar depois.
   */
  const [sugerido, setSugerido] = useState<string | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    setRecusa(null);
    try {
      const r = await gerarSugestaoDaConversa(contactId);
      if (!r.ok) { setErro(r.motivo); return; }
      // ⚠ `escalar` COM TEXTO VAZIO É O CASO QUE JÁ QUEBROU ESTA TELA UMA VEZ.
      // A trava anti-invenção devolve mensagem vazia junto com o pedido de
      // escalar; testar a verdade da string deixaria a tela IDÊNTICA depois do
      // clique, e botão que não muda nada é indistinguível de botão quebrado.
      if (r.escalar || !r.texto.trim()) {
        setRecusa(
          "O motor se recusou a redigir" +
            (r.faltam.length ? ` — falta no DNA: ${r.faltam.join(", ")}` : "") +
            ". Escreva você mesmo: ele preferiu não inventar.",
        );
      }
      if (r.texto.trim()) {
        setTexto(r.texto);
        setSugerido(r.texto);
        setEnviado(false);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  };


  const enviar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await responderPeloCanal(contactId, texto, sugerido ?? undefined);
      if (r.ok) {
        setEnviado(true);
        setTexto("");
        setSugerido(null);
        setRecusa(null);
      } else setErro(r.motivo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="card" style={{ background: "var(--bg-elev)" }}>
      {/* ⚠ A CAIXA APARECE SEMPRE, MESMO BLOQUEADA — e isso não é enfeite.
          O fundador abriu esta aba e disse "não consigo escrever, só serve
          para olhar". O campo existia; ele nunca apareceu porque a única
          conversa do sistema era o teste dele de três dias antes, com a janela
          de 24h fechada. O componente trocava a caixa por um aviso, e campo
          AUSENTE é indistinguível de campo que NÃO FOI FEITO.
          É a quarta vez que um comportamento correto chega como defeito por
          causa disso. A regra vale para telas também: **campo cinza com o
          motivo escrito ganha de campo que some.** */}
      {!podeResponder && (
        <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left" }}>
          {motivoDoBloqueio ?? "Não dá para responder por aqui agora."}
        </p>
      )}
      {aviso && (
        <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left" }}>
          {aviso}
        </p>
      )}
      <textarea
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setEnviado(false); }}
        placeholder={
          podeResponder
            ? "Escreva a resposta — ela sai pelo mesmo número em que ele escreveu."
            : "A janela de 24h fechou. O campo volta a funcionar assim que ele escrever de novo."
        }
        rows={3}
        style={{ width: "100%", marginTop: 8, opacity: podeResponder ? 1 : 0.55 }}
        disabled={enviando || !podeResponder}
      />
      {recusa && (
        <p className="badge badge-warn" style={{ marginTop: 8, whiteSpace: "normal", textAlign: "left" }}>
          {recusa}
        </p>
      )}

      {sugerido && texto.trim() !== sugerido.trim() && (
        <p className="text-faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Você mudou o texto da IA — a diferença vira lição para o motor quando enviar.
        </p>
      )}

      <div className="row wrap" style={{ gap: 8, alignItems: "center", marginTop: 8 }}>
        {/* ⚠ GERAR E ENVIAR SÃO BOTÕES SEPARADOS, sempre. Um botão só que
            gerasse e mandasse tiraria da pessoa o único momento em que ela
            pode discordar — e é justamente esse momento que autoriza o
            automático mais tarde. */}
        <button
          type="button"
          className="btn btn-sm"
          onClick={gerar}
          disabled={gerando || enviando || !podeResponder}
        >
          {gerando ? "gerando…" : "✨ Gerar resposta com IA"}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={enviar}
          disabled={enviando || !texto.trim() || !podeResponder}
        >
          {enviando ? "enviando…" : "Responder pelo número da empresa"}
        </button>
        {enviado && <span className="badge badge-success">enviada</span>}
      </div>
      {erro && (
        <p className="badge badge-danger" style={{ marginTop: 8, whiteSpace: "normal", textAlign: "left" }}>
          {erro}
        </p>
      )}
      <p className="text-faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
        Sai do número do sistema, no mesmo fio da conversa. Dentro da janela de 24h é
        texto livre e hoje não custa nada.
      </p>
    </div>
  );
}
