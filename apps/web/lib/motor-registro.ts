import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ResultadoDoMotor } from "@/lib/motor-db";

// O REGISTRO DE CADA RODADA DO MOTOR — e por que ele não existia.
//
// ⚠ EM 27/AGO AS 15 MENSAGENS DAS 9H SIMPLESMENTE NÃO SAÍRAM. Sem erro em
// lugar nenhum: o produto estava no ar (o endereço do gatilho respondia 401
// corretamente), o modo estava em `auto`, os 39 candidatos esperando. O cron
// do GitHub pulou a execução — comportamento documentado dele em horário de
// pico — e ninguém foi avisado.
//
// **"O motor não rodou" era indistinguível de "não havia ninguém para falar".**
// É a mesma classe que este projeto documenta em todo lugar, agora na peça que
// dispara dinheiro sozinha.
//
// ⚠ E EU LI UM DADO COMO PROVA QUANDO ELE NÃO ERA. Disse ao fundador que "44
// mensagens saíram pelo motor sozinho, então o agendador já disparou" — e o
// botão *Enviar agora* passa pelo MESMO `rodarMotor`, gravando igualzinho.
// Não havia (e não há) nenhuma evidência de que o cron já tenha funcionado.
// Por isso `origem` é a primeira coluna que importa aqui.
//
// ⚠ E A RODADA VAZIA TAMBÉM É REGISTRADA. Uma execução que não mandou nada
// porque estava fora da janela é informação — é ela que distingue "rodou e não
// tinha ninguém" de "não rodou". Guardar só os envios repetiria o defeito.

export async function registrarRodada(entrada: {
  tenantId: string;
  origem: "agendador" | "botao";
  resultado?: ResultadoDoMotor;
  erro?: string;
  /**
   * ⚠ A BATIDA QUE NÃO VIROU RODADA. `true` quando o agendador bateu e o
   * espaçamento recusou. Ela NÃO é uma rodada — é prova de vida do agendador,
   * e é o que faz "o cron morreu" parar de ser indistinguível de "não havia
   * ninguém para falar". Ver `0067` e `lib/espacamento.ts`.
   */
  pulada?: boolean;
  /** O motivo da recusa, escrito para ser lido na tela. */
  porque?: string;
}): Promise<void> {
  const { tenantId, origem, resultado, erro, pulada = false, porque } = entrada;
  try {
    const admin = createAdminClient();
    // Best-effort: falhar em registrar não pode desfazer um envio que
    // aconteceu. Mas vai para o log, porque medição que some em silêncio é o
    // que faz o painel mentir depois.
    const linha = {
      tenant_id: tenantId,
      origem,
      simulado: resultado?.plano.simulado ?? false,
      avaliados: resultado?.plano.vereditos.length ?? 0,
      escolhidos: resultado?.plano.enviar.length ?? 0,
      enviadas: resultado?.enviadas ?? 0,
      falhas: resultado?.falhas.length ?? 0,
      interrompido: resultado?.interrompido ?? false,
      porque: porque ?? resultado?.plano.porque ?? null,
      erro: erro ?? null,
    };

    const { error } = await admin.from("motor_execucoes").insert({ ...linha, pulada });
    if (error) {
      // ⚠ O REPOSITÓRIO PODE ANDAR NA FRENTE DO BANCO. Se esta versão subir na
      // Vercel antes de a `0067` ser aplicada, a coluna `pulada` não existe e
      // TODA rodada deixaria de ser registrada — em silêncio, porque este
      // bloco é best-effort. Seria a `0066` desfeita pela própria correção
      // dela, no dia em que ela mais importa. A batida pulada não cabe na
      // tabela antiga (e não precisa: antes da `0067` ninguém pula), mas a
      // rodada de verdade cabe, e ela é a linha que não pode faltar.
      console.error(`[motor] nao registrou a rodada: ${error.message}`);
      if (!pulada) {
        const { error: e2 } = await admin.from("motor_execucoes").insert(linha);
        if (e2) console.error(`[motor] nem sem a coluna nova: ${e2.message}`);
        else console.warn("[motor] registrada SEM 'pulada' — aplique a migration 0067.");
      }
    }
  } catch (e) {
    console.error(`[motor] falha ao registrar rodada: ${e instanceof Error ? e.message : String(e)}`);
  }
}
