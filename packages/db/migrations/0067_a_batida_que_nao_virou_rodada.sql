-- 0067 — A BATIDA QUE NÃO VIROU RODADA também fica registrada
--
-- POR QUE
-- 27/ago. O agendador do GitHub perdeu as DUAS execuções do dia: nem a das 9h
-- nem a das 17h. 15 mensagens não saíram de manhã, 15 não saíram à tarde, e o
-- fundador teve que perguntar duas vezes se tinham saído.
--
-- ⚠ E NÃO FOI AZAR. O `schedule` do GitHub é best-effort e a documentação diz
-- que sob carga alta *"some queued jobs may be dropped"*, nomeando o começo de
-- cada hora como o pior momento. Nosso cron estava no minuto `:00`. A prova
-- está no histórico do próprio repositório: em 8 execuções agendadas o tique
-- NUNCA foi pontual — 22, 25, 26, 49, 50, 52, 54 e 162 minutos de atraso. E
-- `created_at` era igual a `run_started_at` em todas, então não havia fila nem
-- falta de runner: o atraso inteiro era o GitHub decidindo criar a execução.
-- Vivíamos no balde de alta carga. Naquele dia ele passou de "atrasa" para
-- "descarta", com um incidente aberto das 23:37 UTC de 26/08 às 19:44 de 27/08.
--
-- ⚠ A CAUSA RAIZ ERA DE PROJETO. 15 mensagens penduradas em UM tique, duas
-- vezes ao dia: perder um tique custava meio dia de campanha. A correção é
-- bater de 15 em 15 minutos e deixar o MOTOR decidir a cadência
-- (`min_minutos_entre_rodadas`, em `lib/espacamento.ts`).
--
-- ⚠ E É AQUI QUE A CORREÇÃO QUASE REINTRODUZ O DEFEITO QUE A 0066 FECHOU. Se
-- só as rodadas que executam fossem gravadas, uma tabela com duas linhas por
-- dia seria indistinguível de um agendador morto — "não rodou" voltaria a ser
-- igual a "não havia ninguém para falar", a assinatura desta casa, na mesma
-- peça, dez dias depois.
--
-- Por isso a batida recusada pelo espaçamento entra como linha, com
-- `pulada = true`. Ela responde a pergunta que a outra não responde:
--   `pulada = false` → o motor TRABALHOU (mesmo que não tenha mandado nada)
--   `pulada = true`  → o agendador ESTÁ VIVO (e o motor decidiu esperar)
-- Sem a segunda, o alarme de silêncio só toca 26 horas depois. Com ela, toca
-- em uma hora — e diz qual das duas coisas quebrou.

alter table public.motor_execucoes
  add column if not exists pulada boolean not null default false;

comment on column public.motor_execucoes.pulada is
  'true = o agendador bateu e o motor recusou pelo espacamento (min_minutos_entre_rodadas). '
  'Nao e rodada: e PROVA DE VIDA do agendador. false = o motor rodou de verdade, '
  'inclusive quando nao havia ninguem para falar.';

-- ⚠ O ÍNDICE PRECISA COBRIR A CONSULTA NOVA. O espaçamento pergunta, a cada
-- batida, "qual foi a última rodada DE VERDADE desta empresa" — e com 40
-- batidas por dia por empresa a linha pulada passa a ser a maioria da tabela.
-- Sem este índice a pergunta que roda 40× ao dia varreria o que mais cresce.
create index if not exists ix_motor_execucoes_reais
  on public.motor_execucoes(tenant_id, occurred_at desc)
  where pulada = false and simulado = false;
