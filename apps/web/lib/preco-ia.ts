// O PREÇO DA IA — função pura, testável sem rede e sem SDK.
//
// ⚠ POR QUE ISTO SAIU DE `lib/ai.ts`. Aquele arquivo instancia o cliente do
// provedor no topo do módulo; importá-lo num teste de Node tentaria criar
// conexão. O cálculo do custo é aritmética e precisa ser conferível sozinho —
// principalmente depois do erro abaixo.
//
// ⚠ O ERRO QUE ISTO CORRIGE, achado pelo fundador em 25/ago/2026.
//
// Ele pôs teto de R$ 100 na Be Fitness, o teto bateu, e o console da Anthropic
// mostrava **US$ 13,41** gastos. O sistema tinha contado R$ 101,49 — US$ 18,44.
// Uma vez e meia a mais.
//
// A causa não era bug de código: era **preço desatualizado**. O Sonnet 5 está
// com valor promocional de lançamento — US$ 2 e US$ 10 por milhão — e o código
// usava US$ 3 e US$ 15, que é a tabela cheia. Exatamente 1,5×.
//
// ⚠ E A PROMOÇÃO TEM DATA PARA ACABAR: 31/08/2026. Fixar 2/10 consertaria hoje
// e voltaria a mentir em seis dias, na direção contrária — cobrando de menos,
// que é pior, porque teto que não morde não protege ninguém. Por isso a data
// está no código, com a virada automática.
//
// ⚠ E O NÚMERO NUNCA VAI SER EXATO, de propósito. Ele não conta desconto de
// cache nem repricing, e é uma ESTIMATIVA para um teto de segurança — a
// fatura real é a da Anthropic. O que ele não pode é errar por 50%.

/** Tabela cheia do Sonnet 5, em dólares por milhão de tokens. */
const CHEIO = { entrada: 3, saida: 15 };

/** Preço de lançamento, válido até o fim de 31/08/2026. */
const PROMOCIONAL = { entrada: 2, saida: 10 };
const FIM_DA_PROMOCAO = Date.parse("2026-09-01T00:00:00Z");

/**
 * O preço vigente na data. `agora` é injetado para o teste não depender do
 * relógio — a mesma regra do motor: relógio injetado, nunca `new Date()` solto
 * no meio da lógica.
 */
export function precoPorMilhao(agora: Date = new Date()): { entrada: number; saida: number } {
  // O ambiente manda, quando declarado: preço de contrato, outro provedor ou
  // outro modelo não cabem numa tabela fixa no código.
  const doAmbiente = {
    entrada: Number(process.env.AI_IN_PER_M),
    saida: Number(process.env.AI_OUT_PER_M),
  };
  if (Number.isFinite(doAmbiente.entrada) && Number.isFinite(doAmbiente.saida)) {
    return doAmbiente;
  }
  return agora.getTime() < FIM_DA_PROMOCAO ? PROMOCIONAL : CHEIO;
}

/**
 * Estimativa em CENTAVOS de real.
 *
 * O câmbio também vem do ambiente — 5,5 é chute conservador, e chute
 * conservador num teto é o lado certo de errar.
 */
export function estimarCentavos(
  tokensEntrada: number,
  tokensSaida: number,
  agora: Date = new Date(),
): number {
  const p = precoPorMilhao(agora);
  const usdBrl = Number(process.env.USD_BRL) || 5.5;
  const usd = (tokensEntrada / 1e6) * p.entrada + (tokensSaida / 1e6) * p.saida;
  return Math.round(usd * usdBrl * 100);
}
