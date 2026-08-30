/**
 * O ESPAÇAMENTO ENTRE RODADAS — a regra que permite bater sempre.
 *
 * ⚠ POR QUE ISTO EXISTE. Em 27/ago o agendador do GitHub perdeu as DUAS
 * execuções do dia. Não foi azar: o `schedule` do GitHub é best-effort e a
 * documentação diz que sob carga alta *"some queued jobs may be dropped"* —
 * e nomeia o começo de cada hora como o pior momento. Nosso cron estava no
 * minuto `:00`, e a prova está no histórico: em 8 execuções o tique NUNCA foi
 * pontual (22, 25, 26, 49, 50, 52, 54 e 162 minutos de atraso). Vivíamos no
 * balde de alta carga; naquele dia ele passou de "atrasa" para "descarta".
 *
 * ⚠ E A CAUSA RAIZ ERA DE PROJETO, não do GitHub: **15 mensagens penduradas
 * em um tique, duas vezes ao dia.** Perder um tique custava meio dia de
 * campanha. A correção é bater de 15 em 15 minutos — mas aí o agendador não
 * pode mais ser quem decide a cadência, senão as 30 do dia sairiam todas antes
 * das 11h e o `max_por_rodada` (que existe para ESPALHAR O TRABALHO, não para
 * enganar a Meta) perderia o sentido.
 *
 * ⚠ QUEM ESPALHA PASSA A SER O MOTOR. O agendador vira o que o próprio
 * `motor.yml` já dizia que ele era: alguém que bate numa porta. É esta função
 * que decide se a porta abre.
 *
 * ⚠ E A BATIDA RECUSADA PRECISA FICAR REGISTRADA. Se só as rodadas que
 * enviaram fossem gravadas, "o agendador morreu" voltaria a ser
 * indistinguível de "não havia ninguém para falar" — exatamente o defeito que
 * a migration `0066` existe para fechar, reintroduzido pela correção dele.
 * Por isso quem chama grava a recusa com `pulada = true`.
 *
 * ⚠ O BOTÃO NUNCA É BARRADO. Esta regra vale só para a origem `agendador`:
 * decisão de gente ganha de régua. Quem clicou em *Enviar agora* olhou a tela
 * e quis mandar; travá-lo transformaria a correção de um silêncio no começo de
 * outro.
 *
 * ⚠ O RELÓGIO MEDE ENVIO, NUNCA BATIDA — a correção de 30/ago/2026, na véspera
 * da primeira rodada autônoma.
 *
 * Nasceu medindo a coisa errada: `motor-rota.ts` procurava a última linha
 * "não simulada e não pulada" e chamava isso de rodada de verdade. Só que
 * rodada que ACONTECE e não manda nada grava exatamente essa linha — a que
 * falhou com exceção também, porque o `catch` registra com `pulada` no padrão
 * `false`. As linhas de 28/ago provam: *"Fora da janela de horário"* e *"A
 * automação está desligada"* estão lá, com `pulada = false`, valendo como
 * rodada.
 *
 * **Consequência: uma batida que rodava e enviava zero comprava 240 minutos de
 * silêncio.** E a promessa escrita no `motor.yml`, neste arquivo e no teste —
 * *"cada rodada passa a ter 16 chances de acontecer em vez de 1"* — só valia
 * para o tique que o GitHub DESCARTA. Para o tique que acontece e volta vazio,
 * a chance continuava sendo uma, e o buraco de quatro horas passava com a tela
 * dizendo "agendador vivo". A correção de 27/ago reintroduzindo, por dentro, o
 * defeito que ela existe para fechar.
 *
 * Por isso o parâmetro se chama `ultimoEnvioISO` e não `ultimaRodadaISO`: o
 * nome é a trava. Quem alimenta esta função filtra `enviadas > 0` — e existe
 * uma verificação de código-fonte em `espacamento_test.mjs` que falha se esse
 * filtro sumir, porque função pura nenhuma consegue enxergar um `select`
 * errado do lado de fora.
 */

export type Espacamento = {
  /** Se a rodada pode acontecer agora. */
  pode: boolean;
  /**
   * O motivo, escrito para ser lido na tela. Vale nos dois casos: rodada que
   * não acontece sem motivo visível é a classe de defeito desta casa.
   */
  porque: string;
  /** Minutos desde o último ENVIO. `null` quando nunca saiu mensagem. */
  minutosDesde: number | null;
};

/**
 * @param ultimoEnvioISO A última rodada desta empresa que EFETIVAMENTE ENVIOU
 *   (`enviadas > 0`, não simulada, não pulada), em ISO. `null` quando nunca
 *   saiu mensagem nenhuma.
 *
 *   ⚠ NÃO passe aqui "a última rodada": rodada que aconteceu e mandou zero não
 *   gastou cota do dia, então não pode gastar tempo do dia. Ver o cabeçalho.
 * @param minMinutos Espaçamento mínimo configurado. `0` desliga a regra.
 */
export function avaliarEspacamento(entrada: {
  ultimoEnvioISO: string | null;
  agora: Date;
  minMinutos: number;
}): Espacamento {
  const { ultimoEnvioISO, agora, minMinutos } = entrada;

  // Sem espaçamento configurado a regra não opina — o teto do dia e o da
  // rodada continuam mandando sozinhos, como antes desta função existir.
  if (minMinutos <= 0) {
    return { pode: true, porque: "Sem espaçamento configurado.", minutosDesde: null };
  }

  // ⚠ QUEM NUNCA ENVIOU PASSA. "Nunca saiu mensagem" não pode virar "espera
  // mais um pouco": seria a trava impedindo justamente a rodada que ela existe
  // para garantir que aconteça — e a campanha de uma empresa nova nunca
  // começaria, sem erro em lugar nenhum.
  if (!ultimoEnvioISO) {
    return { pode: true, porque: "Nenhum envio anterior para espaçar.", minutosDesde: null };
  }

  const quando = Date.parse(ultimoEnvioISO);
  // ⚠ DATA ILEGÍVEL LIBERA, NÃO BARRA. Um valor que não parseia é defeito
  // nosso, e defeito nosso não pode calar a campanha do cliente em silêncio.
  if (!Number.isFinite(quando)) {
    return { pode: true, porque: "Data do último envio ilegível — liberando.", minutosDesde: null };
  }

  const minutosDesde = Math.floor((agora.getTime() - quando) / 60_000);

  // ⚠ RELÓGIO PARA TRÁS TAMBÉM LIBERA. Se o último envio está no futuro
  // (fuso trocado, relógio corrigido), barrar seria travar até o futuro
  // chegar — um silêncio de horas com causa invisível.
  if (minutosDesde < 0) {
    return { pode: true, porque: "Último envio no futuro — liberando.", minutosDesde };
  }

  if (minutosDesde >= minMinutos) {
    return {
      pode: true,
      porque: `Último envio há ${minutosDesde} min (espaçamento: ${minMinutos} min).`,
      minutosDesde,
    };
  }

  return {
    pode: false,
    porque:
      `Último envio há ${minutosDesde} min — o espaçamento é de ${minMinutos} min. ` +
      `Falta${minMinutos - minutosDesde === 1 ? "" : "m"} ${minMinutos - minutosDesde} min.`,
    minutosDesde,
  };
}
