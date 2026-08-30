/**
 * O DNA A PARTIR DE TEXTO SOLTO — e por que a validacao e mais importante que
 * a extracao.
 *
 * ⚠ POR QUE ESTA PECA EXISTE. O gargalo do produto nao e o motor: e o primeiro
 * dia. Empresa sem DNA recebe recusa em tudo — a trava anti-invencao faz o
 * certo e o dono conclui que o produto nao funciona. Darvil e Feltros estao
 * cadastradas e paradas por isso. Preencher trinta campos do zero e uma tarde
 * que ninguem tem; corrigir dez preenchidos leva minutos.
 *
 * ⚠ E O RISCO E O OPOSTO DO QUE PARECE. Nao e a IA extrair de menos — e ela
 * extrair DEMAIS. Modelo prestativo inventa campo que o manifesto nao tem, e
 * preenche com "nao informado" o que nao achou. As duas coisas viram FATO
 * DECLARADO para a trava anti-invencao, que passa a afirmar preco e condicao
 * com a confianca de dado conferido. Por isso a validacao descarta, e mostra o
 * que descartou.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { validarProposta, esquemaParaPedido } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/dna-extrator.ts")).href
);

let falhas = 0;
const verifica = (nome, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
};

const SECOES = [
  { key: "pricing", label: "Planos e valores", fields: [
    { key: "range", type: "money_range", label: "Faixa" },
    { key: "plans", type: "table", label: "Planos", columns: ["nome", "valor"] },
    { key: "payment_methods", type: "list", label: "Formas de pagamento" },
  ]},
  { key: "availability", label: "Horario", fields: [
    { key: "weekly_hours", type: "schedule", label: "Horario semanal" },
  ]},
  { key: "free_notes", label: "Observacoes" },
];

// ------------------------------------------------------------ o caso normal
const p = validarProposta({
  pricing: { range: "R$ 40 a R$ 90", payment_methods: ["Pix", "Credito"] },
  availability: { weekly_hours: "Seg a Sex 9h-19h" },
}, SECOES);
verifica("aceita o que o manifesto declara", p.valores.pricing.range, "R$ 40 a R$ 90");
verifica("e diz o que ficou faltando", p.faltando.map((f) => f.campo), ["plans"]);

// ⚠ CAMPO INVENTADO E DESCARTADO. O modelo cria `desconto_aniversario` porque o
// texto falou em aniversario — e esse campo nao existe em tela nenhuma, entao
// ninguem nunca vai conferir nem corrigir. Dado que entra e nao pode ser visto
// e pior que dado ausente.
const inv = validarProposta({
  pricing: { range: "R$ 50", desconto_aniversario: "10% no mes do aniversario" },
  promocoes: { black_friday: "50%" },
}, SECOES);
verifica("campo inventado nao entra", inv.valores.pricing, { range: "R$ 50" });
verifica("secao inventada nao entra", inv.valores.promocoes, undefined);
// ⚠ E O DESCARTE APARECE. Sumir com o que foi ignorado faria a pessoa achar que
// o texto dela foi todo aproveitado.
verifica("e os dois descartes sao relatados", inv.descartado.length, 2);
verifica("com o caminho de cada um",
  inv.descartado.map((d) => d.caminho).sort(), ["pricing.desconto_aniversario", "promocoes"]);

// ⚠ "NAO INFORMADO" VALE ZERO. O modelo preenche por educacao, e a trava
// anti-invencao leria isso como FATO DECLARADO — passando a afirmar a um
// cliente que o preco e "nao informado".
for (const lixo of ["", "   ", "não informado", "N/A", "-", "não sei", "desconhecido"]) {
  const r = validarProposta({ pricing: { range: lixo } }, SECOES);
  verifica(`"${lixo || "(vazio)"}" nao preenche o campo`, r.valores.pricing, undefined);
}
verifica("lista vazia tambem nao preenche",
  validarProposta({ pricing: { payment_methods: [] } }, SECOES).valores.pricing, undefined);

// Secao sem campos declarados guarda valor unico.
verifica("secao de texto livre guarda o valor",
  validarProposta({ free_notes: "Atendemos so com hora marcada." }, SECOES).valores.free_notes,
  { __valor: "Atendemos so com hora marcada." });

// ⚠ O ESQUEMA SAI DO MANIFESTO, nunca de codigo. Descrever os campos aqui faria
// o extrator servir academia e calar para oficina — e seria vocabulario de
// mercado dentro do nucleo (Lei 1).
const esquema = esquemaParaPedido(SECOES);
verifica("o esquema cita os campos do manifesto",
  esquema.includes("weekly_hours") && esquema.includes("Formas de pagamento"), true);
verifica("e leva as colunas da tabela junto", esquema.includes("colunas: nome, valor"), true);

// Resposta podre nao derruba: devolve vazio com o motivo.
verifica("resposta que nao e objeto vira descarte",
  validarProposta({ pricing: "R$ 50" }, SECOES).descartado[0].motivo,
  "esperava um objeto com os campos da seção");
verifica("nulo nao quebra", validarProposta(null, SECOES).valores, {});

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
