"use client";

import { useEffect, useState } from "react";

/**
 * O SELETOR DE TEMA — claro, escuro, ou o que o aparelho manda.
 *
 * ⚠ POR QUE ELE MORA NO NAVEGADOR E NÃO NO BANCO. Tema é preferência de QUEM
 * OLHA, não configuração da empresa. Duas pessoas usam a mesma conta da
 * academia: a recepcionista no balcão com luz de teto e o dono no celular à
 * noite. Salvar no `tenants.settings` faria a escolha de uma virar imposição
 * para a outra — e "Aparência" já tem cor e logo da empresa, que são coletivos.
 *
 * ⚠ E EXISTEM TRÊS OPÇÕES, NÃO DUAS. "Como no aparelho" é o padrão e não é
 * enfeite: é o que faz o painel acompanhar o modo noturno do celular sem
 * ninguém configurar nada. Quem escolhe claro ou escuro está dizendo
 * "independente do aparelho" — e é por isso que a marcação no `<html>` ganha
 * do `prefers-color-scheme` no CSS.
 *
 * ⚠ O `localStorage` PODE FALHAR (janela anônima, cookies bloqueados,
 * miniatura). Toda leitura e escrita vai dentro de `try` — tema é conforto, e
 * conforto que derruba a tela é pior que tela sem conforto.
 */

type Escolha = "sistema" | "claro" | "escuro";
const CHAVE = "kairos-tema";

const OPCOES: { valor: Escolha; texto: string; dica: string }[] = [
  { valor: "sistema", texto: "Como no aparelho", dica: "acompanha o modo noturno do celular ou do computador" },
  { valor: "claro", texto: "Claro", dica: "para o balcão, com luz de teto" },
  { valor: "escuro", texto: "Escuro", dica: "para a noite e para telas grandes" },
];

function aplicar(escolha: Escolha) {
  const raiz = document.documentElement;
  if (escolha === "sistema") raiz.removeAttribute("data-theme");
  else raiz.setAttribute("data-theme", escolha === "claro" ? "light" : "dark");
}

export function Tema() {
  const [escolha, setEscolha] = useState<Escolha>("sistema");
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let salva: Escolha = "sistema";
    try {
      const v = localStorage.getItem(CHAVE);
      if (v === "claro" || v === "escuro" || v === "sistema") salva = v;
    } catch { /* sem armazenamento: fica no padrão */ }
    setEscolha(salva);
    aplicar(salva);
    setPronto(true);
  }, []);

  const trocar = (v: Escolha) => {
    setEscolha(v);
    aplicar(v);
    try { localStorage.setItem(CHAVE, v); } catch { /* idem */ }
  };

  return (
    <div className="card">
      <p className="eyebrow" style={{ marginBottom: 8 }}>Tema desta tela</p>
      <p className="text-dim" style={{ margin: "0 0 12px", fontSize: 14 }}>
        Vale só para você, neste aparelho. A cor e a logo abaixo são da empresa
        inteira; o tema é de quem está olhando.
      </p>
      <div className="stack" style={{ gap: 8 }}>
        {OPCOES.map((o) => (
          <label
            key={o.valor}
            className="row"
            style={{
              gap: 10, alignItems: "flex-start", padding: "10px 12px",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              background: pronto && escolha === o.valor ? "var(--surface-2)" : "transparent",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="tema"
              checked={pronto && escolha === o.valor}
              onChange={() => trocar(o.valor)}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong style={{ fontSize: 14 }}>{o.texto}</strong>
              <span className="text-faint" style={{ display: "block", fontSize: 12 }}>{o.dica}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
