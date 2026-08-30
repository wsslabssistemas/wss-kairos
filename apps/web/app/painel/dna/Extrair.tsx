"use client";

import { useState } from "react";
import Link from "next/link";
import { extrairDna } from "./extrair-actions";
import { saveDna } from "./actions";
import type { Proposta } from "@/lib/dna-extrator";

/**
 * COLE O QUE VOCÊ SABE — o sistema separa, você confere.
 *
 * ⚠ O GARGALO DO PRODUTO É O PRIMEIRO DIA, não o motor. Empresa sem DNA recebe
 * recusa em tudo, e o dono conclui que o produto não funciona — é o que mantém
 * Darvil e Feltros cadastradas e paradas. Preencher trinta campos do zero é uma
 * tarde que ninguém tem; conferir dez preenchidos leva minutos.
 *
 * ⚠ NADA É SALVO SEM ALGUÉM MARCAR. A tela mostra o que entendeu, campo por
 * campo, com uma caixa em cada. É a trava anti-invenção aplicada ao cadastro:
 * dado que entra sem alguém olhar vira afirmação de preço que ninguém
 * autorizou, dita depois a um cliente com a confiança do fato conferido.
 *
 * ⚠ E VEM TUDO MARCADO, de propósito. O trabalho passa a ser DESMARCAR o que
 * está errado — que é menos do que marcar o que está certo, e é o que faz a
 * diferença entre conferir e desistir no meio.
 */
export function Extrair() {
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [p, setP] = useState<Proposta | null>(null);
  const [aceitos, setAceitos] = useState<Set<string>>(new Set());
  const [salvo, setSalvo] = useState(false);

  const chave = (s: string, c: string) => `${s}.${c}`;

  const ler = async () => {
    setCarregando(true);
    setErro(null);
    setP(null);
    setSalvo(false);
    try {
      const r = await extrairDna(texto);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setP(r.proposta);
      const todos = new Set<string>();
      for (const [s, campos] of Object.entries(r.proposta.valores))
        for (const c of Object.keys(campos)) todos.add(chave(s, c));
      setAceitos(todos);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  };

  const salvar = async () => {
    if (!p) return;
    setCarregando(true);
    setErro(null);
    try {
      const sections: Record<string, Record<string, unknown>> = {};
      for (const [s, campos] of Object.entries(p.valores)) {
        for (const [c, v] of Object.entries(campos)) {
          if (!aceitos.has(chave(s, c))) continue;
          (sections[s] ??= {})[c] = v;
        }
      }
      if (!Object.keys(sections).length) {
        setErro("Nenhum campo marcado.");
        return;
      }
      const r = await saveDna(sections);
      if (!r.ok) {
        setErro(r.error ?? "Não consegui salvar.");
        return;
      }
      setSalvo(true);
      setP(null);
      setTexto("");
    } finally {
      setCarregando(false);
    }
  };

  const marcados = aceitos.size;

  return (
    <div className="card mt-16">
      <p className="eyebrow" style={{ marginBottom: 8 }}>Preencher a partir de um texto</p>
      <p className="text-dim" style={{ margin: "0 0 12px", fontSize: 14 }}>
        Cole aqui tudo o que você sabe do negócio, do jeito que vier — preços, horários,
        o que oferece, condições, o que costuma dizer para quem pergunta. O sistema separa
        nos campos certos e <strong>você confere antes de salvar</strong>. Nada é gravado
        sem você marcar.
      </p>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={8}
        placeholder="Ex.: A mensalidade é R$ 169 sem fidelidade. Trimestral 3x R$ 149. Abrimos de segunda a sexta das 6h30 às 22h e sábado das 9h às 13h. Musculação livre, cross training terça e quinta 18h30..."
        style={{ width: "100%", fontSize: 14, lineHeight: 1.55 }}
        aria-label="O que você sabe do negócio"
      />

      <div className="row wrap" style={{ gap: 10, marginTop: 10, alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={ler}
          disabled={carregando || texto.trim().length < 40}
        >
          {carregando ? "lendo…" : "✨ Separar nos campos"}
        </button>
        <span className="text-faint" style={{ fontSize: 12 }}>
          Isto usa IA e conta na sua cota. Nada é salvo neste passo.
        </span>
      </div>

      {erro && (
        <p className="badge badge-danger mt-16" style={{ whiteSpace: "normal", textAlign: "left" }}>
          {erro}
        </p>
      )}
      {salvo && (
        <p className="nota mt-16">
          <strong>Salvo.</strong> Confira em <Link href="/painel/dna">DNA</Link> — o que ficou
          faltando continua sendo o que faz o motor escalar em vez de responder.
        </p>
      )}

      {p && (
        <div className="mt-24">
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            O que eu entendi — desmarque o que estiver errado
          </p>

          {Object.keys(p.valores).length === 0 ? (
            <p className="nota">
              Não consegui separar nada deste texto. Isso quase sempre é o texto falando de
              outra coisa, não defeito — escreva os preços, os horários e o que você oferece,
              com os números como eles são.
            </p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {Object.entries(p.valores).map(([secao, campos]) =>
                Object.entries(campos).map(([campo, valor]) => {
                  const k = chave(secao, campo);
                  return (
                    <label
                      key={k}
                      className="row"
                      style={{
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "9px 11px",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        background: aceitos.has(k) ? "var(--surface-2)" : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={aceitos.has(k)}
                        onChange={() => {
                          const n = new Set(aceitos);
                          if (n.has(k)) n.delete(k);
                          else n.add(k);
                          setAceitos(n);
                        }}
                        style={{ marginTop: 3 }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span className="text-faint" style={{ fontSize: 11, display: "block" }}>
                          {secao} · {campo}
                        </span>
                        <span style={{ fontSize: 14, wordBreak: "break-word" }}>
                          {typeof valor === "string" ? valor : JSON.stringify(valor)}
                        </span>
                      </span>
                    </label>
                  );
                }),
              )}
            </div>
          )}

          {/* ⚠ O QUE FALTOU, COM O CUSTO ESCRITO. Campo vazio no DNA vira
              escalada no atendimento, e ninguém faz essa ligação sozinho.
              Dizer "faltaram 6" sem dizer o que isso provoca seria informação
              sem consequência. */}
          {p.faltando.length > 0 && (
            <p className="nota mt-16">
              <strong>Ficaram {p.faltando.length} campo(s) sem resposta</strong> — e é isso que
              faz o motor escalar para um humano em vez de responder:{" "}
              {p.faltando.slice(0, 8).map((f) => f.label).join(", ")}
              {p.faltando.length > 8 ? "…" : ""}. Dá para completar escrevendo mais no texto
              acima, ou depois na tela do <Link href="/painel/dna/editar">DNA</Link>.
            </p>
          )}

          {/* ⚠ O DESCARTE APARECE. Sumir com o que foi ignorado faria a pessoa
              achar que o texto dela foi todo aproveitado. */}
          {p.descartado.length > 0 && (
            <p className="text-faint mt-8" style={{ fontSize: 12 }}>
              Ignorei {p.descartado.length} coisa(s) que não existem no cadastro deste ramo:{" "}
              {p.descartado.slice(0, 5).map((d) => d.caminho).join(", ")}.
            </p>
          )}

          {Object.keys(p.valores).length > 0 && (
            <button
              type="button"
              className="btn btn-primary mt-16"
              onClick={salvar}
              disabled={carregando || marcados === 0}
            >
              {carregando ? "salvando…" : `Salvar ${marcados} campo(s) marcado(s)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
