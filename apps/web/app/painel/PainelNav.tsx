"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

/**
 * A NAVEGAÇÃO — barra LATERAL agrupada, e a mudança tem motivo medido.
 *
 * ⚠ ERAM VINTE ABAS NUMA LINHA HORIZONTAL. O print de 29/ago mostrou o
 * resultado: uma faixa que rola para o lado, com nomes cortados nas duas
 * pontas, e a pessoa procurando "Sincronizar" numa lista que não cabe na tela.
 *
 * A pesquisa é convergente e não é sutil: barra superior serve para **3 a 6**
 * áreas; a partir de dez, o padrão de todo produto complexo (Linear, Notion,
 * Figma, Slack) é **lateral agrupada** — e estudos de rastreamento ocular
 * medem **20 a 30% menos tempo** para achar um item, porque varrer de cima
 * para baixo é mais rápido que da esquerda para a direita.
 *
 * ⚠ O AGRUPAMENTO É POR TRABALHO, NÃO POR TELA. "Atender" é o que a
 * recepcionista abre; "Configurar" é o que se toca uma vez por mês. Agrupar
 * por semelhança técnica (tudo que mexe em contato junto) devolveria a mesma
 * lista de vinte, só que com títulos.
 *
 * ⚠ E O GRUPO DE QUEM TRABALHA VEM PRIMEIRO. O fundador disse que os
 * vendedores usam **estritamente a Fila de envio** — então ela é o segundo
 * item da tela inteira, e nada de gestão aparece antes dela.
 */

export type Item = { href: string; label: string };
export type Grupo = { titulo: string | null; itens: Item[] };

export default function PainelNav({ grupos }: { grupos: Grupo[] }) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const ativo = (href: string) =>
    href === "/painel" ? pathname === href : pathname.startsWith(href);

  return (
    <>
      {/* ⚠ NO CELULAR A LATERAL VIRA GAVETA. Lateral fixa numa tela de 375px
          comeria metade do conteúdo, e a faixa que rola era exatamente o
          problema que estamos resolvendo. */}
      <button
        type="button"
        className="nav-abrir linklike"
        aria-expanded={aberto}
        aria-controls="menu-lateral"
        onClick={() => setAberto((v) => !v)}
      >
        {aberto ? "✕" : "☰"} Menu
      </button>

      <nav
        id="menu-lateral"
        className={aberto ? "lateral lateral-aberta" : "lateral"}
        aria-label="Seções do painel"
      >
        {grupos.map((g, i) => (
          <div key={g.titulo ?? `g${i}`} className="lateral-grupo">
            {g.titulo && <p className="lateral-titulo">{g.titulo}</p>}
            {g.itens.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={ativo(it.href) ? "lateral-item ativo" : "lateral-item"}
                onClick={() => setAberto(false)}
                aria-current={ativo(it.href) ? "page" : undefined}
              >
                {it.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}
