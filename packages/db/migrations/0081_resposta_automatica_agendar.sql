-- A SEXTA DECISAO: respondeu, E ALGUEM PRECISA MARCAR NA AGENDA.
--
-- ⚠ O BURACO QUE A FASE 2 ABRIU NO MESMO DIA EM QUE FOI LIGADA.
--
-- A regra da casa e antiga e continua valendo: **quem confirma compromisso e
-- gente.** A IA le "pode ser quinta de manha" e preenche `horario_escolhido`;
-- gravar a agenda a partir dessa leitura criaria compromisso que ninguem
-- combinou, e compromisso inventado vira mensagem cobrando algo que a pessoa
-- nunca disse. Por isso marcar na agenda sempre foi um clique.
--
-- So que ate hoje quem clicava estava na tela, lendo a conversa. Com a
-- resposta automatica ligada, a IA confirma "quinta as 10h esta certo" as 2h
-- da manha e **nada vai para a agenda** — e ninguem descobre ate a pessoa
-- aparecer na recepcao, ou nao aparecer.
--
-- ⚠ E ESSE ERRO JA ACONTECEU AQUI, com gente: duas pessoas fizeram a semana
-- experimental, ninguem cadastrou, e o sistema nao lembrou de ninguem por dez
-- dias. A diferenca e que agora seria o SISTEMA cometendo o erro que ele
-- existe para impedir.
--
-- As duas saidas obvias eram ruins:
--   • marcar sozinho — quebra a regra, e agenda errada e pior que agenda vazia;
--   • nao responder e escalar — abandona a pessoa no melhor momento da
--     conversa, que e justamente quando ela acabou de dizer sim.
--
-- A saida e a terceira: **responde na hora E deixa a tarefa visivel.** A
-- mensagem sai (o cliente e atendido), e a linha entra na fila de decisao
-- pendente com o horario escrito, para uma pessoa confirmar na agenda.
--
-- Valor proprio, e nao `escalou`, porque as duas coisas sao diferentes e a
-- tela precisa dizer qual e: `escalou` e "a IA NAO conseguiu responder";
-- `agendar` e "a IA respondeu bem e sobrou trabalho de gente". Somar os dois
-- faria o numero de recusas da trava anti-invencao subir por um motivo que nao
-- e recusa nenhuma — e esse numero e o que diz se a IA esta boa.

alter table respostas_automaticas drop constraint if exists respostas_automaticas_decisao_check;
alter table respostas_automaticas add constraint respostas_automaticas_decisao_check
  check (decisao in ('respondeu','escalou','desistiu','recusou','falhou','agendar'));

comment on column respostas_automaticas.decisao is
  'respondeu | escalou (a IA nao enviou e precisa de gente) | agendar (enviou, e sobrou marcar na agenda) | desistiu (nao era mais a vez dela) | recusou (nao devia responder) | falhou.';

-- A fila que a tela mostra passa a incluir `agendar`: os dois estados tem uma
-- pessoa esperando alguma coisa. O indice parcial acompanha.
drop index if exists respostas_automaticas_pendentes_idx;
create index if not exists respostas_automaticas_pendentes_idx
  on respostas_automaticas (tenant_id, occurred_at desc)
  where decisao in ('escalou','agendar') and visto_em is null;
