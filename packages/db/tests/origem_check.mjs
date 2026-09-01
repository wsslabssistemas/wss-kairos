/**
 * DE ONDE A PESSOA VEIO — e o acordo entre o que o código GRAVA e o que o
 * manifesto DECLARA.
 *
 * ⚠ POR QUE ISTO EXISTE. Em 31/ago o webhook passou a gravar `source = "site"`
 * quando a primeira mensagem trazia a marca do link do site novo. Um dia
 * depois, ao acrescentar Instagram e Facebook, descobri que **`site` não estava
 * em `lead_sources` de 8 dos 15 manifestos — inclusive o da academia**, que é
 * o único cliente em operação. E `facebook` faltava em quase todos.
 *
 * O `CLAUDE.md` diz que toda dimensão de análise é enum, nunca texto livre.
 * Gravar uma origem que o segmento não declara quebra isso de um jeito que não
 * dá erro nenhum: o valor entra no banco, some do seletor da ficha (porque o
 * seletor é montado do manifesto), e nos relatórios ele vira uma fatia órfã ao
 * lado das fatias que somam.
 *
 * ⚠ E A CAUSA É ESTRUTURAL, não descuido: o NÚCLEO é quem grava a origem, e o
 * núcleo não pode conhecer segmento (Lei 1). Então tudo que ele sabe gravar
 * precisa valer para TODOS os ramos — site, Instagram e Facebook são canais de
 * chegada, não vocabulário de mercado. Toda empresa pode ter os três.
 *
 * Este teste é o acordo escrito: origem nova no código obriga a declará-la em
 * todo manifesto, e a falha diz exatamente onde falta.
 *
 *   node packages/db/tests/origem_check.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { MARCADORES } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/origem-site.ts")).href
);

const CR = String.fromCharCode(13);
const fonte = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").split(CR).join("");

/**
 * O arquivo SEM comentário — para as verificações de "isto NÃO pode existir".
 *
 * ⚠ Os comentários deste projeto CITAM o defeito que descrevem, e a linha que
 * explica por que `campanha meta` saiu contém a própria expressão proibida.
 * Sem tirar comentário, a trava acusaria a explicação dela — e a saída fácil
 * seria apagar a explicação, que é justamente o que não pode acontecer.
 */
const codigo = (rel) =>
  fonte(rel)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

// ---------------------------------------------------------------- as origens
// O que o núcleo sabe gravar: as dos marcadores, mais as duas que o webhook
// escreve direto — `whatsapp` (o meio, quando nada mais se sabe) e `campanha`
// (quando a Meta manda o bloco do anúncio).
const DO_CODIGO = [...new Set([...MARCADORES.map((m) => m.origem), "whatsapp", "campanha"])].sort();

const rota = codigo("apps/web/app/api/[[...route]]/route.ts");
// ⚠ "campanha meta" NÃO É UMA ORIGEM DECLARADA por manifesto nenhum. Ela ficou
// no código de agosto até 01/set sem nunca ter sido gravada — não houve lead
// de anúncio ainda. QUAL anúncio trouxe a pessoa segue em `custom.anuncio_*`.
verifica("o webhook nao grava a origem nao declarada 'campanha meta'", rota.includes('"campanha meta"'), false);

// ------------------------------------------------- todos os manifestos
const dir = path.join(ROOT, "packages/skills");
const ramos = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "manifest.yaml")));
verifica("todos os segmentos foram encontrados", ramos.length >= 15, true);

for (const ramo of ramos) {
  const t = fonte(`packages/skills/${ramo}/manifest.yaml`);
  const m = /lead_sources:\n((?:[ \t]+- .*\n)+)/.exec(t);
  if (!m) {
    falhas++;
    console.log(`FALHA  ${ramo}: nao declara lead_sources`);
    continue;
  }
  const declaradas = m[1]
    .trim()
    .split("\n")
    .map((l) => l.trim().replace(/^-\s*/, "").replace(/^["']|["']$/g, "").trim());
  const faltando = DO_CODIGO.filter((o) => !declaradas.includes(o));
  verifica(`${ramo} declara toda origem que o codigo grava`, faltando, []);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : `\ntudo certo — ${DO_CODIGO.join(", ")}`);
process.exit(falhas ? 1 : 0);
