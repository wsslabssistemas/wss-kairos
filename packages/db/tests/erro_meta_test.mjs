/**
 * O TEXTO DA META TRADUZIDO — e por que traduzir nao pode virar inventar.
 *
 * ⚠ O PROBLEMA, no print de 29/ago: a tela do Canal oficial mostrava 14 falhas
 * com o texto CRU da Meta, em ingles, para uma recepcionista brasileira.
 * "Message undeliverable", "User's number is part of an experiment" e "This
 * message was not delivered to maintain healthy ecosystem engagement" parecem
 * a mesma coisa e sao TRES problemas diferentes, com tres acoes diferentes.
 *
 * ⚠ E A TERCEIRA E UM ALERTA DE GESTAO. Ela significa que a Meta segurou o
 * envio por qualidade do engajamento — e costuma ser o aviso que vem ANTES de
 * o numero ser restringido. Lida como "falhou", ninguem reage; lida como
 * "reduza o volume hoje", alguem age.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { lerFalha, agruparFalhas } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/erro-meta.ts")).href
);

let falhas = 0;
const verifica = (nome, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
};

// Os tres textos que apareceram de verdade na Be Fitness.
verifica("'Message undeliverable' = numero sem WhatsApp",
  lerFalha("Message undeliverable").tipo, "sem_whatsapp");
verifica("'part of an experiment' = teste da Meta",
  lerFalha("User's number is part of an experiment").tipo, "experimento");
verifica("'healthy ecosystem engagement' = qualidade",
  lerFalha("This message was not delivered to maintain healthy ecosystem engagement.").tipo, "qualidade");

// ⚠ A DE QUALIDADE E A UNICA DAS TRES QUE E GRAVE. Numero sem WhatsApp e
// cadastro; experimento e da Meta; qualidade e o aviso antes da restricao.
verifica("so a de qualidade e grave", [
  lerFalha("Message undeliverable").grave,
  lerFalha("User's number is part of an experiment").grave,
  lerFalha("This message was not delivered to maintain healthy ecosystem engagement.").grave,
], [false, false, true]);

// ⚠ TODA FALHA CONHECIDA DIZ O QUE FAZER. Motivo sem acao devolve para a
// pessoa o trabalho de descobrir — e ela nao tem como.
for (const t of ["Message undeliverable", "User's number is part of an experiment", "rate limit hit"]) {
  verifica(`"${t.slice(0, 26)}..." vem com acao`, lerFalha(t).acao.length > 10, true);
}

// ⚠ SEM CHUTE PARA O QUE NAO CONHECEMOS. Inventar explicacao plausivel para um
// codigo novo e a mesma classe da IA afirmar preco que nao tem — e pior aqui,
// porque a pessoa AGIRIA com base na explicacao errada.
const novo = lerFalha("Some brand new error code from Meta 2027");
verifica("erro desconhecido nao ganha explicacao inventada", novo.tipo, "desconhecida");
verifica("e nao inventa acao", novo.acao, "");

// Vazio e diferente de desconhecido: um e "a Meta nao disse", o outro e "ela
// disse algo que nao entendemos". A tela mostra o texto cru no segundo caso.
verifica("sem texto nenhum tem resumo proprio", lerFalha(null).resumo, "A Meta não disse o motivo.");

// ⚠ AGRUPAR E O QUE TRANSFORMA 14 LINHAS IGUAIS EM TRES FATOS. E o grave vem
// primeiro: quem abre precisa ver o que exige reacao antes do que e so
// cadastro errado.
const g = agruparFalhas([
  "Message undeliverable", "Message undeliverable", "Message undeliverable",
  "User's number is part of an experiment", "User's number is part of an experiment",
  "This message was not delivered to maintain healthy ecosystem engagement.",
]);
verifica("tres tipos distintos", g.length, 3);
verifica("o grave vem primeiro, mesmo sendo o menos frequente", g[0].leitura.tipo, "qualidade");
verifica("e a contagem esta certa", g.map((x) => x.quantas), [1, 3, 2]);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
