/**
 * A PRIMEIRA SEGUNDA-FEIRA DO MÊS — a regra que o fundador já usava à mão.
 *
 * "Quando o contato fala que retorna mês que vem, eu uso como regra o
 * agendamento para a primeira segunda-feira do mês."
 *
 * ⚠ E ELA SÓ VALE PARA O VAGO. Se a pessoa disse "dia 12", a data dela manda —
 * a regra da casa nunca sobrepõe o que o cliente falou. Os dois últimos casos
 * abaixo são os que protegem isso.
 *
 * Valor esperado escrito no arquivo. Roda sem banco.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { primeiraSegundaDoMes, ajustarRetorno } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/retorno.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${esperado}\n        obtido:   ${obtido}`);
}

// Setembro de 2026 começa numa terça → a primeira segunda é dia 7.
verifica("setembro/2026 começa na terça", primeiraSegundaDoMes(2026, 9), "2026-09-07");

// ⚠ O CASO QUE QUEBRA CONTA INGÊNUA: quando o dia 1º JÁ É segunda, a resposta
// é o próprio dia 1º — não a segunda seguinte. `(8 - dia) % 7` devolve 0 aqui;
// sem o `% 7` devolveria 7, e a pessoa seria marcada uma semana tarde demais.
verifica("junho/2026 começa numa segunda", primeiraSegundaDoMes(2026, 6), "2026-06-01");

// Domingo é o outro extremo: falta 1 dia.
verifica("novembro/2026 começa num domingo", primeiraSegundaDoMes(2026, 11), "2026-11-02");
verifica("virada de ano", primeiraSegundaDoMes(2027, 1), "2027-01-04");

// A regra aplicada: o modelo entendeu "setembro" e devolveu um dia qualquer.
verifica("mês vago vira a primeira segunda", ajustarRetorno("2026-09-01", true), "2026-09-07");
verifica("outro dia do mesmo mês dá o mesmo resultado",
  ajustarRetorno("2026-09-23", true), "2026-09-07");

// ⚠ A METADE QUE PROTEGE O CLIENTE: dia dito não é tocado.
verifica("dia específico é respeitado", ajustarRetorno("2026-09-23", false), "2026-09-23");
verifica("data inválida passa intacta", ajustarRetorno("mês que vem", true), "mês que vem");

console.log(falhas === 0 ? "\nretorno: tudo certo." : `\nretorno: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
