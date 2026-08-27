-- 0068 — A ANOTAÇÃO DO VENDEDOR NÃO É FALA DO CLIENTE
--
-- POR QUE
-- Quem atende escreve, no campo de mensagem da aba Responder, coisas como
-- *"faça uma mensagem de proposta para o retorno da aluna"* ou
-- *"MATRICULA RENOVADA POR MAIS 6 MESES"*. Isso é BOM — é briefing, e a IA
-- gera resposta melhor com ele do que sem. O defeito nunca foi o texto
-- existir: é ele ficar gravado como `customer_message`, isto é, como se a
-- cliente tivesse dito aquilo.
--
-- ⚠ E O ERRO APONTA PARA O LADO BONITO, que é o que o torna perigoso. A
-- pessoa escreve o briefing e a resposta sai em segundos — **é ela
-- respondendo a si mesma**. Isso entra no tempo de resposta e puxa a mediana e
-- o p90 para BAIXO. O produto parece atender mais rápido do que atende, em 14%
-- dos casos (183 de 1.274 entradas), e justamente na métrica que ele vende.
-- Métrica que erra a favor não gera reclamação: ninguém audita um número que
-- está lisonjeando.
--
-- ⚠ A CAIXA JÁ EXISTIA, e este é o achado incômodo. O `0001_foundation.sql`
-- escreveu, ao criar a tabela: *"input_kind separa três coisas que o protótipo
-- misturava no mesmo campo: mensagem real do cliente, ANOTAÇÃO DO VENDEDOR, e
-- iniciativa do sistema."* A terceira gaveta foi projetada no primeiro dia e
-- nunca foi usada; o código foi guardando tudo na primeira.
--
-- POR QUE NÃO REAPROVEITAR `agent_briefing`, que era o nome pensado para isso:
-- no outbound ele hoje significa "resposta reativa", em oposição a
-- `system_initiated` = "toque proativo" — e a Gestão depende dessa separação
-- para distinguir tempo de resposta de campanha. Enfiar o briefing lá faria o
-- MESMO valor significar duas coisas conforme a `direction` do vizinho. É
-- exatamente essa classe de sobrecarga que manteve este defeito invisível.
--
-- A REGRA DO BACKFILL é a que já separava tudo sem ninguém perceber:
--   inbound + `created_by` preenchido  → alguém da equipe digitou
--   inbound + `created_by` nulo        → chegou pelo webhook, é o cliente
-- Medido na Be Fitness antes de escrever isto: 183 com autor, 1.091 sem, e
-- **zero sobreposição** — nenhuma linha com autor tem `external_id` da Meta.
-- A atribuição a um usuário, que era a preocupação, já estava gravada.
--
-- ⚠ O BRIEFING CONTINUA INDO PARA O PROMPT. O histórico que alimenta a IA
-- seleciona `direction, content, occurred_at` e NÃO filtra `input_kind`
-- (`responder/ai-actions.ts`). Esta migration muda o que a MÉTRICA enxerga,
-- não o que a IA lê. Se algum dia alguém filtrar o histórico por
-- `customer_message`, vai apagar o briefing do contexto sem querer — e a
-- qualidade da geração cai sem nada quebrar.

alter table public.interactions drop constraint if exists interactions_input_kind_check;

alter table public.interactions add constraint interactions_input_kind_check
  check (input_kind in ('customer_message','agent_briefing','system_initiated','customer_reaction','agent_note'));

comment on constraint interactions_input_kind_check on public.interactions is
  'agent_note = anotacao/briefing escrito por alguem da equipe no campo de mensagem, para orientar a IA. '
  'Fica no historico e CONTINUA indo para o prompt, mas NAO e fala do cliente: nao conta como mensagem '
  'esperando resposta nem entra no tempo de resposta. E a terceira gaveta que o 0001 projetou e ninguem usou.';

-- O backfill. `direction = inbound` com autor so acontece pela aba Responder;
-- o webhook nunca preenche `created_by`.
update public.interactions
   set input_kind = 'agent_note'
 where direction = 'inbound'
   and created_by is not null
   and input_kind = 'customer_message';

-- ⚠ ÍNDICE PARA QUEM PASSA A FILTRAR. A lista de "aguardando resposta" e o
-- tempo de resposta da Gestao passam a excluir `agent_note`, e `interactions`
-- e a tabela que mais cresce nesta casa.
create index if not exists ix_interactions_cliente_falou
  on public.interactions(tenant_id, occurred_at desc)
  where direction = 'inbound' and input_kind = 'customer_message';
