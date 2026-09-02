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

// ------------------- SENHA FRACA NAO E LOGIN RECUSADO (02/set/2026)
//
// ⚠ ESTA TRAVA EXISTE POR UMA PERGUNTA DO FUNDADOR, feita ANTES de mexer em
// nada: "subir o minimo de senha para 8 nao vai dar problema para quem ja
// cadastrou com 6?".
//
// Dava — e nao pela regra da Supabase. Quando a politica fica mais exigente, o
// `signInWithPassword` devolve `AuthWeakPasswordError` para quem tem senha
// curta, **no campo `error`, embora a sessao TENHA sido criada**. O login
// olhava so `error` e mandava a pessoa de volta com uma mensagem em ingles
// sobre senha fraca. Ela nunca mais entraria, e nada estaria quebrado: a
// politica teria funcionado exatamente como configurada.
//
// ⚠ E A CONDICAO OLHA A SESSAO, nao o nome do erro. Se a sessao existe, a
// pessoa ENTROU — e isso e um fato, nao uma classificacao do provedor que pode
// mudar de versao para versao.
const login = fonte("apps/web/app/login/actions.ts");
verifica(
  "o login distingue senha fraca de credencial errada",
  login.includes("error && data?.session"),
  true,
);
verifica(
  "e quem entrou com senha fraca vai trocar, nao volta para o login",
  login.includes("/definir-senha?fraca=1"),
  true,
);
// ⚠ E A TELA EXPLICA. Tela de senha que aparece do nada e lida como "deu erro".
verifica(
  "a tela diz que a pessoa entrou e que a regra mudou",
  fonte("apps/web/app/definir-senha/page.tsx").includes("Você entrou normalmente"),
  true,
);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
