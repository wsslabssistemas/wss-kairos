/**
 * O PREÇO DA IA — e por que este teste existe.
 *
 * ⚠ O fundador pôs teto de R$ 100 na Be Fitness, o teto bateu, e o console da
 * Anthropic mostrava **US$ 13,41**. O sistema tinha contado US$ 18,44 —
 * exatamente 1,5 vez a mais.
 *
 * A causa não era bug de código: era preço desatualizado. O Sonnet 5 está com
 * valor promocional de lançamento (US$ 2 e US$ 10 por milhão) e o código usava
 * a tabela cheia (US$ 3 e US$ 15).
 *
 * ⚠ E A PROMOÇÃO ACABA EM 31/08/2026. Fixar 2/10 consertaria hoje e voltaria a
 * mentir em seis dias — cobrando de MENOS, que é pior: teto que não morde não
 * protege ninguém. Por isso a virada é por data, e por isso ela é testada dos
 * dois lados.
 *
 * Valor esperado escrito no arquivo. Roda sem banco e sem rede.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { precoPorMilhao, estimarCentavos } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/preco-ia.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

// Sem variável de ambiente, a data manda.
delete process.env.AI_IN_PER_M;
delete process.env.AI_OUT_PER_M;
delete process.env.USD_BRL;

verifica("durante a promoção vale 2 e 10",
  precoPorMilhao(new Date("2026-08-25T12:00:00Z")), { entrada: 2, saida: 10 });

// ⚠ A VIRADA. 31/08 ainda é promoção; 01/09 já é tabela cheia.
verifica("no último dia da promoção ainda vale 2 e 10",
  precoPorMilhao(new Date("2026-08-31T23:59:00Z")), { entrada: 2, saida: 10 });
verifica("no dia seguinte volta para 3 e 15",
  precoPorMilhao(new Date("2026-09-01T00:01:00Z")), { entrada: 3, saida: 15 });

// O CASO REAL: 3.311.506 de entrada e 567.338 de saída, medidos no banco em
// 25/ago. US$ 12,296 pelo promocional contra US$ 18,444 pela tabela cheia.
//
// ⚠ Os dois valores abaixo são a conta INTEIRA, sem arredondar no meio. A
// primeira versão deste teste esperava 6765 porque eu parti do dólar já
// arredondado em duas casas — e a diferença de 2 centavos teria virado "o
// código está errado". Arredondar uma vez, no fim, é a regra.
verifica("o gasto real da Be Fitness em centavos",
  estimarCentavos(3311506, 567338, new Date("2026-08-25T12:00:00Z")), 6763);
verifica("e pela tabela cheia seria 1,5 vez mais",
  estimarCentavos(3311506, 567338, new Date("2026-09-02T12:00:00Z")), 10145);

// O ambiente tem a última palavra: preço de contrato ou outro provedor não
// cabem numa tabela fixa.
process.env.AI_IN_PER_M = "1";
process.env.AI_OUT_PER_M = "5";
verifica("o ambiente manda quando declarado",
  precoPorMilhao(new Date("2026-08-25T12:00:00Z")), { entrada: 1, saida: 5 });

console.log(falhas === 0 ? "\npreco-ia: tudo certo." : `\npreco-ia: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
