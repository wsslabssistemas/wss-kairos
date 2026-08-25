-- 0062 — QUANDO A CONVERSA ACABOU, E O SISTEMA NÃO TEM COMO SABER SOZINHO
--
-- POR QUE
-- Primeiro dia de campanha com respostas de verdade. A Daniela escreveu que
-- queria voltar, recebeu as informações, disse *"não estou com a minha agenda
-- agora, mas assim que chegar em casa verifico e dou retorno"*, foi respondida
-- com *"combinado, fico no aguardo"* — e fechou com um **"Combinado"**.
--
-- Para a tela, a última mensagem é dela: **está esperando resposta.** Para
-- qualquer pessoa que leia, a conversa acabou. O fundador perguntou o que
-- importa: *"o sistema consegue compreender que a conversa se encerrou? e que
-- continuar seria causar problema?"*
--
-- ⚠ NÃO CONSEGUE, E A REGRA ATUAL ESTÁ CERTA. "Se a última mensagem é dele,
-- ninguém respondeu" é estrutural, não depende de ninguém marcar nada, e por
-- isso funciona. O que falta não é inteligência: é o lugar para registrar uma
-- decisão que **só quem leu pode tomar**.
--
-- ⚠ E POR QUE NÃO PEDIR PARA A IA DECIDIR. Classificar "Combinado" como fecho
-- exigiria chamar o modelo em toda mensagem que chega, e errar aqui tem lados
-- muito diferentes: fechar por engano some com uma pessoa que esperava
-- resposta — o defeito mais caro desta tela. Um clique de quem leu custa dois
-- segundos e não erra.
--
-- ⚠ E NÃO É "ARQUIVAR". Se ela escrever DEPOIS desta data, volta para a lista
-- na hora. Encerrar é sobre o que já foi dito, nunca sobre a pessoa — arquivo
-- que engole mensagem nova seria a caixa de entrada que perde cliente.

alter table public.contacts
  add column if not exists atendimento_encerrado_em timestamptz;

comment on column public.contacts.atendimento_encerrado_em is
  'Quando alguem declarou que aquela conversa nao precisa mais de resposta. NAO e "conversa arquivada": se a pessoa escrever DEPOIS desta data, ela volta para a lista de quem espera.';
