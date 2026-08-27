import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { getSkillFormConfig } from "@/lib/skill";
import { buildCsv } from "@/lib/csv";
import { lerTudo } from "@/lib/paginado";
import { dataLocal } from "@/lib/fuso";

export async function GET(request: Request) {
  const url = new URL(request.url);

  // Modelo em branco para o usuário preencher.
  if (url.searchParams.get("template")) {
    const csv = buildCsv([["nome", "telefone"], ["Maria Silva", "51982512270"]]);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="modelo-contatos.csv"',
      },
    });
  }

  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return new Response("Sem empresa", { status: 401 });

  const { stages } = await getSkillFormConfig(tenant.skill_key);
  const stageLabel = (k: string) => stages.find((s) => s.key === k)?.label ?? k;

  const supabase = await createClient();
  // ⚠ PAGINADO. Isto é a BASE DE CONTATOS SAINDO DO PRODUTO — o arquivo que
  // alguém guarda como cópia da sua carteira. Cortado em 1.000, ele sai com
  // cara de completo: cabeçalho certo, nomes reais, sem nenhum sinal de que
  // faltam duas mil pessoas.
  //
  // O `id` entra na ordenação como critério de desempate: `created_at` repete
  // em importação em lote, e com chave não-única o `.range()` pode pular e
  // repetir linha entre uma página e outra.
  const data = await lerTudo<{ name: string; phone: string | null; journey_stage: string; source: string | null; created_at: string }>(
    (de, ate) => supabase
      .from("contacts")
      .select("name, phone, journey_stage, source, created_at")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id")
      .range(de, ate),
    { rotulo: "contatos da exportacao" },
  );

  const rows: (string | null)[][] = [["nome", "telefone", "etapa", "origem", "criado_em"]];
  for (const c of data) {
    rows.push([
      c.name,
      c.phone,
      stageLabel(c.journey_stage),
      c.source,
      dataLocal(c.created_at),
    ]);
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(buildCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contatos-${tenant.slug}-${date}.csv"`,
    },
  });
}
