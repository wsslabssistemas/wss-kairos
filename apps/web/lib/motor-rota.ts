import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { rodarMotor, type ResultadoDoMotor } from "@/lib/motor-db";
import { registrarRodada } from "@/lib/motor-registro";
import { avaliarEspacamento } from "@/lib/espacamento";
import { vigiarCanal } from "@/lib/vigia-canal";
import { vigiarAlertas } from "@/lib/alertas-db";
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
//
// ⚠ E O RELÓGIO DO ESPAÇAMENTO MEDE ENVIO, NÃO BATIDA (30/ago/2026). Até aqui
// ele lia a última linha "não simulada e não pulada" — e rodada que ACONTECE e
// manda zero grava exatamente essa linha, a que estoura com exceção também.
// Uma batida vazia comprava 240 minutos de silêncio, e as "16 chances de
// acontecer" viravam uma só para todo tique que não fosse DESCARTADO pelo
// GitHub. Ver `lib/espacamento.ts`.

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

      // ⚠ E O ALARME VEM LOGO DEPOIS, PELO MESMO MOTIVO. O vigia COLETA (nota
      // da Meta, validade do token); isto CHAMA alguém. Separá-los seria ter
      // todos os dados na mão e ninguém lendo — que é a última versão do
      // defeito desta casa, agora com o produto respondendo cliente sozinho às
      // 2h da manhã.
      //
      // Best-effort como o vigia: `vigiarAlertas` engole o próprio erro.
      // Falhar em avisar não pode impedir uma mensagem de sair.
      if (!simular) await vigiarAlertas(t.id);

      // ⚠ O ESPAÇAMENTO É CONSULTADO ANTES DE QUALQUER TRABALHO. Ele lê o
      // ÚLTIMO ENVIO desta empresa — a última rodada que mandou mensagem de
      // verdade (`enviadas > 0`, não simulada, não pulada), nunca a última
      // batida que passou por aqui.
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

        // ⚠ EMPRESA DESLIGADA SAI AQUI, ANTES DE CARREGAR FILA. Com o relógio
        // medindo ENVIO, quem nunca envia nunca tem relógio — e sem esta saída
        // as 40 batidas do dia carregariam a fila inteira de toda empresa em
        // teste grátis, todo dia, para descobrir de novo que ela está `off`.
        //
        // E ela vira batida PULADA, não rodada: o agendador bateu e não houve
        // rodada nenhuma. É mais honesto do que a linha de rodada vazia que
        // ficava aqui antes — e é ela que alimenta o "agendador vivo há N min".
        if (regras.mode === "off") {
          await registrarRodada({
            tenantId: t.id,
            origem: "agendador",
            pulada: true,
            porque: "A automação está desligada.",
          });
          detalhe.push({
            tenant: t.slug,
            ok: true,
            porque: "A automação está desligada.",
            enviadas: 0,
            falhas: 0,
            pulada: true,
          });
          continue;
        }

        // ⚠ `enviadas > 0` É O CORAÇÃO DESTA TRAVA, e ela é o que impede a
        // correção de 27/ago de reintroduzir o silêncio que ela veio fechar.
        //
        // O relógio pergunta "quando saiu a última mensagem", nunca "quando o
        // agendador passou por aqui". Rodada que aconteceu e mandou zero — por
        // exceção, por falta de candidato, por qualquer motivo transitório —
        // não gastou cota do dia e por isso não pode gastar tempo do dia: a
        // batida seguinte, quinze minutos depois, tenta de novo.
        //
        // ⚠ E ISSO CUSTA CARGAS DE FILA DEPOIS QUE O TETO DO DIA FECHA: das 13h
        // às 18h45 cada batida vai montar a fila para ouvir "o teto já foi
        // atingido". É leitura, é uma empresa, e é o preço de não ter buraco de
        // quatro horas invisível. Quem for otimizar isto um dia: NÃO volte a
        // deixar a batida vazia reiniciar o relógio — o atalho barato é
        // exatamente o defeito. E tem um ganho junto: subir o `max_per_day` no
        // meio da tarde volta a valer em 15 minutos, não em quatro horas.
        //
        // paginacao-ok: `.limit(1)` com ORDER BY — é o último envio, não uma
        // leitura de acervo.
        const consulta = (filtrarPuladas: boolean) => {
          let q = admin
            .from("motor_execucoes")
            .select("occurred_at")
            .eq("tenant_id", t.id)
            .eq("simulado", false)
            .gt("enviadas", 0);
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
        let ultimoEnvio: { occurred_at?: string } | null = null;
        const comFiltro = await consulta(true);
        if (comFiltro.error) {
          console.warn(
            `[motor] coluna 'pulada' ausente (0067 nao aplicada?) — espacamento sem o filtro: ${comFiltro.error.message}`,
          );
          const semFiltro = await consulta(false);
          ultimoEnvio = (semFiltro.data as { occurred_at?: string } | null) ?? null;
        } else {
          ultimoEnvio = (comFiltro.data as { occurred_at?: string } | null) ?? null;
        }

        const esp = avaliarEspacamento({
          ultimoEnvioISO: ultimoEnvio?.occurred_at ?? null,
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

        // ⚠ A RESERVA ATÔMICA — o preço de ter DOIS relógios.
        //
        // Em 4/set saíram 43 mensagens com teto de 30, e a causa está no
        // registro: **duas rodadas às 13:17**, uma com 15 e outra com 13. As
        // duas passaram pelo espaçamento porque as duas perguntaram "faz mais
        // de 240 min desde o último envio?" ANTES de qualquer uma ter enviado
        // — e as duas ouviram sim. O teto do dia também não segurou, porque
        // ele lê o banco antes de agir: as duas leram "15 saíram hoje".
        //
        // ⚠ TODO FREIO QUE LÊ E DEPOIS AGE tem essa fresta quando há dois
        // atores. E a fresta só aparece quando os dois relógios se encontram,
        // que é raro o bastante para ninguém procurar.
        //
        // A trava não é um `if` a mais: é o BANCO decidindo. Quem consegue
        // inserir a linha da janela roda; quem colide sai em silêncio — e sai
        // como batida pulada, não como erro, porque não é erro: é o segundo
        // relógio fazendo exatamente o que devia.
        //
        // ⚠ E A CULPA NÃO É DO RESERVA. Ele entrou em 30/ago porque um relógio
        // só era ponto único de falha, e continua certo. **Redundância sem
        // exclusão mútua não é redundância: é duplicação.**
        const slot = Math.floor(Date.now() / 600_000);
        const { data: reserva, error: erroReserva } = await admin
          .from("motor_reservas")
          .insert({ tenant_id: t.id, slot, origem: "agendador" })
          .select("slot");

        // ⚠ COLISÃO É `23505`, e só ela é motivo de sair. Qualquer outro erro
        // (banco fora do ar, coluna faltando) NÃO pode calar a campanha: aí a
        // trava viraria a causa do silêncio que ela existe para evitar.
        if (erroReserva?.code === "23505" || (!erroReserva && !reserva?.length)) {
          await registrarRodada({
            tenantId: t.id,
            origem: "agendador",
            pulada: true,
            porque: "Outra rodada desta empresa começou neste mesmo minuto — o segundo relógio saiu de cena.",
          });
          detalhe.push({
            tenant: t.slug, ok: true, enviadas: 0, falhas: 0, pulada: true,
            porque: "Rodada simultânea — reserva já tomada.",
          });
          continue;
        }
        if (erroReserva) {
          console.warn(`[motor] nao consegui reservar a rodada de ${t.slug}: ${erroReserva.message}`);
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
      // ⚠ A RODADA QUE ESTOURA NÃO PODE COMPRAR SILÊNCIO. Ela fica registrada
      // com `enviadas = 0`, e é por isso que o relógio do espaçamento filtra
      // `enviadas > 0`: antes de 30/ago uma exceção às 9h valia como rodada e
      // calava a campanha até as 13h, com a tela dizendo "agendador vivo". A
      // batida das 9h15 tenta de novo — que é o comportamento que as 40
      // batidas por dia existem para dar.
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
