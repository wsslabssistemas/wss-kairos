/**
 * O QUE O SISTEMA AFIRMA E A FONTE NÃO CONFIRMA. Sem banco e sem chave.
 *
 * ⚠ POR QUE ESTA PEÇA EXISTE.
 *
 * O fundador viu pessoas marcadas como matriculadas que não eram alunas e
 * suspeitou da importação de recebíveis. A importação estava inocente — ela
 * nunca toca a etapa. A causa era permanente: **`convertido` nunca é
 * revogado**, então uma vez cliente, cliente para sempre, mesmo tendo saído há
 * um ano. Medido na Be Fitness: 11 marcados como matriculados que o sistema da
 * academia não conhece, e 5 com contrato até 2027 e nenhum pagamento.
 *
 * Consertar os 16 resolveria o dia e traria os próximos na semana seguinte.
 * **Etapa que só avança mente com o tempo**, e ninguém procura erro numa etapa
 * que já foi verdade.
 *
 * O QUE ESTE TESTE GUARDA, em ordem de custo:
 *
 *   1. **Não afirmar sobre ausência de dado.** "Nunca pagou" só pode ser dito
 *      se os recebimentos FORAM conferidos. Sem conferência, silêncio de dado
 *      viraria acusação — e o erro é assimétrico: cobrar quem pagou faz o
 *      cliente duvidar do sistema inteiro.
 *   2. **Segmento sem contrato não tem contradição de vigência.** Numa
 *      barbearia, cliente sem data de vencimento é o normal, não um defeito.
 *   3. **A lista precisa encolher.** Quem foi conferido à mão some; sem isso a
 *      tela repete os mesmos nomes toda semana e vira ruído, que é o que faz
 *      alguém parar de abrir.
 *
 * ESPERADO: 12/12.
 *
 *   node packages/db/tests/contradicoes_test.mjs
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { acharContradicoes } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/contradicoes.ts")).href
);

let ok = 0;
const falhas = [];
const eq = (nome, calcular, esperado) => {
  let obtido;
  try { obtido = typeof calcular === "function" ? calcular() : calcular; }
  catch (e) { obtido = `ERRO: ${e.message}`; }
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) { ok++; console.log(`✓ ${nome}`); }
  else { falhas.push(`${nome}\n    esperado: ${JSON.stringify(esperado)}\n    obtido:   ${JSON.stringify(obtido)}`); console.log(`✗ ${nome}`); }
};

const GANHAS = new Set(["convertido"]);
const HOJE = "2026-08-15T12:00:00Z";

const cliente = (over) => ({
  id: "c1", name: "Fulano", journey_stage: "convertido", phone: "51999999999",
  contract_end: "2027-01-09",
  custom: { codigo_sistema: "1234", recebimentos_conferidos_em: "2026-08-14", pagamentos: 6 },
  ...over,
});
const achar = (c, usaContrato = true) =>
  acharContradicoes({ contatos: [c], etapasGanhas: GANHAS, usaContrato, hojeISO: HOJE });

// ------------------------------------------------------------ O CASO NORMAL
eq("cliente em dia não é contradição", () => achar(cliente()).length, 0);

eq("quem não está em etapa de cliente não é conferido",
  () => achar(cliente({ journey_stage: "contato" })).length, 0);

// --------------------------------------- 1. A FONTE NÃO CONHECE (o pior caso)
// Sem chave, a sincronização NUNCA alcança — é o único que não se resolve com
// o tempo, e por isso vem primeiro na lista.
eq("cliente sem código do sistema de origem é contradição",
  () => achar(cliente({ custom: {} })).map((a) => a.tipo), ["fora_da_fonte"]);

// --------------------------------------------------- 2. VIGÊNCIA JÁ VENCIDA
eq("vigência vencida e ninguém deu baixa",
  () => achar(cliente({ contract_end: "2026-07-01" })).map((a) => a.tipo), ["vigencia_vencida"]);

eq("vigência que vence amanhã ainda não é contradição",
  () => achar(cliente({ contract_end: "2026-08-16" })).length, 0);

// ------------------------------------- 3. ⚠ NÃO AFIRMAR SOBRE AUSÊNCIA DE DADO
eq("contrato e zero pagamento, COM os recebimentos conferidos",
  () => achar(cliente({ custom: { codigo_sistema: "1", recebimentos_conferidos_em: "2026-08-14", pagamentos: 0 } }))
    .map((a) => a.tipo), ["sem_pagamento"]);

eq("sem os recebimentos conferidos, NÃO acusa — silêncio de dado não é fato",
  () => achar(cliente({ custom: { codigo_sistema: "1" } })).length, 0);

// ------------------------------------------------------ 4. CLIENTE SEM RÉGUA
eq("cliente sem vigência nenhuma, num ramo que usa contrato",
  () => achar(cliente({ contract_end: null })).map((a) => a.tipo), ["sem_vigencia"]);

// ⚠ E O MESMO CASO NÃO É NADA onde não existe contrato. Numa barbearia,
// cliente sem data de vencimento é o normal.
eq("ramo sem contrato não produz contradição nenhuma",
  () => achar(cliente({ contract_end: null }), false).length, 0);

// --------------------------------------------------- 5. A LISTA TEM QUE ENCOLHER
eq("quem já foi baixado como encerrado não volta — é história, não erro",
  () => achar(cliente({ contract_end: "2026-07-01", custom: { codigo_sistema: "1", contrato_encerrado_em: "2026-07-02" } })).length, 0);

eq("quem o gestor conferiu à mão some da lista",
  () => achar(cliente({ contract_end: null, custom: { codigo_sistema: "1", conferido_em: "2026-08-15" } })).length, 0);

// ------------------------------------------------------------ A ORDEM IMPORTA
// O que não se resolve sozinho vem primeiro.
eq("o que a fonte não conhece vem antes do resto",
  () => acharContradicoes({
    contatos: [
      cliente({ id: "b", name: "Bianca", contract_end: null }),
      cliente({ id: "a", name: "Ana", custom: {} }),
    ],
    etapasGanhas: GANHAS, usaContrato: true, hojeISO: HOJE,
  }).map((a) => a.tipo), ["fora_da_fonte", "sem_vigencia"]);

console.log();

// ------------------------------- DUAS FICHAS, UMA PESSOA (01/set/2026)
//
// ⚠ O SISTEMA JA SABIA E NUNCA CONTOU. `idsComGemeoAtivo` esconde da fila,
// desde agosto, o cadastro velho de quem tem outra ficha com contrato
// correndo — para nao mandar reativacao para quem e cliente. Esconder e a
// decisao certa e NAO e conserto: o cadastro segue dobrado, contando como
// ex-cliente na carteira, e ninguem nunca e avisado.
//
// E o caso tem nome: a Lilian rematriculou, alguem criou ficha nova com um
// digito a menos no telefone, e a ficha velha recebeu 'voce treinou com a
// gente e acabou parando'. Unica contradicao que ja chegou numa pessoa real.
const DUPLA = [
  { id: "velha", name: "Lilian Cabral", journey_stage: "ex_aluno", contract_end: null, phone: "51999998888", custom: { codigo_sistema: "1" } },
  { id: "ativa", name: "Lilian Cabral Leao", journey_stage: "convertido", contract_end: "2027-08-09", phone: "51999998888", custom: { codigo_sistema: "2" } },
];

const comGemeo = acharContradicoes({
  contatos: DUPLA,
  etapasGanhas: new Set(["convertido"]),
  usaContrato: true,
  hojeISO: "2026-09-01",
  gemeos: [{ velhoId: "velha", ativoId: "ativa" }],
});
eq("a ficha dobrada vira contradicao", comGemeo.filter((c) => c.tipo === "duplicata").length, 1);
eq("e ela aponta a ficha VELHA, nao a ativa", comGemeo.find((c) => c.tipo === "duplicata")?.contactId, "velha");
// ⚠ A DESCRICAO NOMEIA A OUTRA FICHA. Sem o nome do gemeo, a pessoa nao tem
// como achar as duas para juntar — e a lista viraria mais uma que ninguem usa.
eq("e nomeia com quem ela se repete", comGemeo.find((c) => c.tipo === "duplicata")?.descricao.includes("Lilian Cabral Leao"), true);
// Duplicata vem primeiro: e a de maior custo de estar errada.
eq("duplicata encabeca a lista", comGemeo[0]?.tipo, "duplicata");

// ⚠ SEM PARES, NADA MUDA. A varredura mora em `lib/gemeo.ts` e vem de fora;
// este arquivo nao recalcula telefone, senao existiriam duas respostas para
// 'quem esta duplicado' e a fila esconderia um conjunto diferente da tela.
const semGemeo = acharContradicoes({
  contatos: DUPLA,
  etapasGanhas: new Set(["convertido"]),
  usaContrato: true,
  hojeISO: "2026-09-01",
});
eq("sem os pares, nenhuma duplicata e inventada", semGemeo.filter((c) => c.tipo === "duplicata").length, 0);

if (falhas.length) {
  console.log(`✗ FALHOU — ${ok}/${ok + falhas.length}`);
  for (const f of falhas) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ PASSOU — ${ok}/${ok}`);
