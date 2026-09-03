import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { carregarFila } from "@/lib/fila-db";
import { despacharToque } from "@/lib/despacho";
import { readAutomation } from "@/lib/automation";
import { lerRoteamento, lerModelos, modeloDoToque } from "@/lib/roteamento";
import { planejar, type Candidato, type PlanoDoMotor } from "@/lib/motor";
import { lerFuso, horaLocal, diaLocalISO } from "@/lib/fuso";
import { nivelDeQualidade } from "@/lib/saude-canal";
import { ultimaVerificacao } from "@/lib/vigia-canal";
import type { MotivoDaFila } from "@/lib/fila";

// O EXECUTOR DO MOTOR — lê, decide, e (só no automático) manda.
//
// ⚠ ELE NÃO ESCOLHE NINGUÉM E NÃO ESCREVE NADA. Quem escolhe a pessoa é
// `lib/fila-db.ts`, a MESMA carga que a tela usa. Quem decide se pode sair
// agora é `lib/motor.ts`, puro e testado. Quem manda é `lib/despacho.ts`, o
// mesmo caminho do botão. Este arquivo só amarra os três — e é de propósito
// que ele seja quase vazio: cada peça que ganhasse lógica própria aqui viraria
// uma segunda versão da regra, divergindo em silêncio da que a tela usa.
//
// ⚠ E O MOTOR SÓ MANDA MODELO. Dentro da janela de 24h a pessoa está numa
// conversa ativa, e conversa ativa é de humano — é literalmente o que a regra
// de `cooldown_hours` protege. Fora da janela só sai modelo aprovado, cujo
// texto é FIXO: a IA não escreve uma palavra no caminho automático. Isso não é
// limitação temporária, é o que torna o automático aceitável hoje, com
// `decisions = 0` e nenhuma resposta de IA jamais entregue a cliente real.

export type ResultadoDoMotor = {
  tenantId: string;
  plano: PlanoDoMotor;
  /** Quantas saíram de fato. Sempre 0 em simulação. */
  enviadas: number;
  /** Falhas de envio, com o motivo da Meta inteiro. */
  falhas: { contactId: string; motivo: string }[];
  /**
   * O lote parou no meio por causa do relógio, e sobrou gente escolhida sem
   * mensagem. Quem chama precisa DIZER isso: lote pela metade em silêncio é
   * indistinguível de lote completo.
   */
  interrompido: boolean;
  /**
   * O motivo DA FILA de cada candidato (`reativacao`, `renovacao`…).
   *
   * ⚠ Não confundir com o `motivo` de um veredito recusado, que é o TEXTO da
   * recusa. São duas coisas com o mesmo nome em camadas diferentes, e a tela
   * de simulação precisa das duas: uma diz por que estamos falando, a outra
   * por que não vamos falar agora.
   */
  motivoPorContato: Record<string, MotivoDaFila>;
  /**
   * QUAL toque cada candidato receberia (1 = o primeiro desta etapa).
   *
   * A tela de simulação precisa dele para mostrar o modelo CERTO: com a lista
   * por toque, "o modelo da reativação" deixou de existir — existe o modelo do
   * 1º toque, o do 2º, e o que falta.
   */
  toquePorContato: Record<string, number>;
  /** `tenants.settings` cru, para quem chama ler os nomes dos modelos. */
  settings: Record<string, unknown> | null;
};

const HORA = 3_600_000;

/**
 * A PAUSA ENTRE UM ENVIO E O SEGUINTE.
 *
 * ⚠ POR QUE ELA EXISTE — pergunta do fundador depois do primeiro lote real:
 * *"não teremos problemas por serem 7 mensagens enviadas ao mesmo tempo?"*.
 *
 * A resposta medida: não foram ao mesmo tempo. O laço é em série e saíram com
 * **1,4 segundo** entre uma e outra, que é a latência da própria chamada. As 7
 * foram entregues, 3 lidas em minutos, zero falhas. Rate limit da Cloud API
 * está ordens de grandeza acima disso.
 *
 * Mesmo assim a pausa entra, e não é superstição: **o que derruba a qualidade
 * de um número não é o limite técnico, é o padrão.** Um número novo, no
 * primeiro degrau de 250/dia, disparando dez mensagens idênticas em catorze
 * segundos é a assinatura de quem faz disparo em massa. Sete reais custam
 * segundos; a reputação do número não se recupera.
 *
 * ⚠ E É COM VARIAÇÃO, não fixa. Intervalo constante é tão artificial quanto
 * intervalo nenhum — um relógio batendo de 6 em 6 segundos é padrão igual.
 */
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A pausa desta empresa, com variação de ±40% em torno do configurado.
 *
 * ⚠ A VARIAÇÃO É O PONTO. Intervalo constante é tão artificial quanto
 * intervalo nenhum: um relógio batendo de 6 em 6 segundos é padrão igual.
 */
function pausaMs(segundos: number): number {
  const base = Math.max(0, segundos) * 1000;
  if (base === 0) return 0;
  const variacao = base * 0.4;
  return Math.round(base - variacao + Math.random() * variacao * 2);
}

/**
 * Roda o motor de UMA empresa.
 *
 * `simular: true` força o modo simulação mesmo com a empresa em automático —
 * é o que a tela usa para mostrar "quem sairia amanhã" sem mandar nada.
 */
export async function rodarMotor(entrada: {
  tenantId: string;
  skillKey: string;
  tenantNome: string;
  simular?: boolean;
  agora?: Date;
  /**
   * ⚠ O RELÓGIO DO LOTE. Quando o tempo acaba, o motor PARA sozinho e devolve
   * o que fez — em vez de ser morto no meio do laço pela plataforma.
   *
   * A diferença não é estética: função morta deixa metade do lote enviado e
   * ninguém sabe quais. Quem chama recebe `interrompido` e mostra na tela
   * "saíram N, rode de novo para continuar".
   */
  limiteMs?: number;
}): Promise<ResultadoDoMotor> {
  const { tenantId, skillKey, tenantNome, simular = false, agora = new Date(), limiteMs } = entrada;
  const comecou = Date.now();

  // O motor não tem sessão de usuário: usa o admin, com `tenant_id` explícito
  // em toda consulta. Ver a nota de `lib/despacho.ts`.
  const admin = createAdminClient();
  const carga = await carregarFila({ supabase: admin, tenantId, skillKey, ownerId: null });

  const fuso = lerFuso(carga.settings);
  const regras = readAutomation(carga.settings);
  const roteamento = lerRoteamento(carga.settings);

  // ⚠ SÓ ENTRA NO PLANO QUEM SAI PELO NÚMERO DA EMPRESA. O resto da fila
  // continua existindo e continua sendo trabalho de gente — o motor não tem
  // como "clicar no wa.me" por ninguém, e fingir que tem faria a lista do
  // vendedor sumir sem que a mensagem existisse.
  const doCanal = carga.fila.filter((f) => roteamento[f.motivo as MotivoDaFila]);

  // A ENTRADA NA ETAPA, por contato. Para o ex-aluno ela é a data em que ele
  // SAIU — real, distribuída mês a mês, não a data da importação. É o que o
  // recorte da campanha usa. Vem de `carga.todos` porque a fila só carrega o
  // que a montagem precisou.
  const entrouNaEtapa = new Map(carga.todos.map((c) => [c.id, c.stage_entered_at]));
  // ⚠ A VIGÊNCIA DO CONTRATO, para o veto que impede chamar de ex-aluno quem
  // ainda é cliente. Ver `lib/motor.ts` — o caso da Lilian, 28/ago.
  const vigenciaDe = new Map(carga.todos.map((c) => [c.id, c.contract_end ?? null]));
  // ⚠ O MOTIVO DE SAÍDA, para o veto de quem não volta. Ver `lib/motor.ts`.
  const saidaDe = new Map(carga.todos.map((c) => [c.id, c.motivo_saida ?? null]));
  // Os motivos que o RAMO classifica como sem volta. Vazio quando o segmento
  // não declara motivos de saída — hoje, 14 dos 15.
  const motivosQueEncerram = carga.churnReasons.filter((m) => m.fora_da_campanha).map((m) => m.key);

  // ⚠ O MODELO DE CADA TOQUE, para o motor saber se o próximo tem texto
  // próprio ou repetiria o anterior. Ver a trava em `lib/motor.ts`.
  const modelos = lerModelos(carga.settings);

  const candidatos: Candidato[] = doCanal.map((f) => ({
    contactId: f.contactId,
    motivo: f.motivo,
    // O toque de HOJE é o seguinte ao último dado nesta etapa. `carga.toques`
    // conta só o que SAIU, e só depois da entrada na etapa — é o mesmo número
    // com que a cadência do manifesto escolhe o passo.
    toque: (carga.toques[f.contactId] ?? 0) + 1,
    textoProprio:
      modeloDoToque(modelos, f.motivo as MotivoDaFila, (carga.toques[f.contactId] ?? 0) + 1) !== null,
    diasNaEtapa: diasDesde(entrouNaEtapa.get(f.contactId), agora),
    contratoAte: vigenciaDe.get(f.contactId) ? String(vigenciaDe.get(f.contactId)).slice(0, 10) : null,
    motivoSaida: saidaDe.get(f.contactId) ?? null,
    horasDesdeUltimoContato: horasDesde(carga.ultimo[f.contactId], agora),
    semResposta: semRespostaDele(carga.interacoes, f.contactId),
    diasSemEngajamento: diasDesdeEntradaDele(carga.interacoes, f.contactId, agora),
    horasDesdeRespostaDele: horasDesde(ultimaEntradaDele(carga.interacoes, f.contactId), agora),
  }));

  // ⚠ O TETO DO DIA CONTA O QUE JÁ SAIU PELO CANAL, não o que a equipe fez à
  // mão. São bolsos diferentes: o teto da automação existe para proteger o
  // NÚMERO da empresa, e mensagem que sai do WhatsApp do vendedor não gasta
  // reputação do número do sistema.
  const enviadosHoje = saidasDoCanalHoje(carga.interacoes, agora, fuso);

  // A última resposta da Meta sobre a saúde do número. Best-effort: falhar em
  // ler a nota não pode impedir o envio — só faz o motor operar sem o freio.
  let ultima: Awaited<ReturnType<typeof ultimaVerificacao>> = null;
  try { ultima = await ultimaVerificacao(tenantId); } catch { ultima = null; }

  /**
   * ⚠ A ESCADA DO RECORTE — o que faz a campanha continuar sem um clique.
   *
   * Quando TODO candidato foi barrado pelo recorte (e só por ele), o público
   * daquela faixa acabou. Sem escada, a campanha para e fica esperando alguém
   * abrir a tela de Automação e digitar um número maior — o que é aceitável
   * numa operação assistida e é o fim da automação numa que roda sozinha.
   *
   * ⚠ UM DEGRAU POR RODADA, nunca dois. Quem acompanha precisa ver cada
   * alargamento acontecer; pular do recorte de 180 para "tudo" numa tacada
   * transformaria uma decisão de campanha em efeito colateral.
   *
   * ⚠ E SÓ QUANDO A CAUSA É O RECORTE. Se ninguém saiu porque todo mundo está
   * em cooldown, ou porque o teto do dia fechou, alargar não resolve nada e
   * gastaria um degrau à toa — trocando um problema temporário por uma decisão
   * permanente.
   *
   * ⚠ SIMULAÇÃO NÃO SOBE DEGRAU. Ela existe para conferir o que aconteceria
   * hoje; se ela mexesse na configuração, conferir mudaria a operação.
   */
  const subirDegrau = (atual: number): number | null => {
    const escada = regras.reativacao_escada;
    if (!escada.length) return null;
    // O `0` significa "sem recorte" e é sempre o topo — por isso ele não entra
    // na comparação numérica: 0 seria o MENOR, e a escada andaria para trás.
    const proximo = escada.find((d) => d === 0 ? atual !== 0 : d > atual);
    return proximo === undefined ? null : proximo;
  };

  // As regras que valem nesta rodada, montadas UMA vez — a escada do recorte
  // replaneja com elas mais abaixo, e duas montagens diferentes divergiriam.
  const regrasDoPlano = simular
    ? { ...regras, motivos_que_encerram: motivosQueEncerram, mode: "simulation" as const }
    : { ...regras, motivos_que_encerram: motivosQueEncerram };

  let plano = planejar({
    candidatos,
    regras: regrasDoPlano,
    enviadosHoje,
    // ⚠ A HORA DA EMPRESA, NÃO A DO SERVIDOR. `getHours()` aqui devolvia UTC
    // — às 18h de Porto Alegre o processo lia 21h e se considerava fora da
    // janela de 9h–19h. A automação nunca rodaria à tarde, e rodaria às 6h da
    // manhã. Ver `lib/fuso.ts`.
    horaLocal: horaLocal(agora, fuso),
    // O "hoje" da EMPRESA, nunca o do servidor — mesma razão da hora local.
    hojeISO: diaLocalISO(agora, fuso),
    // ⚠ A NOTA DA META, para o motor se moldar sozinho. Vem do vigia (`0069`);
    // sem registro fica `desconhecida`, que NÃO freia — barrar por ausência de
    // informação calaria a campanha sem defeito nenhum.
    qualidade: nivelDeQualidade(ultima?.ok ? ultima.quality_rating : null),
    // ⚠ SÓ A SIMULAÇÃO IGNORA O HORÁRIO. Quem confere a lista precisa poder
    // conferir antes de a janela abrir; quem ENVIA continua preso a ela.
    ignorarJanela: simular,
  });

  // A subida acontece DEPOIS do primeiro plano, porque só o veredito diz se a
  // causa foi o recorte. Uma volta só: subiu, replaneja, e para.
  let degrauNovo: number | null = null;
  if (
    !simular &&
    !plano.ativo &&
    plano.vereditos.length > 0 &&
    plano.foraDoRecorte === plano.vereditos.length
  ) {
    degrauNovo = subirDegrau(regras.reativacao_max_dias);
    if (degrauNovo !== null) {
      const { error } = await admin
        .from("tenants")
        .update({
          settings: {
            ...(carga.settings ?? {}),
            automation: {
              ...((carga.settings?.automation as Record<string, unknown>) ?? {}),
              reativacao_max_dias: degrauNovo,
            },
          },
        })
        .eq("id", tenantId);
      if (error) {
        console.warn(`[motor] nao subi o degrau do recorte: ${error.message}`);
        degrauNovo = null;
      } else {
        const antes = regras.reativacao_max_dias;
        plano = planejar({
          candidatos,
          regras: { ...regrasDoPlano, reativacao_max_dias: degrauNovo },
          enviadosHoje,
          horaLocal: horaLocal(agora, fuso),
          hojeISO: diaLocalISO(agora, fuso),
          qualidade: nivelDeQualidade(ultima?.ok ? ultima.quality_rating : null),
          ignorarJanela: simular,
        });
        // ⚠ A SUBIDA VAI ESCRITA NO REGISTRO DA RODADA. Campanha que muda de
        // público sozinha e não conta para ninguém é a definição de mudança
        // silenciosa — e esta muda COM QUEM a empresa fala.
        plano = {
          ...plano,
          porque:
            `Acabou o público do recorte de ${antes} dias. ` +
            `A campanha subiu para ${degrauNovo === 0 ? "todo o acervo" : `${degrauNovo} dias`} e ` +
            plano.porque.charAt(0).toLowerCase() + plano.porque.slice(1),
        };
        console.info(`[motor] recorte subiu de ${antes} para ${degrauNovo} dias no tenant ${tenantId}`);
      }
    }
  }

  const motivoPorContato: Record<string, MotivoDaFila> = {};
  const toquePorContato: Record<string, number> = {};
  for (const f of doCanal) {
    motivoPorContato[f.contactId] = f.motivo;
    toquePorContato[f.contactId] = (carga.toques[f.contactId] ?? 0) + 1;
  }

  if (plano.simulado || !plano.ativo) {
    return { tenantId, plano, enviadas: 0, falhas: [], motivoPorContato, toquePorContato, settings: carga.settings, interrompido: false };
  }

  const falhas: ResultadoDoMotor["falhas"] = [];
  let enviadas = 0;
  let interrompido = false;

  // ⚠ EM SÉRIE, DE PROPÓSITO. Disparar em paralelo mandaria dez mensagens no
  // mesmo segundo, que é exatamente o padrão de rajada que faz o WhatsApp
  // marcar a conta — e o teto do dia perderia o sentido se as dez saíssem
  // antes de qualquer uma ser contada.
  for (const [posicao, contactId] of plano.enviar.entries()) {
    const item = doCanal.find((f) => f.contactId === contactId);
    if (!item) continue;

    // ⚠ PARA ANTES DE SER MORTO. Sem isto a plataforma corta no meio do laço
    // e ninguém fica sabendo em quem parou.
    if (limiteMs && Date.now() - comecou > limiteMs) {
      interrompido = true;
      break;
    }

    // ⚠ A PAUSA VEM ANTES, E NÃO NA PRIMEIRA. Depois da última ela só
    // seguraria a função sem servir a ninguém — e função segurada à toa é
    // função que estoura o tempo com o trabalho já feito.
    if (posicao > 0) await esperar(pausaMs(regras.pausa_entre_envios_seg));

    const r = await despacharToque({
      supabase: admin,
      tenantId,
      tenantNome,
      // ⚠ SEM AUTOR. O toque do motor não pertence a vendedor nenhum: contá-lo
      // no placar de alguém seria creditar a uma pessoa um trabalho que a
      // máquina fez, e o placar é lido pela equipe.
      membershipId: null,
      contactId,
      motivo: item.motivo,
      // Vazio: fora da janela só sai modelo, e modelo é texto fixo.
      texto: "",
      // O motor já contou o toque para decidir se ele podia sair — passar o
      // número evita uma consulta por envio, e garante que a decisão e o
      // envio usem o MESMO toque.
      toque: (carga.toques[contactId] ?? 0) + 1,
    });

    if (r.ok) enviadas++;
    else falhas.push({ contactId, motivo: r.motivo });
  }

  return { tenantId, plano, enviadas, falhas, motivoPorContato, toquePorContato, settings: carga.settings, interrompido };
}

// ---------------------------------------------------------------------
// As derivações. Todas leem o array que a carga já trouxe — nenhuma volta ao
// banco, porque uma consulta por candidato seria N consultas por execução.
// ---------------------------------------------------------------------

type Ix = {
  contact_id: string | null;
  occurred_at: string;
  direction: string;
  external_id?: string | null;
  input_kind?: string | null;
};

/** Dias inteiros desde uma data. `null` quando não há data — ver `Candidato`. */
function diasDesde(iso: string | undefined | null, agora: Date): number | null {
  const h = horasDesde(iso, agora);
  return h === null ? null : Math.floor(h / 24);
}

function horasDesde(iso: string | undefined | null, agora: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (agora.getTime() - t) / HORA : null;
}

/** A última mensagem DELE, em qualquer canal. É o que dispara o cooldown. */
function ultimaEntradaDele(ix: Ix[], contactId: string): string | null {
  let melhor: string | null = null;
  for (const i of ix) {
    if (i.contact_id !== contactId || i.direction !== "inbound") continue;
    if (!melhor || i.occurred_at > melhor) melhor = i.occurred_at;
  }
  return melhor;
}

/**
 * Quantas mensagens NOSSAS saíram desde a última vez que ele falou.
 *
 * ⚠ "Desde a última resposta dele", não "no total". Quem respondeu ontem e
 * recebeu duas mensagens hoje está em conversa; quem recebeu duas e nunca
 * respondeu está sendo perseguido. O mesmo número, situações opostas.
 */
function semRespostaDele(ix: Ix[], contactId: string): number {
  const desde = ultimaEntradaDele(ix, contactId);
  let n = 0;
  for (const i of ix) {
    if (i.contact_id !== contactId || i.direction !== "outbound") continue;
    if (desde && i.occurred_at <= desde) continue;
    n++;
  }
  return n;
}

/**
 * Dias desde o último sinal DELE. `null` quando ele nunca deu sinal nenhum.
 *
 * ⚠ O `null` é obrigatório e não é detalhe: `stop_after_days` veta quem PAROU
 * de engajar, e o ex-aluno importado nunca engajou por aqui. Confundir os dois
 * esvaziaria a reativação inteira — que é o motivo de o motor existir.
 */
function diasDesdeEntradaDele(ix: Ix[], contactId: string, agora: Date): number | null {
  const h = horasDesde(ultimaEntradaDele(ix, contactId), agora);
  return h === null ? null : Math.floor(h / 24);
}

/**
 * O que saiu HOJE **pelo canal oficial** — o que o teto do dia governa.
 *
 * ⚠ O `external_id` NAO E DETALHE, e a falta dele foi um defeito reportado
 * pelo fundador: ele configurou 10 mensagens por dia e a simulacao mostrou 9.
 *
 * A versao anterior contava TODA saida do dia, inclusive os toques que a
 * equipe manda a mao pelo `wa.me`. Um unico toque manual registrado de manha
 * comia uma vaga da automacao — e o comentario acima da funcao ja dizia "pelo
 * canal oficial", ou seja, **o codigo discordava do proprio comentario em
 * silencio**, que e a forma mais cara de errar nesta casa.
 *
 * Sao dois bolsos: o teto da automacao existe para proteger o NUMERO da
 * empresa, e mensagem que sai do WhatsApp do vendedor nao gasta reputacao
 * desse numero. So tem `external_id` o que passou pela Meta.
 */
function saidasDoCanalHoje(ix: Ix[], agora: Date, fuso: string): number {
  // O "hoje" da EMPRESA. Com `toISOString()` o dia virava às 21h de Brasília,
  // e o teto do dia zerava no meio da noite de trabalho de quem opera até 22h.
  const hoje = diaLocalISO(agora, fuso);
  let n = 0;
  for (const i of ix) {
    if (i.direction !== "outbound") continue;
    if (!i.external_id) continue;
    // ⚠ SÓ CONVERSA PROATIVA. `agent_briefing` é resposta a quem escreveu, e
    // resposta não é o que este teto governa.
    //
    // Ele contava toda saída com `external_id` — e a resposta da equipe pelo
    // canal oficial tem `external_id`. Em 3/set/2026 a campanha parou às 17h30
    // com *"o teto do dia (30) já foi atingido: 30 saíram"*, e o número foi a
    // 32 e 33 enquanto a equipe respondia três clientes que tinham escrito.
    // **Dia movimentado encolhia a campanha, justamente no dia em que ela
    // estava funcionando** — e o comentário aqui em cima já afirmava que eram
    // "bolsos diferentes", o que era intenção, não comportamento.
    //
    // ⚠ E O TETO EXISTE PARA PROTEGER A REPUTAÇÃO DO NÚMERO. Quem derruba
    // reputação é mensagem NÃO PEDIDA; responder quem acabou de escrever é o
    // oposto disso. Somar as duas freava o lado certo pelo motivo errado.
    //
    // `system_initiated` é o toque proativo — do motor E do botão da fila, que
    // são o mesmo bolso: os dois falam com quem não pediu nada.
    if (i.input_kind !== "system_initiated") continue;
    if (i.occurred_at.slice(0, 10) !== hoje) continue;
    n++;
  }
  return n;
}
