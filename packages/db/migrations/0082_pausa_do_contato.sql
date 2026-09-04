-- PAUSAR UMA PESSOA POR UM TEMPO — o silencio que tem prazo.
--
-- ⚠ POR QUE ISTO FALTAVA, e a conta que a falta gerou.
--
-- O produto tinha dois estados e nenhum servia para o caso mais comum:
--
--   • `do_not_contact` — para sempre, e nasceu para descadastro (LGPD).
--     Marcar aqui quem so pediu um tempo apaga um cliente que pode voltar em
--     marco.
--   • nada — e ai a regua chama de novo em cinco dias, que e a importunacao.
--
-- O caso que nomeou isso foi o Deoclecio, em 3/set: *"estou dando um tempo e
-- assim que der eu volto"*. O fundador pediu **pelo menos 30 dias** e a
-- cadencia nao tinha como saber — ela conta toques dados e silencio, nao sabe
-- que a PESSOA pediu tempo.
--
-- E em 4/set aconteceu de novo, pior, com a Valeria: ela disse *"no momento nao
-- irei retornar, assim que puder eu retorno, obrigada"* — nao, prazo dela e
-- despedida numa frase so — e recebeu uma pergunta sobre o motivo. Respondeu.
-- Recebeu um agradecimento. Ai escreveu **"Agora basta de pergunta OK?"**.
--
-- ⚠ E QUEM SE SENTE IMPORTUNADO NAO RECLAMA, BLOQUEIA. Bloqueio derruba a
-- qualidade do numero, e a qualidade do numero afeta a entrega de TODA mensagem
-- da empresa — inclusive a renovacao de quem paga em dia. O prejuizo nao fica
-- contido na conversa que irritou.

alter table contacts
  add column if not exists pausado_ate     date,
  add column if not exists pausa_motivo    text,
  add column if not exists pausa_definida_em timestamptz;

comment on column contacts.pausado_ate is
  'Ate quando o sistema nao fala sozinho com esta pessoa. NULL = sem pausa. Silencio com prazo: nem `do_not_contact` (para sempre) nem nada (volta em cinco dias).';
comment on column contacts.pausa_motivo is
  'Por que ela esta pausada, em portugues, para quem abrir a ficha entender — a frase dela quando houver.';

-- A consulta que a fila e o motor fazem: "quem esta pausado hoje?". Indice
-- parcial porque a esmagadora maioria nao esta.
create index if not exists contacts_pausados_idx
  on contacts (tenant_id, pausado_ate)
  where pausado_ate is not null;

-- ⚠ A PAUSA NAO IMPEDE A PESSOA DE FALAR CONOSCO, e isso e o desenho inteiro.
-- Ela silencia o que SAI sozinho: campanha, regua, resposta automatica de
-- retomada. Se ela escrever, a conversa acontece normalmente — quem pediu um
-- tempo e voltou por conta propria nao esta mais pedindo tempo.
