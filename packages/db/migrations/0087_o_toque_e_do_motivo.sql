-- O TOQUE E DO MOTIVO, NAO DA ETAPA — e sem isto a automacao dos outros
-- motivos nasceria travada.
--
-- ⚠ O QUE A MEDICAO MOSTROU (5/set/2026). O fundador decidiu automatizar a fila
-- por partes, comecando pela renovacao. Antes de mexer na tela eu medi o que
-- aconteceria: **72 alunos com contrato vencendo em 60 dias, e 63 deles ja com
-- pelo menos um toque na etapa.**
--
-- Com a contagem de ontem, ligar a renovacao hoje BLOQUEARIA 63 de 72 — a tela
-- diria "nao existe modelo para o 3o toque" para gente que nunca recebeu uma
-- unica mensagem de renovacao. A trava certa, aplicada ao numero errado.
--
-- ⚠ A CAUSA E UMA COINCIDENCIA QUE ME ENGANOU. `toques` conta toda saida desde
-- a entrada na etapa, e para a REATIVACAO isso coincide com "quantas
-- reativacoes ele recebeu": a etapa de ex-cliente so recebe esse motivo. Eu
-- generalizei de um caso onde os dois numeros eram o mesmo — e eles so sao o
-- mesmo la.
--
-- Para um cliente ativo, a etapa acumula toque de boas-vindas, de
-- acompanhamento, de recompra e resposta de campanha. Nada disso e renovacao.
--
-- ⚠ E O BACKFILL E O QUE IMPEDE O ESTRAGO OPOSTO. Se a contagem passasse a
-- olhar so `motivo_fila` sem preencher o passado, as 100+ reativacoes ja
-- enviadas contariam ZERO — e todo mundo que ja recebeu a abertura duas vezes
-- receberia uma terceira. O passado se marca pelo que da para provar: o texto
-- que saiu, que desde 31/ago fica gravado renderizado.

alter table interactions
  add column if not exists motivo_fila text;

comment on column interactions.motivo_fila is
  'O motivo da fila que originou este toque (reativacao, renovacao, followup, recompra, combinado, lembrete). NULL em resposta, em registro manual e no historico anterior a 5/set/2026. E o que faz o numero do toque ser DO MOTIVO, nunca da etapa.';

-- A consulta e sempre "quantos toques deste motivo esta pessoa recebeu".
create index if not exists interactions_motivo_fila_idx
  on interactions (tenant_id, contact_id, motivo_fila)
  where motivo_fila is not null;

-- ---------------------------------------------------------------------------
-- BACKFILL DA REATIVACAO — o unico motivo que ja saiu de verdade.
--
-- ⚠ SO O QUE DA PARA PROVAR. O criterio e o texto do modelo aprovado, que fica
-- gravado renderizado desde 31/ago (`modelos_canal`, 0070). Nada de inferir por
-- etapa ou por data: inferir aqui erraria para o lado de calar alguem que nunca
-- foi chamado, e esse silencio ninguem descobre.
update interactions
set motivo_fila = 'reativacao'
where direction = 'outbound'
  and input_kind = 'system_initiated'
  and external_id is not null
  and motivo_fila is null
  and (
    content like 'Oi,%mero novo%treinou com a gente%'
    or content like 'Oi,%ficando sem a sua resposta%'
  );
