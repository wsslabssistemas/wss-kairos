/**
 * O "👍" QUE NÃO PEDE RESPOSTA.
 *
 * ⚠ POR QUE ESTE TESTE É DOS MAIS IMPORTANTES DA PASTA, apesar do assunto
 * pequeno. Os dois erros aqui não custam a mesma coisa:
 *
 *   • fechar por engano → a pessoa espera resposta para sempre, e ninguém
 *     descobre, porque ela sai da lista;
 *   • não fechar → sobra uma linha que um clique resolve.
 *
 * Então a regra só pode fechar sozinha o que NÃO PODE conter pergunta. Este
 * arquivo existe para que ninguém, no futuro, "melhore" a regra incluindo
 * palavras — e transforme silêncio em cliente perdido.
 *
 * Valor esperado escrito no arquivo. Roda sem banco.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { tipoDeFecho } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/fecho.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${esperado}\n        obtido:   ${obtido}`);
}

// ---------------------------------------------------------------------
// SEM CONTEÚDO — fecha sozinho, porque não cabe pergunta
// ---------------------------------------------------------------------
verifica("um emoji sozinho", tipoDeFecho("👍"), "sem_conteudo");
verifica("emoji com pele e variação", tipoDeFecho("🙏🏻"), "sem_conteudo");
verifica("vários emojis", tipoDeFecho("😊😊👏"), "sem_conteudo");
verifica("coração", tipoDeFecho("❤️"), "sem_conteudo");
verifica("só pontuação", tipoDeFecho("..."), "sem_conteudo");

// ⚠ A REGRA NÃO É UMA LISTA DE EMOJIS — é a ausência de letra. Lista de emoji
// nunca fica pronta, e cada um que faltasse seria uma conversa parada na fila.
verifica("emoji que ninguém previu", tipoDeFecho("🫶🩵"), "sem_conteudo");

// ---------------------------------------------------------------------
// CORTESIA — SUGERE fechar, nunca fecha sozinho
// ---------------------------------------------------------------------
verifica("ok", tipoDeFecho("ok"), "cortesia");
verifica("Combinado (o caso real da Daniela)", tipoDeFecho("Combinado"), "cortesia");
verifica("obrigada com acento", tipoDeFecho("Obrigada"), "cortesia");
verifica("cortesia com emoji junto", tipoDeFecho("obrigada 🙏"), "cortesia");
verifica("valeu abreviado", tipoDeFecho("vlw"), "cortesia");

// ---------------------------------------------------------------------
// ⚠ O QUE NÃO PODE FECHAR — a metade que protege o cliente
// ---------------------------------------------------------------------
//
// As duas primeiras COMEÇAM como cortesia. Se a regra olhasse o começo do
// texto em vez do texto inteiro, ela silenciaria quem está perguntando preço.
verifica("obrigada, mas com pergunta atrás",
  tipoDeFecho("Obrigada, mas preciso saber o valor do mensal"), null);
verifica("ok seguido de pedido",
  tipoDeFecho("ok, me manda o endereço por favor"), null);
verifica("pergunta curta", tipoDeFecho("quanto?"), null);
verifica("um número é conteúdo", tipoDeFecho("2"), null);
verifica("nome de dia é conteúdo", tipoDeFecho("terça"), null);
verifica("vazio não é fecho", tipoDeFecho(""), null);
verifica("nulo não é fecho", tipoDeFecho(null), null);

console.log(falhas === 0 ? "\nfecho: tudo certo." : `\nfecho: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
