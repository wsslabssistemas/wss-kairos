-- ALERTA ATIVO — o produto passa a CHAMAR, em vez de esperar alguem abrir a tela.
--
-- ⚠ O QUE FALTAVA, E O FUNDADOR ACHOU QUE JA EXISTIA. Em 04/set ele disse:
-- *"fazer o registro de alertas (eu ate pensei que ja tinha, pois eu ja havia
-- solicitado)"*. O que existia era REGISTRO — `motor_execucoes`, o vigia do
-- canal, a validade do token, o alarme de silencio. Tudo isso desenha na tela
-- e espera alguem olhar.
--
-- E a peca inteira roda quando ninguem esta olhando: o motor bate de 15 em 15
-- minutos, a fase 2 responde as 2h da manha, e o token vence num domingo. Ter
-- registro e nao ter alerta e a ultima versao do defeito desta casa —
-- "quebrado" indistinguivel de "nao havia trabalho" —, so que agora com todos
-- os dados na mao e ninguem lendo.
--
-- ⚠ ESTA TABELA NAO GUARDA O ALERTA: guarda que ele JA FOI DADO. E a diferenca
-- entre avisar e amolar. Sem ela, um token vencendo em 7 dias mandaria um
-- e-mail a cada 15 minutos por uma semana — 672 e-mails —, e alarme que toca
-- sempre e alarme desligado. A regra e a mesma do `vigia`: cada tipo tem uma
-- janela propria de silencio, e a `chave` diz de QUAL ocorrencia se trata.

create table if not exists alertas_enviados (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,

  -- Que especie de alerta. Lista aberta de proposito: alerta novo nao pode
  -- exigir migration — o custo de adiar um aviso e maior que o de aceitar um
  -- texto livre aqui, e nada de negocio soma por este campo.
  tipo        text not null,

  -- ⚠ QUAL OCORRENCIA. E o que separa "o token vence em 7 dias" de "o token
  -- vence em 3 dias": mesmo tipo, avisos diferentes, e o segundo PRECISA
  -- furar o silencio do primeiro. Sem `chave`, a janela de silencio esconderia
  -- justamente a piora — que e a unica novidade que importa num alarme.
  chave       text not null default '',

  enviado_em  timestamptz not null default now(),

  -- Para quem foi, e se saiu. `false` com `erro` preenchido e o caso de nao
  -- haver chave de e-mail configurada: o alerta EXISTE, so nao foi entregue —
  -- e a tela precisa poder dizer isso, em vez de nao mostrar nada.
  destino     text,
  entregue    boolean not null default false,
  erro        text
);

comment on table alertas_enviados is
  'Registro de que um alerta ja foi dado, para nao repetir. Nao e a fila de alertas: e a memoria do que ja tocou.';

create index if not exists alertas_enviados_busca_idx
  on alertas_enviados (tenant_id, tipo, chave, enviado_em desc);

alter table alertas_enviados enable row level security;

-- Leitura para quem e da empresa; escrita so pelo service_role (quem escreve e
-- a maquina, sem sessao). Sem policy de insert, o Postgres nega a todos os
-- papeis com RLS ligada — o desenho de `tenant_secrets`.
drop policy if exists alertas_enviados_select on alertas_enviados;
create policy alertas_enviados_select on alertas_enviados
  for select using (
    exists (
      select 1 from memberships m
      where m.tenant_id = alertas_enviados.tenant_id
        and m.user_id = auth.uid()
    )
  );
