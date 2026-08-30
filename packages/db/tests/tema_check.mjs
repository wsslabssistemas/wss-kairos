/**
 * O TEMA CLARO E O ESCURO PRECISAM DEFINIR OS MESMOS NOMES.
 *
 * ⚠ O DEFEITO QUE ESTA TRAVA IMPEDE, e ele e silencioso como todos os outros
 * daqui: uma cor definida SO dentro de `@media (prefers-color-scheme: dark)`
 * ou so dentro de `[data-theme]` nao existe no estado sem marcacao — que e o
 * estado da MAIORIA das pessoas, porque quase ninguem troca o tema do sistema.
 * O resultado nao e erro: e texto de um tema sobre fundo do outro, ilegivel,
 * numa tela que passou no build e no typecheck.
 *
 * ⚠ E ELE SO APARECE PARA QUEM ABRE. Nao ha log, nao ha excecao, nao ha teste
 * de unidade que perceba. Foi por isso que o tema claro nasceu junto com esta
 * verificacao, em 29/ago/2026, e nao depois.
 *
 * A regra: TODO token declarado num bloco de tema precisa existir tambem no
 * `:root` base. O `:root` e a definicao completa; os outros blocos so
 * REDEFINEM. Nome que aparece so no escuro fica indefinido no claro.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// ⚠ NORMALIZA CRLF: os arquivos aqui estao em CRLF e o CI roda em LF.
const css = fs.readFileSync(path.join(ROOT, "apps/web/app/globals.css"), "utf8").replace(/\r\n/g, "\n");

let falhas = 0;
const verifica = (nome, ok, detalhe = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok && detalhe) console.log(`        ${detalhe}`);
};

/** Os tokens declarados dentro de um bloco, dado o texto do bloco. */
const tokensDe = (texto) =>
  new Set([...texto.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));

/** Recorta o corpo de um seletor, contando chaves. */
function corpoDe(alvo) {
  const i = css.indexOf(alvo);
  if (i < 0) return null;
  let j = css.indexOf("{", i), nivel = 0, k = j;
  for (; k < css.length; k++) {
    if (css[k] === "{") nivel++;
    else if (css[k] === "}") { nivel--; if (nivel === 0) break; }
  }
  return css.slice(j + 1, k);
}

const base = corpoDe(":root {");
verifica("existe o bloco :root base", !!base);
const claro = tokensDe(base ?? "");

const escuroSistema = corpoDe(':root:not([data-theme="light"])');
verifica("existe o bloco do escuro por preferencia do sistema", !!escuroSistema);

const escuroEscolhido = corpoDe(':root[data-theme="dark"]');
verifica("existe o bloco do escuro escolhido a dedo", !!escuroEscolhido);

// ⚠ OS TRES ESTADOS. Sem o bloco do sistema, quem nunca escolheu tema (a
// maioria) ve o claro mesmo com o computador no escuro. Sem o bloco do
// `[data-theme]`, a escolha da pessoa nao ganha do sistema operacional dela.
for (const [rot, corpo] of [
  ["escuro do sistema", escuroSistema],
  ["escuro escolhido", escuroEscolhido],
]) {
  const faltando = [...tokensDe(corpo ?? "")].filter((t) => !claro.has(t));
  verifica(
    `todo token do ${rot} existe tambem no :root`,
    faltando.length === 0,
    `sem definicao no tema claro: ${faltando.join(", ")}`,
  );
}

// ⚠ E O CONTRARIO TAMBEM IMPORTA, mas com tolerancia: o claro pode ter tokens
// que o escuro herda sem mudar (forma, ritmo, a tinta sobre o gradiente). O
// que NAO pode e uma COR do claro ficar sem par no escuro — ai o escuro herda
// uma cor pensada para fundo branco.
const CORES = /(bg|surface|border|text|brand|warn|danger|success|shadow|ring)/;
const semParNoEscuro = [...claro].filter(
  (t) => CORES.test(t) && !tokensDe(escuroEscolhido ?? "").has(t) && t !== "--on-brand" && t !== "--brand-gradient",
);
verifica(
  "toda cor do claro tem par no escuro",
  semParNoEscuro.length === 0,
  `herdariam cor de fundo branco: ${semParNoEscuro.join(", ")}`,
);

// ⚠ `color-scheme` PRECISA ACOMPANHAR. E ele que faz a barra de rolagem, o
// campo de formulario nativo e o `input type=date` do navegador virarem
// escuros junto. Sem ele o tema fica certo no nosso CSS e errado nos controles
// que o navegador desenha — e ninguem procura ali.
verifica("o :root declara color-scheme", /color-scheme:\s*light/.test(base ?? ""));
verifica("o escuro tambem declara color-scheme", /color-scheme:\s*dark/.test(escuroEscolhido ?? ""));

// ⚠ INTER NAO VOLTA. Ela e o default de todo painel SaaS — o sistema de design
// do concorrente lista "Inter como font family" como anti-padrao numero 1, e os
// guias de 2026 a citam como a escolha generica. Voltar a ela e desfazer a
// unica coisa que a tipografia diz sobre nos.
const layout = fs.readFileSync(path.join(ROOT, "apps/web/app/layout.tsx"), "utf8").replace(/\r\n/g, "\n");
verifica("o layout nao usa Inter", !/from "next\/font\/google"[\s\S]{0,120}\bInter\b/.test(layout));
verifica("e declara as duas familias escolhidas", /Archivo/.test(layout) && /Sora/.test(layout));

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
