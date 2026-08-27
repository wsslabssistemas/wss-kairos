import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { rodarMotor, type ResultadoDoMotor } from "@/lib/motor-db";
import { registrarRodada } from "@/lib/motor-registro";
import { lerTudo } from "@/lib/paginado";

// A RODADA DE TODAS AS EMPRESAS — o que o agendador chama.
//
// ⚠ UMA EMPRESA QUE FALHA NÃO PODE DERRUBAR AS OUTRAS. Com um cliente isso é
// teórico; com cinco é a diferença entre "a Be Fitness teve um problema" e
// "a automação parou para todo mundo e ninguém sabe". Por isso cada tenant
// roda dentro do próprio `try`, e o erro dela vira uma linha no relatório em
// vez de uma exceção que sobe.
//
// ⚠ E EM SÉRIE, não em paralelo — pelo mesmo motivo do envio: rajada é o
// padrão que faz o WhatsApp marcar a conta, e o teto diário de cada empresa
// perde o sentido se as chamadas se atropelarem.

export type RodadaDoMotor = {
  quando: string;
  empresas: number;
  enviadas: number;
  falhas: number;
  detalhe: {
    tenant: string;
    ok: boolean;
    porque: string;
    enviadas: number;
    falhas: number;
    erro?: string;
  }[];
};

export async function rodarTodasAsEmpresas(simular = false): Promise<RodadaDoMotor> {
  const admin = createAdminClient();

  // paginacao-ok: `lerTudo` já pagina — e a lista de empresas é a tabela que
  // mais cresce quando o produto der certo.
  const tenants = await lerTudo<{ id: string; name: string; slug: string; skill_key: string }>(
    (de, ate) => admin
      .from("tenants")
      .select("id, name, slug, skill_key")
      .order("id")
      .range(de, ate),
    { rotulo: "empresas para o motor" },
  );

  const detalhe: RodadaDoMotor["detalhe"] = [];
  let enviadas = 0;
  let falhas = 0;

  for (const t of tenants) {
    // ⚠ NENHUM TENANT `demo-` RECEBE MENSAGEM. É a regra do prefixo do
    // CLAUDE.md aplicada ao caminho mais perigoso que existe: dado fictício
    // com telefone plausível, e uma máquina disparando sozinha.
    if (t.slug.startsWith("demo-")) continue;

    try {
      const r: ResultadoDoMotor = await rodarMotor({
        tenantId: t.id,
        skillKey: t.skill_key,
        tenantNome: t.name,
        simular,
      });
      // ⚠ A RODADA DO AGENDADOR FICA REGISTRADA — inclusive a que não mandou
      // nada. Em 27/ago o cron do GitHub pulou a execução das 9h e ninguém
      // soube: "não rodou" era indistinguível de "não havia ninguém".
      await registrarRodada({ tenantId: t.id, origem: "agendador", resultado: r });

      enviadas += r.enviadas;
      falhas += r.falhas.length;
      detalhe.push({
        tenant: t.slug,
        ok: true,
        porque: r.plano.porque,
        enviadas: r.enviadas,
        falhas: r.falhas.length,
      });
      if (r.falhas.length) {
        console.error(
          `[motor] ${t.slug}: ${r.falhas.length} falha(s) — ` +
          r.falhas.map((f) => f.motivo).join(" | "),
        );
      }
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      console.error(`[motor] ${t.slug} FALHOU: ${erro}`);
      await registrarRodada({ tenantId: t.id, origem: "agendador", erro });
      detalhe.push({ tenant: t.slug, ok: false, porque: "", enviadas: 0, falhas: 0, erro });
    }
  }

  return {
    quando: new Date().toISOString(),
    empresas: detalhe.length,
    enviadas,
    falhas,
    detalhe,
  };
}
