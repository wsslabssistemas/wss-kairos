-- O ID DA CONTA DO WHATSAPP BUSINESS (WABA), descoberto em vez de pedido.
--
-- ⚠ POR QUE ELE FALTAVA. As credenciais do canal são quatro caixas que a
-- pessoa cola na instalação (token, id do número, chave secreta do app, token
-- de verificação). O WABA id não é nenhuma delas — e sem ele não dá para ler
-- os MODELOS APROVADOS pela API (`GET /{waba_id}/message_templates`).
--
-- Consequência prática, anotada em 31/ago: o corpo dos modelos em
-- `modelos_canal` (0070) é RECONSTRUÍDO do repositório, não lido da Meta. Se
-- alguém reaprovar um texto lá e não atualizar aqui, a mensagem que sai passa
-- a ser diferente da que o histórico registra — e a IA responde uma conversa
-- que não aconteceu. Silencioso, como tudo que dói neste produto.
--
-- ⚠ E ELE JÁ CHEGAVA, O TEMPO INTEIRO. `entry[].id` de todo webhook da Meta É
-- o WABA id. `desmontarPacote` lia o `phone_number_id` de dentro de `entry` e
-- descartava o `id` da própria entrada.
--
-- Três caminhos de descoberta pela API foram tentados e os três recusam com o
-- token que temos: o campo `whatsapp_business_account` no id do número, os
-- `granular_scopes` do `debug_token`, e as duas arestas de WABA do app.
--
-- ⚠ POR QUE NÃO PEDIR MAIS UMA CAIXA. O onboarding é o gargalo declarado do
-- produto, e uma quinta caixa num formulário que já assusta é o custo mais
-- caro possível para um dado que a Meta manda de graça em toda mensagem.
-- Mesma decisão do `idDoApp` (`lib/perfil-canal.ts`), que descobre o app pelo
-- próprio token em vez de perguntar.
--
-- ⚠ E ELE MORA EM `tenant_secrets` — não porque seja segredo, mas porque é ali
-- que vive a identidade do canal daquela empresa, com RLS ligada e nenhuma
-- policy (só `service_role` alcança). Espalhar credencial de canal por duas
-- tabelas é como o `phone_number_id` já se perdeu uma vez.

alter table tenant_secrets
  add column if not exists whatsapp_waba_id text;

comment on column tenant_secrets.whatsapp_waba_id is
  'ID da conta do WhatsApp Business. Descoberto sozinho a partir de entry[].id do webhook — nunca digitado por ninguém. Necessário para ler os modelos aprovados pela API.';
