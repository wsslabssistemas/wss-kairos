-- O AGENDADOR RESERVA — um segundo relógio, que falha de forma independente.
--
-- ⚠ ISTO NÃO É UMA MIGRATION, DE PROPÓSITO. Migration roda em TODO ambiente,
-- na sequência numerada. Este script depende de duas extensões e de um segredo
-- que só existem no projeto Supabase de produção: numerá-lo faria a sequência
-- quebrar em qualquer ambiente novo. É configuração de infraestrutura, não
-- schema. Rode à mão, uma vez, no SQL Editor do Supabase.
--
-- =====================================================================
-- POR QUE ELE EXISTE
--
-- Em 27/ago/2026 o agendador do GitHub perdeu as DUAS execuções do dia. As
-- correções que foram para o código (bater de 15 em 15 minutos fora da hora
-- cheia, cadência no motor, batida registrada, alarme em 1 hora) melhoram
-- muito a chance de o GitHub entregar — mas **não removem o GitHub como
-- provedor único**. Se o `schedule` dele ficar degradado um dia inteiro, como
-- ficou, quarenta batidas perdidas continuam sendo quarenta batidas perdidas.
--
-- Este script é a única camada que responde de verdade a "não pode acontecer":
-- um segundo agendador, em outra empresa, em outra infraestrutura. Para a
-- campanha parar, os dois precisam falhar no mesmo dia.
--
-- ⚠ E BATER DUAS VEZES NÃO MANDA MENSAGEM DUAS VEZES. O espaçamento
-- (`min_minutos_entre_rodadas`, em `lib/espacamento.ts`) e o teto do dia
-- (contado do banco, não de contador em memória) já governam isso. Os dois
-- agendadores batem na MESMA porta; quem decide continua sendo o motor.
--
-- =====================================================================
-- ANTES DE RODAR — duas ações no painel do Supabase
--
--   1) Database → Extensions → ligar `pg_cron` e `pg_net`.
--   2) Trocar os dois valores no bloco abaixo pelo segredo real e pela URL.
--      O segredo é o MESMO `MOTOR_CRON_SECRET` que está na Vercel e no GitHub.
--
-- ⚠ O SEGREDO VAI PARA O VAULT, NUNCA PARA O CORPO DO JOB. `cron.job` é
-- legível por quem alcança o banco, e o comando do job ficaria com o segredo
-- em texto puro numa tabela de sistema. É a mesma regra de `tenant_secrets`:
-- credencial não mora em lugar que uma policy de leitura alcança.
-- =====================================================================

-- 1. O segredo, no Vault.
select vault.create_secret(
  'TROQUE_PELO_MOTOR_CRON_SECRET',
  'motor_cron_secret',
  'Segredo do gatilho do motor proativo. Igual ao MOTOR_CRON_SECRET da Vercel.'
);

-- 2. A função que bate na porta.
--
-- ⚠ O TIMEOUT É DE 120s, NÃO O PADRÃO DE 5s. Uma rodada de 15 mensagens com
-- pausa de 6s leva mais de um minuto e meio. Com o padrão, o `pg_net` desiste
-- de ler a resposta no meio — a rodada ainda completa do lado da Vercel, mas
-- nós ficamos sem saber o que aconteceu, que é o defeito que esta semana
-- inteira existiu para fechar.
create or replace function public.bater_no_motor()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  segredo text;
begin
  select decrypted_secret into segredo
    from vault.decrypted_secrets
   where name = 'motor_cron_secret';

  if segredo is null then
    raise warning '[motor] segredo ausente no vault — batida cancelada';
    return;
  end if;

  perform net.http_post(
    url     := 'https://kairos.wsslabs.com.br/api/motor/rodar',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || segredo,
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.bater_no_motor() from public, anon, authenticated;

-- 3. O agendamento.
--
-- ⚠ NOS MINUTOS 0/15/30/45, DESLOCADO DO GITHUB (7/22/37/52). Sete minutos de
-- diferença: se um dos dois atrasar um pouco, eles não competem pela mesma
-- rodada — e o espaçamento decide de qualquer jeito. Horas 12–21 UTC = 9h–18h
-- de Brasília, a mesma janela do `motor.yml`.
--
-- ⚠ O `pg_cron` DO SUPABASE ESTÁ EM UTC, igual ao do GitHub. Conferir com
-- `show timezone;` antes de confiar — relógio de agendador foi exatamente o
-- que fez a simulação voltar vazia às 18h em 20/ago.
select cron.schedule(
  'motor-reserva',
  '0,15,30,45 12-21 * * 1-5',
  $$select public.bater_no_motor();$$
);

-- =====================================================================
-- CONFERIR DEPOIS DE RODAR
--
--   select * from cron.job;                         -- o job existe?
--   select * from cron.job_run_details               -- ele rodou?
--     order by start_time desc limit 10;
--   select occurred_at, origem, pulada, porque       -- chegou do outro lado?
--     from motor_execucoes order by occurred_at desc limit 10;
--
-- ⚠ AS BATIDAS DELE CHEGAM COMO `origem = 'agendador'`, iguais às do GitHub.
-- Isso é deliberado: para o produto, o que importa é se ALGUÉM bateu. Qual dos
-- dois bateu se descobre em `cron.job_run_details` — e no dia em que essa
-- pergunta virar operacional, ela vira coluna, não comentário.
--
-- PARA DESLIGAR:  select cron.unschedule('motor-reserva');
-- =====================================================================
