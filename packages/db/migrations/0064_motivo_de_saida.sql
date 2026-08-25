-- 0064 — POR QUE ELA PAROU, e o campo que faltava para a campanha 2 existir
--
-- POR QUE
-- Primeiro dia de campanha com resposta real: duas pessoas disseram não sem
-- dizer por quê. *"Por enquanto não irei mais"* e *"não tô liberada pra
-- retornar"*. Cada uma dessas frases esconde um motivo diferente — mudou de
-- bairro, está lesionada, achou caro, entrou em outra academia — e o motivo
-- não tinha onde morar. Sumiu junto com a conversa.
--
-- ⚠ E É ELE QUE MULTIPLICA A CAMPANHA SEGUINTE. O benchmark de reativação é
-- 3–5% para campanha genérica e 12–18% para segmentada. A segmentação que
-- vale nesta base não é idade nem plano: é POR QUE a pessoa saiu. Quem mudou
-- de bairro não volta com desconto nenhum; quem parou por preço não volta com
-- "sentimos sua falta".
--
-- ⚠ TRÊS COLUNAS, E CADA UMA FAZ UMA COISA:
--
--   • `motivo_saida` — a CHAVE, validada contra `churn_reasons` do manifesto.
--     É o que permite SOMAR ("41 saíram por preço"). Texto livre aqui viraria
--     acervo que ninguém consegue contar, que é o mesmo defeito do veredito
--     aberto no banco de provas.
--
--   • `motivo_saida_texto` — as PALAVRAS DELA. A chave soma; a frase é o que
--     abre a conversa seguinte. *"Você tinha me dito que ia começar a fazer
--     hora extra"* funciona; *"motivo: tempo"* não é pretexto de nada.
--
--   • `motivo_saida_em` — quando foi registrado. Motivo de dois anos atrás não
--     é o motivo de hoje, e sem data ninguém sabe qual é qual. Mesma lição da
--     trava de atualidade do DNA (`0029`).
--
-- ⚠ E A CHAVE NÃO É ENUM DO BANCO, de propósito. "Lesão" e "outra academia"
-- são vocabulário de academia; numa distribuidora o equivalente é "mudou de
-- fornecedor". Enum aqui exigiria migration a cada segmento novo e quebraria
-- a Lei 2 — a lista vive no manifesto, como as etapas da jornada.

alter table public.contacts
  add column if not exists motivo_saida       text,
  add column if not exists motivo_saida_texto text,
  add column if not exists motivo_saida_em    timestamptz;

comment on column public.contacts.motivo_saida is
  'A CHAVE do motivo, validada contra `churn_reasons` do manifesto — nunca enum do banco.';
comment on column public.contacts.motivo_saida_texto is
  'As PALAVRAS DELA. A chave permite somar; a frase e o que abre a proxima conversa.';
comment on column public.contacts.motivo_saida_em is
  'Quando o motivo foi registrado. Motivo de dois anos atras nao e o motivo de hoje.';

create index if not exists ix_contacts_motivo_saida
  on public.contacts(tenant_id, motivo_saida) where motivo_saida is not null;
