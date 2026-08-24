/**
 * IMPORTA OS EX-ALUNOS a partir do relatório de recebimentos.
 *
 * ⚠ SIMULA POR PADRÃO. Só grava com `--aplicar`, e é de propósito: importar
 * mil pessoas num sistema em uso não se desfaz com um clique. É a mesma regra
 * do `importar-base44.mjs` e da tela de sincronização — prever, olhar, aplicar.
 *
 *   node scripts/importar-ex-alunos.mjs "<Recebimentos.xls>" [slug]
 *   node scripts/importar-ex-alunos.mjs "<Recebimentos.xls>" be-fitness --aplicar
 *
 * QUEM ENTRA: quem pagou pelo menos uma vez e **não é aluno hoje** — a
 * definição está em `diagnostico-ex-alunos.mjs`. Decisão do fundador em
 * 15/ago: entram TODOS os 1.200, inclusive os 201 que pararam antes de 2024,
 * e inclusive os 37 sem telefone.
 *
 * ⚠ AS TRÊS COISAS QUE ESTE SCRIPT FAZ E QUE UM `INSERT` INGÊNUO NÃO FARIA:
 *
 * 1. **`created_at` HISTÓRICO.** Sem isso as 1.200 pessoas nascem como "leads
 *    de hoje", e conversão é `convertidos ÷ leads do período`: a Gestão, o
 *    Placar e o Analista reportariam 1.200 leads novos com 14 fechamentos, e
 *    os três recepcionistas apareceriam com desempenho catastrófico por 30
 *    dias. O número sairia plausível e errado — a classe que mais custou aqui.
 *
 * 2. **`stage_entered_at` = a data em que a pessoa SAIU** (o último pagamento).
 *    É o que a régua de reativação usa como marco e o que a fila usa para pôr
 *    quem saiu há menos tempo na frente.
 *
 * 3. **A carteira é DIVIDIDA** entre quem atende. Quem roda o script é o
 *    fundador, e a Fila abre na carteira de quem está logado: tudo no nome
 *    dele seria 1.200 pessoas invisíveis para os três recepcionistas.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { lerRecebimentos } = await import(pathToFileURL(path.join(ROOT, "apps/web/lib/planilha.ts")).href);
const { normalizePhone } = await import(pathToFileURL(path.join(ROOT, "apps/web/lib/phone.ts")).href);
const { escolherResponsavel } = await import(pathToFileURL(path.join(ROOT, "apps/web/lib/carteira.ts")).href);

const arquivo = process.argv[2];
const slug = process.argv.find((a, i) => i > 2 && !a.startsWith("--")) ?? "be-fitness";
const APLICAR = process.argv.includes("--aplicar");
if (!arquivo) { console.error('Uso: node scripts/importar-ex-alunos.mjs "<arquivo>" [slug] [--aplicar]'); process.exit(1); }

const env = fs.readFileSync(path.join(ROOT, "apps/web/.env.local"), "utf8");
const pega = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();
const supabase = createClient(pega("NEXT_PUBLIC_SUPABASE_URL"), pega("SUPABASE_SERVICE_ROLE_KEY"));

const { data: tenant } = await supabase.from("tenants").select("id, name, skill_key").eq("slug", slug).maybeSingle();
if (!tenant) { console.error(`Empresa "${slug}" não encontrada.`); process.exit(1); }

// A etapa de saída vem do MANIFESTO — "ex_aluno" é vocabulário de academia.
const { data: skill } = await supabase.from("skills").select("manifest").eq("key", tenant.skill_key).maybeSingle();
const ETAPA = skill?.manifest?.contract?.ended_stage;
if (!ETAPA) {
  console.error(`\n✗ O manifesto de "${tenant.skill_key}" não declara \`contract.ended_stage\`.`);
  console.error("  Sem ela o script não sabe em que etapa colocar quem saiu — e chutar aqui");
  console.error("  seria o núcleo inventando vocabulário de mercado (Lei 1).");
  process.exit(1);
}

// ------------------------------------------------------------------- LEITURA
const rec = lerRecebimentos(fs.readFileSync(arquivo, "utf8"));
if (rec.erro) { console.error(`\n✗ ${rec.erro}`); process.exit(1); }

// PAGINADO: corte aqui inverteria a conclusão — quem não viesse na página
// apareceria como desconhecido e seria criado de novo, duplicando gente.
const conhecidos = new Set();
const telefonesConhecidos = new Set();
for (let de = 0; ; de += 1000) {
  const { data, error } = await supabase
    .from("contacts").select("phone, custom")
    .eq("tenant_id", tenant.id).is("deleted_at", null).order("id").range(de, de + 999);
  if (error) throw new Error(error.message);
  for (const c of data ?? []) {
    const cod = c.custom?.["codigo_sistema"];
    if (cod) conhecidos.add(String(cod));
    if (c.phone) telefonesConhecidos.add(normalizePhone(c.phone));
  }
  if ((data ?? []).length < 1000) break;
}

// A equipe que recebe carteira. Agente é quem atende; sem nenhum, admin serve.
const { data: mems } = await supabase
  .from("memberships").select("id, role").eq("tenant_id", tenant.id).eq("status", "active").order("id");
const ativos = mems ?? [];
const agentes = ativos.filter((m) => m.role === "agent");
const time = agentes.length ? agentes : ativos;
const carga = {};
for (const a of time) {
  const { count } = await supabase.from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id).eq("owner_id", a.id).is("deleted_at", null);
  carga[a.id] = count ?? 0;
}

// ---------------------------------------------------------------- A MONTAGEM
/**
 * ⚠ QUEM PAGOU MENOS QUE UMA MENSALIDADE, POUCAS VEZES, NAO E EX-ALUNO.
 *
 * Achado em 24/ago/2026, com a campanha prestes a sair: o fundador olhou a
 * lista e disse *"esta aparecendo gente que fez o avulso, e normalmente quem
 * paga avulso e quem nao mora perto ou na cidade"*.
 *
 * Ele estava certo, e a causa e a fonte: esta base foi montada a partir do
 * arquivo de RECEBIMENTOS — quem PAGOU alguma coisa —, nao do de matriculas.
 * O arquivo de matriculas tem a coluna `Plano` e permite separar avulso de
 * contrato; o de recebimentos nao tem nada disso. Resultado: **todo turista
 * que treinou um dia entrou como ex-aluno.** Eram 91 de 1.088.
 *
 * ⚠ E O CORTE NAO PODE SER PELA MEDIA POR PAGAMENTO, que foi a primeira ideia
 * e estava errada: o anual parcelado e **12x R$ 99**, entao "media abaixo de
 * R$ 100" excluiria 93 dos MELHORES ex-alunos. E ha gente pagando R$ 8 doze
 * vezes — copagamento de convenio, que e aluno de verdade.
 *
 * O corte que funciona usa as DUAS dimensoes: **total abaixo de uma
 * mensalidade E no maximo duas visitas**. Quem veio 12 vezes nao esta de
 * passagem, por menos que pague; quem pagou R$ 35 uma vez, esta.
 */
const MENSALIDADE_CENTS = 9900;   // a menor parcela de plano que existe hoje
const MAXIMO_DE_VISITAS = 2;
const eVisitaDePassagem = (p) =>
  Number.isFinite(p.totalCents) &&
  Number.isFinite(p.pagamentos) &&
  p.pagamentos > 0 &&
  p.pagamentos <= MAXIMO_DE_VISITAS &&
  p.totalCents < MENSALIDADE_CENTS;

const hoje = new Date().toISOString().slice(0, 10);
const linhas = [];
let jaExiste = 0, semNome = 0, telefoneRepetido = 0, visitas = 0;
const vistos = new Set();

for (const p of rec.pagantes) {
  if (conhecidos.has(p.chave)) { jaExiste++; continue; }
  const nome = (p.nome ?? "").trim();
  if (!nome) { semNome++; continue; }

  // ⚠ A VISITA NAO ENTRA NA REATIVACAO. Ela vai para `perdido` — o mesmo
  // lugar onde a importacao das matriculas ja coloca o "Treino Avulso" —,
  // porque mandar "volte a treinar" para quem nunca treinou aqui e a classe do
  // Gympass: mensagem plausivel chegando em quem nao deveria receber, no nome
  // da academia. E infla o denominador da retencao.
  const etapa = eVisitaDePassagem(p) ? "perdido" : ETAPA;
  if (etapa !== ETAPA) visitas++;

  const fone = p.telefone ? normalizePhone(p.telefone) : null;
  // Telefone que já existe na base é a MESMA PESSOA com outro código — criar
  // de novo duplicaria alguém que o vendedor já conhece. O índice único do
  // banco barraria, mas barrar em silêncio conta como "importado".
  if (fone && (telefonesConhecidos.has(fone) || vistos.has(fone))) { telefoneRepetido++; continue; }
  if (fone) vistos.add(fone);

  // A DATA DE SAÍDA. Sem último pagamento não há como saber quando saiu —
  // usa-se hoje, e a pessoa entra no fim da fila de reativação, que é o lugar
  // certo para quem o sistema sabe menos.
  const saiuEm = p.ultimoPagamento ?? hoje;

  linhas.push({
    tenant_id: tenant.id,
    name: nome,
    phone: fone,
    source: "ex-aluno (recebimentos)",
    journey_stage: etapa,
    stage_entered_at: `${saiuEm}T12:00:00Z`,
    // ⚠ HISTÓRICO. Ver a nota 1 no topo: sem isto a conversão da empresa
    // inteira desaba por 30 dias.
    created_at: `${saiuEm}T12:00:00Z`,
    owner_id: null, // preenchido abaixo, dividindo a carteira
    custom: {
      codigo_sistema: p.chave,
      saiu_em: saiuEm,
      pagamentos: p.pagamentos,
      total_pago_cents: p.totalCents,
      ultimo_pagamento: p.ultimoPagamento,
      atraso_habitual_dias: p.atrasoHabitualDias,
      recebimentos_conferidos_em: hoje,
    },
  });
}

// Divide DEPOIS de saber quantos são, e do mais recente para o mais antigo:
// assim cada vendedor recebe uma fatia parecida dos quentes e dos frios.
linhas.sort((a, b) => String(b.custom.saiu_em).localeCompare(String(a.custom.saiu_em)));
for (const l of linhas) {
  const dono = escolherResponsavel(time, carga);
  l.owner_id = dono;
  if (dono) carga[dono]++;
}

// ------------------------------------------------------------------ RELATÓRIO
const porAno = {};
for (const l of linhas) {
  const a = String(l.custom.saiu_em).slice(0, 4);
  porAno[a] = (porAno[a] ?? 0) + 1;
}
console.log(`\n${tenant.name} · etapa de destino: "${ETAPA}"`);
console.log(`${"=".repeat(58)}`);
console.log(`  a criar como ex-aluno:            ${String(linhas.length).padStart(6)}`);
console.log(`  já cadastrados (pulados):         ${String(jaExiste).padStart(6)}`);
// ⚠ APARECE NO RESUMO, e não em silêncio: quem lê precisa saber que N pessoas
// entraram FORA da reativação, senão a diferença entre o total do arquivo e o
// total da fila vira mistério.
console.log(`  visitas de passagem (→ perdido):  ${String(visitas).padStart(6)}`);
console.log(`  telefone já na base (pulados):    ${String(telefoneRepetido).padStart(6)}`);
console.log(`  sem nome (pulados):               ${String(semNome).padStart(6)}`);
console.log(`  sem telefone (entram mudos):      ${String(linhas.filter((l) => !l.phone).length).padStart(6)}`);
console.log(`${"=".repeat(58)}`);
console.log(`\n  Por ano de saída:`);
for (const a of Object.keys(porAno).sort().reverse()) console.log(`    ${a}  ${String(porAno[a]).padStart(5)}`);
console.log(`\n  Carteira depois da divisão:`);
for (const a of time) console.log(`    ${a.id.slice(0, 8)}…  ${String(carga[a.id]).padStart(5)}`);

if (!APLICAR) {
  console.log(`\n⚠ SIMULAÇÃO — nada foi gravado. Rode com --aplicar para valer.\n`);
  process.exit(0);
}

// -------------------------------------------------------------------- GRAVAÇÃO
let criados = 0;
const erros = [];
for (let i = 0; i < linhas.length; i += 200) {
  const lote = linhas.slice(i, i + 200);
  const { error } = await supabase.from("contacts").insert(lote);
  if (!error) { criados += lote.length; continue; }
  // Lote que colide no índice único cai para linha a linha, para um telefone
  // repetido não derrubar os outros 199.
  for (const l of lote) {
    const { error: e2 } = await supabase.from("contacts").insert(l);
    if (e2) erros.push(`${l.custom.codigo_sistema}: ${e2.message}`);
    else criados++;
  }
}

console.log(`\n✓ ${criados} ex-alunos criados.`);
if (erros.length) {
  console.log(`✗ ${erros.length} recusados pelo banco. Os três primeiros:`);
  for (const e of erros.slice(0, 3)) console.log(`    ${e}`);
}
console.log();
