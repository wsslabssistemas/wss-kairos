-- O CANAL DO INSTAGRAM — os directs entrando no mesmo lugar das conversas.
--
-- ⚠ POR QUE ELE E DIFERENTE DO WHATSAPP, e a diferenca decide o desenho:
--
--   • No WhatsApp a pessoa TEM telefone, e o telefone e a chave do contato.
--     No Instagram nao existe telefone: existe um id proprio da conversa
--     (Instagram-scoped id), que so vale para ESTE app e ESTA conta.
--   • Nao existe modelo aprovado nem envio proativo. O webhook so dispara
--     DEPOIS que a pessoa escreve, e ha 24h para responder (7 dias com a
--     marca de atendimento humano). Campanha de reativacao NAO roda aqui.
--
-- Por isso o Instagram entra como CANAL DE RESPOSTA, nunca como canal de
-- campanha — e o contato precisa de uma segunda chave, ao lado do telefone.
--
-- ⚠ E A CREDENCIAL MORA EM `tenant_secrets`, como a do WhatsApp. Nao porque o
-- id da conta seja secreto, mas porque e ali que vive a identidade do canal
-- daquela empresa, com RLS ligada e nenhuma policy. Espalhar credencial de
-- canal por duas tabelas foi como o `phone_number_id` ja se perdeu uma vez.

alter table tenant_secrets
  add column if not exists instagram_account_id text,
  add column if not exists instagram_token      text;

comment on column tenant_secrets.instagram_account_id is
  'ID da conta profissional do Instagram. E o `entry[].id` do webhook — e o que diz de qual empresa e o direct.';
comment on column tenant_secrets.instagram_token is
  'Token de acesso da conta do Instagram, gerado no passo "Adicionar conta" do painel da Meta.';

-- ⚠ A SEGUNDA CHAVE DO CONTATO.
--
-- O id do Instagram e por app e por conta: a mesma pessoa tem ids diferentes
-- em dois apps. Ele NAO substitui o telefone — convive com ele, e o dia em que
-- a pessoa mandar o telefone pelo direct, os dois cadastros viram um.
alter table contacts
  add column if not exists instagram_id text;

comment on column contacts.instagram_id is
  'Instagram-scoped id de quem escreve por direct. Chave alternativa ao telefone: quem chega pelo Instagram nao tem telefone.';

-- Busca por id do Instagram acontece a CADA mensagem recebida. Parcial porque
-- a esmagadora maioria dos contatos nunca vai ter um.
create index if not exists contacts_instagram_id_idx
  on contacts (tenant_id, instagram_id)
  where instagram_id is not null;
