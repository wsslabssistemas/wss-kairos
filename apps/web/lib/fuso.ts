// A HORA LOCAL DE UMA EMPRESA.
//
// ⚠ POR QUE ISTO EXISTE — o defeito de 20/ago/2026.
//
// O executor do motor passava `new Date().getHours()` como "hora local". O
// servidor da Vercel roda em **UTC**, e o Brasil é UTC-3: às 18h de Porto
// Alegre o processo acredita que são 21h. Com a janela de operação padrão
// (9h–19h), o efeito era duplo e invisível:
//
//   • à tarde, quando a recepção está trabalhando, o motor se considerava
//     FORA da janela e não fazia nada;
//   • às 6h da manhã (9h UTC) ele se considerava DENTRO e dispararia.
//
// O sintoma que chegou foi o fundador dizendo *"não estou conseguindo puxar a
// simulação, não está gerando lista nenhuma"*. Nada quebrou, nada deu erro: a
// lista voltava vazia com um motivo que parecia razoável.
//
// ⚠ E o pior: o tipo em `lib/motor.ts` já dizia "quem converte o fuso é quem
// chama". Quem chamava não convertia. **Comentário e código discordando em
// silêncio** — a forma de erro que mais custou neste projeto.

/** O fuso padrão. Todo cliente do produto está no Brasil hoje. */
export const FUSO_PADRAO = "America/Sao_Paulo";

/**
 * Lê o fuso da empresa de `tenants.settings.timezone`.
 *
 * Fuso inválido cai no padrão em vez de explodir: um erro de digitação na
 * configuração não pode derrubar o motor de todo mundo, e o padrão está certo
 * para 100% da base atual.
 */
export function lerFuso(settings: unknown): string {
  const v = (settings as { timezone?: unknown } | null)?.timezone;
  if (typeof v !== "string" || !v.trim()) return FUSO_PADRAO;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v.trim() });
    return v.trim();
  } catch {
    return FUSO_PADRAO;
  }
}

/**
 * A hora (0–23) num fuso, para um instante.
 *
 * Usa `Intl` de propósito, e não uma subtração de 3 horas: o Brasil já teve
 * horário de verão e pode voltar a ter. Deslocamento fixo é a mesma classe de
 * erro que este arquivo existe para consertar, só que mais difícil de achar.
 */
export function horaLocal(quando: Date, fuso: string = FUSO_PADRAO): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hour: "numeric",
    hour12: false,
  }).format(quando);
  const n = Number(h);
  // `24` aparece em algumas implementações para meia-noite.
  return Number.isFinite(n) ? n % 24 : quando.getUTCHours();
}

/** O dia (`AAAA-MM-DD`) num fuso — o "hoje" da empresa, não o do servidor. */
export function diaLocalISO(quando: Date, fuso: string = FUSO_PADRAO): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(quando);
  return p.slice(0, 10);
}

// =====================================================================
// MOSTRAR A HORA PARA GENTE
//
// ⚠ O DEFEITO DE 27/ago/2026, e é o MESMO deste arquivo três camadas acima.
// O fundador enviou a campanha às 17h37 e o Canal oficial mostrou **20:37**.
// Nada quebrou, nada deu erro: `toLocaleString("pt-BR")` sem `timeZone` usa o
// fuso de QUEM RENDERIZA — e página de servidor renderiza na Vercel, que roda
// em UTC. Três horas a mais em toda tela do painel.
//
// ⚠ E ELE É PIOR QUE O DE 20/ago, não menor. Aquele fazia o motor não rodar,
// e ninguém acreditou no número errado porque não havia número. Este mostra um
// horário PLAUSÍVEL e errado: "20:37" é hora que existe, dentro de um dia que
// existe, e quem for conferir se a mensagem saiu na hora combinada vai
// concluir que o produto disparou fora da janela de operação. Número que
// ninguém consegue contestar é o mais perigoso que existe aqui.
//
// ⚠ E NÃO É "SÓ" O SERVIDOR. Em componente de cliente o mesmo código acerta,
// porque o navegador do fundador está em Brasília — então o defeito aparece em
// UMAS telas e não em outras, o que faz parecer dado inconsistente em vez de
// bug. Fixar o fuso resolve os dois casos com a mesma linha, e é o único jeito
// de a tela ficar certa no dia em que um cliente operar de outro fuso.
//
// ⚠ ISTO SÓ VALE PARA INSTANTE (`timestamptz`). Coluna `date` — uma data sem
// hora, como o encerramento de um edital — NÃO passa por aqui: `new
// Date("2026-08-27")` é meia-noite UTC, e convertê-la para São Paulo devolve
// **26/08**. Aplicar fuso onde não há hora cria o erro que ele deveria evitar.
// =====================================================================

/** Dia, mês, hora e minuto de um instante, no fuso da empresa. */
export function dataHoraLocal(iso: string | Date | null | undefined, fuso: string = FUSO_PADRAO): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: fuso,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Só o dia de um instante, no fuso da empresa. */
export function dataLocal(iso: string | Date | null | undefined, fuso: string = FUSO_PADRAO): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: fuso });
}

/** Só a hora e o minuto de um instante, no fuso da empresa. */
export function horaMinutoLocal(iso: string | Date | null | undefined, fuso: string = FUSO_PADRAO): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" });
}
