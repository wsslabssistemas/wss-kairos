-- UMA RODADA POR VEZ — o preco de ter dois relogios.
--
-- ⚠ O QUE ACONTECEU EM 4/set, e o fundador viu pelo sintoma errado: *"verifica
-- porque as mensagens das 17h nao foi enviada"*. A resposta do registro foi
-- *"o teto do dia (30) ja foi atingido: 43 sairam"*. Sairam 43 com teto de 30.
--
-- A causa esta em `motor_execucoes`: **duas rodadas as 13:17**, uma mandando 15
-- e outra 13. Somadas as 15 da manha, 43. As duas passaram pelo espacamento
-- porque as duas perguntaram "faz mais de 240 min desde o ultimo envio?" ANTES
-- de qualquer uma ter enviado — e as duas ouviram sim.
--
-- ⚠ E ISSO E O PRECO DE UMA DECISAO CERTA. Em 30/ago o agendador reserva
-- (`pg_cron` no Supabase) entrou justamente porque o cron do GitHub descarta
-- execucao em silencio, e um relogio so era ponto unico de falha. Com dois
-- relogios a campanha para de depender de um; sem trava, os dois batem juntos.
-- **Redundancia sem exclusao mutua nao e redundancia: e duplicacao.**
--
-- ⚠ E O TETO DIARIO NAO SEGURA, porque ele tambem le o banco antes de enviar:
-- as duas rodadas leram "15 sairam hoje", as duas concluiram que cabiam 15, e
-- as duas mandaram. Todo freio que LE e depois AGE tem essa fresta quando ha
-- dois atores — e a fresta so aparece quando os dois relogios se encontram,
-- que e raro o bastante para ninguem procurar.
--
-- A trava e uma RESERVA atomica: quem consegue inserir a linha da janela roda,
-- quem colide sai. `insert ... on conflict do nothing` resolve no banco, sem
-- lock de aplicacao e sem transacao distribuida.

create table if not exists motor_reservas (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  -- A janela, em blocos de 10 minutos desde a epoca. Dez minutos porque a
  -- rodada inteira cabe nisso (15 mensagens com pausa de 6s levam ~90s) e
  -- porque o custo de errar e pequeno dos dois lados: no maximo uma rodada
  -- legitima espera 10 min, contra uma cadencia de 240.
  slot       bigint not null,
  criada_em  timestamptz not null default now(),
  origem     text,
  primary key (tenant_id, slot)
);

comment on table motor_reservas is
  'Reserva atomica da rodada do motor. Com dois agendadores (GitHub e pg_cron), quem insere a linha da janela roda e quem colide sai — redundancia sem exclusao mutua e duplicacao.';

-- ⚠ LIMPEZA JUNTO, senao a tabela cresce para sempre por um dado que so vale
-- por dez minutos. Reserva de mais de um dia nao serve para nada.
create index if not exists motor_reservas_criada_idx on motor_reservas (criada_em);

alter table motor_reservas enable row level security;
-- Sem policy: so o service_role alcanca. Quem reserva e a maquina.
