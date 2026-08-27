/**
 * O PAR SUGERIDO x ENVIADO — o sinal mais rapido de qualidade da IA.
 *
 * ⚠ O DEFEITO DE 27/ago/2026. O fundador estava na conta da Luciana, precisou
 * ADAPTAR a mensagem antes de mandar, e percebeu que a aba Responder nao tinha
 * onde editar — so *Copiar* e *Registrar no cliente*.
 *
 * O que ninguem tinha visto e que era pior que faltar um botao: o "Registrar"
 * gravava `data.resposta_sugerida`, o texto da IA, e NAO o que a pessoa
 * mandou. Duas perdas, e a segunda e a grave:
 *
 *   • a correcao do vendedor evaporava. Em agosto foram 183 mensagens por
 *     aquela tela contra 20 pelo Canal oficial (o unico caminho que
 *     capturava), e `ai_edits` tinha CINCO licoes. O sinal que o CLAUDE.md
 *     chama de "o mais rapido de qualidade da IA" era coletado em 6% dos
 *     envios — e e por isso que a amostra de `origem_ia`, o numero que
 *     autoriza o modo automatico, nao saia do lugar.
 *   • o historico guardava mensagem que nunca foi enviada daquele jeito. E
 *     `interactions.content` volta como CONTEXTO da proxima geracao: a IA
 *     passava a se apoiar em texto que ela mesma escreveu e ninguem mandou.
 *
 * ⚠ E A REGRA ESTAVA DUPLICADA. O Canal classificava `origem_ia` com uma copia
 * da comparacao; quando a aba Responder passou a gravar, virariam duas copias.
 * Regra copiada diverge na primeira mudanca — por isso `origemDaMensagem` e
 * uma funcao so, e este arquivo guarda o comportamento dela.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { origemDaMensagem, mesmaMensagem } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/origem-ia.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

const SUG = "Oi Ana! Vi que voce treinou com a gente e acabou parando. Quer saber como esta a academia hoje?";

// -------------------------------------------------- o caso que autoriza ligar
// ⚠ IDENTICA E O SINAL QUE MAIS IMPORTA PARA A DECISAO, mesmo nao virando
// licao: e ela que diz que a IA acertou sozinha.
verifica("enviada igualzinha e 'aceita'", origemDaMensagem(SUG, SUG), "aceita");
verifica("so o espaco mudou: continua 'aceita'", origemDaMensagem(SUG, SUG.replace(/ /g, "  ")), "aceita");
verifica("so a caixa mudou: continua 'aceita'", origemDaMensagem(SUG, SUG.toUpperCase()), "aceita");

// ------------------------------------------------------------ a licao de fato
verifica(
  "texto adaptado e 'editada'",
  origemDaMensagem(SUG, "Oi Ana! Tudo bem? Faz tempo que voce nao aparece — passa aqui pra ver as novidades?"),
  "editada",
);

// ------------------------------------------- o caso que inventaria um numero
// ⚠ SEM SUGESTAO E `null`, NUNCA "editada". Mensagem escrita do zero, sem a IA
// ter proposto nada, nao e a IA errando. Conta-la como edicao derrubaria a taxa
// de acerto por um motivo que nao existe — e adiaria a decisao de ligar o
// automatico por um numero inventado, que e pior que numero ausente.
verifica("sem sugestao e null", origemDaMensagem(null, "escrevi do zero"), null);
verifica("sugestao vazia e null", origemDaMensagem("   ", "escrevi do zero"), null);
verifica("enviado vazio e null", origemDaMensagem(SUG, "   "), null);

// ------------------------------------------------------- a comparacao crua
verifica("mesmaMensagem ignora espaco e caixa", mesmaMensagem("  Oi   Ana ", "oi ana"), true);
verifica("e nao confunde textos diferentes", mesmaMensagem("oi ana", "oi joao"), false);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
