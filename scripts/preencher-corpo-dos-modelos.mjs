/**
 * PREENCHE O TEXTO DOS MODELOS JÁ ENVIADOS — uma vez, no acervo.
 *
 * ⚠ POR QUE ESTE SCRIPT EXISTE. Até 31/ago/2026 o envio de modelo aprovado
 * gravava no histórico só o NOME: `(modelo "reativacao_ex_aluno")`. São 114
 * interações assim. A IA que redige a resposta lia um rótulo vazio seguido de
 * "Oi sim" — a cliente respondendo uma pergunta que o modelo não tinha como
 * ver. `lib/despacho.ts` já grava o texto renderizado; isto conserta o que
 * ficou para trás, que é justamente a campanha em andamento.
 *
 * ⚠ NÃO É MIGRATION, de propósito: migration roda em todo ambiente e este
 * conserto é de DADO de produção. Num banco novo não existe linha para
 * corrigir, e numerá-lo faria parecer que existe.
 *
 * ⚠ E ELE USA AS MESMAS FUNÇÕES DO ENVIO (`primeiroNome`,
 * `higienizarParametro`, `renderizarModelo`). Reescrever a substituição aqui
 * produziria um histórico *parecido* com o que saiu — e histórico parecido é
 * pior que histórico ausente, porque ninguém desconfia dele.
 *
 * Uso:  node scripts/preencher-corpo-dos-modelos.mjs [--aplicar]
 * Sem `--aplicar` ele só mostra o que faria.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { primeiroNome, higienizarParametro, renderizarModelo } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/modelo.ts")).href
);

function env() {
  const file = path.join(ROOT, "apps", "web", ".env.local");
  if (!fs.existsSync(file)) throw new Error("apps/web/.env.local não encontrado.");
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const e = env();
const db = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const aplicar = process.argv.includes("--aplicar");

// O rótulo antigo, exatamente como `despacho.ts` gravava.
const ROTULO = /^\(modelo "([a-z0-9_]+)"\)$/;

const [{ data: linhas, error: e1 }, { data: corpos }, { data: tenants }] = await Promise.all([
  db.from("interactions").select("id, tenant_id, contact_id, content").like("content", '(modelo "%'),
  db.from("modelos_canal").select("tenant_id, nome, corpo"),
  db.from("tenants").select("id, name"),
]);
if (e1) throw new Error(e1.message);

const nomeDoTenant = new Map((tenants ?? []).map((t) => [t.id, t.name]));
const corpoDe = (tenantId, nome) =>
  (corpos ?? []).find((c) => c.tenant_id === tenantId && c.nome === nome)?.corpo ??
  (corpos ?? []).find((c) => c.tenant_id === null && c.nome === nome)?.corpo ??
  null;

const ids = [...new Set((linhas ?? []).map((l) => l.contact_id).filter(Boolean))];
const contatos = new Map();
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await db.from("contacts").select("id, name").in("id", ids.slice(i, i + 200));
  for (const c of data ?? []) contatos.set(c.id, c.name);
}

let feitas = 0;
const pulos = [];
for (const l of linhas ?? []) {
  const m = ROTULO.exec(l.content ?? "");
  if (!m) continue;
  const corpo = corpoDe(l.tenant_id, m[1]);
  if (!corpo) { pulos.push(`${l.id}: sem corpo para "${m[1]}"`); continue; }

  const nome = primeiroNome(contatos.get(l.contact_id));
  const empresa = higienizarParametro(nomeDoTenant.get(l.tenant_id));
  if (!nome.ok || !empresa.ok) { pulos.push(`${l.id}: ${nome.ok ? empresa.motivo : nome.motivo}`); continue; }

  // ⚠ SÓ MODELO DE DUAS VARIÁVEIS. `combinado` e `renovacao` afirmam uma DATA
  // em `{{3}}`, e a data que saiu naquele dia não é recuperável com confiança
  // (a ficha pode ter mudado depois). Reconstruir por aproximação escreveria
  // no histórico uma data que talvez nunca tenha sido dita — que é inventar
  // fato, o defeito que o produto inteiro existe para não cometer.
  if (corpo.includes("{{3}}")) { pulos.push(`${l.id}: modelo "${m[1]}" afirma data — nao reconstruo`); continue; }

  const texto = renderizarModelo(corpo, [nome.valor, empresa.valor]);
  if (aplicar) {
    const { error } = await db.from("interactions").update({ content: texto }).eq("id", l.id);
    if (error) { pulos.push(`${l.id}: ${error.message}`); continue; }
  }
  feitas++;
}

console.log(`${aplicar ? "preenchidas" : "preencheria"}: ${feitas}`);
if (pulos.length) {
  console.log(`puladas: ${pulos.length}`);
  for (const p of pulos.slice(0, 10)) console.log(`  ${p}`);
}
if (!aplicar) console.log("\n(nada foi gravado — rode com --aplicar)");
