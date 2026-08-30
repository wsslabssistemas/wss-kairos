"use client";

import { useState, type ReactNode } from "react";

/**
 * AS SUB-ABAS DA AUTOMAÇÃO.
 *
 * ⚠ ERAM QUINZE BLOCOS NUMA PÁGINA SÓ. Modo, regras anti-bloqueio, o manual de
 * como ligar, o custo, a credencial da Meta, o webhook, o roteamento por
 * motivo, a simulação, o disparo, o perfil do número, o teste, o alcance, a
 * saúde do canal e o histórico de rodadas — tudo empilhado. Quem entrava para
 * apertar "Enviar agora" rolava por doze blocos de configuração antes de achar
 * o botão.
 *
 * ⚠ E O AGRUPAMENTO É POR FREQUÊNCIA DE USO, NÃO POR ASSUNTO. Foi a decisão
 * que mais mudou o desenho: "Canal oficial" e "Roteamento" são assunto
 * parecido, e um se toca todo dia enquanto o outro se toca uma vez por
 * trimestre. Agrupar por semelhança devolveria a mesma pilha com títulos —
 * o mesmo erro que a barra lateral acabou de corrigir.
 *
 * A ordem: **Operação** é o que se abre todo dia e vem primeiro e por padrão.
 * **Regras** e **Canal** são configuração. **Ajuda** é leitura.
 *
 * ⚠ AS ABAS ESCONDEM COM CSS, NÃO DESMONTAM. `display: none` preserva o que
 * já foi digitado num formulário ao trocar de aba — desmontar apagaria o campo
 * pela metade e a pessoa perderia o trabalho sem entender por quê. É o mesmo
 * princípio do aviso que não recarrega a tela de quem está preenchendo.
 */

export type Aba = { id: string; titulo: string; conteudo: ReactNode };

export function Abas({ abas }: { abas: Aba[] }) {
  const [atual, setAtual] = useState(abas[0]?.id ?? "");

  return (
    <>
      <div className="subabas" role="tablist" aria-label="Seções da automação">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={atual === a.id}
            className={atual === a.id ? "subaba ativa" : "subaba"}
            onClick={() => setAtual(a.id)}
          >
            {a.titulo}
          </button>
        ))}
      </div>

      {abas.map((a) => (
        <div
          key={a.id}
          role="tabpanel"
          hidden={atual !== a.id}
          style={atual === a.id ? undefined : { display: "none" }}
        >
          {a.conteudo}
        </div>
      ))}
    </>
  );
}
