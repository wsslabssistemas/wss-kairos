// Regras da automação por empresa. Guardadas em tenants.settings.automation.
// O núcleo não sabe de canal (WhatsApp/Facebook são plugues no fim) — aqui
// mora só a política: modo e regras anti-bloqueio. Espelha o piloto Base44.

export type AutomationMode = "off" | "simulation" | "auto";

export type AutomationSettings = {
  mode: AutomationMode;
  max_per_day: number; // limite total gerado em 24h
  min_hours_between: number; // espera mínima desde o último contato sem resposta
  max_no_reply: number; // para após N mensagens sem resposta
  cooldown_hours: number; // espera após o cliente responder/engajar
  window_start: number; // hora em que a automação começa a operar
  window_end: number; // hora em que a automação para
  stop_after_days: number; // sem engajamento por N dias → bloqueia
  monthly_budget_credits: number; // 0 = sem limite; ao atingir, suspende até virar o mês
  /**
   * O RECORTE DA REATIVAÇÃO — só fala com quem saiu nos últimos N dias.
   *
   * ⚠ ELE É O QUE FAZ A PRIMEIRA CAMPANHA CABER NUM LOTE. Sem recorte, a
   * reativação da Be Fitness são **1.049 pessoas** (R$ 327 no primeiro toque),
   * e o `max_per_day` só as espalha ao longo de semanas — ele fatia o acervo,
   * não escolhe QUEM. O plano combinado começa pelos **35 dos últimos 90
   * dias** (R$ 10,94): a primeira campanha não existe para converter, existe
   * para ENSINAR, e disparar o acervo inteiro é experimento sem controle no
   * ativo mais caro que existe aqui, que é a reputação do número.
   *
   * Vale SÓ para `reativacao`, e isso não é detalhe: a data de referência é a
   * entrada na etapa (`stage_entered_at`), que para o ex-aluno é a data em que
   * ele saiu. Aplicá-la à `renovacao` barraria justamente o aluno antigo —
   * quem está na mesma etapa há três anos é o melhor cliente da casa.
   *
   * 0 = sem recorte (o acervo inteiro).
   */
  reativacao_max_dias: number;
  /**
   * QUANTAS PODEM SAIR EM UMA RODADA — o teto do dia, fatiado.
   *
   * ⚠ ELE EXISTE PORQUE O TETO DIÁRIO SOZINHO NÃO ESPALHA NADA. Com 40 no dia
   * e duas rodadas agendadas, a primeira mandava as 40 e a segunda não
   * encontrava ninguém. O fundador pediu o contrário: *"algumas sairiam pela
   * manhã e outras no início e final da tarde"*.
   *
   * ⚠ E O MOTIVO DE VERDADE NÃO É A META — é que RESPOSTA VEM EM ONDA. 40
   * mensagens de uma vez viram 6 conversas simultâneas com quem estiver
   * atendendo; 20 e 20 viram três conversas de manhã e três à tarde. O que
   * espalha não é o disparo: é o trabalho que ele gera.
   *
   * 0 = sem limite por rodada (o teto do dia manda sozinho).
   */
  max_por_rodada: number;
  /**
   * A PAUSA ENTRE UM ENVIO E O SEGUINTE, em segundos.
   *
   * ⚠ SEJA HONESTO SOBRE O QUE ELA FAZ. Não há evidência de que 6 ou 60
   * segundos entre mensagens mude a nota de qualidade do número: o que a Meta
   * mede é bloqueio, denúncia e leitura — o comportamento de QUEM RECEBE. A
   * pausa é prudência barata contra o padrão de rajada, não uma proteção
   * comprovada, e vender como proteção seria inventar segurança.
   *
   * ⚠ E PAUSA GRANDE TEM CUSTO: com 40 mensagens e 60 segundos, a rodada leva
   * 40 minutos e o relógio do lote (`rodarMotor`) corta antes do fim. O teto
   * por rodada é o jeito certo de espalhar; a pausa é o jeito caro.
   */
  pausa_entre_envios_seg: number;
};

export const AUTOMATION_DEFAULTS: AutomationSettings = {
  mode: "off",
  max_per_day: 30,
  min_hours_between: 24,
  max_no_reply: 3,
  cooldown_hours: 48,
  window_start: 9,
  window_end: 19,
  stop_after_days: 14,
  monthly_budget_credits: 0,
  // ⚠ O PADRÃO É CONSERVADOR DE PROPÓSITO, e ele MUDA o comportamento de quem
  // já tinha `automation` salvo sem este campo. É deliberado: o erro de barrar
  // demais aparece na simulação, com o motivo escrito em cada pessoa; o erro
  // de soltar demais aparece na fatura da Meta e no número marcado.
  reativacao_max_dias: 90,
  max_por_rodada: 0,
  // 6 segundos: o meio do intervalo que já existia no código (4 a 9).
  pausa_entre_envios_seg: 6,
};

const MODES: AutomationMode[] = ["off", "simulation", "auto"];

export function readAutomation(settings: unknown): AutomationSettings {
  const a = (settings as { automation?: Partial<AutomationSettings> } | null)?.automation ?? {};
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
  };
  return {
    mode: MODES.includes(a.mode as AutomationMode) ? (a.mode as AutomationMode) : "off",
    max_per_day: num(a.max_per_day, AUTOMATION_DEFAULTS.max_per_day, 0, 1000),
    min_hours_between: num(a.min_hours_between, AUTOMATION_DEFAULTS.min_hours_between, 0, 720),
    max_no_reply: num(a.max_no_reply, AUTOMATION_DEFAULTS.max_no_reply, 0, 50),
    cooldown_hours: num(a.cooldown_hours, AUTOMATION_DEFAULTS.cooldown_hours, 0, 720),
    window_start: num(a.window_start, AUTOMATION_DEFAULTS.window_start, 0, 23),
    window_end: num(a.window_end, AUTOMATION_DEFAULTS.window_end, 0, 23),
    stop_after_days: num(a.stop_after_days, AUTOMATION_DEFAULTS.stop_after_days, 0, 365),
    monthly_budget_credits: num(a.monthly_budget_credits, 0, 0, 100000000),
    reativacao_max_dias: num(a.reativacao_max_dias, AUTOMATION_DEFAULTS.reativacao_max_dias, 0, 3650),
    max_por_rodada: num(a.max_por_rodada, AUTOMATION_DEFAULTS.max_por_rodada, 0, 1000),
    // O teto de 120s não é capricho: acima disso um lote grande não cabe no
    // tempo da função, e o relógio do lote corta pela metade.
    pausa_entre_envios_seg: num(a.pausa_entre_envios_seg, AUTOMATION_DEFAULTS.pausa_entre_envios_seg, 0, 120),
  };
}

export const MODE_LABEL: Record<AutomationMode, string> = {
  off: "Desligado",
  simulation: "Simulação",
  auto: "Automático",
};

export const MODE_HINT: Record<AutomationMode, string> = {
  off: "A automação não roda. Operação 100% manual.",
  simulation: "Gera e conta as mensagens, mas não envia. Serve para calibrar as regras.",
  auto: "Gera e envia dentro das regras. (Exige a versão automática e um canal ligado.)",
};
