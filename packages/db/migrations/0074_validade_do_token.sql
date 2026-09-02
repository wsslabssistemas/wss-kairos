-- QUANDO O TOKEN VENCE — perguntado a Meta, nunca anotado por alguem.
--
-- ⚠ O PEDIDO DO FUNDADOR, em 02/set: "todo o trabalho manual e ruim, ainda
-- mais os que dependem da memoria de um humano, entao vamos ter que colocar
-- alertas de lembrete de token expirando".
--
-- Ele esta certo, e a saida e melhor que lembrete: o `debug_token` da Meta
-- DEVOLVE a data de expiracao do proprio token. Ninguem precisa anotar nada —
-- o sistema pergunta, e a tela mostra quantos dias faltam.
--
-- ⚠ E ISSO IMPORTA MAIS DO QUE PARECE. Token vencido nao da erro visivel: a
-- Meta recusa a chamada, o motor registra falha, e do lado de fora aparece
-- como "o sistema parou de responder". E o mesmo padrao que este projeto paga
-- desde agosto — a falha que se apresenta como silencio.
--
-- Fica em `canal_verificacoes` porque e o que o vigia ja escreve a cada
-- leitura da saude do numero: uma linha por verificacao, com o retrato do
-- canal naquele instante.

alter table canal_verificacoes
  add column if not exists token_expira_em timestamptz,
  add column if not exists token_valido    boolean;

comment on column canal_verificacoes.token_expira_em is
  'Quando o token do canal expira, segundo o debug_token da Meta. NULO = token sem validade declarada (os permanentes) ou leitura falhou.';
comment on column canal_verificacoes.token_valido is
  'Se a Meta considerava o token valido no momento da leitura. `false` e alarme: o canal ja esta mudo.';
