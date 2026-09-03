-- O CANAL DO FACEBOOK — as mensagens da pagina, no mesmo lugar das conversas.
--
-- ⚠ MESMO FORMATO DO INSTAGRAM, CHAVES DIFERENTES. O pacote chega com
-- `object: "page"` em vez de `object: "instagram"`, e o caminho interno e o
-- mesmo (`entry[].messaging[]`). O que muda:
--
--   • `entry[].id` e o ID DA PAGINA, nao da conta do Instagram.
--   • O remetente e um PSID (page-scoped id): a mesma pessoa tem um id no
--     Instagram e OUTRO no Facebook, e nenhum dos dois e telefone.
--   • A assinatura usa o segredo do APP, nao o do Instagram.
--
-- Por isso as colunas sao proprias. Reaproveitar `instagram_id` para guardar
-- PSID pareceria economia e produziria o pior defeito possivel: duas pessoas
-- diferentes casando no mesmo contato, com o historico de uma aparecendo na
-- conversa da outra.
--
-- ⚠ E AQUI TAMBEM SO SE RECEBE. Nao existe modelo aprovado nem campanha no
-- Messenger: a janela e de 24h depois que a pessoa escreve.

alter table tenant_secrets
  add column if not exists facebook_page_id text,
  add column if not exists facebook_token   text;

comment on column tenant_secrets.facebook_page_id is
  'ID da pagina do Facebook. E o `entry[].id` do webhook — e o que diz de qual empresa e a mensagem.';
comment on column tenant_secrets.facebook_token is
  'Token de acesso da PAGINA (page access token), gerado no painel da Meta.';

alter table contacts
  add column if not exists facebook_id text;

comment on column contacts.facebook_id is
  'PSID de quem escreve pela pagina do Facebook. Terceira chave do contato, ao lado do telefone e do instagram_id — a mesma pessoa tem ids diferentes em cada plataforma.';

create index if not exists contacts_facebook_id_idx
  on contacts (tenant_id, facebook_id)
  where facebook_id is not null;
