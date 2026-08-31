-- GATILHOS DE RESPOSTA — a biblioteca foi curada para conversa que ENTRA.
--
-- ⚠ O DEFEITO, medido em 31/ago/2026 numa conversa real de reativação.
--
-- Todos os gatilhos da biblioteca são PERGUNTAS QUE O CLIENTE FAZ: "quanto
-- custa", "tem aula experimental", "o que você recomenda". Faz sentido para
-- quem chega no balcão. Só que a campanha proativa inverte a conversa: quem
-- pergunta é o sistema, e o cliente **responde** — "sim", "emagrecer", "foi o
-- horário". Resposta de WhatsApp tem uma ou duas palavras e não casa com
-- nenhum gatilho escrito como pergunta.
--
-- ⚠ E QUATRO ENTRADAS ESTAVAM COM A LISTA VAZIA — entre elas a de retenção
-- *"Quebrar o padrão da mensagem (Robbins) + recuar para atrair (Tracy)"*,
-- que é **a entrada que governa a reativação**, o motivo de maior volume e de
-- maior risco do produto. A técnica da campanha inteira só podia ser
-- alcançada por semelhança de prosa.
--
-- O efeito somado: a resposta "Emagrecer" casava com ZERO entradas, o motor
-- caía num punhado arbitrário de entradas de objeção, e a IA escrevia contorno
-- de objeção para uma conversa sem objeção nenhuma. Fluente, educada, sem
-- técnica — exatamente o que o fundador viu e nomeou.
--
-- ⚠ ACRESCENTA, NUNCA SUBSTITUI. As perguntas continuam valendo: quem chega
-- pelo Instagram continua perguntando "quanto custa". O que faltava era o
-- outro lado da conversa, não o outro em vez deste.
--
-- Idempotente: só entra o gatilho que ainda não está lá.

create or replace function pg_temp.somar_gatilhos(atual text[], novos text[])
returns text[] language sql immutable as $$
  select coalesce(atual, '{}'::text[]) || coalesce(
    (select array_agg(x) from unnest(novos) x
      where not (x = any (coalesce(atual, '{}'::text[])))),
    '{}'::text[]);
$$;

-- 1. REATIVAÇÃO — a entrada sem nenhum gatilho, e a mais usada do produto.
--    Os gatilhos são o que a pessoa RESPONDE a "quer que eu te conte como
--    está a academia hoje?": o sim curto, o "parei", o "faz tempo".
update knowledge_entries set trigger_questions = pg_temp.somar_gatilhos(trigger_questions, array[
  'sim', 'oi sim', 'quero sim', 'pode contar', 'pode falar', 'manda',
  'parei de treinar', 'faz tempo que não vou', 'estou parado', 'estou parada',
  'acabei parando', 'quero voltar', 'estava pensando em voltar', 'quanto tempo faz'
])
where skill_key = 'academia' and tenant_id is null and technique like 'Quebrar o padrão%';

-- 2. OBJETIVO DECLARADO — a resposta a "qual é seu objetivo?".
--    É o caso da conversa de 31/ago: "Emagrecer", uma palavra, zero casamento.
update knowledge_entries set trigger_questions = pg_temp.somar_gatilhos(trigger_questions, array[
  'emagrecer', 'perder peso', 'secar', 'ganhar massa', 'hipertrofia',
  'ficar mais forte', 'saúde', 'qualidade de vida', 'condicionamento',
  'meu objetivo é', 'quero emagrecer', 'quero ganhar massa'
])
where skill_key = 'academia' and tenant_id is null and category = 'goal_matching';

-- 3. O MOTIVO DA SAÍDA, RESPONDIDO. Quem parou por tempo não diz "minha
--    rotina é corrida" numa resposta: diz "os horários", "foi o horário".
--    A técnica certa já estava curada — faltava ser alcançável.
update knowledge_entries set trigger_questions = pg_temp.somar_gatilhos(trigger_questions, array[
  'os horários', 'foi o horário', 'foi o horario', 'falta de tempo',
  'não tinha tempo', 'nao tinha tempo', 'o trabalho', 'mudou minha rotina',
  'não consegui conciliar', 'sem tempo'
])
where skill_key = 'academia' and tenant_id is null and technique like 'Redução de sacrifício%';

update knowledge_entries set trigger_questions = pg_temp.somar_gatilhos(trigger_questions, array[
  'foi o valor', 'ficou caro', 'tava caro', 'estava caro', 'apertou',
  'questão financeira', 'foi o preço', 'foi o preco'
])
where skill_key = 'academia' and tenant_id is null and technique like 'Diluir o valor%';

update knowledge_entries set trigger_questions = pg_temp.somar_gatilhos(trigger_questions, array[
  'não vi resultado', 'nao vi resultado', 'não engrenou', 'nao engrenou',
  'desanimei', 'me sentia perdida', 'me sentia perdido', 'não gostei do treino',
  'enjoei', 'perdi a motivação'
])
where skill_key = 'academia' and tenant_id is null and technique like 'Diagnóstico antes de solução%';

-- 4. AS OUTRAS TRÊS DE LISTA VAZIA.
update knowledge_entries set trigger_questions = pg_temp.somar_gatilhos(trigger_questions, array[
  'e depois', 'como funciona', 'o que está incluso', 'o que eu recebo',
  'o que muda', 'me explica melhor'
])
where skill_key = 'academia' and tenant_id is null and technique like 'Fazer o valor aparecer%';

update knowledge_entries set trigger_questions = pg_temp.somar_gatilhos(trigger_questions, array[
  'até quando', 'ainda dá tempo', 'essa condição vale até quando',
  'vou perder a condição', 'até que dia'
])
where skill_key = 'academia' and tenant_id is null and technique like 'Aversão a perda%';

update knowledge_entries set trigger_questions = pg_temp.somar_gatilhos(trigger_questions, array[
  'melhorei', 'estou melhor', 'to conseguindo', 'estou gostando',
  'deu certo', 'consegui', 'valeu a pena'
])
where skill_key = 'academia' and tenant_id is null and technique like 'Colher o ganho%';
