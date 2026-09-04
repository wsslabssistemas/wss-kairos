-- A CONVERSA COM QUEM TREINA POR CONVENIO — Gympass e Totalpass.
--
-- ⚠ POR QUE ISTO E UM PUBLICO PROPRIO, e nao "mais um ex-aluno".
--
-- Em 4/set a Marcela recebeu o segundo toque da reativacao e respondeu: *"eu ja
-- faco com o gympass"*. Ela treina na Be Fitness, tinha vindo naquele mesmo
-- dia, e o sistema a chamava de ex-aluna. Cruzando os cadastros com a base, ela
-- nao era caso isolado: **76 pessoas marcadas como ex-aluno tinham convenio**.
--
-- A matricula do convenio nao passa pelo sistema de mensalidade de onde os
-- ex-alunos vem — entao, para o Kairos, quem entra na academia todo dia pela
-- catraca do aplicativo simplesmente nao existe.
--
-- ⚠ E O CHECK-IN MUDA A CONVERSA INTEIRA. O fundador trouxe 12 meses de
-- check-in do Gympass e 3 do Totalpass, e disse a frase que define esta
-- biblioteca: *"teriamos que descobrir onde a pessoa treina e se esta
-- treinando, mas SEM PERGUNTAR DIRETAMENTE"*. Com o check-in, nao se pergunta:
-- se sabe. E saber muda o que se diz.
--
--   • vindo (ate 30 dias)  → reconhecer. NAO vender, NAO chamar de volta.
--   • esfriando (31 a 60)  → o publico mais valioso: ainda tem o convenio e
--                            parou de vir. Ninguem cancela por ter faltado.
--   • sumido (mais de 60)  → repatriar, sem cobranca.
--
-- ⚠ E O ERRO MAIS CARO AQUI E O DE DIZER "VOLTA" PARA QUEM ESTA LA DENTRO.
-- Quem treina tres vezes por semana e recebe "sentimos sua falta" conclui uma
-- coisa so: ninguem daqui presta atencao em mim. E o oposto do que a mensagem
-- pretendia.
--
-- ⚠ NADA AQUI OFERECE PLANO DIRETO NEM SEMANA EXPERIMENTAL. Semana
-- experimental para quem ja treina e ofensivo, e puxar para plano direto quem
-- paga pelo aplicativo e assunto de contrato com o convenio, nao de conversa
-- automatica. Se a pessoa PERGUNTAR sobre plano proprio, ai sim se responde.

insert into knowledge_entries
  (tenant_id, skill_key, category, entry_type, school, trigger_questions,
   strategy, technique, required_facts, next_objective, hard_rules, on_missing_facts, status)
values
-- ---------------------------------------------------------------------------
(null, 'academia', 'retention', 'proactive', 'relacionamento_carnegie',
 array[
   'treina pelo gympass', 'treina pelo totalpass', 'uso o gympass', 'uso o totalpass',
   'ja faco com o gympass', 'ja faco pelo gympass', 'sou do gympass', 'sou do totalpass',
   'venho pelo aplicativo', 'faco pelo convenio', 'como estao os treinos',
   'reconhecer quem treina', 'aluno de convenio ativo'
 ],
 'Ela treina aqui HOJE, pelo convenio — o sistema sabe pelo check-in, entao NAO pergunte se ela treina. ' ||
 'A conversa e de reconhecimento, nao de venda: diga que e bom te-la por aqui, cite algo concreto e ' ||
 'verificavel (a frequencia que ela mantem, o turno em que costuma vir) e ofereca ALGO UTIL sem pedir ' ||
 'nada em troca — ajuda do professor para revisar o treino, conhecer uma aula coletiva que ela ainda ' ||
 'nao faz. Encerre sem pergunta de venda. ' ||
 '⚠ NUNCA diga "sentimos sua falta", "volta pra gente" ou qualquer coisa que sugira que ela parou: ' ||
 'ela nao parou, e dizer isso prova que ninguem aqui presta atencao nela. ' ||
 '⚠ NUNCA ofereca plano proprio nem semana experimental por iniciativa nossa. Se ELA perguntar sobre ' ||
 'plano direto, responda com o catalogo, sem comparar com o convenio dela.',
 'Reciprocidade (Cialdini) + atencao genuina (Carnegie): valor entregue antes de qualquer pedido',
 array['schedule.horarios','offer.aulas_coletivas'],
 'manter_frequencia',
 array['Nao mencionar valor de plano, desconto ou adesao nesta conversa.'],
 -- `omit`: sem aula coletiva declarada, reconhece a presenca e encerra. Falta
 -- de atividade nao impede elogiar quem veio; inventar atividade, sim.
 'omit',
 'active'),
-- ---------------------------------------------------------------------------
(null, 'academia', 'retention', 'proactive', 'consultiva_spin',
 array[
   'parou de vir', 'faltou nas ultimas semanas', 'nao aparece ha um mes',
   'sumiu do treino', 'esfriando no convenio', 'nao vem mais treinar',
   'faz tempo que nao venho', 'estou sem tempo de ir', 'nao consegui ir esse mes'
 ],
 'Ela TEM o convenio e parou de vir — ninguem cancela por ter faltado, entao a janela para trazer de ' ||
 'volta esta aberta e e curta. Abra pelo que MUDOU no lado dela, nunca pelo que ela deixou de fazer: ' ||
 '"sumiu" e cobranca, e cobranca gera culpa, e culpa gera silencio. ' ||
 'Pergunte UMA coisa, fechada e facil de responder: se o que atrapalhou foi horario, rotina ou o treino ' ||
 'em si. Ofereca a saida concreta que existir no DNA para cada caso — outro turno, treino mais curto, ' ||
 'ajuda do professor para remontar. ' ||
 '⚠ NAO afirme quantos dias ela esta sem vir nem cite o check-in como quem exibe um registro: soa como ' ||
 'vigilancia. Diga que faz um tempo, no maximo.',
 'SPIN: situacao e problema antes de qualquer solucao',
 array['schedule.horarios'],
 'retomar_frequencia',
 array['Nao oferecer plano proprio nem desconto: ela ja paga pelo aplicativo, e o assunto aqui e voltar a treinar.'],
 -- `omit`: sem horario declarado, pergunta o turno em vez de sugerir um.
 'omit',
 'active'),
-- ---------------------------------------------------------------------------
(null, 'academia', 'reciprocity', 'proactive', 'oferta_valor',
 array[
   'nunca veio treinar', 'cadastrou e nao apareceu', 'primeiro treino pelo convenio',
   'como funciona pelo gympass', 'como funciona pelo totalpass', 'primeira vez na academia',
   'nao sei como comecar', 'tenho vergonha de comecar'
 ],
 'Ela tem o convenio e nunca usou aqui — o custo de vir nao e dinheiro (ela ja paga), e emocional e ' ||
 'operacional: nao saber como entra, o que faz no primeiro dia, se vai ficar perdida. Entao a mensagem ' ||
 'resolve o PRIMEIRO PASSO, nao vende nada: diga em uma frase como e chegar (o que apresentar na ' ||
 'recepcao, que o professor monta o treino no dia) e convide para um dia especifico. ' ||
 '⚠ Ofereca ESCOLHER entre duas coisas concretas, nunca uma pergunta aberta — "prefere de manha ou no ' ||
 'fim da tarde?" custa menos que "quando voce pode vir?". ' ||
 '⚠ E NAO REPITA a proposta se ela nao escolher: na conversa seguinte, pergunte o que atrapalha.',
 'Reducao de atrito (Jolt): o obstaculo e a indecisao, nao o preco',
 array['schedule.horarios'],
 'primeira_visita',
 array['Nao prometer atendimento exclusivo, personal incluso nem avaliacao que o DNA nao declare.'],
 -- `escalate`: convidar para um dia sem saber quando a academia abre e marcar
 -- encontro no escuro — a trava anti-invencao aplicada ao horario.
 'escalate',
 'active');

comment on table knowledge_entries is
  'Biblioteca comercial curada. O ativo do produto: codigo se copia em duas semanas, curadoria nao.';
