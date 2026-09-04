-- CORRIGE A TERCEIRA ENTRADA DO CONVENIO — "nunca veio" NAO EXISTE.
--
-- ⚠ EU LI O DADO ERRADO, E O FUNDADOR PEGOU NA MESMA HORA.
--
-- A `0083` criou uma entrada para "tem o convenio e nunca usou aqui", e eu
-- cheguei nela por aritmetica: 1.142 cadastros, 442 com check-in na janela,
-- logo 890 "nunca vieram". A conta estava certa e a conclusao estava errada.
--
-- Ele explicou o que o numero nao diz: *"nos nunca teremos acesso a pessoas que
-- tem o convenio — todos ou ja frequentam a academia, ou buscaram informacao
-- para frequentar"*. **O cadastro nasce NA academia.** Ninguem entra nessa
-- lista sem ter estado la.
--
-- Entao os 890 nao sao "nunca vieram": sao **vieram antes da janela do
-- arquivo** — 12 meses no Gympass, e apenas 3 no Totalpass. Recontado com a
-- leitura certa: 746 do Gympass e 158 do Totalpass estiveram la antes da
-- janela, e nao depois.
--
-- ⚠ E O ESTRAGO SERIA EXATAMENTE O DEFEITO QUE ESTA CASA MAIS TEME. A mensagem
-- *"vi que voce ainda nao veio treinar com a gente"* chegaria a alguem que
-- treinou ali por dois anos. **Fluente e errada** — a pessoa nao corrige, nao
-- reclama: conclui que ninguem daquela academia sabe quem ela e, e some.
--
-- ⚠ E A LICAO E DE METODO, nao de dado: **"a exportacao do cliente nao e a
-- realidade — ela tem um filtro que ninguem declarou"**. Ja tinha custado caro
-- com a "relacao de plano ativo" da Be Fitness, que era na verdade uma lista de
-- cobranca em aberto. A janela do arquivo de check-in e o mesmo filtro nao
-- declarado, e eu tratei ausencia de linha como ausencia de fato.

-- A entrada some. Nao vira outra coisa: nao existe publico "nunca veio", e
-- manter a linha com outro texto deixaria a chave antiga viva na busca.
delete from knowledge_entries
where tenant_id is null
  and skill_key = 'academia'
  and category = 'reciprocity'
  and 'nunca veio treinar' = any(trigger_questions);

-- ---------------------------------------------------------------------------
-- No lugar dela, o publico que EXISTE e que a `0083` nao cobria: quem esteve
-- na academia ha muito tempo — antes da janela do arquivo — e nao voltou.
--
-- ⚠ A CONVERSA COM ELE E OUTRA, e por isso e entrada propria em vez de
-- reaproveitar a de quem esfriou. Quem parou ha seis semanas lembra do
-- professor, do horario, da rotina; quem parou ha dois anos nao lembra de nada
-- disso — e para ele a academia de hoje e outra academia. Falar "faz um
-- tempinho" com quem sumiu ha dois anos e tao errado quanto falar "sentimos sua
-- falta" com quem treinou ontem: nos dois casos a pessoa percebe que o numero
-- do outro lado nao sabe quem ela e.
insert into knowledge_entries
  (tenant_id, skill_key, category, entry_type, school, trigger_questions,
   strategy, technique, required_facts, next_objective, hard_rules, on_missing_facts, status)
values
(null, 'academia', 'retention', 'proactive', 'oferta_valor',
 array[
   'sumiu ha mais de um ano', 'nao vem ha muito tempo', 'treinei ai faz tempo',
   'ja treinei ai', 'fui aluno ha uns anos', 'parei faz tempo',
   'convenio antigo sem check-in', 'nao vou ai ha bastante tempo'
 ],
 'Ela tem o convenio, ja esteve aqui, e faz MUITO tempo — mais de um ano. Ela nao lembra do horario, ' ||
 'nem do professor, e a academia que ela conheceu nao e a de hoje. Entao a mensagem NAO cobra ausencia ' ||
 'e NAO tenta puxar memoria: ela apresenta o que MUDOU desde entao, em uma ou duas coisas concretas que ' ||
 'existam no DNA (grade de aulas, equipamento, horario, aplicativo de treino), e convida a dar uma ' ||
 'passada para ver. ' ||
 '⚠ NAO diga "faz um tempinho": para quem sumiu ha dois anos isso soa como quem nao sabe com quem esta ' ||
 'falando — o mesmo erro, ao contrario, de dizer "sentimos sua falta" para quem treinou ontem. ' ||
 '⚠ E NAO afirme ha quantos meses ela nao vem: o arquivo de check-in tem janela curta, e o silencio ' ||
 'dele nao prova ausencia. Se nao souber, nao diga.',
 'Novidade como motivo de retorno (oferta de valor): saudade nao traz ninguem de volta, novidade traz',
 array['schedule.horarios'],
 'primeira_visita',
 array['Nao oferecer plano proprio nem semana experimental: ela ja paga pelo aplicativo.'],
 -- `omit`: sem novidade declarada no DNA, convide sem listar o que mudou. Falar
 -- de novidade inexistente e a trava anti-invencao sendo furada pelo lado do
 -- entusiasmo.
 'omit',
 'active');
