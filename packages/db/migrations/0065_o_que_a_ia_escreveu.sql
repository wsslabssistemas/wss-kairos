-- 0065 — A MENSAGEM SAIU DA IA? E SAIU COMO VEIO?
--
-- POR QUE
-- O fundador, depois de uma semana atendendo pelo canal: *"já faz algumas
-- conversas que não estou precisando editar nada... no final dessa semana já
-- poderemos migrar para o modo automático"*.
--
-- ⚠ E NÃO HÁ COMO CONFERIR ISSO. Uma mensagem aceita sem mexer e uma mensagem
-- escrita do zero viram a MESMA linha `outbound`. A impressão dele pode estar
-- certa — provavelmente está — mas a decisão de tirar a pessoa do meio não
-- pode ser tomada por impressão, e é a decisão mais cara que este produto tem.
--
-- Toda esta semana foi trocar impressão por número: o custo da IA estava 1,5
-- vez errado, o "não enviou nada" tinha enviado 8, a conversa "aguardando" era
-- um emoji. Em todos, o que resolveu foi medir.
--
-- ⚠ POR QUE NÃO DEU PARA USAR `ai_edits`. Aquela tabela guarda SÓ as editadas,
-- e de propósito: mensagem idêntica não é lição e encheria o bloco do prompt
-- de ruído. Mas para a DECISÃO é o contrário — as idênticas são o sinal, são
-- elas que dizem que a IA acertou sozinha. As duas perguntas são diferentes e
-- precisavam de dois lugares.
--
--   • `aceita`  — a IA escreveu, a pessoa leu e mandou como veio.
--   • `editada` — a IA escreveu e a pessoa mudou. A lição está em `ai_edits`.
--   • NULO      — escrita à mão, sem sugestão nenhuma.
--
-- ⚠ E O DENOMINADOR IMPORTA MAIS QUE O NUMERADOR: "12 aceitas" não diz nada;
-- "12 aceitas de 14 geradas" diz que o automático é viável. Por isso as duas
-- pontas ficam na mesma coluna, na mesma tabela do envio.

alter table public.interactions
  add column if not exists origem_ia text
  check (origem_ia is null or origem_ia in ('aceita','editada'));

comment on column public.interactions.origem_ia is
  'A mensagem saiu de uma sugestao da IA: `aceita` = enviada como veio, `editada` = mudada antes. NULO = escrita a mao. E o numero que autoriza o automatico.';

create index if not exists ix_interactions_origem_ia
  on public.interactions(tenant_id, origem_ia) where origem_ia is not null;
