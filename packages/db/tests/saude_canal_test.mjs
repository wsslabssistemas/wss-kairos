/**
 * O VIGIA QUE PERGUNTA — responder nao e estar bem.
 *
 * ⚠ POR QUE ESTA PECA EXISTE. Todo alarme deste produto depende de EVENTO, e
 * evento emudece exatamente quando o transporte morre: assinatura desativada
 * pela Meta, token vencido, numero restringido. Em nenhum desses casos chega
 * nada — e "nenhuma mensagem hoje" fica identico a "canal fora do ar".
 *
 * ⚠ E E A MESMA CLASSE DO AGENDADOR QUE PULOU (0066/0067), na peca que ficou
 * descoberta. Fechamos o silencio de quem DISPARA e deixamos aberto o de quem
 * RECEBE — e o de receber e pior: mensagem que nao sai vira reclamacao de
 * dentro de casa; mensagem que nao CHEGA e um cliente que escreveu, nao foi
 * respondido, e foi embora sem ninguem saber que ele escreveu.
 *
 * ⚠ A ARMADILHA QUE ESTE ARQUIVO GUARDA: tratar "a Meta respondeu 200" como
 * "esta tudo bem". Ela responde 200 com o numero em qualidade BAIXA, com o
 * nome REJEITADO ou com o envio restringido. Trocar um silencio por um VERDE
 * FALSO e pior que o silencio — verde falso ninguem investiga.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { avaliarSaude } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/saude-canal.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${esperado}\n        obtido:   ${obtido}`);
}

// ⚠ NAO CONSEGUIR PERGUNTAR E O MAIS GRAVE, mesmo parecendo o mais banal:
// token vencido e numero removido chegam exatamente assim, e e o unico caso em
// que ninguem consegue nem mandar nem receber.
verifica("nao deu para perguntar = parado",
  avaliarSaude({ ok: false, erro: "token expirado" }).gravidade, "parado");

// ⚠ RESPONDER NAO E ESTAR BEM.
verifica("respondeu com qualidade RED = parado",
  avaliarSaude({ ok: true, quality_rating: "RED" }).gravidade, "parado");
// FLAGGED e o aviso que antecede o bloqueio — a ultima janela para reduzir volume.
verifica("FLAGGED tambem = parado",
  avaliarSaude({ ok: true, quality_rating: "FLAGGED" }).gravidade, "parado");
verifica("qualidade YELLOW = atencao",
  avaliarSaude({ ok: true, quality_rating: "YELLOW" }).gravidade, "atencao");

// ⚠ NOME REJEITADO NAO IMPEDE ENVIO — e por isso passa despercebido. Tudo
// funciona, e quem recebe le um nome errado antes de decidir se abre. E o caso
// REAL da Be Fitness, que aparecia como "Seja Fitness2".
verifica("nome rejeitado = atencao, mesmo com qualidade alta",
  avaliarSaude({ ok: true, quality_rating: "GREEN", name_status: "REJECTED" }).gravidade, "atencao");
verifica("nome em revisao = atencao",
  avaliarSaude({ ok: true, quality_rating: "GREEN", name_status: "PENDING_REVIEW" }).gravidade, "atencao");

// O unico caso verde.
verifica("qualidade alta e nome aprovado = ok",
  avaliarSaude({ ok: true, quality_rating: "GREEN", name_status: "APPROVED" }).gravidade, "ok");

// ⚠ SEM DADO NAO E ALARME. A Meta as vezes omite o campo; inventar "parado"
// ali faria a tela gritar por ausencia de informacao, e alarme que toca a toa
// e alarme que alguem desliga.
verifica("campos ausentes nao viram alarme",
  avaliarSaude({ ok: true }).gravidade, "ok");

// ⚠ O RESUMO E ESCRITO PARA QUEM OPERA. Recusa sem motivo legivel na tela e o
// mesmo que botao quebrado — a regra do CLAUDE.md.
const rede = avaliarSaude({ ok: false, erro: "getaddrinfo ENOTFOUND" });
verifica("o erro da Meta vai inteiro para a tela",
  rede.resumo.includes("getaddrinfo ENOTFOUND"), true);
const nome = avaliarSaude({ ok: true, name_status: "REJECTED", verified_name: "Seja Fitness2" });
verifica("o resumo mostra o nome que o cliente ve",
  nome.resumo.includes("Seja Fitness2"), true);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
