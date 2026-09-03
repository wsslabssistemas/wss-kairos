-- O ANEXO DO DIRECT — que nao vem como `media_id`, vem como URL.
--
-- ⚠ O DEFEITO, achado em 03/set com a primeira mensagem real do Instagram. Uma
-- pessoa mandou um anexo pelo direct e ficou gravado so
-- "(anexo recebido no direct — veja no Instagram)", com `media_id` vazio.
--
-- A causa: eu supus que o Instagram mandaria a midia como o WhatsApp manda —
-- um `id` para buscar depois. **Ele nao manda.** O anexo chega como
-- `message.attachments[].payload.url`: um endereco direto, temporario, do CDN
-- da Meta. Duas plataformas da mesma empresa, dois formatos.
--
-- ⚠ E SUPOR SIMETRIA ENTRE APIS FOI O ERRO. O formato das mensagens era
-- identico ao do Messenger, entao eu assumi que o das midias tambem seria o do
-- WhatsApp. Nao e — e o sintoma foi um anexo que chegou e nao existia para
-- ninguem.
--
-- Coluna propria em vez de reaproveitar `media_id`: um e chave para buscar na
-- API, o outro e endereco para baixar. Guardar os dois no mesmo campo faria o
-- codigo do download ter que adivinhar qual e qual.

alter table interactions
  add column if not exists media_url text;

comment on column interactions.media_url is
  'Endereco direto do anexo (Instagram e Messenger mandam URL, nao id). Temporario: o CDN da Meta expira. `media_id` e o caminho do WhatsApp, que manda id.';
