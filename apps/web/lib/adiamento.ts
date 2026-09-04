// QUANDO A PESSOA JÁ DECIDIU — adiamento, e o pedido de parar.
//
// Arquivo puro e SEM IMPORTS, como `lib/optout.ts` e `lib/fecho.ts`: dá para
// testar em Node sem banco e sem bundler.
//
// ⚠ POR QUE ISTO EXISTE — a conversa da Valéria, 4/set/2026.
//
// Ela escreveu: *"No momento não irei retornar. Assim que puder, eu retorno.
// Obrigada."* Três coisas numa frase: um **não agora**, um **prazo que é dela**
// e uma **despedida**. Não sobrou pergunta nenhuma.
//
// O sistema respondeu com a regra de manual — *"só pra eu não te incomodar à
// toa: foi mais questão de horário, de estar treinando em outro lugar, ou é
// outra coisa?"*. Ela respondeu. O sistema agradeceu. Ela então escreveu:
// **"Agora basta de pergunta OK?"**. E o sistema respondeu de novo.
//
// O fundador nomeou o que aconteceu: *"ela foi clara — eu decido quando quiser
// voltar. É essa importunação que faz a pessoa bloquear o contato."*
//
// ⚠ E A REGRA QUE CAUSOU ISSO É UMA REGRA BOA. "Depois do não, pergunte o
// motivo" existe porque motivo declarado vale ouro, e perguntar com
// alternativas concretas coleta verdade em vez da desculpa educada. Só que ela
// foi escrita para o "não" SECO — *"não quero"*, *"não tenho interesse"*.
// Aplicada a quem já explicou e já se despediu, ela vira interrogatório.
//
// ⚠ E TEM UMA ASSIMETRIA QUE DECIDE TUDO: quem se sente importunado **não
// reclama, bloqueia**. Bloqueio derruba a qualidade do número, e a qualidade do
// número afeta a entrega de TODA mensagem da empresa — inclusive a renovação de
// quem paga em dia. O prejuízo não fica contido na conversa que irritou.

/** O que a pessoa comunicou, do ponto de vista de continuar falando. */
export type Sinal =
  /** Ela disse não AGORA e assumiu o prazo do retorno. Nada a perguntar. */
  | "adiou"
  /** Ela pediu para parar. É mais forte que adiar, e é o último aviso. */
  | "chega"
  | null;

const semAcento = (t: string) =>
  t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * ⚠ SÃO FRASES, NÃO PALAVRAS SOLTAS — a mesma decisão de `lib/optout.ts`, e
 * pelo mesmo motivo: "depois" sozinho pegaria *"depois das 18h fica melhor"*,
 * que é exatamente uma pessoa marcando horário.
 *
 * A frase pode vir no meio da mensagem, então a busca é por conteúdo, não por
 * igualdade — *"no momento não irei retornar, assim que puder eu retorno"* tem
 * duas destas dentro.
 */
const ADIOU = [
  "no momento nao",
  "agora nao posso",
  "agora nao da",
  "agora nao vou",
  "no momento eu nao",
  "assim que puder eu retorno",
  "assim que puder eu volto",
  "quando puder eu retorno",
  "quando puder eu volto",
  "quando eu puder eu volto",
  "quando der eu volto",
  "quando der eu retorno",
  "assim que der eu volto",
  "mais para frente",
  "mais pra frente",
  "quando eu decidir",
  "eu decido quando",
  "eu aviso quando",
  "eu te aviso quando",
  "eu procuro voces",
  "eu entro em contato quando",
  "estou dando um tempo",
  "to dando um tempo",
  "vou dar um tempo",
];

/**
 * ⚠ O PEDIDO DE PARAR NÃO É DESCADASTRO, e tratá-los como a mesma coisa erra
 * dos dois lados. *"Agora basta de pergunta"* não é *"não quero mais receber
 * mensagem de vocês"*: é "pare de me interrogar AGORA". Marcar descadastro
 * aqui apagaria a pessoa da base para sempre por causa de uma conversa ruim de
 * dez minutos — e ela pode voltar a ser cliente em março.
 *
 * O que ele pede é silêncio, e silêncio tem prazo.
 */
const CHEGA = [
  "basta de pergunta",
  "chega de pergunta",
  "para de perguntar",
  "pare de perguntar",
  "parem de perguntar",
  "sem mais perguntas",
  "nao quero mais responder",
  "nao vou responder mais",
  "chega por favor",
  "ja disse que nao",
  "ja falei que nao",
  "pare de insistir",
  "para de insistir",
];

/**
 * O que esta mensagem comunica sobre continuar a conversa.
 *
 * ⚠ `chega` VENCE `adiou` quando os dois aparecem: quem pede para parar já
 * passou do ponto de explicar, e responder ao pedido de parar com mais uma
 * pergunta é o pior desfecho possível.
 */
export function lerSinal(texto: string | null | undefined): Sinal {
  const t = semAcento((texto ?? "").trim())
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;

  if (CHEGA.some((f) => t.includes(f))) return "chega";
  if (ADIOU.some((f) => t.includes(f))) return "adiou";
  return null;
}

/**
 * Quantos dias de silêncio cada sinal compra.
 *
 * ⚠ SILÊNCIO COM PRAZO, NUNCA PARA SEMPRE. Apagar a pessoa por causa de uma
 * conversa ruim de dez minutos é jogar fora um cliente que pode voltar em
 * março — e é o oposto do que a reativação existe para fazer. Mas voltar em
 * cinco dias é a importunação que faz bloquear.
 *
 * ⚠ E O NÚMERO NÃO É CHUTE: 60 dias é o piso que a própria biblioteca da
 * academia já usa para quem sumiu (*"reativação com ângulo novo, depois de 60
 * a 90 dias"*). `chega` ganha 90 porque ela pediu explicitamente.
 */
export function diasDeSilencio(sinal: Sinal): number {
  if (sinal === "chega") return 90;
  if (sinal === "adiou") return 60;
  return 0;
}
