/**
 * O MANIFESTO DO REPOSITÓRIO x O MANIFESTO QUE ESTÁ RODANDO.
 *
 * ⚠ POR QUE ESTE TESTE EXISTE — e ele nasceu de um erro que chegou na lead.
 *
 * Em 20/ago o motor disse a uma pessoa que *"segunda à tarde não temos horário
 * livre"* — negando uma coisa que existe, numa academia onde nada está
 * disputado. A correção foi escrita no mesmo dia: a chave
 * `scheduling.todo_horario_aberto_vale` no manifesto de academia, com o
 * comentário explicando o caso.
 *
 * **E em 21/ago o erro aconteceu de novo, com outra lead.**
 *
 * O motivo não estava no código nem no YAML: os dois estavam certos. O
 * manifesto que o sistema LÊ mora na tabela `skills`, e nada leva o YAML até
 * lá — quem leva é `scripts/seed-skills.mjs`, rodado à mão. O commit foi
 * feito, o CI passou, a Vercel publicou, e o banco continuou com a versão
 * velha. Por quatro dias.
 *
 * ⚠ É a mesma classe do "mover a fonte de verdade é fácil; achar os LEITORES é
 * o trabalho", com um agravante: aqui o leitor não é uma linha de código que
 * um `grep` acha — é uma linha de um banco, que nenhuma ferramenta do
 * repositório enxerga.
 *
 * O QUE ELE GUARDA
 * Que "está no repositório" pare de ser confundido com "está valendo".
 *
 * ⚠ E ELE SÓ RODA COM CREDENCIAL. Sem `.env.local` ele **avisa e passa** em
 * vez de falhar: trava que quebra o CI de quem não tem segredo é trava que
 * alguém desliga. Rode antes de fechar qualquer entrega que mexa em manifesto:
 *
 *   node packages/db/tests/manifesto_no_banco_check.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SKILLS = path.join(ROOT, "packages", "skills");

function env() {
  const f = path.join(ROOT, "apps", "web", ".env.local");
  if (!fs.existsSync(f)) return null;
  const out = {};
  // Normaliza CRLF: os arquivos daqui estão em CRLF e o CI roda em LF — duas
  // travas já mediram coisa diferente na máquina do fundador e no CI.
  for (const line of fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const e = env();
if (!e?.SUPABASE_SERVICE_ROLE_KEY || !e?.NEXT_PUBLIC_SUPABASE_URL) {
  console.log("manifesto_no_banco: sem credencial local — pulado (nao e falha).");
  process.exit(0);
}

const db = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * As chaves conferidas, uma a uma.
 *
 * ⚠ COMPARAR O MANIFESTO INTEIRO NÃO FUNCIONA: o YAML tem comentários, ordem e
 * tipos que o JSONB do Postgres normaliza, então a igualdade byte a byte
 * acusaria diferença sempre — e trava que acusa sempre é trava que se ignora.
 * A lista abaixo é das chaves cuja AUSÊNCIA muda o que o cliente recebe.
 */
const CHAVES = [
  ["scheduling.todo_horario_aberto_vale", "o motor NEGA horario que existe"],
  ["contract.ended_stage", "a reativacao nao existe para o segmento"],
  ["contract.planos", "quem fez aula avulsa vira ex-aluno"],
  ["hard_rules", "as regras permanentes do ramo somem do prompt"],
  ["strategy_map", "toda situacao cai na escola padrao"],
];

const pegar = (obj, caminho) =>
  caminho.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * Comparação que NÃO depende da ordem das chaves.
 *
 * ⚠ A primeira versão usava `JSON.stringify` direto e acusou 15 divergências
 * que não existiam: o JSONB do Postgres **reordena as chaves do objeto**, e o
 * `strategy_map` voltava com a mesma informação em outra ordem. Trava que
 * acusa sempre é trava que alguém desliga — o defeito estava na medição, não
 * no dado.
 */
function estavel(v) {
  if (Array.isArray(v)) return `[${v.map(estavel).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const { data, error } = await db.from("skills").select("key, manifest");
if (error) {
  console.error("Falha ao ler `skills`:", error.message);
  process.exit(1);
}
const noBanco = new Map((data ?? []).map((r) => [r.key, r.manifest ?? {}]));

let falhas = 0;
let conferidos = 0;

for (const dir of fs.readdirSync(SKILLS)) {
  const arq = path.join(SKILLS, dir, "manifest.yaml");
  if (!fs.existsSync(arq)) continue;

  const doRepo = yaml.parse(fs.readFileSync(arq, "utf8").replace(/\r\n/g, "\n"));
  const db_ = noBanco.get(doRepo.key);

  if (!db_) {
    console.log(`FALHA  ${doRepo.key}: existe no repositorio e NAO existe na tabela skills.`);
    falhas++;
    continue;
  }

  for (const [caminho, consequencia] of CHAVES) {
    const a = pegar(doRepo, caminho);
    if (a === undefined) continue; // o segmento nao declara: nao ha o que comparar
    conferidos++;
    const b = pegar(db_, caminho);
    if (estavel(a) !== estavel(b)) {
      falhas++;
      console.log(
        `FALHA  ${doRepo.key} — \`${caminho}\` esta diferente no banco.\n` +
          `       repositorio: ${estavel(a).slice(0, 90)}\n` +
          `       banco:       ${estavel(b).slice(0, 90)}\n` +
          `       consequencia: ${consequencia}.`,
      );
    }
  }
}

if (falhas) {
  console.log(
    `\nmanifesto_no_banco: ${falhas} divergencia(s) em ${conferidos} chaves conferidas.\n` +
      "O repositorio e a verdade; o banco e onde ela roda. Para levar uma na outra:\n" +
      "  node scripts/seed-skills.mjs <segmento>",
  );
  process.exit(1);
}

console.log(`✓ PASSOU — ${conferidos} chaves conferidas, o banco espelha o repositorio.`);
