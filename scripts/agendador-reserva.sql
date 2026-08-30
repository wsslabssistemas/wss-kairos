-- O AGENDADOR RESERVA — um segundo relógio, que falha de forma independente.
--
-- ⚠ ISTO NÃO É UMA MIGRATION, DE PROPÓSITO. Migration roda em TODO ambiente, na
-- sequência numerada. Isto depende de extensões e de um segredo que só existem
-- no projeto de produção; numerá-lo quebraria qualquer ambiente novo.
--
-- ⚠ JÁ FOI APLICADO em 30/ago/2026, no projeto `nljxhtvmrpuaotlhnmrb`. Este
-- arquivo é o REGISTRO do que está rodando lá, não uma proposta. Quem precisar
-- refazer em outro projeto roda daqui.
--
-- =====================================================================
-- POR QUE ELE EXISTE
--
-- O `schedule` do GitHub parou de criar execuções para este repositório. Não
-- foi só atraso: em 8 execuções o tique NUNCA foi pontual (22 a 162 minutos),
-- e depois de 28/ago não veio mais nenhuma — nem com o cron adensado para 40
-- batidas por dia. Todo envio desde então saiu porque alguém clicou no botão.
--
-- As correções no `motor.yml` melhoraram muito a chance de o GitHub entregar,
-- e **não removem o GitHub como provedor único**. Este arquivo é a única
-- camada que responde a "não pode acontecer": um segundo agendador, em outra
-- infraestrutura. Para a campanha parar, os dois precisam falhar no mesmo dia.
--
-- ⚠ E BATER DUAS VEZES NÃO MANDA MENSAGEM DUAS VEZES. O espaçamento
-- (`min_minutos_entre_rodadas`) e o teto do dia — contado do banco, não de
-- contador em memória — já governam isso. Os dois agendadores batem na MESMA
-- porta; quem decide continua sendo o motor.
-- =====================================================================

-- 1. As extensões. `supabase_vault` já vem instalado no Supabase.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. O segredo, no cofre.
--
-- ⚠ NUNCA NO CORPO DO JOB. `cron.job` é legível por quem alcança o banco, e o
-- comando ficaria com o segredo em texto puro numa tabela de sistema. Mesma
-- regra de `tenant_secrets`: credencial não mora onde uma policy de leitura
-- alcança.
--
-- Criado com o valor 'PENDENTE' e trocado depois — ver o passo 5.
select vault.create_secret(
  'PENDENTE',
  'motor_cron_secret',
  'Segredo do gatilho do motor. Igual ao MOTOR_CRON_SECRET da Vercel.'
);

-- 3. A função que bate na porta.
--
-- ⚠ A ASSINATURA DO `net.http_post` FOI CONFERIDA NO BANCO, não suposta:
--   (url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds int)
-- Escrever de memória e errar a ordem faria a batida falhar em silêncio — que é
-- exatamente a classe de defeito que este arquivo existe para fechar.
--
-- ⚠ O TIMEOUT É DE 120s, NÃO O PADRÃO DE 5s. Uma rodada de 15 mensagens com
-- pausa de 6s leva mais de um minuto e meio; com o padrão, o `pg_net` desiste
-- de ler a resposta no meio e ficamos sem saber o que aconteceu.
--
-- ⚠ E SEGREDO AUSENTE AVISA E PARA, em vez de chamar sem autorização. Chamada
-- sem credencial voltaria 401 a cada 15 minutos, enchendo o log de erro que
-- não é erro.
create or replace function public.bater_no_motor()
returns void
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  segredo text;
  pedido  bigint;
begin
  select decrypted_secret into segredo
    from vault.decrypted_secrets
   where name = 'motor_cron_secret';

  if segredo is null or segredo = 'PENDENTE' then
    raise warning '[motor] segredo ausente no vault — batida cancelada';
    return;
  end if;

  select net.http_post(
    url                  := 'https://kairos.wsslabs.com.br/api/motor/rodar',
    body                 := '{}'::jsonb,
    headers              := jsonb_build_object(
                              'Authorization', 'Bearer ' || segredo,
                              'Content-Type',  'application/json'
                            ),
    timeout_milliseconds := 120000
  ) into pedido;
end;
$$;

revoke all on function public.bater_no_motor() from public, anon, authenticated;

-- 4. O agendamento.
--
-- ⚠ NOS MINUTOS 0/15/30/45, DESLOCADO DO GITHUB (7/22/37/52). Sete minutos de
-- diferença: se um dos dois atrasar um pouco, eles não competem pela mesma
-- rodada — e o espaçamento decide de qualquer jeito.
--
-- ⚠ O FUSO FOI CONFERIDO: `show timezone` devolve UTC. Então 12–21 é 9h–18h de
-- Brasília, dentro da janela padrão. Supor o fuso do agendador foi exatamente o
-- defeito que fez a simulação voltar vazia às 18h em 20/ago.
select cron.schedule(
  'motor-reserva',
  '0,15,30,45 12-21 * * 1-5',
  $$select public.bater_no_motor();$$
);

-- 5. ⚠ O ÚNICO PASSO QUE PRECISA DE GENTE — trocar o segredo pelo valor real.
--
-- O `MOTOR_CRON_SECRET` mora na Vercel (Settings → Environment Variables) e não
-- existe em lugar nenhum do repositório, de propósito. Copie de lá e rode:
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'motor_cron_secret'),
--     'COLE_AQUI_O_MOTOR_CRON_SECRET'
--   );
--
-- Enquanto ele for 'PENDENTE', a função avisa e não chama nada — o agendador
-- fica montado e desarmado, sem gerar erro nem mensagem.

-- =====================================================================
-- CONFERIR
--
--   select jobid, jobname, schedule, active from cron.job;
--   select status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 10;
--   select id, status_code, created from net._http_response
--     order by created desc limit 10;
--   select occurred_at, origem, pulada, porque
--     from motor_execucoes order by occurred_at desc limit 10;
--
-- ⚠ AS BATIDAS DELE CHEGAM COMO `origem = 'agendador'`, iguais às do GitHub.
-- Deliberado: para o produto, o que importa é se ALGUÉM bateu. Qual dos dois se
-- descobre em `cron.job_run_details`; no dia em que essa pergunta virar
-- operacional, ela vira coluna — não comentário.
--
-- PARA DESLIGAR:  select cron.unschedule('motor-reserva');
-- =====================================================================
