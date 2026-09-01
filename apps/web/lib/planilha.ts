// O LEITOR DA PLANILHA — transforma uma aba em linhas comparáveis.
//
// Sem rede: recebe o TEXTO do CSV e devolve estrutura. Quem busca é o
// chamador, e isso é de propósito — os dois caminhos de acesso decididos em
// 13/ago (conta de serviço ou CSV exportado à mão) entregam o mesmo texto, e
// nenhum deles precisa mudar uma linha daqui.
//
// ⚠ O QUE ESTE ARQUIVO NÃO FAZ: aplicar nada. Ele lê e DECLARA O QUE
// ENTENDEU. A aplicação é `lib/sincronizacao.ts`, que compara com o banco e
// bloqueia quando a fonte não é confiável.
//
// A REGRA QUE GOVERNA O ARQUIVO: **planilha lida errado em silêncio é pior
// que planilha não lida.** Este repositório já pagou por isso três vezes — o
// `;` perdido que sumiu com 3 entradas do seed da barbearia, o carregador que
// lia só o último `values`, e o PostgREST cortando em 1.000 linhas sem avisar.
// Todas se apresentaram como sucesso. Por isso `ler()` devolve o que
// reconheceu, o que ignorou e por quê — e nunca adivinha a chave.

import { parseCsv, parseDataBR, detectColumns } from "./csv.ts";
import type { LinhaDaFonte } from "./sincronizacao.ts";

/**
 * ⚠ O ARQUIVO `.xls` DA ACADEMIA É HTML.
 *
 * O relatório "Recebimentos Detalhados" sai com extensão `.xls` e por dentro é
 * uma `<table>` HTML. O Excel abre por gentileza, não porque o arquivo está
 * certo — e um leitor de XLS de verdade recusaria.
 *
 * É a MESMA classe já registrada no `BE_FITNESS_CHECKLIST.md`: *"o botão
 * exportar CSV do sistema devolve PDF"*. O sistema da academia mente a
 * extensão em pelo menos dois relatórios, então detectar pelo CONTEÚDO e não
 * pelo nome é regra aqui, não exceção.
 */
function pareceHtml(texto: string): boolean {
  const inicio = texto.slice(0, 2000).toLowerCase();
  return inicio.includes("<table") || inicio.includes("<tr");
}

/** Extrai a primeira tabela HTML como matriz, do jeito que `parseCsv` devolveria. */
function lerTabelaHtml(texto: string): string[][] {
  const linhas: string[][] = [];
  const trs = texto.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const tr of trs) {
    const celulas = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((c) =>
      desescapar(c.replace(/<[^>]+>/g, "")).trim(),
    );
    if (celulas.some((c) => c !== "")) linhas.push(celulas);
  }
  return linhas;
}

/** As entidades que aparecem nesta exportação. Sem dependência externa. */
function desescapar(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Lê CSV ou tabela HTML — decidido pelo CONTEÚDO, nunca pela extensão. */
export function linhasDe(texto: string): string[][] {
  return pareceHtml(texto) ? lerTabelaHtml(texto) : parseCsv(texto);
}

/** Cabeçalhos que servem como CHAVE de reconciliação, em ordem de confiança. */
const CHAVE_H = ["codigo", "código", "cod", "matricula", "matrícula", "id", "registro"];

/**
 * Cabeçalhos que dizem O NOME DO PLANO.
 *
 * ⚠ Esta coluna existia na exportação desde sempre e era ignorada. Ela é o que
 * separa um contrato de um "Treino Avulso" (gente de passagem) e de uma
 * "Semana FREE" — e sem ela os três viram a mesma coisa. Ver `lib/planos.ts`.
 */
const PLANO_H = ["plano", "produto", "servico", "serviço", "modalidade", "contrato"];

/** Cabeçalhos que dizem o CICLO do plano — é o que separa renovação de ajuste. */
const CICLO_H = ["meses", "periodicidade", "ciclo", "duracao", "duração"];

/**
 * Cabeçalhos que dizem quando o contrato COMEÇOU.
 *
 * ⚠ Não confundir com a data de cadastro. "Inclusao" fica de fora de
 * propósito: é quando a linha foi digitada no sistema da academia, não quando
 * o contrato passou a valer — e usar uma pela outra faria a régua de renovação
 * medir a partir do dia errado.
 */
const INICIO_H = ["inicio", "início", "inicio-vigencia", "data-inicio", "vigencia-de"];
const CICLO_PALAVRA: Record<string, number> = {
  mensal: 30, bimestral: 60, trimestral: 90, quadrimestral: 120,
  semestral: 180, anual: 365, bianual: 730,
};

function cicloEmDias(v: string): number | null {
  const t = strip(v);
  if (!t) return null;
  if (CICLO_PALAVRA[t]) return CICLO_PALAVRA[t];
  const n = Number(t.replace(/[^0-9]/g, ""));
  // Número puro nesta coluna é MÊS (a planilha da academia traz "12", "6").
  return Number.isFinite(n) && n > 0 && n <= 60 ? n * 30 : null;
}

const strip = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const soDigitos = (s: string) => (s ?? "").replace(/\D/g, "");

export type Leitura = {
  linhas: LinhaDaFonte[];
  /** O que o leitor entendeu — vai para a tela ANTES de qualquer aplicação. */
  entendeu: {
    chave: string;
    nome: string | null;
    vigencia: string | null;
    /** Total de linhas de dado (fora o cabeçalho). */
    lidas: number;
  };
  /** Linhas descartadas, com o motivo. Nunca em silêncio. */
  ignoradas: { linha: number; motivo: string }[];
  /** Impede o uso da aba. Preenchido = não dá para comparar. */
  erro: string | null;
};

/**
 * Lê uma aba.
 *
 * `exigeVigencia` separa os dois tipos de aba do fundador: `Matriculas` tem
 * vigência e alimenta a comparação de contratos; `Cadastros` e as de convênio
 * não têm, e servem para cruzamento e prospecção. Pedir vigência de todas
 * faria as três abas de cadastro falharem por um campo que elas não deviam
 * mesmo ter.
 */
export function ler(csv: string, opts: { exigeVigencia?: boolean } = {}): Leitura {
  const linhas = linhasDe(csv);
  if (linhas.length < 2) {
    return {
      linhas: [], ignoradas: [], erro: "A aba veio vazia ou só com cabeçalho.",
      entendeu: { chave: "—", nome: null, vigencia: null, lidas: 0 },
    };
  }

  const cab = linhas[0];
  const h = cab.map(strip);
  const det = detectColumns(cab);
  const iCiclo = h.findIndex((c) => CICLO_H.some((k) => c === k || c.startsWith(k)));
  // O NOME do plano, cru. Quem classifica é `lib/planos.ts`, com a lista do
  // manifesto do segmento — este arquivo não pode conhecer "Treino Avulso".
  const iPlano = h.findIndex((c) => PLANO_H.some((k) => c === k || c.startsWith(k)));
  // IGUALDADE EXATA, nao `startsWith`: "Inicio" e "Data-de-Inclusao" sao
  // colunas diferentes, e casar por prefixo faria a regua de renovacao medir a
  // partir do dia em que alguem digitou a linha, nao de quando o contrato
  // passou a valer.
  const iInicio = h.findIndex((c) => INICIO_H.includes(c));

  // ⚠ A CHAVE NUNCA É ADIVINHADA.
  //
  // Nome e telefone o detector pode chutar pela posição, porque errar ali
  // produz um cadastro torto que alguém vê. Errar a CHAVE é outra classe: a
  // comparação casaria pessoa errada com pessoa errada e o histórico sairia
  // trocado — em silêncio, e sem jeito de descobrir depois. Então ou existe
  // coluna de código, ou o telefone assume o papel explicitamente, ou para.
  const iChave = h.findIndex((c) => CHAVE_H.some((k) => c === k || c.startsWith(k)));
  const usaTelefone = iChave < 0 && det.phoneIdx >= 0 && !det.adivinhou.telefone;
  if (iChave < 0 && !usaTelefone) {
    return {
      linhas: [], ignoradas: [],
      erro:
        "Não achei coluna de código nem de telefone com cabeçalho reconhecível. " +
        "A comparação precisa de uma chave estável para não trocar o histórico de uma pessoa pelo de outra — " +
        `renomeie uma coluna para "Código" (ou "Matrícula") e tente de novo. Cabeçalhos lidos: ${cab.join(" | ")}`,
      entendeu: { chave: "—", nome: null, vigencia: null, lidas: 0 },
    };
  }

  if (opts.exigeVigencia && det.endIdx < 0) {
    return {
      linhas: [], ignoradas: [],
      erro:
        "Esta aba deveria ter a data de VENCIMENTO do contrato e eu não achei a coluna. " +
        "Sem ela não dá para saber quem renovou nem quem está a vencer — e deduzir seria inventar. " +
        `Cabeçalhos lidos: ${cab.join(" | ")}`,
      entendeu: { chave: "—", nome: null, vigencia: null, lidas: 0 },
    };
  }

  const out: LinhaDaFonte[] = [];
  const ignoradas: { linha: number; motivo: string }[] = [];
  const vistas = new Set<string>();

  for (let i = 1; i < linhas.length; i++) {
    const r = linhas[i];
    const bruta = iChave >= 0 ? (r[iChave] ?? "") : (r[det.phoneIdx] ?? "");
    // Código costuma vir com zero à esquerda, espaço ou apóstrofo do Excel.
    const chave = usaTelefone ? soDigitos(bruta) : bruta.trim().replace(/^'/, "");
    if (!chave) { ignoradas.push({ linha: i + 1, motivo: "sem chave (código/telefone vazio)" }); continue; }

    // ⚠ CHAVE REPETIDA NÃO É DESCARTE SILENCIOSO.
    //
    // A planilha da academia é um LOG: a mesma pessoa aparece uma vez por
    // contrato. Para vigência vale o contrato de MAIOR data de fim — e ficar
    // com a primeira linha encontrada daria o contrato ANTIGO como verdade,
    // que é exatamente o defeito da Maria Isabel reintroduzido pela porta dos
    // fundos.
    const vigencia = det.endIdx >= 0 ? parseDataBR(r[det.endIdx] ?? "") : null;
    const inicio = iInicio >= 0 ? parseDataBR(r[iInicio] ?? "") : null;
    if (vistas.has(chave)) {
      const ja = out.find((l) => l.chave === chave)!;
      if (vigencia && (!ja.vigencia_ate || vigencia > ja.vigencia_ate)) {
        ja.vigencia_ate = vigencia;
        // O inicio acompanha o fim: sao do MESMO contrato. Guardar o fim de um
        // com o inicio de outro daria um contrato que nunca existiu, e a regua
        // mediria a fracao decorrida de uma coisa imaginaria.
        ja.vigencia_de = inicio;
        ignoradas.push({ linha: i + 1, motivo: `chave ${chave} repetida — ficou a vigência mais longa (${vigencia})` });
      } else {
        ignoradas.push({ linha: i + 1, motivo: `chave ${chave} repetida — vigência igual ou mais curta, descartada` });
      }
      continue;
    }

    vistas.add(chave);
    out.push({
      chave,
      nome: (r[det.nameIdx] ?? "").trim() || null,
      vigencia_ate: vigencia,
      vigencia_de: inicio,
      ciclo_dias: iCiclo >= 0 ? cicloEmDias(r[iCiclo] ?? "") : null,
      plano: iPlano >= 0 ? (r[iPlano] ?? "").trim() || null : null,
    });
  }

  return {
    linhas: out,
    ignoradas,
    erro: null,
    entendeu: {
      chave: iChave >= 0 ? (cab[iChave] ?? "").trim() : `${det.phoneLabel} (telefone, na falta de código)`,
      nome: det.adivinhou.nome ? null : (cab[det.nameIdx] ?? "").trim(),
      vigencia: det.endIdx >= 0 ? (cab[det.endIdx] ?? "").trim() : null,
      lidas: linhas.length - 1,
    },
  };
}

// =====================================================================
// RECEBIMENTOS — o que a pessoa PAGOU, e como ela costuma pagar.
// =====================================================================

/** O que o sistema guarda de cada pagante. CPF e endereço NÃO entram. */
export type Pagante = {
  chave: string;
  nome: string | null;
  /**
   * O CANAL. Entra, e o CPF não — e a diferença não é de sensibilidade, é de
   * uso: o produto existe para decidir com quem falar e o que dizer, e sem
   * telefone não se fala com ninguém. CPF não serve para nada aqui.
   *
   * ⚠ ELE NÃO ERA LIDO, e a falta quase virou um número falso no relatório.
   * O diagnóstico de ex-alunos anunciou "1.200 sem telefone" — plausível,
   * alarmante e mentira: o relatório TEM `Celular` e `Telefone-1-ou-2`, e
   * quem não lia era este arquivo. Só apareceu porque os cabeçalhos foram
   * conferidos antes de a conclusão ser reportada.
   *
   * `Celular` vem primeiro: é o número de WhatsApp, e o fixo não recebe
   * mensagem.
   */
  telefone: string | null;
  /** Quantos pagamentos, no total do histórico. */
  pagamentos: number;
  /** Soma em centavos. Inteiro, nunca float — ver `lib/money.ts`. */
  totalCents: number;
  /** ISO do pagamento mais recente. */
  ultimoPagamento: string | null;
  /** ISO do vencimento mais recente pago. */
  ultimoVencimento: string | null;
  /**
   * ⚠ O ATRASO HABITUAL DESTA PESSOA — mediana de (pagamento − vencimento).
   *
   * É o achado do arquivo real (13/ago) e muda o que "atraso" significa.
   * Maria Isabel Ferreira Garcia paga com 3 a 7 dias de atraso **desde 2025**,
   * todas as vezes, e sempre paga: 15/02 para vencimento 10/02, 12/08 para
   * 11/08, 18/02 para 11/02, 13/08 para 10/08. Cobrar essa cliente no
   * primeiro dia seria perseguir quem paga há três anos.
   *
   * Na base inteira: de 756 pessoas com 3+ pagamentos, **575 pagam em dia**,
   * 96 atrasam de 1 a 3 dias, 60 de 4 a 10, e 25 mais de 10. Um dia de atraso
   * em quem sempre paga adiantado é sinal; em quem sempre atrasa três, é ruído.
   *
   * `null` com menos de 3 pagamentos: duas observações não fazem um hábito, e
   * declarar hábito com n=2 é o mesmo erro do ranking de escolas.
   */
  atrasoHabitualDias: number | null;
};

/** Cabeçalhos do relatório de recebimentos. */
const REC_H = {
  chave: ["codigo", "código"],
  nome: ["nome-ou-razao-social", "nome", "nome-completo"],
  venc: ["vencimento"],
  pag: ["pagamento", "data-de-pagamento"],
  valor: ["valor"],
  recibo: ["codigo-do-recebimento", "recibo"],
  // Ordem de preferência: celular recebe mensagem, fixo não.
  celular: ["celular"],
  telefone: ["telefone-1-ou-2", "telefone-1", "telefone"],
};

/**
 * ⚠ COLUNAS QUE NUNCA ENTRAM, por decisão — não por esquecimento.
 *
 * O relatório traz `CPF-ou-CNPJ`, `Endereco`, `Numero` e `Complemento`. Junto
 * com nome e telefone isso é kit de identidade completo, e **o sistema não
 * precisa de nada disso para o que ele faz**: ele decide com quem falar e o
 * que dizer, não emite nota nem cobra.
 *
 * Guardar dado sensível sem uso cria responsabilidade com zero benefício —
 * então o descarte é na PORTA, antes de qualquer gravação, e está aqui em
 * cima para quem for mexer ver primeiro.
 */
export const DESCARTADAS = ["cpf-ou-cnpj", "cpf", "cnpj", "endereco", "endereço", "numero", "número", "complemento"];

const acha = (h: string[], nomes: string[]) =>
  h.findIndex((c) => nomes.some((n) => c === n || c.startsWith(n)));

const brlParaCents = (v: string): number => {
  const t = (v ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export type LeituraRecebimentos = {
  pagantes: Pagante[];
  entendeu: { chave: string; vencimento: string; pagamento: string; valor: string; lidas: number };
  descartadas: string[];
  ignoradas: { linha: number; motivo: string }[];
  erro: string | null;
};

export function lerRecebimentos(texto: string): LeituraRecebimentos {
  const linhas = linhasDe(texto);
  const vazio = {
    pagantes: [], descartadas: [], ignoradas: [],
    entendeu: { chave: "—", vencimento: "—", pagamento: "—", valor: "—", lidas: 0 },
  };
  if (linhas.length < 2) return { ...vazio, erro: "O relatório veio vazio ou só com cabeçalho." };

  const cab = linhas[0];
  const h = cab.map(strip);
  const i = {
    chave: acha(h, REC_H.chave), nome: acha(h, REC_H.nome), venc: acha(h, REC_H.venc),
    pag: acha(h, REC_H.pag), valor: acha(h, REC_H.valor), recibo: acha(h, REC_H.recibo),
    celular: acha(h, REC_H.celular), telefone: acha(h, REC_H.telefone),
  };
  if (i.chave < 0 || i.pag < 0 || i.valor < 0) {
    return {
      ...vazio,
      erro:
        "Não achei as colunas mínimas do relatório de recebimentos (código, pagamento e valor). " +
        `Cabeçalhos lidos: ${cab.join(" | ")}`,
    };
  }

  const porPessoa = new Map<string, { nome: string | null; telefone: string | null; pags: string[]; vencs: (string | null)[]; cents: number; recibos: Set<string> }>();
  const ignoradas: { linha: number; motivo: string }[] = [];

  for (let n = 1; n < linhas.length; n++) {
    const r = linhas[n];
    const chave = (r[i.chave] ?? "").trim();
    if (!chave) { ignoradas.push({ linha: n + 1, motivo: "sem código" }); continue; }
    const pago = parseDataBR(r[i.pag] ?? "");
    if (!pago) { ignoradas.push({ linha: n + 1, motivo: "sem data de pagamento — parcela em aberto ou linha de total" }); continue; }

    const cur = porPessoa.get(chave) ?? { nome: null, telefone: null, pags: [], vencs: [], cents: 0, recibos: new Set<string>() };
    // RECIBO REPETIDO NÃO SOMA DUAS VEZES. No arquivo real são 7.991 linhas
    // para 7.648 recibos distintos — pagamento dividido compartilha o mesmo
    // número, e somar de novo inflaria o faturamento em silêncio.
    const recibo = i.recibo >= 0 ? (r[i.recibo] ?? "").trim() : "";
    if (recibo && cur.recibos.has(recibo)) {
      ignoradas.push({ linha: n + 1, motivo: `recibo ${recibo} repetido — valor não somado de novo` });
    } else {
      if (recibo) cur.recibos.add(recibo);
      cur.cents += brlParaCents(r[i.valor] ?? "");
    }
    cur.nome = cur.nome ?? ((i.nome >= 0 ? (r[i.nome] ?? "").trim() : "") || null);
    // A mesma pessoa aparece numa linha por parcela e nem toda linha traz o
    // número. Fica o PRIMEIRO que aparecer preenchido, com o celular na frente.
    cur.telefone = cur.telefone
      ?? ((i.celular >= 0 ? (r[i.celular] ?? "").trim() : "") || null)
      ?? null;
    if (!cur.telefone && i.telefone >= 0) cur.telefone = (r[i.telefone] ?? "").trim() || null;
    cur.pags.push(pago);
    cur.vencs.push(i.venc >= 0 ? parseDataBR(r[i.venc] ?? "") : null);
    porPessoa.set(chave, cur);
  }

  const mediana = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };

  const pagantes: Pagante[] = [...porPessoa.entries()].map(([chave, v]) => {
    const atrasos = v.pags
      .map((p, k) => (v.vencs[k] ? Math.round((Date.parse(p) - Date.parse(v.vencs[k]!)) / 86400000) : null))
      .filter((x): x is number => x !== null);
    const ordenados = [...v.pags].sort();
    const idxUltimo = v.pags.indexOf(ordenados[ordenados.length - 1]);
    return {
      chave,
      nome: v.nome,
      telefone: v.telefone,
      pagamentos: v.pags.length,
      totalCents: v.cents,
      ultimoPagamento: ordenados[ordenados.length - 1] ?? null,
      ultimoVencimento: idxUltimo >= 0 ? v.vencs[idxUltimo] ?? null : null,
      // Três é o piso: duas observações não fazem um hábito.
      atrasoHabitualDias: atrasos.length >= 3 ? mediana(atrasos) : null,
    };
  });

  return {
    pagantes,
    ignoradas,
    erro: null,
    descartadas: cab.filter((c) => DESCARTADAS.includes(strip(c))),
    entendeu: {
      chave: (cab[i.chave] ?? "").trim(),
      vencimento: i.venc >= 0 ? (cab[i.venc] ?? "").trim() : "(ausente)",
      pagamento: (cab[i.pag] ?? "").trim(),
      valor: (cab[i.valor] ?? "").trim(),
      lidas: linhas.length - 1,
    },
  };
}

// ---------------------------------------------------------------------------
// QUE ARQUIVO É ESTE — a pergunta que o sistema fazia para a pessoa errada.
//
// ⚠ O PROBLEMA, dito pelo fundador em 01/set/2026: *"o sistema da Be Fitness é
// tão ruim que não tenho todas as informações em apenas uma planilha, sempre
// fico com dúvida do tipo de importação que devo fazer"*.
//
// A tela de sincronização tinha duas caixas rotuladas — "Matrículas" e
// "Recebimentos" — e exigia que ele soubesse qual arquivo era qual ANTES de
// qualquer leitura. Só que quem sabe isso é o conteúdo do arquivo, não a
// pessoa: os nomes que o sistema da academia exporta não batem com os nossos,
// e a mesma exportação já veio com 304 e com 362 linhas em dias diferentes.
//
// **Era o produto delegando a quem opera uma decisão que ele mesmo consegue
// tomar** — e errar essa decisão não dá erro: dá uma comparação silenciosa
// entre coisas diferentes.
//
// ⚠ E A IDENTIFICAÇÃO NÃO REIMPLEMENTA NADA. Ela roda os DOIS leitores de
// verdade e observa qual aceitou o arquivo. Uma lista própria de cabeçalhos
// aqui seria uma segunda versão da regra, divergindo em silêncio da primeira
// no dia em que alguém mexesse num leitor só — o defeito que este repositório
// documenta em cinco lugares diferentes.
//
// ⚠ E ELA PROPÕE, NUNCA DECIDE SOZINHA. A tela mostra o que entendeu e de
// onde tirou isso; quem confirma é gente. Identificação errada aplicada em
// silêncio seria trocar a dúvida honesta do fundador por uma certeza falsa.
// ---------------------------------------------------------------------------

export type TipoDePlanilha = "matriculas" | "recebimentos" | "desconhecido";

export type Identificacao = {
  tipo: TipoDePlanilha;
  /** A frase que vai para a tela, dizendo o que decidiu. */
  porque: string;
  /** Os cabeçalhos lidos — é o que a pessoa reconhece do arquivo dela. */
  cabecalhos: string[];
  /** Quantas linhas de dado o leitor vencedor aproveitou. */
  aproveitadas: number;
  /**
   * Os DOIS leitores aceitaram. Não impede nada — só faz a tela mostrar a
   * escolha em aberto, em vez de esconder que houve dúvida.
   */
  ambiguo: boolean;
};

/**
 * Descobre se o arquivo é a relação de matrículas ou o relatório de
 * recebimentos, rodando os leitores de verdade.
 *
 * ⚠ RECEBIMENTOS GANHA O EMPATE, e não é arbitrário: aquele leitor exige
 * código + data de pagamento + valor na mesma linha, e essas três colunas só
 * aparecem juntas num relatório financeiro. A relação de matrículas passa no
 * leitor de matrículas E quase passa no de recebimentos, porque os dois
 * começam com código e nome — a assimetria de exigência é o que desempata.
 */
export function identificarPlanilha(texto: string): Identificacao {
  const linhas = linhasDe(texto);
  const cabecalhos = linhas[0] ?? [];

  const rec = lerRecebimentos(texto);
  const mat = ler(texto);

  const recOk = !rec.erro && rec.pagantes.length > 0;
  const matOk = !mat.erro && mat.linhas.length > 0;

  if (recOk) {
    return {
      tipo: "recebimentos",
      porque:
        `Isto é o relatório de RECEBIMENTOS: achei as colunas de ` +
        `${rec.entendeu.chave}, ${rec.entendeu.pagamento} e ${rec.entendeu.valor}, ` +
        `e li ${rec.pagantes.length} pessoa(s) que já pagaram.`,
      cabecalhos,
      aproveitadas: rec.pagantes.length,
      ambiguo: matOk,
    };
  }

  if (matOk) {
    const temVigencia = mat.entendeu.vigencia && mat.entendeu.vigencia !== "—";
    return {
      tipo: "matriculas",
      porque:
        `Isto é a relação de MATRÍCULAS: a chave é ${mat.entendeu.chave}` +
        (temVigencia ? `, a vigência vem de ${mat.entendeu.vigencia}` : ", e ela não traz vigência") +
        `, e li ${mat.linhas.length} pessoa(s).`,
      cabecalhos,
      ambiguo: false,
      aproveitadas: mat.linhas.length,
    };
  }

  // ⚠ NENHUM ACEITOU: a tela mostra POR QUE cada um recusou e os cabeçalhos
  // lidos. É o que transforma "não deu certo" em "faltou a coluna X" — e o
  // fundador reconhece o arquivo dele pelos cabeçalhos, não pelo nosso jargão.
  const motivos = [rec.erro, mat.erro].filter(Boolean).join(" / ");
  return {
    tipo: "desconhecido",
    porque:
      `Não reconheci este arquivo. ${motivos || "Ele veio vazio ou só com cabeçalho."} ` +
      `Se ele for de um relatório que o sistema ainda não conhece, mande do jeito que está — ` +
      `o cabeçalho acima é o que preciso ver para ensinar o sistema a ler.`,
    cabecalhos,
    aproveitadas: 0,
    ambiguo: false,
  };
}
