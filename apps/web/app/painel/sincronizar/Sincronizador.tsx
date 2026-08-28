"use client";

import { useState } from "react";
import { ler, lerRecebimentos } from "@/lib/planilha";
import { prever, aplicar, type Previsao, type DadosLidos } from "./actions";

/**
 * A TELA DE SINCRONIZAÇÃO — ver antes de aplicar.
 *
 * ⚠ O FLUXO É DE DOIS PASSOS E ISSO É A SEGURANÇA, não a ergonomia.
 *
 * O primeiro botão não grava nada: mostra o que ACONTECERIA. Só depois de a
 * pessoa ler a lista é que o segundo aparece. Um botão só, "importar", é o
 * desenho que produz a classe de defeito mais cara deste repositório — o
 * `seed-curso.mjs` saiu **com três ✓ verdes** enquanto derrubava oito módulos
 * ao lado, porque relatava só o que ele mesmo escrevera.
 *
 * ⚠ O ARQUIVO É LIDO **E INTERPRETADO** AQUI, e a segunda metade é nova.
 *
 * Antes, o texto inteiro do arquivo ia para a server action. O de matrículas
 * (86 KB) chegava; o de recebimentos (**4,2 MB**) não — o corpo da requisição
 * estoura o teto de plataforma da Vercel, que o `bodySizeLimit` do Next não
 * move, e estoura **sem mensagem na tela**. Do lado de quem usa, isso é
 * exatamente "não está salvando".
 *
 * Hoje `lib/planilha.ts` roda aqui (ele não tem rede nem banco, de propósito)
 * e o que sobe é o RESULTADO: os 1.548 pagantes viram algo perto de 200 KB.
 * Some o teto, some o parse duplicado no servidor, e some a chance de o mesmo
 * defeito voltar quando a base dobrar.
 *
 * O erro de leitura também passou a aparecer na hora, sem ida ao servidor —
 * planilha com coluna faltando é resposta imediata, não espera.
 *
 * O arquivo continua sem subir: o `.csv` e o `.xls` que na verdade é HTML são
 * decididos pelo CONTEÚDO (`linhasDe`), porque o sistema da academia mente a
 * extensão em pelo menos dois relatórios.
 */
export function Sincronizador() {
  const [dados, setDados] = useState<DadosLidos>({ matriculas: null, recebimentos: null });
  const [nomeMat, setNomeMat] = useState("");
  const [nomeRec, setNomeRec] = useState("");
  const [p, setP] = useState<Previsao | null>(null);
  /**
   * "Conferi a exportação" — a saída deliberada da trava de desaparecidos.
   *
   * Zera a previsão ao mudar: marcar a caixa e continuar vendo o resultado
   * antigo faria a pessoa aplicar em cima de uma conta que não é mais a que
   * está na tela.
   */
  const [confirmado, setConfirmado] = useState(false);
  /**
   * ⚠ CAIXA SEPARADA, e não é preciosismo. Ela autoriza dar baixa em quem
   * sumiu da fonte COM CONTRATO CORRENDO — decisão diferente de "a exportação
   * está completa". Em 28/ago, 20 dos 27 sumidos tinham contrato até 2027, e
   * dois dos três conferidos eram alunos em dia (um com o ano pago à vista).
   * Uma caixa só para as duas perguntas é como se aprende a marcar tudo sem ler.
   */
  const [baixarVigentes, setBaixarVigentes] = useState(false);
  const [carregando, setCarregando] = useState<null | "lendo" | "prever" | "aplicar">(null);
  const [feito, setFeito] = useState<string | null>(null);

  const rotuloDoArquivo = (f: File, extra: string) =>
    `${f.name} · ${Math.round(f.size / 1024)} KB · ${extra}`;

  const escolher = async (f: File | undefined, qual: "mat" | "rec") => {
    if (!f) return;
    setCarregando("lendo"); setP(null); setFeito(null);
    try {
      const texto = await f.text();
      if (qual === "mat") {
        const l = ler(texto, { exigeVigencia: true });
        if (l.erro) {
          setDados((d) => ({ ...d, matriculas: null }));
          setNomeMat("");
          setP({ ok: false, erro: `Matrículas: ${l.erro}` });
          return;
        }
        setDados((d) => ({
          ...d,
          matriculas: { linhas: l.linhas, entendeu: l.entendeu, ignoradas: l.ignoradas.length },
        }));
        setNomeMat(rotuloDoArquivo(f, `${l.linhas.length} pessoas`));
      } else {
        const r = lerRecebimentos(texto);
        if (r.erro) {
          setDados((d) => ({ ...d, recebimentos: null }));
          setNomeRec("");
          setP({ ok: false, erro: `Recebimentos: ${r.erro}` });
          return;
        }
        setDados((d) => ({
          ...d,
          recebimentos: {
            pagantes: r.pagantes, entendeu: r.entendeu,
            descartadas: r.descartadas, ignoradas: r.ignoradas.length,
          },
        }));
        setNomeRec(rotuloDoArquivo(f, `${r.pagantes.length} pagantes`));
      }
    } finally {
      setCarregando(null);
    }
  };

  const temAlgo = !!dados.matriculas || !!dados.recebimentos;

  const rodarPrevisao = async () => {
    setCarregando("prever"); setFeito(null);
    try { setP(await prever(dados, confirmado, baixarVigentes)); } finally { setCarregando(null); }
  };

  const rodarAplicacao = async () => {
    setCarregando("aplicar");
    try {
      const r = await aplicar(dados, confirmado, baixarVigentes);
      if (r.ok) {
        // A falha parcial vem junto do sucesso, de propósito: "1.500
        // atualizados" escondendo 48 recusas é o mesmo defeito de sempre.
        setFeito(
          `${r.gravados} contatos atualizados.` +
          (r.falhas ? ` ${r.falhas} não foram gravados — o banco recusou.` : ""),
        );
        setP(null);
      } else setP({ ok: false, erro: r.erro });
    } finally { setCarregando(null); }
  };

  const rotulo: Record<string, { txt: string; cor: string }> = {
    renovou: { txt: "renovou", cor: "badge-success" },
    entrou: { txt: "entrou", cor: "badge-brand" },
    reapareceu: { txt: "voltou", cor: "badge-brand" },
    encerrou: { txt: "encerrou", cor: "badge-danger" },
    ajuste_de_data: { txt: "ajuste de data", cor: "badge" },
    vigencia_recuou: { txt: "conferir", cor: "badge-warn" },
    // ⚠ SEM A LINHA ABAIXO, A TELA MOSTRAVA `sumiu_vigente` CRU. O rótulo caía
    // no nome interno do evento, em snake_case, no meio de uma lista onde todo
    // o resto está em português — e logo no grupo que existe para uma PESSOA
    // ler e decidir. Chave de código na cara de quem opera é o tipo de detalhe
    // que faz o produto parecer inacabado justo onde ele está sendo cuidadoso.
    sumiu_vigente: { txt: "confirmar saída", cor: "badge-warn" },
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <p className="eyebrow" style={{ marginBottom: 10 }}>1 · Os arquivos</p>
        <div className="row wrap" style={{ gap: 20 }}>
          <label className="text-dim" style={{ fontSize: 13 }}>
            <span style={{ display: "block", marginBottom: 4 }}>Matrículas (.csv)</span>
            <input type="file" accept=".csv,.txt,.xls,.html" onChange={(e) => escolher(e.target.files?.[0], "mat")} />
            {nomeMat && <span className="badge badge-success" style={{ marginLeft: 8 }}>{nomeMat}</span>}
          </label>
          <label className="text-dim" style={{ fontSize: 13 }}>
            <span style={{ display: "block", marginBottom: 4 }}>Recebimentos (.xls)</span>
            <input type="file" accept=".csv,.txt,.xls,.html" onChange={(e) => escolher(e.target.files?.[0], "rec")} />
            {nomeRec && <span className="badge badge-success" style={{ marginLeft: 8 }}>{nomeRec}</span>}
          </label>
        </div>
        <p className="text-faint" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          Pode mandar um só ou os dois. O arquivo é lido <strong>aqui no seu
          navegador</strong> e não sobe — só o que foi entendido dele.{" "}
          <strong>Nada é gravado neste passo.</strong> CPF, endereço e complemento
          são descartados na leitura — o sistema não precisa deles.
        </p>
        <button
          type="button"
          className="btn btn-primary mt-16"
          disabled={!temAlgo || carregando !== null}
          onClick={rodarPrevisao}
        >
          {carregando === "lendo" ? "lendo o arquivo…" : carregando === "prever" ? "comparando…" : "Ver o que vai mudar"}
        </button>
      </div>

      {feito && <p className="badge badge-success">{feito}</p>}

      {p && !p.ok && <p className="badge badge-danger" style={{ whiteSpace: "normal", textAlign: "left" }}>{p.erro}</p>}

      {p?.ok && (
        <div className="card">
          <p className="eyebrow" style={{ marginBottom: 10 }}>2 · O que eu entendi</p>
          {p.entendeu?.matriculas && <p className="text-dim" style={{ fontSize: 13, margin: "0 0 4px" }}>Matrículas: {p.entendeu.matriculas}</p>}
          {p.entendeu?.recebimentos && <p className="text-dim" style={{ fontSize: 13, margin: "0 0 4px" }}>Recebimentos: {p.entendeu.recebimentos}</p>}
          {p.pagantes && (
            <p className="text-faint" style={{ fontSize: 12, margin: "8px 0 0" }}>
              {p.pagantes.total} pagantes · {p.pagantes.comHabito} com histórico suficiente para o sistema
              saber o atraso habitual deles.
              {p.pagantes.descartadas.length > 0 && (
                <> Colunas descartadas por serem dado sensível sem uso: <strong>{p.pagantes.descartadas.join(", ")}</strong>.</>
              )}
            </p>
          )}

          {/* O que muda ALÉM dos campos, escrito antes do botão. Mudar a etapa
              de dezenas de pessoas é a consequência mais visível desta
              gravação, e a tela de dois passos existe para ninguém ser
              surpreendido por ela. */}
          {p.aviso && (
            <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left", marginTop: 12 }}>
              {p.aviso}
            </p>
          )}

          {/* ⚠ O BLOQUEIO VEM ANTES DE TUDO E SUBSTITUI O BOTÃO. Mostrar o
              aviso e deixar o botão do lado é o mesmo que não ter aviso. */}
          {/* ⚠ O BOTÃO DE APLICAR NÃO PODE DEPENDER DE `resumo`.
              `resumo` só existe quando veio arquivo de MATRÍCULAS. Quem subisse
              só o de recebimentos via a leitura correta e **nenhum botão** —
              que é exatamente o "não está salvando" e o "parece que falta o
              botão de enviar" que o fundador relatou. O botão agora depende de
              haver ALGO a aplicar, não de um dos dois arquivos. */}
          {p.bloqueio ? (
            <div className="card mt-16" style={{ borderColor: "var(--danger)" }}>
              <p className="badge badge-danger">Não dá para aplicar</p>
              <p style={{ fontSize: 14, margin: "8px 0 0" }}>{p.bloqueio}</p>
              <p className="text-faint" style={{ fontSize: 12 }}>
                A lista abaixo mostra o que teria acontecido, para você conferir a exportação.
              </p>

              {/* ⚠ A TRAVA GANHOU SAÍDA, e o motivo é do dia 20/ago.
                  O fundador subiu a exportação certa — 393 linhas de 2023 a
                  2026, a base inteira — e levou "não dá para aplicar: 78%
                  sumiram". Quem estava inflado era o BANCO, com contratos
                  velhos sem baixa.

                  Trava sem saída transforma "confira antes de aplicar" em
                  "nunca aplique", e quem precisa aplicar contorna por fora,
                  editando planilha até caber no limite — que é o pior desfecho
                  possível.

                  Então o bloqueio continua sendo o padrão, e a saída é um
                  SEGUNDO ATO deliberado: marcar a caixa e mandar prever de
                  novo. Não é o mesmo botão com um clique a mais. */}
              {!p.fonteVazia && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                  <label className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={confirmado}
                      onChange={(e) => { setConfirmado(e.target.checked); setP(null); }}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <strong>Conferi a exportação e ela está completa.</strong> Sei que isto
                      vai dar baixa em quem não está no arquivo, e quero aplicar mesmo assim.
                    </span>
                  </label>
                  {confirmado && (
                    <p className="text-faint" style={{ fontSize: 12, margin: "8px 0 0" }}>
                      Marcado. Clique em <strong>Ver o que vai acontecer</strong> de novo — a
                      previsão é refeita no servidor, e só então o botão de aplicar aparece.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            (p.resumo || p.pagantes) && (
              <>
                <div className="row wrap mt-16" style={{ gap: 8 }}>
                  {!!p.resumo && p.resumo.renovaram > 0 && <span className="badge badge-success">renovaram: <strong>{p.resumo.renovaram}</strong></span>}
                  {!!p.resumo && p.resumo.entraram > 0 && <span className="badge badge-brand">entraram: <strong>{p.resumo.entraram}</strong></span>}
                  {!!p.resumo && p.resumo.reapareceram > 0 && <span className="badge badge-brand">voltaram: <strong>{p.resumo.reapareceram}</strong></span>}
                  {!!p.resumo && p.resumo.encerraram > 0 && <span className="badge badge-danger">encerraram: <strong>{p.resumo.encerraram}</strong></span>}
                  {!!p.resumo && p.resumo.ajustaram > 0 && <span className="badge">ajuste de data: <strong>{p.resumo.ajustaram}</strong></span>}
                  {!!p.resumo && (p.resumo.vigentesSumidos ?? 0) > 0 && (
                    <span className="badge badge-warn">
                      sumiram com contrato correndo: <strong>{p.resumo.vigentesSumidos}</strong>
                    </span>
                  )}
                  {!!p.resumo && p.resumo.recuaram > 0 && <span className="badge badge-warn">conferir: <strong>{p.resumo.recuaram}</strong></span>}
                </div>
                {/* ⚠ A SEGUNDA DECISÃO, SEPARADA. Quem sumiu da fonte com contrato
                    correndo é contradição, não encerramento: pode ser
                    cancelamento no meio do plano, pode ser filtro na
                    exportação. Em 28/ago eram 20 de 27, com contratos até 2027,
                    e dois dos três conferidos eram alunos EM DIA — um deles com
                    o ano inteiro pago à vista. Sem esta caixa, eles receberiam
                    "você parou de treinar, quer voltar?". */}
                {!!p.resumo && (p.resumo.vigentesSumidos ?? 0) > 0 && (
                  <div className="card mt-16" style={{ borderColor: "var(--warn)" }}>
                    <p style={{ margin: 0, fontSize: 14 }}>
                      <strong>{p.resumo.vigentesSumidos} pessoa(s) sumiram da fonte, mas o
                      contrato delas ainda está correndo.</strong>{" "}
                      Isso pode ser cancelamento no meio do plano — ou a exportação ter um filtro
                      que as deixou de fora (quem já pagou tudo, quem está com valor em aberto).
                      Por padrão elas <strong>não recebem baixa</strong> e continuam onde estão.
                    </p>
                    <label className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 14, marginTop: 12 }}>
                      <input
                        type="checkbox"
                        checked={baixarVigentes}
                        onChange={(e) => { setBaixarVigentes(e.target.checked); setP(null); }}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        <strong>Conferi: essas pessoas cancelaram mesmo.</strong> Dar baixa nelas
                        também, mesmo com contrato em aberto.
                      </span>
                    </label>
                    {baixarVigentes && (
                      <p className="text-faint" style={{ fontSize: 12, margin: "8px 0 0" }}>
                        Marcado. Clique em <strong>Ver o que vai acontecer</strong> de novo — a
                        previsão é refeita no servidor antes de qualquer gravação.
                      </p>
                    )}
                  </div>
                )}

                <button type="button" className="btn btn-primary mt-16" disabled={carregando !== null} onClick={rodarAplicacao}>
                  {carregando === "aplicar" ? "gravando…" : "Aplicar essas mudanças"}
                </button>
              </>
            )
          )}

          {!!p.eventos?.length && (
            <ul style={{ listStyle: "none", padding: 0, marginTop: 16 }}>
              {p.eventos.slice(0, 60).map((e) => (
                <li key={`${e.chave}-${e.tipo}`} className="row wrap" style={{ gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                  <span className={`badge ${rotulo[e.tipo]?.cor ?? ""}`} style={{ minWidth: 100, justifyContent: "center" }}>
                    {rotulo[e.tipo]?.txt ?? e.tipo}
                  </span>
                  <span className="grow">{e.descricao}</span>
                </li>
              ))}
              {p.eventos.length > 60 && (
                <li className="text-faint" style={{ fontSize: 12, paddingTop: 10 }}>
                  … e mais {p.eventos.length - 60}. Todas serão aplicadas.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
