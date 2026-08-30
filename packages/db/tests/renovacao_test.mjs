/**
 * AS JANELAS DE RENOVAÇÃO — sem banco e sem chave.
 *
 * Por que existe: renovação errada não quebra tela. O contato acontece, o
 * cliente responde, e o defeito só aparece na taxa de renovação três meses
 * depois — quando ninguém mais lembra que a régua estava trocada.
 *
 * O caso que mais importa é o da JANELA APERTADA: um contrato a 25 dias de
 * vencer não pode cair na conversa de 60 dias. Se cair, o vendedor chega
 * perguntando "e aí, como está indo?" faltando três semanas — e depois não
 * sobra tempo para a condição concreta. A régua certa é a mais apertada que
 * ainda cabe.
 *
 * ESPERADO: 11/11.
 *
 *   node packages/db/tests/renovacao_test.mjs
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { computeRenovacoes, JANELAS } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/renovacao.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}`);
  if (!ok) console.log(`    esperado: ${JSON.stringify(esperado)}\n    obtido:   ${JSON.stringify(obtido)}`);
}

const HOJE = new Date("2026-08-07T12:00:00Z");
const daqui = (d) => new Date(Date.parse("2026-08-07") + d * 86400000).toISOString().slice(0, 10);
const c = (id, dias, stage = "convertido") => ({
  id, name: id, phone: null, journey_stage: stage, contract_end: daqui(dias),
});
const rodar = (lista, fora = new Set()) => computeRenovacoes(lista, fora, HOJE);
const janelaDe = (dias) => rodar([c("x", dias)])[0]?.janela ?? null;

// ------------------------------------------------------------ as três janelas
verifica("60 dias → falar do resultado", janelaDe(60), "resultado");
verifica("30 dias → abrir continuidade", janelaDe(30), "continuidade");
verifica("7 dias → condição concreta", janelaDe(7), "condicao");

// A JANELA MAIS APERTADA QUE CABE. Este é o caso que originou o teste: 25
// dias está dentro de 60 e dentro de 30 — tem que dar a de 30, não a de 60.
verifica("25 dias cai na janela de 30, não na de 60", janelaDe(25), "continuidade");
verifica("5 dias cai na de 7, não na de 30", janelaDe(5), "condicao");

// Fora de qualquer janela: silêncio. Alertar cedo demais gasta o toque.
verifica("90 dias ainda não entra em nenhuma janela", rodar([c("x", 90)]).length, 0);

// ------------------------------------------------------------------- vencido
const vencido = rodar([c("x", -12)])[0];
verifica("vencido entra na lista", vencido?.vencido, true);
// A intenção do vencido NÃO cita quantos dias passaram: "venceu há 40 dias"
// dito ao cliente é constrangimento, não argumento.
verifica("a intenção do vencido não expõe o atraso", /\d+\s*dias/.test(vencido?.intencao ?? ""), false);

// ------------------------------------------------------------------ a ordem
// Vencido primeiro (perda mais barata de evitar), depois o mais próximo.
verifica(
  "vencido vem antes, depois o mais próximo de vencer",
  rodar([c("a", 55), c("b", -3), c("c", 10)]).map((r) => r.contactId),
  ["b", "c", "a"],
);

// -------------------------------------------------------------- fora de jogo
// Quem já saiu não recebe conversa de renovação — seria oferecer continuidade
// a quem disse não.
verifica("etapa de perda não recebe renovação", rodar([c("x", 20, "perdido")], new Set(["perdido"])).length, 0);

// A REGRA QUE MAIS IMPORTA, e por isso ela é teste e não comentário: o
// primeiro toque NÃO fala de renovação. Fala do resultado.
verifica(
  "a janela de 60 dias proíbe mencionar renovação",
  /não mencione renovação/i.test(JANELAS.find((j) => j.key === "resultado").intencao),
  true,
);


// ------------------------------------------- O VENCIMENTO QUE NÃO SE PODE AFIRMAR
//
// ⚠ O CASO MARIA ISABEL FERREIRA GARCIA (13/ago/2026).
//
// Contrato 11/fev → 10/ago, semestral. A fila dizia "Venceu sem contato" — e
// ela JÁ TINHA RENOVADO. A fila não errou: reportou fielmente o que o banco
// dizia. O banco é que afirmava uma FOTOGRAFIA com a confiança de um fato
// vivo.
//
// O sistema da academia não tem API. A vigência entra por planilha e cada
// renovação vira uma LINHA NOVA lá; entre duas importações, todo
// `contract_end` envelhece em silêncio. É o mesmo defeito que o `0029`
// corrigiu no DNA — só que aqui a mentira sai numa mensagem para o cliente.
//
// O ERRO É ASSIMÉTRICO, e é isso que decide a regra: dizer "venceu" para quem
// renovou é constrangedor e faz o cliente duvidar do sistema inteiro;
// perguntar para quem realmente venceu custa uma frase.
const venc = (conferido) => computeRenovacoes(
  [{ id: "m", name: "Maria Isabel", phone: null, journey_stage: "convertido",
     contract_end: "2026-08-10", contrato_conferido_em: conferido }],
  new Set(),
  new Date("2026-08-13T12:00:00Z"),
)[0];

verifica("sem carimbo, NÃO afirma o vencimento", venc(null).vencimentoConfirmado, false);
verifica("sem carimbo, o texto manda confirmar",
  venc(null).intencao.includes("NÃO sabe se ele renovou"), true);
verifica("sem carimbo, o título não afirma", venc(null).titulo, "Vencimento não confirmado");

// Conferido ANTES do fim não vale: a planilha foi lida quando o contrato
// ainda estava vivo, então ela não pode dizer nada sobre o que houve depois.
verifica("conferido antes do fim, continua não confirmado",
  venc("2026-08-01").vencimentoConfirmado, false);

// Conferido DEPOIS do fim e ainda vencido: aí sim venceu de verdade.
verifica("conferido depois do fim, afirma o vencimento",
  venc("2026-08-12").vencimentoConfirmado, true);
verifica("conferido depois do fim, volta o texto de retomada",
  venc("2026-08-12").titulo, "Venceu sem contato");

// ================================ O PLANO MENSAL QUE NASCIA "A VENCER" (29/ago)
//
// ⚠ O DEFEITO. As janelas de renovacao abrem 60 e 30 dias antes do
// vencimento. Um plano MENSAL dura 30 dias — entao `diasParaVencer` vale 30
// **no dia da matricula**, e a pessoa entrava na fila no mesmo dia em que
// pagou, com o assunto "seu plano esta a vencer".
//
// ⚠ E O ESTRAGO NAO ERA SO A MENSAGEM ESTRANHA. `renovacao` tem peso 1 na
// fila, quase o topo: cada mensal novo entrava NA FRENTE de gente com conversa
// de verdade devida, empurrando o trabalho util para baixo. O vendedor via uma
// fila cheia de gente que acabou de pagar.
//
// A regra: a janela nao abre antes de METADE do contrato ter passado.

// Usa os ajudantes que o arquivo ja tem: `daqui` e a data relativa ao HOJE
// fixo, e `rodar` passa esse HOJE — teste que depende do relogio de quem roda
// falha sozinho num dia qualquer.
const mensal = (inicioDias, fimDias) => ({
  id: "m", name: "Mensal", phone: "51999999999", journey_stage: "convertido",
  contract_start: daqui(inicioDias),
  contract_end: daqui(fimDias),
});

// Assinou HOJE um mensal (hoje -> +30). A metade e o dia 15: nao entra.
verifica("mensal assinado hoje NAO entra na fila", rodar([mensal(0, 30)]).length, 0);

// Dia 10 de 30: ainda antes da metade.
verifica("mensal no dia 10 de 30 ainda nao entra", rodar([mensal(-10, 20)]).length, 0);

// Dia 20 de 30: passou da metade, entra.
verifica("mensal no dia 20 de 30 ENTRA", rodar([mensal(-20, 10)]).length, 1);

// ⚠ PLANO LONGO NAO MUDA NADA. Anual: a metade cai no dia 182, e a janela de
// 60 dias so abre no dia 305 — bem depois. A trava so morde onde o defeito
// existe, e nao pode roubar renovacao de quem precisa dela.
verifica("anual a 45 dias do fim continua entrando", rodar([mensal(-320, 45)]).length, 1);

// ⚠ SEM `contract_start` A REGRA NAO OPINA. Base antiga nao tem a data, e
// barrar por ausencia de dado tiraria renovacao legitima da fila em silencio —
// o mesmo principio do recorte e do `paraE164BR`: falhar nao pode virar barrar.
verifica("sem data de inicio, a regra nao barra", rodar([c("s", 20)]).length, 1);

console.log(falhas ? `\n✗ FALHOU — ${falhas} caso(s)` : "\n✓ PASSOU — 17/17");
process.exit(falhas ? 1 : 0);
