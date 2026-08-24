"use client";

import { useState } from "react";
import Link from "next/link";
import { dispararTeste, type TesteResult } from "./teste-actions";

/**
 * ⚠ ESTE BOTÃO MANDA MENSAGEM DE VERDADE, e a tela diz isso antes do clique.
 *
 * Não é simulação: sai pelo número da empresa, custa, e chega no celular de
 * alguém. A diferença para a campanha é só o destinatário ser escolhido a
 * dedo — o caminho por dentro é exatamente o mesmo `despacharToque`.
 */
export function DisparoDeTeste() {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [r, setR] = useState<TesteResult | null>(null);

  const enviar = async () => {
    setEnviando(true);
    setR(null);
    try {
      setR(await dispararTeste({ nome, telefone }));
    } catch (e) {
      setR({ ok: false, erro: e instanceof Error ? e.message : String(e) });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="card mt-16" style={{ borderColor: "var(--border-brand)" }}>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Disparo de teste</p>

      <p className="text-dim" style={{ marginTop: 0, fontSize: 14 }}>
        Manda o <strong>modelo de reativação</strong> para um número escolhido, pelo mesmo
        caminho da campanha. Serve para provar o encanamento inteiro — envio, entrega, status
        e a resposta voltando — antes de a primeira mensagem sair para um ex-aluno de verdade.
      </p>

      {/* ⚠ O AVISO VEM ANTES DOS CAMPOS. Depois do clique não adianta. */}
      <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left" }}>
        <strong>Isto envia de verdade.</strong> A mensagem chega no celular da pessoa e é
        cobrada pela Meta como qualquer outra. Use um número seu ou de alguém que sabe do teste.
      </p>

      <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
        <div style={{ flex: "1 1 200px" }}>
          <label className="label" htmlFor="teste-nome">Nome de quem recebe</label>
          <input
            id="teste-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="O primeiro nome vai dentro do modelo"
            disabled={enviando}
          />
        </div>
        <div style={{ flex: "1 1 200px" }}>
          <label className="label" htmlFor="teste-fone">Telefone com DDD</label>
          <input
            id="teste-fone"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="51 99999-9999"
            disabled={enviando}
          />
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary mt-16"
        onClick={enviar}
        disabled={enviando || !nome.trim() || !telefone.trim()}
      >
        {enviando ? "enviando…" : "Enviar o modelo agora"}
      </button>

      {r && !r.ok && (
        <p className="badge badge-danger" style={{ marginTop: 12, whiteSpace: "normal", textAlign: "left" }}>
          {r.erro}
        </p>
      )}

      {r && r.ok && (
        <div className="mt-16">
          <p className="badge badge-success" style={{ whiteSpace: "normal", textAlign: "left" }}>
            Saiu pelo número da empresa — a Meta aceitou e devolveu o identificador{" "}
            <code>{r.id}</code>
            {r.modelo ? <> (modelo <code>{r.modelo}</code>)</> : null}.
          </p>
          <p className="text-dim" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
            {r.contatoNovo && (
              <>
                Criei o contato <strong>{r.nome}</strong> marcado como{" "}
                <em>não contatar</em>, para ele nunca entrar numa lista automática.{" "}
              </>
            )}
            Agora acompanhe em <Link href="/painel/conversas">Canal oficial</Link>: o status
            (enviada, entregue, lida) chega sozinho, e quando ela responder a conversa aparece
            lá com o botão de gerar a resposta.
          </p>
        </div>
      )}

      {/* ⚠ "ACEITOU" NÃO É "ENTREGOU", e a diferença já custou caro nesta casa.
          A Meta responde com o identificador antes de tentar entregar; falha de
          entrega chega DEPOIS, pelo webhook de status. Por isso o texto acima
          manda olhar o Canal oficial em vez de declarar sucesso aqui. */}
      <p className="text-faint" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
        A Meta devolver o identificador significa que ela <strong>aceitou</strong> a mensagem,
        não que entregou. A entrega — e a falha, se houver — aparece no Canal oficial.
      </p>
    </div>
  );
}
