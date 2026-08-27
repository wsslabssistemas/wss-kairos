-- 0066 — TODA RODADA DO MOTOR FICA REGISTRADA, inclusive a que não mandou nada
--
-- POR QUE
-- 27/ago, 9h51. O fundador: *"não saiu as mensagens que eu tinha programado.
-- me diz se tenho que gerar novamente e qual foi o erro"*.
--
-- Não havia erro. O produto estava no ar (o endereço do gatilho respondia 401
-- corretamente, que é o esperado sem a chave), o modo em `auto`, o teto e o
-- recorte salvos, 39 candidatos esperando. **O cron do GitHub simplesmente
-- pulou a execução das 9h** — comportamento documentado dele em horário de
-- pico — e ninguém foi avisado.
--
-- ⚠ "O MOTOR NÃO RODOU" ERA INDISTINGUÍVEL DE "NÃO HAVIA NINGUÉM PARA FALAR".
-- É a assinatura de defeito que este projeto documenta em todo lugar, agora na
-- peça que gasta dinheiro sozinha. E o pior estado possível: campanha parada
-- com tudo configurado certo, sem nada na tela dizendo isso.
--
-- ⚠ E EU LI UM DADO COMO PROVA QUANDO ELE NÃO ERA. Uma hora antes eu havia
-- dito a ele que "44 mensagens saíram pelo motor sozinho, então o agendador já
-- disparou" — e o botão *Enviar agora* passa pelo MESMO `rodarMotor`, gravando
-- exatamente igual (`created_by` nulo, porque o toque do motor não pertence a
-- vendedor nenhum). Não havia evidência nenhuma de que o cron tivesse
-- funcionado alguma vez. É por isso que `origem` é a coluna que mais importa
-- aqui: sem ela, as duas coisas continuam iguais no banco.
--
-- ⚠ E A RODADA VAZIA TAMBÉM ENTRA. Uma execução que não mandou nada por estar
-- fora da janela é informação — é ela que distingue "rodou e não tinha
-- ninguém" de "não rodou". Guardar só os envios repetiria o defeito que esta
-- tabela existe para fechar.

create table if not exists public.motor_execucoes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  origem       text not null check (origem in ('agendador','botao')),
  simulado     boolean not null default false,
  avaliados    int not null default 0,
  escolhidos   int not null default 0,
  enviadas     int not null default 0,
  falhas       int not null default 0,
  interrompido boolean not null default false,
  porque       text,
  erro         text,
  occurred_at  timestamptz not null default now()
);

comment on table public.motor_execucoes is
  'Toda rodada do motor, do agendador ou do botao — inclusive as que nao mandaram nada.';
comment on column public.motor_execucoes.origem is
  'agendador = cron do GitHub; botao = alguem clicou em Enviar agora. Os dois passam pelo MESMO rodarMotor e gravavam identico no historico de mensagens.';

create index if not exists ix_motor_execucoes on public.motor_execucoes(tenant_id, occurred_at desc);

alter table public.motor_execucoes enable row level security;

create policy motor_execucoes_isolation on public.motor_execucoes
  for all using (public.is_member_of(tenant_id)) with check (public.is_member_of(tenant_id));
