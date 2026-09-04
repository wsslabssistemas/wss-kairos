// A PLANILHA QUE MORA NO GOOGLE — ler por link publicado, sem OAuth.
//
// ⚠ POR QUE POR LINK E NÃO POR INTEGRAÇÃO. Pedido do fundador: *"a empresa
// coloca um link público e compartilhado do Google Sheets, a pessoa atualiza a
// planilha e o sistema já reconhece"*. Integração com a conta Google exigiria
// OAuth, tela de consentimento revisada pelo Google e um app verificado — três
// semanas de burocracia para resolver o que um link publicado resolve hoje.
//
// ⚠ E O LINK PUBLICADO É PÚBLICO — quem tiver o endereço lê. Isso é decisão de
// quem publica, e o produto tem que DIZER, não descobrir depois: a tela avisa,
// e a recomendação é publicar só as abas que precisam ser lidas.
//
// ⚠ O QUE ISTO NÃO FAZ: importar sozinho. A planilha muda sozinha, o sistema
// lê quando alguém pede, e a pessoa CONFIRMA o que vai entrar. Importação
// automática de uma fonte que muda sozinha é a receita para o dia em que uma
// coluna trocar de nome e ninguém perceber — e o defeito só aparece no cadastro
// de mil pessoas.

/** Teto do que a gente aceita baixar de uma aba. */
const LIMITE_BYTES = 8 * 1024 * 1024;

export type AbaPublicada = { gid: string; nome: string };

/**
 * Normaliza o que a pessoa colou para a raiz do documento publicado.
 *
 * ⚠ ELA VAI COLAR QUALQUER UMA DAS TRÊS FORMAS, porque o Google mostra as
 * três: `.../pub?output=xlsx`, `.../pubhtml` e `.../pub?gid=0&single=true`.
 * Exigir um formato exato transformaria "cole o link" numa tarefa com erro —
 * e o erro apareceria como "não consegui ler", que não ensina nada.
 */
export function raizDoLinkPublicado(url: string): { ok: true; base: string } | { ok: false; motivo: string } {
  const t = (url ?? "").trim();
  if (!t) return { ok: false, motivo: "Cole o link da planilha publicada." };

  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { ok: false, motivo: "Isso não parece um endereço — cole o link inteiro, começando com https://." };
  }

  if (u.hostname !== "docs.google.com") {
    return { ok: false, motivo: "Por enquanto só planilhas do Google Sheets publicadas na web." };
  }

  // .../spreadsheets/d/e/<id>/pub | pubhtml | ...
  const m = u.pathname.match(/^\/spreadsheets\/d\/e\/([^/]+)\//);
  if (!m) {
    return {
      ok: false,
      motivo:
        "Esse link não é o de uma planilha PUBLICADA. No Google Sheets: Arquivo → Compartilhar → " +
        "Publicar na web → Publicar, e cole o endereço que aparece. O link normal de compartilhamento não serve.",
    };
  }
  return { ok: true, base: `https://docs.google.com/spreadsheets/d/e/${m[1]}` };
}

/**
 * As abas do documento, com nome e `gid`.
 *
 * ⚠ SAI DO HTML PUBLICADO porque não existe outro jeito sem OAuth: a exportação
 * CSV precisa do `gid` de cada aba, e o `gid` só aparece na página. Frágil por
 * natureza — se o Google mudar o HTML, isto para. Por isso a falha é EXPLÍCITA
 * (a tela diz que não conseguiu listar) em vez de devolver lista vazia, que se
 * leria como "a planilha não tem abas".
 */
export async function abasPublicadas(
  base: string,
): Promise<{ ok: true; abas: AbaPublicada[] } | { ok: false; motivo: string }> {
  let html: string;
  try {
    const r = await fetch(`${base}/pubhtml`, { cache: "no-store", redirect: "follow" });
    if (!r.ok) {
      return {
        ok: false,
        motivo:
          r.status === 404
            ? "A planilha não está publicada (ou foi despublicada). Refaça: Arquivo → Compartilhar → Publicar na web."
            : `O Google respondeu ${r.status} ao abrir a planilha.`,
      };
    }
    html = await r.text();
  } catch (e) {
    return { ok: false, motivo: `Não consegui abrir a planilha: ${e instanceof Error ? e.message : String(e)}` };
  }

  // ⚠ O NOME E O `gid` VÊM DO MESMO PAR, e é isso que evita o pior defeito
  // possível aqui: casar o nome de uma aba com o conteúdo de outra e importar
  // recebimento como cadastro. A página traz
  // `{name: "Matrículas", pageUrl: "...&gid=2065839085"}` — e os dois saem
  // juntos ou nenhum sai.
  const abas: AbaPublicada[] = [];
  const re = /\{name: "([^"]+)", pageUrl: "([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const gid = m[2].match(/gid=(\d+)/)?.[1];
    if (gid) abas.push({ gid, nome: decodificar(m[1]).trim() || `aba ${gid}` });
  }

  // Documento de uma aba só não desenha os botões. O `gid` dela aparece nos
  // links de exportação — e sem este ramo o caso mais simples seria o único
  // que não funciona.
  if (abas.length === 0) {
    const gids = [...new Set([...html.matchAll(/gid=(\d+)/g)].map((x) => x[1]))];
    for (const g of gids) abas.push({ gid: g, nome: `aba ${g}` });
  }

  if (abas.length === 0) {
    return { ok: false, motivo: "Abri a planilha e não encontrei nenhuma aba publicada." };
  }
  return { ok: true, abas };
}

/**
 * O conteúdo de UMA aba, em CSV.
 *
 * ⚠ O TETO EXISTE PORQUE JÁ ESTOUROU UMA VEZ. Em ago/2026 a sincronização
 * morreu com um corpo de 4,2 MB — limite de plataforma que se apresentou como
 * silêncio. Aqui o corte é declarado e a mensagem diz o tamanho, para ninguém
 * gastar meia hora procurando defeito onde há limite.
 */
export async function csvDaAba(
  base: string,
  gid: string,
): Promise<{ ok: true; csv: string } | { ok: false; motivo: string }> {
  try {
    const r = await fetch(`${base}/pub?gid=${encodeURIComponent(gid)}&single=true&output=csv`, {
      cache: "no-store",
      redirect: "follow",
    });
    if (!r.ok) return { ok: false, motivo: `O Google respondeu ${r.status} ao baixar esta aba.` };

    const tamanho = Number(r.headers.get("content-length") ?? 0);
    if (tamanho > LIMITE_BYTES) {
      return { ok: false, motivo: `Esta aba tem ${(tamanho / 1048576).toFixed(1)} MB — o teto de leitura é 8 MB.` };
    }

    const csv = await r.text();
    if (csv.length > LIMITE_BYTES) {
      return { ok: false, motivo: `Esta aba passou de 8 MB depois de baixada (${(csv.length / 1048576).toFixed(1)} MB).` };
    }
    if (!csv.trim()) return { ok: false, motivo: "Esta aba veio vazia." };
    return { ok: true, csv };
  } catch (e) {
    return { ok: false, motivo: `Não consegui baixar esta aba: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** As poucas entidades HTML que aparecem em nome de aba. */
function decodificar(t: string): string {
  return t
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
