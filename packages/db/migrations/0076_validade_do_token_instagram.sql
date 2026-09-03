-- A VALIDADE DO TOKEN DO INSTAGRAM — o segundo token, que ninguem vigiava.
--
-- ⚠ O DEFEITO, achado por uma pergunta do fundador em 03/set: "este token do
-- Instagram, o sistema vai falar com a Meta pra ela dizer quando esta para
-- vencer os 60 dias? ja esta pronto?".
--
-- Nao estava. O vigia lia `credencialDoCanal`, que devolve o token do
-- WHATSAPP — e conferia a validade dele. O token do Instagram, colado uma hora
-- antes, nao era perguntado por ninguem.
--
-- ⚠ E ELE E JUSTAMENTE O QUE VENCE. O do WhatsApp costuma ser permanente
-- (`expires_at: 0`); o do Instagram vale 60 dias. Ou seja: a peca que eu
-- construi para avisar sobre expiracao estava vigiando o token que nao expira
-- e ignorando o que expira.
--
-- E o sintoma teria sido o de sempre: no dia 61 o nome de quem manda direct
-- para de ser buscado, depois o envio para, e do lado de fora parece "o
-- Instagram parou de funcionar".

alter table canal_verificacoes
  add column if not exists token_ig_expira_em timestamptz,
  add column if not exists token_ig_valido    boolean;

comment on column canal_verificacoes.token_ig_expira_em is
  'Quando o token do Instagram expira, segundo o debug_token da Meta. Ele costuma valer 60 dias — ao contrario do token do WhatsApp, que costuma ser permanente.';
comment on column canal_verificacoes.token_ig_valido is
  'Se a Meta considerava o token do Instagram valido na leitura. NULO = a empresa nao tem canal de Instagram configurado.';
