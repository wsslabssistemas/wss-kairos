import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { readAutomation, MODE_LABEL, MODE_HINT, type AutomationMode } from "@/lib/automation";
import { saveAutomation } from "./actions";
import { statusDoCanal } from "@/lib/credenciais";
import { getSkillFormConfig } from "@/lib/skill";
import { origemDoSite } from "@/lib/site";
import { Canal } from "./Canal";
import { Guia } from "./Guia";
import { Roteamento } from "./Roteamento";
import { Simulacao } from "./Simulacao";
import { DisparoDeTeste } from "./DisparoDeTeste";
import { RodarAgora } from "./RodarAgora";
import { Abas } from "./Abas";
import { PerfilDoNumero } from "./PerfilDoNumero";
import { lerRoteamento, lerModelos } from "@/lib/roteamento";
import { lerTetoDeMensagens } from "@/lib/custo_mensagem";
import { dataHoraLocal } from "@/lib/fuso";
import { ultimaVerificacao } from "@/lib/vigia-canal";
import { alcanceDaReativacao } from "@/lib/alcance";
import { avaliarSaude } from "@/lib/saude-canal";

// Chamada de rede para a Meta no teste de conexao. Ver a nota em
// `fila/page.tsx`: tela que fala com servico externo declara o tempo.
/**
 * ⚠ 300, E O MOTIVO É UMA REGRA DESTA CASA QUE EU MESMO VIOLEI.
 *
 * "`maxDuration` mora na PÁGINA, nunca no arquivo de ações — é a página que
 * governa a duração das ações invocadas a partir dela." Está escrito no
 * `CLAUDE.md`. Ontem eu declarei 300 na ROTA da API (que o agendador usa) e
 * deixei esta página em 60.
 *
 * Em 25/ago o fundador apertou "Enviar agora" com 20 no teto do dia. Com a
 * pausa entre envios, 8 mensagens saíram em 54 segundos e a função foi morta
 * aos 60 — a tela devolveu *"An unexpected response was received from the
 * server"* e ele concluiu, razoavelmente, que **nada** tinha sido enviado.
 * Oito tinham.
 *
 * ⚠ E ELEVAR O TETO NÃO BASTA, por isso `rodarAgora` também tem RELÓGIO
 * PRÓPRIO: ele para sozinho antes do limite e diz onde parou. Função morta no
 * meio do laço deixa metade do lote enviado sem ninguém saber quais.
 */
export const maxDuration = 300;

const FIELDS: { key: keyof ReturnType<typeof readAutomation>; label: string; hint: string; min: number; max: number }[] = [
  { key: "max_per_day", label: "Máx. de mensagens por dia", hint: "Limite total gerado pela automação em 24h", min: 0, max: 1000 },
  { key: "min_hours_between", label: "Horas mín. entre contatos", hint: "Espera mínima desde o último contato (sem resposta)", min: 0, max: 720 },
  { key: "max_no_reply", label: "Máx. de não-respostas", hint: "Após N mensagens sem resposta, para de incomodar", min: 0, max: 50 },
  { key: "cooldown_hours", label: "Cooldown após resposta (h)", hint: "Espera após o cliente responder/engajar", min: 0, max: 720 },
  { key: "window_start", label: "Início da janela (h)", hint: "Horário a partir do qual a automação opera", min: 0, max: 23 },
  { key: "window_end", label: "Fim da janela (h)", hint: "Horário em que a automação para", min: 0, max: 23 },
  { key: "stop_after_days", label: "Parar de incomodar (dias)", hint: "Sem engajamento por N dias → bloqueia", min: 0, max: 365 },
  // ⚠ O RECORTE DA CAMPANHA. Ele é o único campo aqui que escolhe QUEM, e não
  // quanto nem quando: o `máx. por dia` fatia o acervo em semanas, mas manda
  // para todo mundo do mesmo jeito. Ver `lib/automation.ts`.
  { key: "reativacao_max_dias", label: "Reativação: só quem saiu nos últimos (dias)", hint: "Recorte da campanha de retorno. 0 = a base inteira, do mais antigo ao mais novo", min: 0, max: 3650 },
  // ⚠ ESPALHAR O DISPARO É ESPALHAR O TRABALHO, não enganar a Meta. Resposta
  // vem em onda: 40 de uma vez viram seis conversas simultâneas.
  { key: "max_por_rodada", label: "Máx. por rodada", hint: "Fatia o teto do dia entre as rodadas. 0 = manda tudo de uma vez", min: 0, max: 1000 },
  // ⚠ O CAMPO QUE SUBSTITUIU O HORÁRIO FIXO DO AGENDADOR. Antes as rodadas
  // eram 9h e 17h, cravadas no cron — e em 27/ago o GitHub descartou as duas.
  // Hoje ele bate de 15 em 15 minutos e é ESTE número que decide a cadência.
  { key: "min_minutos_entre_rodadas", label: "Espaço entre rodadas (minutos)", hint: "O agendador bate de 15 em 15 min; este número decide quando a batida vira rodada. 240 = ~2 rodadas/dia. 0 = toda batida roda", min: 0, max: 720 },
  { key: "pausa_entre_envios_seg", label: "Pausa entre mensagens (segundos)", hint: "Evita o padrão de rajada. Vai com variação automática — e pausa alta faz o lote não caber no tempo", min: 0, max: 120 },
  { key: "monthly_budget_credits", label: "Orçamento mensal (créditos)", hint: "0 = sem limite. Ao atingir, suspende até a virada do mês", min: 0, max: 100000000 },
];

export default async function AutomacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ salvo?: string; erro?: string; canal?: string }>;
}) {
  const { salvo, erro, canal } = await searchParams;
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) {
    return (
      <main>
        <h1>Automação</h1>
        <p className="text-dim">Sem empresa vinculada.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.from("tenants").select("settings").eq("id", tenant.id).maybeSingle();
  const a = readAutomation(data?.settings);
  const canEdit = ["owner", "admin"].includes(membership!.role);

  // ⚠ AS ÚLTIMAS RODADAS DO MOTOR — o histórico que esta tela prometia e nunca
  // teve. Em 27/ago o agendador pulou a execução das 9h e não havia onde ver
  // isso: o produto estava no ar, o modo em `auto`, 39 candidatos esperando, e
  // zero mensagem. "Não rodou" era indistinguível de "não havia ninguém".
  //
  // paginacao-ok: `.limit(10)` é decisão de produto — as dez últimas rodadas —
  // com ORDER BY explícito.
  const listar = (filtrarPuladas: boolean) => {
    let q = supabase
      .from("motor_execucoes")
      .select("id, origem, simulado, avaliados, enviadas, falhas, interrompido, porque, erro, occurred_at")
      .eq("tenant_id", tenant.id);
    if (filtrarPuladas) q = q.eq("pulada", false);
    return q.order("occurred_at", { ascending: false }).limit(10);
  };
  // ⚠ SE A `0067` AINDA NÃO FOI APLICADA, o filtro devolve erro e a lista
  // voltaria VAZIA — dizendo "nenhuma rodada registrada" para quem acabou de
  // rodar. Lista vazia que mente é o sintoma proibido aqui: ela precisa dizer
  // se é "ainda não aconteceu" ou "está quebrado".
  const primeira = await listar(true);
  const { data: rodadas } = primeira.error ? await listar(false) : primeira;

  /**
   * ⚠ A PROVA DE VIDA DO AGENDADOR — a pergunta que a lista acima não responde.
   *
   * São duas coisas diferentes, e confundi-las foi o defeito de 27/ago: "o
   * motor não trabalhou" e "o agendador está morto" tinham a mesma cara. Esta
   * consulta pega a última batida QUALQUER, inclusive a recusada pelo
   * espaçamento — e é ela que faz o alarme tocar em uma hora, não em 26.
   *
   * paginacao-ok: `.limit(1)` com ORDER BY — é a última linha, não acervo.
   */
  const bater = (colunaNova: boolean) =>
    supabase
      .from("motor_execucoes")
      .select(colunaNova ? "occurred_at, pulada, porque" : "occurred_at, porque")
      .eq("tenant_id", tenant.id)
      .eq("origem", "agendador")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  // ⚠ AQUI O ERRO SERIA PIOR QUE LISTA VAZIA: sem batida, o alarme conclui
  // "agendador morto" e toca à toa em toda tela, dentro da janela — e alarme
  // que toca à toa é alarme desligado, que é como se perde o próximo 27/ago.
  const b1 = await bater(true);
  const { data: batida } = b1.error ? await bater(false) : b1;
  const ultimaBatida = batida as
    | { occurred_at: string; pulada?: boolean; porque: string | null }
    | null;
  const minutosSemBatida = ultimaBatida
    ? Math.floor((Date.now() - Date.parse(ultimaBatida.occurred_at)) / 60_000)
    : null;

  type Rodada = {
    id: string; origem: string; simulado: boolean; avaliados: number;
    enviadas: number; falhas: number; interrompido: boolean;
    porque: string | null; erro: string | null; occurred_at: string;
  };
  const execucoes = (rodadas as Rodada[] | null) ?? [];

  /**
   * ⚠ O ALARME DE SILÊNCIO. O cron do GitHub pula execução em horário de pico
   * — é comportamento documentado dele — e não avisa ninguém. Sem este aviso,
   * a campanha pode ficar parada dias com tudo configurado certo.
   *
   * Só vale em dia útil e depois das 9h: cobrar rodada às 7h de domingo seria
   * alarme que toca à toa, e alarme que toca à toa é alarme desligado.
   */
  const agoraNaEmpresa = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }),
  );
  const diaUtil = agoraNaEmpresa.getDay() >= 1 && agoraNaEmpresa.getDay() <= 5;

  /**
   * ⚠ O LIMIAR CAIU DE 26 HORAS PARA 1. Ele era 26h porque o agendador batia
   * duas vezes ao dia — menos que isso tocaria à toa, e alarme que toca à toa
   * é alarme desligado. Mas 26h significava que a campanha podia ficar parada
   * um dia inteiro antes de a tela dizer qualquer coisa. Foi exatamente o que
   * aconteceu em 27/ago: as duas execuções do dia sumiram, e quem percebeu foi
   * o fundador perguntando se as mensagens tinham saído.
   *
   * Com a batida de 15 em 15 minutos (`motor.yml`), quatro batidas perdidas
   * seguidas já são anormais. Uma hora de silêncio dentro da janela é defeito,
   * não paciência.
   */
  const horaAqui = agoraNaEmpresa.getHours();
  const dentroDaJanela = horaAqui >= a.window_start + 1 && horaAqui < a.window_end;
  const agendadorMudo =
    a.mode === "auto" && diaUtil && dentroDaJanela &&
    (minutosSemBatida === null || minutosSemBatida > 60);
  /**
   * ⚠ QUANTOS AINDA CABEM NO RECORTE. Em 28/ago saíram 10 mensagens com teto
   * de 15, e o fundador não soube dizer se era defeito, teto ou fim da fila —
   * as três pedem ações opostas. Eram 10 porque a faixa de 180 dias tinha
   * acabado, e o sistema sabia disso sem contar a ninguém.
   */
  const { contract } = await getSkillFormConfig(tenant.skill_key);
  const alcance = await alcanceDaReativacao(
    tenant.id,
    a.reativacao_max_dias,
    contract?.ended_stage ?? null,
    a.max_per_day,
  );

  const status = await statusDoCanal(tenant.id);

  /**
   * ⚠ A SAÚDE DO CANAL, PERGUNTADA — não deduzida do silêncio.
   *
   * Todo o resto deste painel depende de EVENTO, e evento emudece exatamente
   * quando o transporte morre: assinatura desativada, token vencido, número
   * restringido. "Nenhuma mensagem hoje" fica idêntico a "canal fora do ar".
   * Ver `lib/vigia-canal.ts` e a `0069`.
   */
  const vigia = await ultimaVerificacao(tenant.id);
  const saude = vigia
    ? avaliarSaude(
        vigia.ok
          ? {
              ok: true,
              quality_rating: vigia.quality_rating ?? undefined,
              name_status: vigia.name_status ?? undefined,
              messaging_limit_tier: vigia.messaging_limit_tier ?? undefined,
              verified_name: vigia.verified_name ?? undefined,
            }
          : { ok: false, erro: vigia.erro ?? "sem detalhe" },
      )
    : null;
  const minutosSemVigia = vigia
    ? Math.floor((Date.now() - Date.parse(vigia.occurred_at)) / 60_000)
    : null;

  const banner: Record<AutomationMode, { cls: string; txt: string }> = {
    off: { cls: "badge", txt: "A automação está desligada — nenhuma mensagem é gerada ou enviada." },
    simulation: { cls: "badge badge-warn", txt: "Modo simulação — mensagens são geradas e contadas, mas não enviadas." },
    auto: { cls: "badge badge-success", txt: "Modo automático — mensagens geradas e enviadas dentro das regras." },
  };

  return (
    <main style={{ maxWidth: 820 }}>
      <h1>Automação</h1>
      <p className="text-dim" style={{ marginTop: 4 }}>
        Controle da versão automática: modo de operação, regras anti-bloqueio e teto
        de orçamento. O manual continua disponível o tempo todo.
      </p>

      <div className="card mt-16 row" style={{ gap: 12 }}>
        <span className={banner[a.mode].cls}>Modo atual: {MODE_LABEL[a.mode]}</span>
        <span className="text-dim" style={{ fontSize: 14 }}>{banner[a.mode].txt}</span>
      </div>

      {salvo && <p className="badge badge-success mt-16">Regras salvas.</p>}
      {canal === "salvo" && <p className="badge badge-success mt-16">Credencial do canal salva. Teste antes de usar com cliente.</p>}
      {canal === "desligado" && <p className="badge mt-16">Canal desligado — o envio voltou para o link humano.</p>}
      {erro && <p className="badge badge-danger mt-16">{erro}</p>}

      {/* ⚠ AGRUPADAS POR FREQUENCIA DE USO, nao por assunto — e essa foi a
          decisao que mais mudou o desenho. "Canal" e "Roteamento" sao assunto
          parecido, e um se toca todo dia enquanto o outro se toca uma vez por
          trimestre. Agrupar por semelhanca devolveria a mesma pilha de quinze
          blocos com titulos em cima, que e o erro que a barra lateral acabou
          de corrigir.
          "Operacao" e o que se abre todo dia — vem primeiro e por padrao. */}
      <Abas
        abas={[
          {
            id: "operacao",
            titulo: "Operação",
            conteudo: (
              <>
            {/* ⚠ CONTEXTO ANTES DE AÇÃO, e a ordem mudou por isso. Antes o botão
                de disparar vinha antes de "quem ainda falta falar" e da saúde do
                canal — ou seja, a pessoa apertava e SÓ DEPOIS descobria que a
                fila tinha acabado ou que o canal estava mudo. As duas perguntas
                que decidem se vale apertar vêm primeiro; elas estão logo abaixo,
                e o botão vem em seguida. */}

            {/* ⚠ O QUE FAZER DEPOIS — a pergunta que a tela não respondia.
                "Saíram 10" é indistinguível de teto atingido, defeito no envio e fim
                da fila, e as três pedem ações opostas: esperar, chamar suporte, ou
                aumentar o recorte. O número sozinho transfere para a pessoa uma
                investigação que o banco responde numa consulta. */}
            {a.mode !== "off" && alcance && (
              <div className="card mt-16">
                <p className="eyebrow" style={{ marginBottom: 8 }}>Quem ainda falta falar</p>
                {alcance.dentro > 0 ? (
                  <p style={{ margin: 0, fontSize: 14 }}>
                    Dentro do recorte de hoje{" "}
                    <strong>
                      {alcance.recorte > 0 ? `(saiu nos últimos ${alcance.recorte} dias)` : "(base inteira)"}
                    </strong>{" "}
                    ainda há <strong>{alcance.dentro} pessoa(s)</strong> para falar — com telefone e sem
                    nenhuma mensagem nossa pelo canal.
                  </p>
                ) : (
                  <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left" }}>
                    <strong>O recorte de {alcance.recorte} dias acabou.</strong> Já falamos com todo mundo
                    que saiu nesse período. Enquanto ele não aumentar, o motor não tem com quem falar — e
                    vai continuar rodando sem mandar nada.
                  </p>
                )}
                {alcance.proximo && (
                  <p className="text-dim" style={{ fontSize: 13, margin: "10px 0 0" }}>
                    Aumentando o recorte para{" "}
                    <strong>{alcance.proximo.dias === 0 ? "a base inteira" : `${alcance.proximo.dias} dias`}</strong>,
                    entram mais <strong>{alcance.proximo.destrava} pessoa(s)</strong>. O campo é{" "}
                    <em>“Reativação: só quem saiu nos últimos (dias)”</em>, logo acima.
                  </p>
                )}
                {/* ⚠ A PERGUNTA "VAMOS ALCANÇAR OS ANTIGOS ALGUM DIA?" tem resposta
                    aritmética, e ela precisa estar na tela. A fila põe quem saiu há
                    menos tempo primeiro — numa base onde entram mais pessoas do que
                    o teto alcança, os antigos ficariam para sempre no fim. Aqui não
                    ficam, e o número mostra por quê. */}
                {alcance.diasParaOAcervo !== null && alcance.acervo > alcance.dentro && (
                  <p className="text-dim" style={{ fontSize: 13, margin: "10px 0 0" }}>
                    Somando todas as faixas são <strong>{alcance.acervo} pessoas</strong> — cerca de{" "}
                    <strong>{alcance.diasParaOAcervo} dias úteis</strong> para falar com todas, no teto
                    de {a.max_per_day}/dia. Quem saiu há menos tempo vem primeiro, porque responde mais;
                    os mais antigos entram na sequência, não ficam de fora.
                  </p>
                )}
                {!alcance.proximo && alcance.dentro === 0 && (
                  <p className="text-dim" style={{ fontSize: 13, margin: "10px 0 0" }}>
                    E não há mais ninguém em nenhuma faixa: a base de reativação foi toda contatada.
                  </p>
                )}
              </div>
            )}

            {/* ⚠ A SAÚDE DO CANAL VEM ANTES DAS RODADAS. Motor perfeito com canal
                fora do ar é o pior estado possível: tudo verde e ninguém recebendo.
                E a linha aparece mesmo quando está tudo bem — "está tudo bem" tem que
                ser uma afirmação com hora, não a ausência de notícia. */}
            {status.configurado && (
              <div className="card mt-16">
                <p className="eyebrow" style={{ marginBottom: 8 }}>Saúde do canal oficial</p>
                {!vigia || !saude ? (
                  <p className="text-dim" style={{ margin: 0, fontSize: 14 }}>
                    Ainda não perguntamos à Meta como está o número. A verificação roda junto com o
                    agendador — se ela não aparecer aqui em até uma hora, é sinal de que o agendador
                    não está batendo.
                  </p>
                ) : (
                  <>
                    <p
                      className={
                        saude.gravidade === "parado" ? "badge badge-danger"
                        : saude.gravidade === "atencao" ? "badge badge-warn"
                        : "badge badge-success"
                      }
                      style={{ whiteSpace: "normal", textAlign: "left" }}
                    >
                      {saude.resumo}
                    </p>
                    <p className="text-dim" style={{ fontSize: 12, margin: "8px 0 0" }}>
                      Perguntado{" "}
                      {minutosSemVigia !== null && minutosSemVigia < 90
                        ? `há ${minutosSemVigia} min`
                        : `em ${dataHoraLocal(vigia.occurred_at)}`}
                      {vigia.messaging_limit_tier ? ` · degrau de envio ${vigia.messaging_limit_tier}` : ""}
                      {vigia.verified_name ? ` · quem recebe vê "${vigia.verified_name}"` : ""}
                    </p>
                    {minutosSemVigia !== null && minutosSemVigia > 180 && (
                      <p className="text-dim" style={{ fontSize: 12, margin: "6px 0 0" }}>
                        ⚠ Esta resposta tem mais de 3 horas. O vigia roda junto com o agendador — se ele
                        parou, esta informação envelheceu junto.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* A ORDEM É A DA CABEÇA DE QUEM VAI DISPARAR: quem sairia
                (simulação) e quem sai de verdade agora (rodar). */}
            {canEdit && <Simulacao modo={a.mode} />}

            {canEdit && <RodarAgora modo={a.mode} />}

            <div className="card mt-16">
              <p className="eyebrow" style={{ marginBottom: 8 }}>Últimas rodadas do motor</p>

              {/* ⚠ O ALARME DE SILÊNCIO vem ANTES da lista. Campanha parada com tudo
                  configurado certo é o pior estado possível: nada avisa, e cada dia
                  perdido é uma lista que não anda. */}
              {agendadorMudo && (
                <p className="badge badge-danger" style={{ whiteSpace: "normal", textAlign: "left" }}>
                  <strong>O agendador não bate há{" "}
                  {minutosSemBatida === null
                    ? "nunca bateu"
                    : minutosSemBatida >= 120
                      ? `${Math.floor(minutosSemBatida / 60)} horas`
                      : `${minutosSemBatida} minutos`}.</strong>{" "}
                  Ele bate de 15 em 15 minutos, das {a.window_start}h às {a.window_end}h, de segunda
                  a sexta — quatro batidas perdidas seguidas não são atraso normal. O{" "}
                  <code>schedule</code> do GitHub descarta execuções sob carga e não avisa ninguém.{" "}
                  <strong>Use Enviar agora</strong> acima: isso não depende do agendador. Depois
                  confira em <em>Actions → Motor proativo</em> no GitHub se as execuções pararam de
                  ser criadas.
                </p>
              )}

              {/* ⚠ A PROVA DE VIDA APARECE MESMO QUANDO ESTÁ TUDO CERTO. Campo que só
                  existe no erro é indistinguível de campo que não foi feito — a regra
                  do "campo cinza com o motivo escrito" do CLAUDE.md. Sem esta linha,
                  "o agendador está vivo" seria uma informação que ninguém tem como
                  confirmar, que é como 27/ago começou. */}
              {!agendadorMudo && ultimaBatida && (
                <p className="text-dim" style={{ margin: "0 0 4px", fontSize: 12 }}>
                  Agendador vivo — última batida{" "}
                  {minutosSemBatida !== null && minutosSemBatida < 60
                    ? `há ${minutosSemBatida} min`
                    : `em ${dataHoraLocal(ultimaBatida.occurred_at)}`}
                  {ultimaBatida.pulada && ultimaBatida.porque ? ` · ${ultimaBatida.porque}` : ""}
                </p>
              )}

              {execucoes.length === 0 ? (
                <p className="text-dim" style={{ margin: 0, fontSize: 14 }}>
                  Nenhuma rodada registrada ainda. Cada execução — do agendador ou do botão —
                  passa a aparecer aqui, <strong>inclusive as que não mandaram nada</strong>: é o
                  que distingue &ldquo;rodou e não tinha ninguém&rdquo; de &ldquo;não rodou&rdquo;.
                </p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
                  {execucoes.map((e, i) => (
                    <li key={e.id} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                      <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
                        <span className="text-faint" style={{ fontSize: 12, minWidth: 96 }}>
                          {dataHoraLocal(e.occurred_at)}
                        </span>
                        <span className="badge">{e.origem === "agendador" ? "agendador" : "botão"}</span>
                        {e.erro ? (
                          <span className="badge badge-danger">falhou</span>
                        ) : (
                          <span className={e.enviadas > 0 ? "badge badge-success" : "badge"}>
                            {e.enviadas} enviada(s)
                          </span>
                        )}
                        {e.falhas > 0 && <span className="badge badge-danger">{e.falhas} não chegaram</span>}
                        {e.simulado && <span className="badge badge-warn">simulação</span>}
                        {e.interrompido && <span className="badge badge-warn">parou no meio</span>}
                      </div>
                      <p className="text-dim" style={{ fontSize: 12, margin: "2px 0 0 104px" }}>
                        {e.erro ?? e.porque}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
              </>
            ),
          },
          {
            id: "regras",
            titulo: "Regras",
            conteudo: (
              <>
            <form action={saveAutomation} className="card mt-24">
              <p className="eyebrow">Modo de operação</p>
              <div className="seg mt-8" role="radiogroup" aria-label="Modo de operação">
                {(["off", "simulation", "auto"] as AutomationMode[]).map((m) => (
                  <label key={m}>
                    <input type="radio" name="mode" value={m} defaultChecked={a.mode === m} disabled={!canEdit} />
                    {MODE_LABEL[m]}
                  </label>
                ))}
              </div>
              <p className="text-faint mt-8" style={{ fontSize: 13 }}>{MODE_HINT[a.mode]}</p>

              <hr className="divider" />
              <p className="eyebrow" style={{ marginBottom: 14 }}>Regras anti-bloqueio</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
                {FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className="label" htmlFor={f.key}>{f.label}</label>
                    <input
                      id={f.key}
                      name={f.key}
                      type="number"
                      min={f.min}
                      max={f.max}
                      defaultValue={a[f.key]}
                      disabled={!canEdit}
                    />
                    <p className="text-faint" style={{ fontSize: 12, marginTop: 4 }}>{f.hint}</p>
                  </div>
                ))}
              </div>

              {canEdit ? (
                <button type="submit" className="btn btn-primary mt-24">Salvar regras</button>
              ) : (
                <p className="text-faint mt-16" style={{ fontSize: 13 }}>
                  Só quem é dono ou admin da empresa pode alterar estas regras.
                </p>
              )}
            </form>

            {/* O QUE FALTA PARA LIGAR, EM PORTUGUÊS.
                Antes esta tela dizia só "quando estiver ligado" — e não dizia o que
                é preciso para ligar, quem faz cada parte, nem quanto custa. Painel
                que promete um botão sem dizer o caminho até ele vira promessa. */}
              </>
            ),
          },
          {
            id: "canal",
            titulo: "Canal oficial",
            conteudo: (
              <>
                {/* ⚠ PERFIL E DISPARO DE TESTE MORAM AQUI, e não na Operação.
                    Os dois falam do CANAL: o que a pessoa vê ao tocar no nome, e
                    provar o encanamento antes da primeira mensagem real. Ficavam
                    no meio do dia a dia porque a página era uma pilha só. */}
            {canEdit && (
              <Canal
                configurado={status.configurado}
                phoneId={status.phoneId}
                temVerifyToken={status.temVerifyToken}
                temAppSecret={status.temAppSecret}
                atualizadoEm={status.atualizadoEm}
                urlDoWebhook={`${await origemDoSite()}/api/whatsapp/webhook`}
              />
            )}

                {canEdit && status.configurado && <PerfilDoNumero />}

                {canEdit && <DisparoDeTeste />}
              </>
            ),
          },
          {
            id: "roteamento",
            titulo: "Por onde cada motivo sai",
            conteudo: (
              <>
            {canEdit && (
              <Roteamento
                roteamento={lerRoteamento(data?.settings)}
                modelos={lerModelos(data?.settings)}
                temCredencial={status.configurado}
                tetoCents={lerTetoDeMensagens(data?.settings)}
              />
            )}
              </>
            ),
          },
          {
            id: "ajuda",
            titulo: "Como funciona",
            conteudo: (
              <>
            <div className="card mt-24" style={{ borderColor: "var(--border-brand)" }}>
              <p className="eyebrow" style={{ marginBottom: 8 }}>Como funciona HOJE, sem automação</p>
              <p style={{ marginTop: 0, fontSize: 14 }}>
                O sistema já decide <strong>quem</strong> procurar e escreve <strong>o que</strong>{" "}
                dizer — é a <a href="/painel/fila">Fila de envio</a>. O que ele não faz é
                apertar o botão: você lê, ajusta e envia pelo WhatsApp com um clique.
              </p>
              <p className="text-dim" style={{ marginBottom: 0, fontSize: 14 }}>
                <strong>Isso não é uma limitação temporária.</strong> Envio automático exige a
                API oficial da Meta; qualquer atalho por provedor não oficial arrisca{" "}
                <strong>banir o número da sua empresa</strong>, e o número é o ativo. Por isso
                a fila existe: entrega quase tudo da automação sem esse risco.
              </p>
            </div>

            <div className="card mt-16">
              <p className="eyebrow" style={{ marginBottom: 8 }}>O que é preciso para ligar o envio automático</p>
              <ol className="text-dim" style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.9 }}>
                <li>
                  <strong>Conta Meta Business</strong> (business.facebook.com). Não precisa de
                  página do Facebook com conteúdo, mas precisa do portfólio de negócios. Se você
                  já tem Instagram profissional, provavelmente ele já existe.
                </li>
                <li>
                  <strong>Verificação da empresa</strong> na Meta — CNPJ, comprovante de endereço
                  e, às vezes, telefone fixo. É a etapa mais demorada: costuma levar dias.
                </li>
                <li>
                  <strong>Um número dedicado</strong> ao WhatsApp Business API. Ele{" "}
                  <strong>não pode</strong> estar em uso no WhatsApp comum — e migrar um número
                  que já tem conversas é caminho sem volta.
                </li>
                <li>
                  <strong>Modelos de mensagem aprovados</strong> pela Meta para falar com quem
                  não escreveu nas últimas 24 horas. Cada modelo passa por revisão.
                </li>
                <li>
                  <strong>Credenciais</strong>: ID da conta WhatsApp Business, ID do número e um
                  token permanente. É isso que a WSS Labs cadastra para a sua empresa.
                </li>
              </ol>
              <p className="text-faint" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
                <strong>As credenciais não são digitadas aqui, e isso é decisão de segurança.</strong>{" "}
                Token da Meta em campo de tela fica salvo no banco e visível para quem tem acesso
                ao painel; o lugar certo dele é o cofre de variáveis do servidor. Quando você tiver
                os três dados acima, mande para a WSS Labs — o cadastro é feito uma vez e não
                aparece em tela nenhuma.
              </p>
            </div>

            <div className="card mt-16">
              <p className="eyebrow" style={{ marginBottom: 8 }}>Custo, para decidir com número</p>
              <p className="text-dim" style={{ marginTop: 0, marginBottom: 0, fontSize: 14 }}>
                A Meta cobra <strong>por conversa iniciada</strong> pela empresa, não por mensagem,
                e o valor muda por país e por categoria (utilidade, marketing, serviço). Conversa
                iniciada pelo cliente costuma ser gratuita numa janela de 24 horas. Some isso ao
                custo de IA por resposta, que o seu painel já mede em{" "}
                <a href="/painel/admin/cotas">Cota de IA</a> — o teto de gasto continua valendo
                igual com a automação ligada.
              </p>
            </div>
              </>
            ),
          },
        ]}
      />

    </main>
  );
}
