/**
 * QUANDO A PESSOA JÁ DECIDIU — a trava contra a importunação.
 *
 * ⚠ POR QUE ESTE ARQUIVO EXISTE: a conversa da Valéria, 4/set/2026.
 *
 * Ela escreveu *"No momento não irei retornar. Assim que puder, eu retorno.
 * Obrigada."* — um não agora, um prazo que é dela, e uma despedida. Não sobrou
 * pergunta nenhuma. O sistema aplicou a regra de manual ("depois do não,
 * pergunte o motivo"), ela respondeu, o sistema agradeceu, e ela então
 * escreveu **"Agora basta de pergunta OK?"**.
 *
 * O fundador nomeou: *"ela foi clara — eu decido quando quiser voltar. É essa
 * importunação que faz a pessoa bloquear o contato."*
 *
 * ⚠ E A ASSIMETRIA QUE DECIDE TUDO: quem se sente importunado **não reclama,
 * bloqueia** — e bloqueio derruba a qualidade do número, que afeta a entrega
 * de TODA mensagem da empresa, inclusive a de quem paga em dia. O prejuízo não
 * fica contido na conversa que irritou.
 *
 * As duas propriedades guardadas aqui:
 *   1. frase, nunca palavra solta — "depois" pegaria "depois das 18h fica
 *      melhor", que é uma pessoa marcando horário;
 *   2. o pedido de parar NÃO é descadastro. Silêncio tem prazo; apagar a
 *      pessoa por uma conversa ruim de dez minutos joga fora um cliente que
 *      pode voltar em março.
 *
 * Valor esperado escrito no arquivo. "Parece certo" não é critério.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { lerSinal, diasDeSilencio } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/adiamento.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

// Esperado: `adiou`. É a frase da Valéria, com o "Obrigads" digitado errado —
// e erro de digitação não pode mudar a leitura: quem escreve no WhatsApp erra.
verifica(
  "a frase da Valéria é um adiamento",
  lerSinal("No momento não irei retornar. Assim que puder, eu retorno. Obrigads."),
  "adiou",
);

// Esperado: `adiou`. A frase do Deoclécio, 3/set.
verifica(
  "'estou dando um tempo' é adiamento",
  lerSinal("Oioi, estou dando um tempo e assim que der eu volto. Obrigado por me lembrar."),
  "adiou",
);

// Esperado: `chega`, inclusive com o erro de digitação dela ("perguntad").
verifica(
  "'agora basta de pergunta' é pedido de parar",
  lerSinal("Agora basta de perguntad OK?"),
  "chega",
);

// ⚠ ESTE É O CASO QUE A REGRA EXISTE PARA NÃO ESTRAGAR. "Depois das 18h" é
// alguém marcando horário — silenciar essa pessoa por 60 dias seria perder a
// conversa no momento em que ela estava funcionando.
verifica(
  "marcar horário não é adiamento",
  [
    lerSinal("depois das 18h fica melhor pra mim"),
    lerSinal("pode ser quinta de manhã"),
    lerSinal("quanto custa o mensal?"),
    lerSinal("não estou treinando em outro lugar"),
  ],
  [null, null, null, null],
);

// Esperado: `chega` vence. Quem pede para parar já passou do ponto de
// explicar, e responder ao pedido de parar com mais uma pergunta é o pior
// desfecho possível.
verifica(
  "quando os dois aparecem, 'chega' vence",
  lerSinal("no momento não posso, e para de perguntar por favor"),
  "chega",
);

// Esperado: 60 e 90 dias — silêncio com PRAZO. Zero faria a régua chamar em
// cinco dias (a importunação); "para sempre" apagaria alguém que pode voltar.
verifica(
  "o silêncio tem prazo, e o pedido de parar compra mais",
  [diasDeSilencio("adiou"), diasDeSilencio("chega"), diasDeSilencio(null)],
  [60, 90, 0],
);

console.log(falhas === 0 ? "\nadiamento: tudo certo." : `\nadiamento: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
