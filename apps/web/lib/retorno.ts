// QUANDO A PESSOA DISSE QUE VOLTA — e o dia que a casa marca.
//
// ⚠ A REGRA É DO FUNDADOR, não minha: *"quando o contato fala que retorna mês
// que vem, eu uso como regra o agendamento para a primeira segunda-feira do
// mês que a pessoa ficou de retornar"*.
//
// Ela existe porque "mês que vem" não é data, e alguém precisa escolher uma.
// Marcar dia 1º cai em domingo ou feriado com frequência; marcar "daqui a 30
// dias" cai numa quarta aleatória que não significa nada para ninguém. A
// primeira segunda é o começo real do mês para quem treina — e é o dia em que
// as pessoas de fato recomeçam coisas.
//
// ⚠ E ELA SÓ VALE QUANDO O DIA NÃO FOI DITO. Se a pessoa falou "dia 12" ou
// "na semana do dia 20", a data dela manda — a regra da casa é para o VAGO,
// nunca para sobrepor o que o cliente disse. É a mesma regra do prazo em
// `lib/prompt.ts`: a decisão é dele.

/**
 * A primeira segunda-feira do mês de uma data.
 *
 * ⚠ TUDO EM UTC, de propósito. Data de calendário não tem fuso — "1º de
 * setembro" é 1º de setembro em qualquer lugar —, e usar o relógio local aqui
 * faria o servidor da Vercel (que roda em UTC) devolver o dia anterior para
 * qualquer horário depois das 21h de Brasília. É o mesmo defeito que fez a
 * simulação voltar vazia às 18h.
 */
export function primeiraSegundaDoMes(ano: number, mes1a12: number): string {
  const primeiro = new Date(Date.UTC(ano, mes1a12 - 1, 1));
  // getUTCDay: 0 = domingo, 1 = segunda. O quanto falta para a próxima segunda.
  const faltam = (8 - primeiro.getUTCDay()) % 7;
  const dia = new Date(Date.UTC(ano, mes1a12 - 1, 1 + faltam));
  return dia.toISOString().slice(0, 10);
}

/**
 * Ajusta a data sugerida quando o cliente falou só do MÊS.
 *
 * `iso` é o que o modelo entendeu; `vago` é ele dizendo que não houve dia
 * específico. Com dia dito, devolve o que veio — sem tocar.
 */
export function ajustarRetorno(iso: string, vago: boolean): string {
  if (!vago || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [ano, mes] = iso.split("-").map(Number);
  return primeiraSegundaDoMes(ano, mes);
}
