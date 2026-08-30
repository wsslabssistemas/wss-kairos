// QUEM LÊ A TABELA `skills`, E COM QUAL CLIENTE.
//
// POR QUE ESTE TESTE EXISTE
// A policy `skills_read_installed` só deixa o usuário ver a Skill JÁ INSTALADA
// na empresa dele:
//
//   using ( exists (select 1 from tenant_skills ts
//                    where ts.skill_id = skills.id and is_member_of(ts.tenant_id)) )
//
// Consequência: com o cliente do USUÁRIO, qualquer pergunta sobre um segmento
// que ainda não está instalado volta VAZIA. Não dá erro. Não dá aviso. Volta
// zero linhas, e a tela decide alguma coisa errada em cima disso.
//
// Isso derrubou o produto TRÊS VEZES em 9/ago/2026, sempre com sintoma
// diferente e sempre com a mesma causa:
//
//   1. `listarRamos` (criar empresa) — a lista dos 15 ramos vinha VAZIA para
//      quem ainda não tem empresa. A primeira cliente externa travou aqui e
//      descreveu como "coloquei o nome e ele continuou pedindo o nome".
//   2. `listSegments` (onboarding) — o seletor de trocar de ramo mostrava UMA
//      opção: a que a pessoa já tinha. Não parece defeito, parece decisão.
//   3. `installSkill` (onboarding) — a conferência "esse segmento existe?"
//      voltava nula para todo segmento que não fosse o atual, e a tela
//      recusava TODOS com "Segmento não disponível".
//
// As três foram corrigidas uma de cada vez, e a segunda e a terceira estavam
// no mesmo arquivo. Corrigir ocorrência não fecha classe.
//
// O QUE ESTE TESTE FAZ
// Ele NÃO tenta adivinhar se o cliente está certo — adivinhação gera alarme
// falso e alarme falso ensina a ignorar teste. Ele mantém um INVENTÁRIO: todo
// ponto do app que lê `skills` está listado abaixo, classificado e justificado.
//
// Ponto novo que não está no inventário FALHA. Quem adicionou é obrigado a
// dizer em qual dos dois casos ele cai — e é exatamente essa pergunta que eu
// deixei de fazer três vezes.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = new URL("../../../apps/web/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * O inventário.
 *
 * `proprio`  — lê o manifesto da Skill JÁ INSTALADA do tenant. O vínculo
 *              existe, a RLS passa, o cliente do usuário está CERTO (e é o
 *              mais seguro: respeita o isolamento por empresa).
 * `catalogo` — pergunta sobre o catálogo de segmentos em geral (listar todos,
 *              ou conferir um que ainda não está instalado). A RLS
 *              necessariamente devolve vazio. TEM que ser `service_role`.
 */
const INVENTARIO = {
  "app/calendario/[token]/route.ts": "proprio",
  "app/painel/admin/acesso/page.tsx": "catalogo",
  "app/painel/contatos/[id]/page.tsx": "proprio",
  "app/painel/dna/editar/page.tsx": "proprio",
  // O extrator le as `dna_sections` do manifesto da Skill JA INSTALADA para
  // saber quais campos existem — vinculo do tenant, cliente do usuario basta.
  "app/painel/dna/extrair-actions.ts": "proprio",
  "app/painel/dna/page.tsx": "proprio",
  "app/painel/fila/actions.ts": "proprio",
  "app/painel/funil/page.tsx": "proprio",
  "app/painel/nova-empresa/actions.ts": "catalogo",
  "app/painel/onboarding/page.tsx": "proprio",
  "app/painel/onboarding/segmento-actions.ts": "catalogo",
  "app/painel/page.tsx": "proprio",
  "app/painel/responder/ai-actions.ts": "proprio",
  "lib/entitlements.ts": "proprio",
  "lib/skill.ts": "proprio",
};

function arquivos(dir, acc = []) {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next") continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, acc);
    else if (/\.(ts|tsx)$/.test(nome)) acc.push(p);
  }
  return acc;
}

const encontrados = new Map(); // caminho -> [linhas]
for (const p of arquivos(RAIZ)) {
  const txt = readFileSync(p, "utf8");
  if (!txt.includes('from("skills")')) continue;
  const rel = relative(RAIZ, p).replace(/\\/g, "/");
  const linhas = txt
    .split("\n")
    .map((l, i) => ({ n: i + 1, l }))
    .filter((x) => x.l.includes('from("skills")'));
  encontrados.set(rel, linhas);
}

const falhas = [];
let passou = 0;

// 1. Ponto novo, não inventariado
for (const [rel, linhas] of encontrados) {
  if (!(rel in INVENTARIO)) {
    falhas.push(
      `PONTO NOVO lendo \`skills\` e fora do inventário: ${rel} (linha ${linhas[0].n})\n` +
        "      Classifique em packages/db/tests/skills_client_check.mjs:\n" +
        "        `proprio`  = lê o manifesto da Skill JÁ INSTALADA do tenant → cliente do usuário\n" +
        "        `catalogo` = pergunta sobre segmento NÃO instalado → PRECISA de service_role,\n" +
        "                     senão a RLS devolve vazio sem erro e a tela decide errado.",
    );
  } else passou++;
}

// 2. Ponto que saiu do código e ficou no inventário — some para o inventário
//    não virar folclore.
for (const rel of Object.keys(INVENTARIO)) {
  if (!encontrados.has(rel)) {
    falhas.push(`No inventário e não lê mais \`skills\`: ${rel} — remova a entrada.`);
  } else passou++;
}

// 3. Todo ponto marcado `catalogo` tem que usar o cliente admin no arquivo.
for (const [rel, linhas] of encontrados) {
  if (INVENTARIO[rel] !== "catalogo") continue;
  const txt = readFileSync(join(RAIZ, rel), "utf8");
  if (!txt.includes("createAdminClient")) {
    falhas.push(
      `${rel} é \`catalogo\` mas não importa \`createAdminClient\`.\n` +
        "      Com o cliente do usuário esta consulta volta VAZIA — sem erro, sem aviso.",
    );
  } else {
    // A linha do `from("skills")` precisa partir de um cliente admin.
    const ruins = linhas.filter((x) => !/\b(admin|adminClient|db)\b\s*\n?\s*\./.test(x.l) && !/^\s*\.from/.test(x.l));
    if (ruins.length) {
      const ok = ruins.every((x) => /admin/.test(x.l));
      if (!ok) {
        falhas.push(
          `${rel}: leitura de \`skills\` que não parte do cliente admin —\n` +
            ruins.map((x) => `        linha ${x.n}: ${x.l.trim()}`).join("\n"),
        );
      } else passou++;
    } else passou++;
  }
}

console.log(`  ${encontrados.size} arquivos leem \`skills\`; inventário tem ${Object.keys(INVENTARIO).length}.`);

const total = passou + falhas.length;
if (falhas.length) {
  console.error(`\n✗ FALHOU — ${passou}/${total}\n`);
  for (const f of falhas) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`\n✓ PASSOU — ${passou}/${total}`);
