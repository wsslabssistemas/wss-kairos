// Disponibilidade: quais horários estão livres.
//
// É o que permite o motor dizer "sábado 10h está livre, confirmo?" em vez de
// escalar para um humano. Sem isto, o modo automático não fecha agendamento.
//
// O núcleo calcula; a duração do serviço e se o segmento agenda vêm do
// manifesto (Lei 1 — nenhum vocabulário de mercado aqui).

const MIN = 60000;

export type RegraJornada = {
  membership_id: string | null;
  weekday: number; // 0 = domingo
  starts_at: string; // "09:00:00"
  ends_at: string;
};

export type Bloqueio = {
  membership_id: string | null;
  starts_at: string; // ISO
  ends_at: string;
};

export type Compromisso = {
  membership_id: string | null;
  starts_at: string; // ISO
  duration_min: number;
};

export type Vaga = {
  inicio: Date;
  fim: Date;
  membershipId: string | null;
};

export type SchedulingConfig = {
  /** O segmento trabalha com hora marcada? */
  enabled?: boolean;
  /** Duração padrão quando o serviço não define. */
  default_duration_min?: number;
  /** De quanto em quanto tempo os horários começam (ex.: 30 = 9h, 9h30…). */
  slot_step_min?: number;
  /** Antecedência mínima para marcar (evita oferecer daqui a 5 minutos). */
  min_advance_min?: number;
  /**
   * MARCOU, COMEÇOU — a etapa em que a pessoa entra quando um horário é
   * marcado para ela. Ausente, marcar não mexe na etapa.
   *
   * ⚠ ELA EXISTE PORQUE O ACOMPANHAMENTO NÃO COMEÇAVA. A régua da semana
   * experimental conta a partir da entrada na etapa, e nada colocava ninguém
   * lá sozinho: o sistema conversava até o "pode ser quinta", marcava, e a
   * pessoa seguia como lead — sem o toque do dia 3 para conferir se ela veio,
   * sem o do dia 8 para vender. Com a IA marcando sozinha, o buraco piora.
   *
   * ⚠ A CHAVE VEM DO MANIFESTO (Lei 1): "semana experimental" é vocabulário de
   * academia. Quem marca horário para uma visita técnica declara a etapa dele.
   */
  starts_stage?: string;
  /**
   * OFERECER TURNO EM VEZ DE HORA.
   *
   * Existe porque nem todo negócio que agenda disputa horário. Onde o acesso
   * é livre — academia — não há vaga nem lotação, e o que se combina é o DIA.
   * Oferecer "quinta às 6h30" ali é pior de duas maneiras: sugere uma
   * precisão que não existe e, como a janela começa quando a porta abre, o
   * motor acabava propondo 6h30 da manhã para todo mundo.
   *
   * Com turno o motor pergunta "quinta de manhã ou quinta à noite?" — que é
   * como a pessoa realmente responde. Onde a cadeira É disputada (barbearia,
   * clínica, salão) isto fica desligado: lá a hora exata é o produto.
   */
  offer_by_turno?: boolean;
};

/**
 * Os três turnos, pelo relógio e não pelo ramo — a Lei 1 vale aqui: "manhã"
 * é hora do dia, não vocabulário de mercado.
 *
 * Os cortes (12h e 18h) são os que as pessoas usam falando, e é assim que a
 * resposta do cliente vai chegar.
 */
export const TURNOS = [
  { chave: "manha", label: "de manhã", ate: 12 },
  { chave: "tarde", label: "à tarde", ate: 18 },
  { chave: "noite", label: "à noite", ate: 24 },
] as const;

export type TurnoChave = (typeof TURNOS)[number]["chave"];

export function turnoDe(d: Date): (typeof TURNOS)[number] {
  const h = d.getHours();
  return TURNOS.find((t) => h < t.ate) ?? TURNOS[TURNOS.length - 1];
}

function hhmmParaMinutos(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function noDia(base: Date, minutos: number): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + minutos * MIN);
}

function conflita(inicio: Date, fim: Date, oIni: Date, oFim: Date): boolean {
  return inicio < oFim && oIni < fim;
}

/**
 * Horários livres nos próximos `dias`, respeitando jornada, bloqueios e o que
 * já está marcado. Se `membershipId` for informado, calcula a agenda daquele
 * profissional (usando a regra dele ou, na falta, a da empresa).
 */
export function calcularVagas(input: {
  regras: RegraJornada[];
  bloqueios: Bloqueio[];
  compromissos: Compromisso[];
  duracaoMin: number;
  cfg?: SchedulingConfig | null;
  dias?: number;
  membershipId?: string | null;
  agora?: Date;
  limite?: number;
}): Vaga[] {
  const {
    regras, bloqueios, compromissos, duracaoMin,
    cfg, dias = 14, membershipId = null, limite = 60,
  } = input;

  const agora = input.agora ?? new Date();
  const passo = cfg?.slot_step_min ?? 30;
  const antecedencia = cfg?.min_advance_min ?? 60;
  const minimo = new Date(agora.getTime() + antecedencia * MIN);

  // Regra do profissional tem prioridade; sem ela, vale a da empresa.
  const doProfissional = regras.filter((r) => r.membership_id === membershipId && membershipId);
  const daEmpresa = regras.filter((r) => r.membership_id === null);
  const aplicaveis = doProfissional.length ? doProfissional : daEmpresa;
  if (aplicaveis.length === 0) return [];

  // Só interessam bloqueios/compromissos do profissional em questão (ou gerais).
  const meusBloqueios = bloqueios.filter((b) => !membershipId || !b.membership_id || b.membership_id === membershipId);
  const meusCompromissos = compromissos.filter((c) => !membershipId || c.membership_id === membershipId || !c.membership_id);

  const vagas: Vaga[] = [];

  for (let d = 0; d < dias && vagas.length < limite; d++) {
    const dia = new Date(agora.getTime() + d * 24 * 60 * MIN);
    const weekday = dia.getDay();

    for (const regra of aplicaveis.filter((r) => r.weekday === weekday)) {
      const abre = hhmmParaMinutos(regra.starts_at);
      const fecha = hhmmParaMinutos(regra.ends_at);

      for (let m = abre; m + duracaoMin <= fecha; m += passo) {
        if (vagas.length >= limite) break;

        const inicio = noDia(dia, m);
        const fim = new Date(inicio.getTime() + duracaoMin * MIN);

        if (inicio < minimo) continue;

        const bloqueado = meusBloqueios.some((b) =>
          conflita(inicio, fim, new Date(b.starts_at), new Date(b.ends_at)),
        );
        if (bloqueado) continue;

        const ocupado = meusCompromissos.some((c) => {
          const cIni = new Date(c.starts_at);
          const cFim = new Date(cIni.getTime() + (c.duration_min || 30) * MIN);
          return conflita(inicio, fim, cIni, cFim);
        });
        if (ocupado) continue;

        vagas.push({ inicio, fim, membershipId });
      }
    }
  }

  vagas.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  return vagas;
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/**
 * "sábado, 09/08 às 10h" — como a pessoa fala, não como o banco guarda.
 * Com `porTurno`, "sábado, 09/08 de manhã": o dia é o combinado e a hora
 * exata não é promessa.
 */
export function descreverVaga(v: Vaga | Date, porTurno = false): string {
  const d = v instanceof Date ? v : v.inicio;
  const dia = DIAS[d.getDay()];
  const data = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (porTurno) return `${dia}, ${data} ${turnoDe(d).label}`;
  const h = d.getHours();
  const min = d.getMinutes();
  const hora = min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, "0")}`;
  return `${dia}, ${data} às ${hora}`;
}

/**
 * Poucas opções convertem melhor que muitas: espalha as vagas ao longo dos
 * dias para oferecer alternativas realmente diferentes, não três horários
 * seguidos da mesma manhã.
 *
 * `porTurno` muda a UNIDADE da variedade, não só o texto. Sem ele a chave é
 * o dia e o motor pega a primeira vaga de cada um — que numa janela de
 * 06:30 às 22:00 é sempre 06:30, três dias seguidos. Com ele a chave é
 * dia+turno, e as opções passam a ser realmente diferentes: quinta de manhã,
 * quinta à noite, sexta de manhã. Um turno por dia vem primeiro, para que
 * três opções não caiam todas na mesma quinta-feira.
 */
export function escolherOpcoes(vagas: Vaga[], quantas = 3, porTurno = false): Vaga[] {
  const chaveDe = (v: Vaga) =>
    porTurno ? `${v.inicio.toDateString()}|${turnoDe(v.inicio).chave}` : v.inicio.toDateString();

  const grupos = new Map<string, Vaga>();
  for (const v of vagas) {
    const k = chaveDe(v);
    if (!grupos.has(k)) grupos.set(k, v); // a primeira vaga representa o grupo
  }

  const escolhidas: Vaga[] = [];
  const diasUsados = new Set<string>();

  // 1ª passada: no máximo um por DIA, para variar de data antes de variar
  // de turno. Oferecer três turnos da mesma quinta esconde que sexta existe.
  for (const v of grupos.values()) {
    if (escolhidas.length >= quantas) break;
    const dia = v.inicio.toDateString();
    if (diasUsados.has(dia)) continue;
    diasUsados.add(dia);
    escolhidas.push(v);
  }

  // 2ª passada: só se ainda faltar, aí sim repetindo o dia em outro turno.
  if (escolhidas.length < quantas) {
    for (const v of grupos.values()) {
      if (escolhidas.length >= quantas) break;
      if (!escolhidas.includes(v)) escolhidas.push(v);
    }
  }

  escolhidas.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  return escolhidas.slice(0, quantas);
}
