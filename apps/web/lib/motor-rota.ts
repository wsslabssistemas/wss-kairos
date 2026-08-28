import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { rodarMotor, type ResultadoDoMotor } from "@/lib/motor-db";
import { registrarRodada } from "@/lib/motor-registro";
import { avaliarEspacamento } from "@/lib/espacamento";
import { vigiarCanal } from "@/lib/vigia-canal";
import { readAutomation } from "@/lib/automation";
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
//
// ⚠ O AGENDADOR BATE DE 15 EM 15 MINUTOS, E QUASE TODA BATIDA É RECUSADA.
// Isso é o desenho, não defeito. Em 27/ago o cron do GitHub perdeu as duas
// execuções do dia — `schedule` é best-effort e a documentação dele diz que
// sob carga *"some queued jobs may be dropped"*. Com duas batidas por dia,
// perder uma custava meio dia de campanha; com quarenta, custa quinze minutos.
// Quem decide a cadência passou a ser o motor (`lib/espacamento.ts`), e este
// arquivo continua sendo só quem bate na porta.
//
// ⚠ E A RECUSA VIRA LINHA NO BANCO. Sem isso, uma tabela com duas linhas por
// dia seria idêntica à de um agendador morto, e o defeito que a `0066` fechou
// voltaria pela porta da própria correção.

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
    /** A batida foi recusada pelo espaçamento — não houve rodada. */
    pulada?: boolean;
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
      // ⚠ O VIGIA RODA ANTES DO ESPAÇAMENTO E FORA DELE, de propósito. O
      // espaçamento governa QUANTO se manda; a saúde do canal é outra
      // pergunta, e ela precisa de resposta mesmo nas batidas em que nada sai.
      // Se ele viesse depois do `continue` da recusa, o canal só seria vigiado
      // duas vezes ao dia — nas rodadas que enviam —, que é exatamente o
      // intervalo em que uma assinatura desativada passa despercebida.
      //
      // ⚠ E ELE É BEST-EFFORT: `vigiarCanal` engole o próprio erro. Falhar em
      // vigiar não pode impedir uma mensagem de sair.
      if (!simular) await vigiarCanal(t.id);

      // ⚠ O ESPAÇAMENTO É CONSULTADO ANTES DE QUALQUER TRABALHO. Ele lê a
      // última rodada DE VERDADE (não simulada, não pulada) desta empresa.
      //
      // ⚠ E A SIMULAÇÃO NUNCA É BARRADA, pelo mesmo motivo pelo qual ela
      // ignora a janela de horário: simular não manda mensagem nenhuma, e quem
      // confere a lista precisa poder conferir quando quiser.
      if (!simular) {
        const { data: t0 } = await admin
          .from("tenants")
          .select("settings")
          .eq("id", t.id)
          .maybeSingle();
        const regras = readAutomation((t0 as { settings?: unknown } | null)?.settings ?? null);

        // paginacao-ok: `.limit(1)` com ORDER BY — é a última rodada, não uma
        // leitura de acervo.
        const consulta = (filtrarPuladas: boolean) => {
          let q = admin
            .from("motor_execucoes")
            .select("occurred_at")
            .eq("tenant_id", t.id)
            .eq("simulado", false);
          if (filtrarPuladas) q = q.eq("pulada", false);
          return q.order("occurred_at", { ascending: false }).limit(1).maybeSingle();
        };

        // ⚠ O CÓDIGO NÃO PODE DEPENDER DA ORDEM DO DEPLOY. Se esta versão
        // subir na Vercel antes de a `0067` ser aplicada, a coluna `pulada`
        // não existe e o filtro devolve ERRO — e erro aqui, lido como "não há
        // rodada anterior", liberaria TODA batida: 40 rodadas por dia em vez
        // de duas. O teto diário seguraria o estrago, mas a campanha sairia
        // toda de manhã sem ninguém entender por quê.
        //
        // É a mesma classe do "editou manifesto? o banco não sabe": o
        // repositório andando na frente do banco. Aqui a saída é barata —
        // antes da `0067` não existe linha pulada, então a consulta sem o
        // filtro devolve exatamente a mesma coisa.
        let ultima: { occurred_at?: string } | null = null;
        const comFiltro = await consulta(true);
        if (comFiltro.error) {
          console.warn(
            `[motor] coluna 'pulada' ausente (0067 nao aplicada?) — espacamento sem o filtro: ${comFiltro.error.message}`,
          );
          const semFiltro = await consulta(false);
          ultima = (semFiltro.data as { occurred_at?: string } | null) ?? null;
        } else {
          ultima = (comFiltro.data as { occurred_at?: string } | null) ?? null;
        }

        const esp = avaliarEspacamento({
          ultimaRodadaISO: ultima?.occurred_at ?? null,
          agora: new Date(),
          minMinutos: regras.min_minutos_entre_rodadas,
        });

        if (!esp.pode) {
          await registrarRodada({
            tenantId: t.id,
            origem: "agendador",
            pulada: true,
            porque: esp.porque,
          });
          detalhe.push({
            tenant: t.slug,
            ok: true,
            porque: esp.porque,
            enviadas: 0,
            falhas: 0,
            pulada: true,
          });
          continue;
        }
      }

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
