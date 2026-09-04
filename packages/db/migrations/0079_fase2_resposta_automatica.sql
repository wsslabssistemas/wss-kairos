-- FASE 2 — A IA RESPONDE SOZINHA, e o registro de que ela tentou.
--
-- ⚠ POR QUE EXISTE UMA TABELA, e nao so a mensagem enviada.
--
-- E a licao de `motor_execucoes` (0066/0067) aplicada a peca seguinte. Ali a
-- campanha nao saiu por dois dias e "nao rodou" era indistinguivel de "nao
-- havia ninguem para falar": produto no ar, modo em `auto`, 39 candidatos
-- esperando, nenhum erro em lugar nenhum. A correcao foi registrar a EXECUCAO,
-- nao so o resultado.
--
-- A resposta automatica tem exatamente a mesma forma de silencio, e pior: ela
-- roda depois que o cliente ESCREVEU. "A IA nao respondeu a Fulana" pode ser
-- qualquer um destes, e sem registro os quatro sao o mesmo nada:
--
--   • a trava anti-invencao recusou (falta um fato — e o comportamento CERTO);
--   • alguem da equipe respondeu antes, no meio da pausa;
--   • chegou outra mensagem dela e esta rodada desistiu em favor da seguinte;
--   • quebrou.
--
-- ⚠ E O CASO 1 E O QUE MAIS IMPORTA. Recusa da trava e o produto funcionando —
-- mas do lado do cliente e uma pessoa esperando resposta que nunca vem. Hoje a
-- recusa aparece na tela porque e o fundador quem clica em gerar; sozinha, ela
-- precisa CHAMAR alguem. Sem esta tabela nao ha o que chamar.

create table if not exists respostas_automaticas (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  occurred_at  timestamptz not null default now(),

  -- O que a rodada decidiu. Lista fechada: `porque` conta a historia, `decisao`
  -- e o que da para SOMAR — a mesma separacao de `motivo_saida` (chave) e
  -- `motivo_saida_texto` (frase).
  --
  --   respondeu   — gerou e enviou.
  --   escalou     — gerou e NAO enviou: a trava recusou, e alguem precisa ver.
  --   desistiu    — nao era mais a vez dela (humano respondeu, ou chegou
  --                 mensagem nova). Nao e defeito, e a pausa fazendo o trabalho.
  --   recusou     — nao devia responder (fora da janela, descadastrado, reacao).
  --   falhou      — quebrou. O texto do erro vai em `porque`.
  decisao      text not null check (decisao in ('respondeu','escalou','desistiu','recusou','falhou')),

  -- Por que, em portugues, para uma PESSOA ler. Nunca so um codigo: a tela de
  -- quem opera precisa dizer o motivo, e "escalou" sozinho nao diz nada.
  porque       text not null,

  -- ⚠ QUANTO A PAUSA ESPEROU DE FATO. Ela e aleatoria entre 20 e 40s de
  -- proposito (intervalo constante e tao artificial quanto intervalo nenhum), e
  -- sem registro nao ha como conferir que ela existiu. Peca que se comporta
  -- como gente precisa provar que se comportou.
  esperou_ms   integer,

  -- A mensagem que saiu, quando saiu. `null` em todo o resto.
  interaction_id uuid references interactions(id) on delete set null,

  -- ⚠ QUEM JA OLHOU. So vale para `escalou`: e a fila de decisao pendente.
  -- Enquanto for nulo, tem gente esperando resposta e ninguem sabe.
  visto_em     timestamptz,
  visto_por    uuid references memberships(id) on delete set null
);

comment on table respostas_automaticas is
  'Registro de cada tentativa da IA de responder sozinha. Existe para que "nao respondeu" nunca seja indistinguivel de "nao havia o que responder" — a licao de motor_execucoes aplicada a fase 2.';

create index if not exists respostas_automaticas_tenant_idx
  on respostas_automaticas (tenant_id, occurred_at desc);

-- A FILA DE DECISAO PENDENTE, que e a consulta que a tela faz o tempo todo.
-- Indice parcial porque so `escalou` sem `visto_em` interessa.
create index if not exists respostas_automaticas_pendentes_idx
  on respostas_automaticas (tenant_id, occurred_at desc)
  where decisao = 'escalou' and visto_em is null;

alter table respostas_automaticas enable row level security;

-- Leitura por quem e da empresa; escrita so pelo service_role (quem escreve e
-- a maquina, sem sessao). Sem policy de insert, o Postgres nega a todos os
-- papeis com RLS ligada — que e exatamente o desenho de `tenant_secrets`.
drop policy if exists respostas_automaticas_select on respostas_automaticas;
create policy respostas_automaticas_select on respostas_automaticas
  for select using (
    exists (
      select 1 from memberships m
      where m.tenant_id = respostas_automaticas.tenant_id
        and m.user_id = auth.uid()
    )
  );

-- Marcar como visto e acao de gente, e por isso tem policy propria — e ela so
-- deixa mexer nas duas colunas de leitura porque o resto e registro de fato
-- consumado. (RLS e row-level: a garantia de coluna vem do trigger abaixo, a
-- mesma solucao de `t_decisions_append_only` no 0006.)
drop policy if exists respostas_automaticas_update on respostas_automaticas;
create policy respostas_automaticas_update on respostas_automaticas
  for update using (
    exists (
      select 1 from memberships m
      where m.tenant_id = respostas_automaticas.tenant_id
        and m.user_id = auth.uid()
    )
  );

create or replace function respostas_automaticas_append_only()
returns trigger
language plpgsql
as $$
begin
  -- ⚠ SO `visto_em` E `visto_por` MUDAM, PARA TODO PAPEL, inclusive
  -- service_role. Registro de execucao que pode ser reescrito nao e registro:
  -- e a mesma razao de `decisions` ser append-only por trigger e nao por
  -- policy — RLS e row-level, nao column-level.
  if new.tenant_id      is distinct from old.tenant_id
  or new.contact_id     is distinct from old.contact_id
  or new.occurred_at    is distinct from old.occurred_at
  or new.decisao        is distinct from old.decisao
  or new.porque         is distinct from old.porque
  or new.esperou_ms     is distinct from old.esperou_ms
  or new.interaction_id is distinct from old.interaction_id then
    raise exception 'respostas_automaticas e registro de execucao: so visto_em e visto_por podem mudar';
  end if;
  return new;
end;
$$;

drop trigger if exists t_respostas_automaticas_append_only on respostas_automaticas;
create trigger t_respostas_automaticas_append_only
  before update on respostas_automaticas
  for each row execute function respostas_automaticas_append_only();

-- ---------------------------------------------------------------------------
-- ⚠ A MENSAGEM AUTOMATICA NAO PODE CONTAR COMO "ACEITA SEM EDICAO".
--
-- `origem_ia` aceitava `aceita` e `editada`, e foi ELA que autorizou a fase 2:
-- 69 casos, 82,6% aceitas. Gravar a resposta automatica como `aceita` faria o
-- numero subir sozinho ate 100% — porque ninguem edita o que ninguem le.
--
-- **O indicador que justificou a decisao viraria consequencia da decisao.** E
-- a familia do "contar nao substitui conferir": um numero que so pode subir
-- nao mede mais nada, e continuaria com cara de medida.
--
-- Por isso um valor proprio. Quem soma qualidade filtra `in ('aceita','editada')`
-- e continua medindo o que uma PESSOA julgou.
-- ---------------------------------------------------------------------------
alter table interactions drop constraint if exists interactions_origem_ia_check;
alter table interactions add constraint interactions_origem_ia_check
  check (origem_ia is null or origem_ia in ('aceita','editada','automatica'));

comment on column interactions.origem_ia is
  'Como a sugestao da IA virou mensagem: `aceita` (pessoa enviou sem editar), `editada` (pessoa mudou antes de enviar) ou `automatica` (a IA enviou sozinha, sem ninguem ler). So as duas primeiras medem qualidade julgada por gente.';
