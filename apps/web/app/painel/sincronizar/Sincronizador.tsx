"use client";

import { useState } from "react";
import { ler, lerRecebimentos, identificarPlanilha, type TipoDePlanilha } from "@/lib/planilha";
import { prever, aplicar, lerDoGoogle, type Previsao, type DadosLidos } from "./actions";

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
/** Como cada tipo se chama na tela. Nome de código nunca aparece para quem opera. */
const ROTULO_TIPO: Record<TipoDePlanilha, string> = {
  matriculas: "relação de matrículas",
  recebimentos: "relatório de recebimentos",
  desconhecido: "não reconhecido",
};

export function Sincronizador({ linkSalvo = "" }: { linkSalvo?: string }) {
  const [dados, setDados] = useState<DadosLidos>({ matriculas: null, recebimentos: null });
  /** O link publicado desta empresa, para não colar de novo toda vez. */
  const [link, setLink] = useState(linkSalvo);
  /**
   * ⚠ OS ARQUIVOS COMO ELES SÃO, com o que o sistema entendeu de cada um.
   *
   * Antes existiam duas caixas rotuladas — "Matrículas" e "Recebimentos" — e
   * a pessoa tinha que saber qual arquivo era qual ANTES de qualquer leitura.
   * O fundador descreveu o custo disso em 01/set: *"o sistema da Be Fitness é
   * tão ruim que não tenho todas as informações em apenas uma planilha, sempre
   * fico com dúvida do tipo de importação que devo fazer"*.
   *
   * Quem sabe que arquivo é aquele é o CONTEÚDO dele. Guardar o texto aqui é o
   * que permite trocar o tipo sem pedir o arquivo de novo — corrigir uma
   * identificação não pode custar reabrir o seletor.
   */
  const [arquivos, setArquivos] = useState<
    { nome: string; kb: number; texto: string; tipo: TipoDePlanilha; porque: string; cabecalhos: string[]; ambiguo: boolean }[]
  >([]);
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

  /**
   * Aplica UM arquivo já identificado na caixa que corresponde ao tipo.
   *
   * ⚠ ELE NÃO DECIDE NADA — recebe o tipo pronto, venha da identificação
   * automática ou da correção de quem está olhando. Quem manda é a pessoa;
   * o sistema só para de perguntar o que ele mesmo consegue descobrir.
   */
  const aplicarTipo = (texto: string, tipo: TipoDePlanilha): string | null => {
    if (tipo === "matriculas") {
      const l = ler(texto, { exigeVigencia: true });
      if (l.erro) return `Como relação de matrículas: ${l.erro}`;
      setDados((d) => ({
        ...d,
        matriculas: { linhas: l.linhas, entendeu: l.entendeu, ignoradas: l.ignoradas.length },
      }));
      return null;
    }
    if (tipo === "recebimentos") {
      const r = lerRecebimentos(texto);
      if (r.erro) return `Como relatório de recebimentos: ${r.erro}`;
      setDados((d) => ({
        ...d,
        recebimentos: {
          pagantes: r.pagantes, entendeu: r.entendeu,
          descartadas: r.descartadas, ignoradas: r.ignoradas.length,
        },
      }));
      return null;
    }
    return null;
  };

  /**
   * ⚠ VÁRIOS ARQUIVOS DE UMA VEZ, e isso é o ponto.
   *
   * A realidade do cliente não é uma planilha completa: é um sistema velho que
   * exporta pedaços. Exigir um arquivo por caixa, na caixa certa, é pedir que
   * ele resolva no braço a bagunça que o fornecedor dele criou.
   */
  const receber = async (lista: FileList | null) => {
    if (!lista || lista.length === 0) return;
    setCarregando("lendo"); setP(null); setFeito(null);
    try {
      const novos: typeof arquivos = [];
      const erros: string[] = [];
      for (const f of Array.from(lista)) {
        const texto = await f.text();
        const id = identificarPlanilha(texto);
        const erro = aplicarTipo(texto, id.tipo);
        if (erro) erros.push(`${f.name}: ${erro}`);
        novos.push({
          nome: f.name, kb: Math.round(f.size / 1024), texto,
          tipo: id.tipo, porque: erro ?? id.porque, cabecalhos: id.cabecalhos, ambiguo: id.ambiguo,
        });
      }
      // Arquivo remandado substitui o anterior de mesmo nome, em vez de virar
      // duas linhas dizendo coisas diferentes sobre o mesmo arquivo.
      setArquivos((a) => [...a.filter((x) => !novos.some((n) => n.nome === x.nome)), ...novos]);
      if (erros.length) setP({ ok: false, erro: erros.join(" · ") });
    } finally {
      setCarregando(null);
    }
  };

  /**
   * A MESMA LEITURA, VINDA DO GOOGLE.
   *
   * ⚠ Reaproveita `identificarPlanilha` e `aplicarTipo` de propósito: se a aba
   * do Google passasse por outro caminho, as duas leituras divergiriam em
   * silêncio — e a que erra seria a que ninguém está conferindo. Uma planilha
   * é uma planilha, tenha vindo do disco ou da nuvem.
   */
  const lerDoLink = async () => {
    setCarregando("lendo"); setP(null); setFeito(null);
    try {
      const r = await lerDoGoogle(link.trim() || undefined);
      if (!r.ok) { setP({ ok: false, erro: r.erro }); return; }
      setLink(r.salvo);
      const novos: typeof arquivos = [];
      const erros: string[] = [];
      for (const aba of r.abas) {
        const id = identificarPlanilha(aba.csv);
        const erro = aplicarTipo(aba.csv, id.tipo);
        if (erro && id.tipo !== "desconhecido") erros.push(`${aba.nome}: ${erro}`);
        novos.push({
          nome: aba.nome, kb: Math.round(aba.csv.length / 1024), texto: aba.csv,
          tipo: id.tipo, porque: erro ?? id.porque, cabecalhos: id.cabecalhos, ambiguo: id.ambiguo,
        });
      }
      setArquivos((a) => [...a.filter((x) => !novos.some((n) => n.nome === x.nome)), ...novos]);
      if (erros.length) setP({ ok: false, erro: erros.join(" · ") });
    } catch (e) {
      setP({ ok: false, erro: e instanceof Error ? e.message : String(e) });
    } finally {
      setCarregando(null);
    }
  };

  /** A correção humana: a pessoa diz que o arquivo é outra coisa. */
  const corrigirTipo = (nome: string, tipo: TipoDePlanilha) => {
    const alvo = arquivos.find((a) => a.nome === nome);
    if (!alvo) return;
    setP(null); setFeito(null);
    const erro = aplicarTipo(alvo.texto, tipo);
    setArquivos((a) =>
      a.map((x) => (x.nome === nome ? { ...x, tipo, porque: erro ?? `Você marcou como ${ROTULO_TIPO[tipo]}.`, ambiguo: false } : x)),
    );
    if (erro) setP({ ok: false, erro: `${nome}: ${erro}` });
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
        <label className="text-dim" style={{ fontSize: 13 }}>
          <span style={{ display: "block", marginBottom: 4 }}>
            Mande os arquivos — o sistema descobre o que é cada um
          </span>
          <input
            type="file"
            multiple
            accept=".csv,.txt,.xls,.html"
            onChange={(e) => receber(e.target.files)}
          />
        </label>

        {/* ⚠ A PLANILHA QUE MORA NO GOOGLE — pedido do fundador: *"a empresa
            coloca um link público e compartilhado, a pessoa atualiza a planilha
            e o sistema já reconhece"*. O caminho depois do link é o MESMO do
            arquivo: identifica, mostra o que entendeu, e a pessoa confirma.
            Ler não importa nada — importar continua sendo decisão de gente. */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <label className="label" htmlFor="link_planilha">Ou leia direto de uma planilha do Google</label>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              id="link_planilha"
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/e/.../pubhtml"
              style={{ flex: "1 1 380px", minWidth: 260 }}
            />
            <button type="button" className="btn btn-sm" disabled={carregando !== null} onClick={lerDoLink}>
              {carregando === "lendo" ? "lendo…" : "Ler a planilha"}
            </button>
          </div>
          <p className="text-faint" style={{ fontSize: 12, marginTop: 6, maxWidth: 620 }}>
            Tem que ser o link de <strong>publicação na web</strong> (no Google Sheets: Arquivo →
            Compartilhar → Publicar na web), não o de compartilhamento. O sistema lê{" "}
            <strong>todas as abas</strong> e identifica cada uma — você confere antes de aplicar.
            O link fica guardado: da próxima vez é só clicar em ler.
          </p>
          <p className="text-faint" style={{ fontSize: 12, marginTop: 4, maxWidth: 620 }}>
            ⚠ Planilha publicada é <strong>pública</strong>: quem tiver o endereço consegue abrir.
            Publique só as abas que o sistema precisa ler.
          </p>
        </div>

        {arquivos.length > 0 && (
          <ul className="stack" style={{ gap: 8, listStyle: "none", padding: 0, margin: "14px 0 0" }}>
            {arquivos.map((a) => (
              <li
                key={a.nome}
                style={{ borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: 13 }}
              >
                <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                  <span
                    className={`badge ${a.tipo === "desconhecido" ? "badge-warn" : "badge-success"}`}
                  >
                    {ROTULO_TIPO[a.tipo]}
                  </span>
                  <strong>{a.nome}</strong>
                  <span className="text-faint">{a.kb} KB</span>
                  {a.ambiguo && <span className="badge badge-warn">os dois leitores aceitaram</span>}
                </div>
                <p className="text-dim" style={{ margin: "6px 0 0" }}>{a.porque}</p>
                {a.tipo === "desconhecido" && a.cabecalhos.length > 0 && (
                  <p className="text-faint" style={{ margin: "4px 0 0", fontSize: 12 }}>
                    Colunas lidas: {a.cabecalhos.join(" | ")}
                  </p>
                )}
                {/* ⚠ A CORREÇÃO FICA SEMPRE À MÃO, mesmo quando o sistema tem
                    certeza. Identificação automática que não se deixa corrigir
                    troca a dúvida honesta de quem opera por uma certeza do
                    sistema — e aqui errar o tipo faz comparar coisas diferentes
                    em silêncio. */}
                <label className="text-faint" style={{ fontSize: 12, display: "block", marginTop: 6 }}>
                  Não é isso?{" "}
                  <select
                    value={a.tipo}
                    onChange={(e) => corrigirTipo(a.nome, e.target.value as TipoDePlanilha)}
                  >
                    <option value="matriculas">é a relação de matrículas</option>
                    <option value="recebimentos">é o relatório de recebimentos</option>
                    <option value="desconhecido">não sei / não usar</option>
                  </select>
                </label>
              </li>
            ))}
          </ul>
        )}

        <p className="text-faint" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          Pode mandar um, dois ou vários de uma vez — cada um entra no lugar dele.
          O arquivo é lido <strong>aqui no seu navegador</strong> e não sobe — só o
          que foi entendido dele. <strong>Nada é gravado neste passo.</strong> CPF,
          endereço e complemento são descartados na leitura — o sistema não precisa deles.
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
