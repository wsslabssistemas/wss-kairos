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
 */

export type Espacamento = {
  /** Se a rodada pode acontecer agora. */
  pode: boolean;
  /**
   * O motivo, escrito para ser lido na tela. Vale nos dois casos: rodada que
   * não acontece sem motivo visível é a classe de defeito desta casa.
   */
  porque: string;
  /** Minutos desde a última rodada de verdade. `null` se nunca houve uma. */
  minutosDesde: number | null;
};

/**
 * @param ultimaRodadaISO A última rodada que EXECUTOU (não simulada, não
 *   pulada) desta empresa, em ISO. `null` quando não existe nenhuma.
 * @param minMinutos Espaçamento mínimo configurado. `0` desliga a regra.
 */
export function avaliarEspacamento(entrada: {
  ultimaRodadaISO: string | null;
  agora: Date;
  minMinutos: number;
}): Espacamento {
  const { ultimaRodadaISO, agora, minMinutos } = entrada;

  // Sem espaçamento configurado a regra não opina — o teto do dia e o da
  // rodada continuam mandando sozinhos, como antes desta função existir.
  if (minMinutos <= 0) {
    return { pode: true, porque: "Sem espaçamento configurado.", minutosDesde: null };
  }

  // ⚠ PRIMEIRA RODADA DO DIA PASSA. "Nunca rodou" não pode virar "espera mais
  // um pouco": seria a trava impedindo justamente a rodada que ela existe para
  // garantir que aconteça.
  if (!ultimaRodadaISO) {
    return { pode: true, porque: "Primeira rodada — não há anterior para espaçar.", minutosDesde: null };
  }

  const quando = Date.parse(ultimaRodadaISO);
  // ⚠ DATA ILEGÍVEL LIBERA, NÃO BARRA. Um valor que não parseia é defeito
  // nosso, e defeito nosso não pode calar a campanha do cliente em silêncio.
  if (!Number.isFinite(quando)) {
    return { pode: true, porque: "Data da última rodada ilegível — liberando.", minutosDesde: null };
  }

  const minutosDesde = Math.floor((agora.getTime() - quando) / 60_000);

  // ⚠ RELÓGIO PARA TRÁS TAMBÉM LIBERA. Se a última rodada está no futuro
  // (fuso trocado, relógio corrigido), barrar seria travar até o futuro
  // chegar — um silêncio de horas com causa invisível.
  if (minutosDesde < 0) {
    return { pode: true, porque: "Última rodada no futuro — liberando.", minutosDesde };
  }

  if (minutosDesde >= minMinutos) {
    return {
      pode: true,
      porque: `Última rodada há ${minutosDesde} min (espaçamento: ${minMinutos} min).`,
      minutosDesde,
    };
  }

  return {
    pode: false,
    porque:
      `Rodada há ${minutosDesde} min — o espaçamento é de ${minMinutos} min. ` +
      `Falta${minMinutos - minutosDesde === 1 ? "" : "m"} ${minMinutos - minutosDesde} min.`,
    minutosDesde,
  };
}
