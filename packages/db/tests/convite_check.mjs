/**
 * O LINK DE CONVITE NÃO PODE MORRER ANTES DE A PESSOA CLICAR.
 *
 * ⚠ O DEFEITO, relatado em 02/set/2026. O sócio do fundador recebeu o convite,
 * abriu e viu "link expirado" — e depois entrou normalmente pelo "esqueci a
 * senha". Ele não demorou: o link já estava morto quando chegou.
 *
 * O token é de USO ÚNICO, e a troca por sessão acontecia num GET. Colar o link
 * num WhatsApp faz o aplicativo BUSCAR a URL para montar a prévia — um GET.
 * O robô da prévia entrava, queimava o token, e sobrava um link morto. Filtro
 * de antivírus e de e-mail corporativo fazem o mesmo.
 *
 * ⚠ E O SINTOMA CULPAVA A PESSOA: "expirado" faz quem recebeu achar que
 * demorou. Numa porta de entrada — o único lugar onde alguém encontra o
 * produto pela primeira vez.
 *
 * A regra que fica: **operação de uso único não acontece num GET.** Robô de
 * prévia não aperta botão.
 *
 *   node packages/db/tests/convite_check.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CR = String.fromCharCode(13);
const fonte = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").split(CR).join("");
const existe = (rel) => fs.existsSync(path.join(ROOT, rel));

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

// ⚠ SE A ROTA VOLTAR, O DEFEITO VOLTA JUNTO. `route.ts` naquele caminho só
// pode responder GET/POST cru — e foi o GET dela que queimava o convite.
verifica(
  "a confirmacao NAO e uma rota de GET",
  existe("apps/web/app/auth/confirmar/route.ts"),
  false,
);
verifica(
  "e sim uma pagina com botao",
  existe("apps/web/app/auth/confirmar/page.tsx"),
  true,
);

const pag = fonte("apps/web/app/auth/confirmar/page.tsx");

// ⚠ A TROCA TEM QUE ESTAR NUMA ACAO DE SERVIDOR, disparada por formulario.
// Se `verifyOtp` voltar para o corpo da pagina, ele roda no carregamento — que
// e exatamente o GET que o robo da previa faz.
verifica("a troca do token acontece numa acao de servidor", pag.includes('"use server"'), true);
verifica("e ela e chamada por um formulario", pag.includes("<form action={confirmar}>"), true);
verifica("a pagina troca o token com verifyOtp", pag.includes("verifyOtp"), true);

// ⚠ O TEXTO DE ERRO NAO PODE ESCOLHER A CAUSA. "Ja foi usado" e "expirou" sao
// coisas diferentes e pedem acoes diferentes: quem clicou duas vezes precisa
// saber que a primeira valeu, e nao que deve pedir outro link.
verifica(
  "o erro descreve as duas causas sem escolher uma",
  pag.includes("ou já foi usado, ou passou da validade"),
  true,
);
verifica(
  "e diz o que fazer em cada caso",
  pag.includes("é só entrar normalmente") && pag.includes("peça um link novo"),
  true,
);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
