-- O CORPO DO MODELO APROVADO — para a IA ver a PRIMEIRA fala da conversa.
--
-- ⚠ O DEFEITO, achado em 31/ago/2026 pelo fundador lendo uma conversa real.
--
-- Quando o motor manda um modelo aprovado, `lib/despacho.ts` gravava isto no
-- histórico:
--
--     (modelo "reativacao_ex_aluno")
--
-- O NOME, nunca o texto. São 114 interações assim no banco. Consequência: a IA
-- que redige a resposta lê um histórico que começa com um rótulo vazio seguido
-- de "Oi sim" — a cliente respondendo uma pergunta que o modelo não tem como
-- ver. O fundador nomeou antes de eu medir: *"fica uma resposta jogada ao ar"*.
--
-- E o pior é o de sempre nesta casa: não dava erro. A resposta saía fluente,
-- educada e genérica, e só quem conhece a conversa percebia que ela não
-- respondia nada.
--
-- ⚠ POR QUE UMA TABELA, E NÃO UMA CONSTANTE NO CÓDIGO. O corpo é dado do
-- produto e muda por aprovação da Meta, não por deploy. E ele é POR EMPRESA:
-- duas academias podem ter modelos com o mesmo nome e textos diferentes. O
-- padrão é o mesmo de `knowledge_entries`: linha com `tenant_id` nulo é o
-- texto do produto, linha com `tenant_id` sobrepõe.
--
-- ⚠ E `origem` EXISTE PARA NÃO MENTIR. `repositorio` quer dizer "reconstruído
-- do texto que nós escrevemos e submetemos", não "lido da Meta". A leitura
-- direta da Meta (`GET /{waba_id}/message_templates`) exige o WABA id, que
-- este token não alcança — está anotado como pendência no ESTADO_DO_PROJETO.
-- Enquanto ela não existir, a coluna diz de onde o texto veio, e quem ler
-- sabe o que está lendo.

create table if not exists modelos_canal (
  id            uuid primary key default gen_random_uuid(),
  -- Nulo = o texto do produto, válido para toda empresa que não tenha o seu.
  tenant_id     uuid references tenants(id) on delete cascade,
  nome          text not null,
  corpo         text not null,
  origem        text not null default 'repositorio'
                check (origem in ('repositorio', 'meta')),
  atualizado_em timestamptz not null default now()
);

-- `nulls not distinct` para que só exista UM texto de produto por nome — sem
-- ele o Postgres trata cada nulo como diferente e a tabela aceitaria dez
-- versões do mesmo modelo, com a leitura escolhendo uma por acaso.
create unique index if not exists modelos_canal_nome_por_empresa
  on modelos_canal (tenant_id, nome) nulls not distinct;

alter table modelos_canal enable row level security;

-- Leitura: o texto do produto e o da própria empresa. Não é estratégia (a
-- biblioteca curada é), é o que a empresa manda em nome dela — a tela precisa
-- poder mostrar. ESCRITA só por `service_role`: nenhuma policy de write.
drop policy if exists modelos_canal_read on modelos_canal;
create policy modelos_canal_read on modelos_canal
  for select to authenticated
  using (tenant_id is null or is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- O TEXTO DOS CINCO MODELOS APROVADOS.
--
-- Fonte: `docs/blueprint/MODELOS_WHATSAPP.md`, que é onde eles foram escritos
-- antes de irem para a Meta. As quebras de linha aqui são as do parágrafo — o
-- arquivo de origem tem quebra de leitura no meio das frases, que não existe
-- na mensagem que a pessoa recebeu.
-- ---------------------------------------------------------------------------

insert into modelos_canal (tenant_id, nome, corpo, origem) values
(null, 'reativacao_ex_aluno',
'Oi, {{1}}! Aqui é da {{2}} — estou falando de um número novo, que é o canal de atendimento que a gente passou a usar.

Você já treinou com a gente e acabou parando. Sem compromisso nenhum: quer que eu te conte como está a academia hoje, ou prefere que eu não te chame mais por aqui?',
'repositorio'),

(null, 'combinado_retorno',
'Oi, {{1}}! Aqui é da {{2}}.

Você tinha combinado com a gente de retomar o contato por volta de {{3}}. Estou passando para saber se ainda faz sentido para você seguirmos com isso.',
'repositorio'),

(null, 'renovacao_vencimento',
'Oi, {{1}}! Aqui é da {{2}}.

Passando um aviso sobre o seu plano: ele vence em {{3}}. Se quiser deixar a renovação encaminhada antes dessa data, é só me responder por aqui.',
'repositorio'),

(null, 'followup_retomada',
'Oi, {{1}}! Aqui é da {{2}}.

A gente começou uma conversa por aqui e eu acabei ficando sem a sua resposta. Você ainda quer que eu te ajude com isso, ou prefere que eu deixe para um outro momento?',
'repositorio'),

(null, 'recompra_retorno',
'Oi, {{1}}! Aqui é da {{2}} — este é o número novo de atendimento da gente.

Faz um tempo desde o seu último atendimento e eu lembrei de você. Quer que eu veja um horário para esta semana?',
'repositorio')
on conflict (tenant_id, nome) do nothing;
