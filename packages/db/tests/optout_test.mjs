/**
 * QUEM PEDIU PARA NAO RECEBER MAIS.
 *
 * ⚠ POR QUE ESTE TESTE EXISTE, e por que ele guarda mais os FALSOS POSITIVOS
 * que os verdadeiros.
 *
 * Honrar descadastro e exigencia da LGPD e da politica do WhatsApp, e a
 * marcacao e automatica porque a janela entre "ele pediu" e "alguem viu" e
 * justamente onde a denuncia acontece — o motor manda de madrugada, sem
 * ninguem lendo.
 *
 * Mas a regra que reconhece o pedido e perigosa na direcao oposta: uma lista
 * de PALAVRAS soltas silenciaria gente interessada. "sair" pegaria "quero sair
 * do plano basico", "vou sair da cidade" e "posso sair as 18h?". Por isso sao
 * FRASES, e por isso metade das asseracoes aqui e sobre o que NAO pode ser
 * confundido com um pedido.
 *
 * Valor esperado escrito no arquivo.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { pediuParaSair } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/optout.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

const pede = (t) => pediuParaSair(t) !== null;

// ---------------------------------------------------------------------
// 1. O QUE E PEDIDO — e tem que ser reconhecido
// ---------------------------------------------------------------------

verifica("pedido direto", pede("Nao quero mais receber essas mensagens"), true);
verifica("com o verbo invertido", pede("nao quero receber mais nada de voces"), true);
verifica("imperativo", pede("Pare de me mandar mensagem"), true);
verifica("imperativo coloquial", pede("para de me mandar isso"), true);
verifica("pedido de lista", pede("me tira dessa lista por favor"), true);
verifica("descadastro", pede("quero me descadastrar"), true);
verifica("incomodo", pede("por favor nao me incomode mais"), true);
verifica("me deixa em paz", pede("me deixa em paz"), true);

// ⚠ SEM ACENTO — e como a pessoa realmente digita no WhatsApp. Uma regra que
// so pega texto acentuado nao pega nada na vida real.
verifica("sem acento nenhum", pede("nao quero mais receber"), true);
verifica("com acento", pede("não quero mais receber"), true);
verifica("caixa alta", pede("NAO QUERO MAIS RECEBER"), true);
verifica("espaco duplicado no meio", pede("nao   quero   mais   receber"), true);

// A frase dentro de um texto maior continua valendo.
verifica(
  "pedido no meio de uma frase longa",
  pede("Oi, obrigado pelo contato, mas nao quero mais receber mensagens de voces, ok?"),
  true,
);

// ---------------------------------------------------------------------
// 2. ⚠ O QUE **NAO** PODE SER CONFUNDIDO — a metade que mais importa
//
// Falso positivo silencia gente interessada, e ela nunca vai saber por que
// parou de receber. E o defeito nao aparece: a fila so fica menor.
// ---------------------------------------------------------------------

verifica("quer sair do plano, nao da lista", pede("quero sair do plano basico"), false);
verifica("vai sair da cidade", pede("vou sair da cidade semana que vem"), false);
verifica("pergunta de horario", pede("posso sair as 18h?"), false);
verifica("cancelar aula, nao inscricao", pede("preciso cancelar a aula de amanha"), false);
verifica("parar de treinar por um tempo", pede("vou parar de treinar um tempo"), false);
verifica("nao quero o plano anual", pede("nao quero o plano anual, so o mensal"), false);
verifica("remover do grupo, nao da lista", pede("me remove do grupo do whatsapp"), false);
verifica("interesse comum", pede("nao tenho interesse no plano trimestral"), false);
verifica("resposta positiva", pede("quero sim, pode me mandar mais informacoes"), false);
verifica("texto vazio", pede(""), false);
verifica("nulo", pede(null), false);

// ---------------------------------------------------------------------
// 3. O MOTIVO VOLTA, NAO UM BOOLEANO
//
// A frase reconhecida vira o motivo gravado na ficha. Marcacao sem
// justificativa e a que ninguem tem coragem de desfazer depois.
// ---------------------------------------------------------------------

verifica(
  "devolve a frase reconhecida, para virar o motivo na ficha",
  pediuParaSair("Olha, nao quero mais receber, obrigado"),
  "nao quero mais receber",
);

// ---------------------------------------------------------------------
// O CASO DO ARTUR (5/set/2026) — a lista nao escutava a propria pergunta
//
// ⚠ A campanha pergunta *"prefere que eu nao te chame mais por aqui?"*. Ele
// respondeu com o verbo da pergunta: *"nao moro mais nesse bairro, preferivel
// que nao chame mais"*. A lista tinha "mande", "envie" e "ligue" — e nao tinha
// CHAMAR. A IA respondeu "nao vamos te chamar mais por aqui" e nada foi
// gravado: a promessa existia so no texto.
//
// ⚠ E O PIOR DESSE DEFEITO E QUE ELE SO APARECE NA SEGUNDA MENSAGEM — a que
// nunca deveria ter saido. Ate la, tudo parece funcionando.
// ---------------------------------------------------------------------

// Esperado: a frase exata dele para.
verifica(
  "a frase do Artur e um pedido de parar",
  !!pediuParaSair("Eu não moro mais nesse bairro, preferível que não chame mais"),
  true,
);

// Esperado: as variacoes do mesmo verbo.
verifica(
  "as variacoes de 'chamar' param",
  [
    "não me chame mais",
    "prefiro que não me chame",
    "não entre em contato comigo",
    "não me procurem",
  ].map((t) => !!pediuParaSair(t)),
  [true, true, true, true],
);

// ⚠ E ESTE E O CASO QUE A REGRA NAO PODE ESTRAGAR: "chamar" e um verbo comum,
// e a NOSSA propria pergunta contem "te chame mais por aqui". Uma regra por
// palavra solta silenciaria quem esta marcando horario — e silenciar um
// interessado e o falso positivo caro.
verifica(
  "chamar em contexto normal NAO para",
  [
    "pode me chamar amanhã de manhã?",
    "me chama quando abrir vaga",
    "quer que eu te chame mais por aqui?",
  ].map((t) => !!pediuParaSair(t)),
  [false, false, false],
);

console.log(falhas === 0 ? "\noptout: tudo certo." : `\noptout: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
