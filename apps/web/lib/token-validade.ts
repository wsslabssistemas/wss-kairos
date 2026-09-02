// QUANTOS DIAS O TOKEN AINDA TEM — aritmética pura, testável sem rede.
//
// ⚠ POR QUE ISTO SAIU DE `lib/perfil-canal.ts`, e é a mesma razão do
// `lib/preco-ia.ts`: aquele arquivo fala com a Meta, e importá-lo num teste de
// Node tentaria resolver dependências que só existem dentro do Next. A conta
// dos dias é o que decide a COR do aviso na tela, e ela precisa ser conferível
// sozinha.
//
// ⚠ E O AVISO EXISTE POR UM PEDIDO DO FUNDADOR, em 02/set/2026: *"todo o
// trabalho manual é ruim, ainda mais os que dependem da memória de um humano,
// então vamos ter que colocar alertas de lembrete de token expirando"*.
//
// A saída foi melhor que lembrete: o `debug_token` da Meta DEVOLVE a data de
// expiração. Ninguém anota nada — o vigia pergunta e a tela conta os dias.

/** A partir de quantos dias o aviso deixa de ser informação e vira alarme. */
export const DIAS_DE_ALERTA = 15;

/**
 * Dias até vencer. `null` quando o token não vence.
 *
 * ⚠ `null` COBRE DOIS CASOS DE PROPÓSITO: token permanente (a Meta manda
 * `expires_at: 0`) e leitura que falhou. Os dois viram silêncio na tela —
 * alarme para o que está certo é como se aprende a ignorar alarme.
 *
 * ⚠ E VENCIDO DEVOLVE NEGATIVO, nunca zero: "venceu há dois dias" e "vence
 * hoje" pedem urgências diferentes de quem lê.
 */
export function diasAteVencer(expiraEm: Date | null, agora = new Date()): number | null {
  if (!expiraEm) return null;
  return Math.floor((expiraEm.getTime() - agora.getTime()) / 86_400_000);
}
