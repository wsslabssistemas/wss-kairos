-- 0069 — O VIGIA QUE PERGUNTA se o canal está de pé
--
-- POR QUE
-- Todo o alarme deste produto depende de EVENTO: a mensagem chega, o webhook
-- grava, a tela mostra. Isso funciona enquanto o transporte está vivo — e
-- emudece exatamente quando ele morre. Se a Meta desativar a assinatura do
-- webhook, se o token expirar, se o número for restringido, **não chega evento
-- nenhum** — e "nenhum evento" é indistinguível de "ninguém escreveu hoje".
--
-- ⚠ ESSA É A MESMA CLASSE DO AGENDADOR QUE PULOU (0066/0067), na peça que
-- ainda estava descoberta. Fechamos o silêncio de quem DISPARA e deixamos
-- aberto o silêncio de quem RECEBE. E o de receber é pior: mensagem que não
-- sai é reclamação de dentro de casa; mensagem que não CHEGA é um cliente que
-- escreveu, não foi respondido, e foi embora sem que ninguém soubesse que ele
-- escreveu.
--
-- ⚠ O ÚNICO JEITO DE FECHAR É PERGUNTAR. Silêncio deixa de ser resposta quando
-- alguém faz a pergunta e anota a hora. `lib/perfil-canal.ts` já sabe
-- consultar a Meta (`estadoDoNumero`) — só rodava quando um humano abria a
-- tela. Esta tabela é a metade que faltava: a resposta, com data.
--
-- ⚠ E ELE NÃO CONSERTA NADA, DE PROPÓSITO. Não troca token, não reconfigura
-- webhook, não reenvia. Religar sozinho um canal derrubado por decisão da
-- plataforma é o caminho para transformar restrição temporária em definitiva.
-- O vigia informa; a decisão é de quem lê.
--
-- ⚠ A LINHA DE SUCESSO TAMBÉM É GRAVADA. Guardar só as falhas repetiria o
-- defeito: sem a verificação que deu certo, "está tudo bem" volta a ser uma
-- ausência de notícia em vez de uma afirmação com hora.

create table if not exists public.canal_verificacoes (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  ok                   boolean not null,
  quality_rating       text,
  name_status          text,
  messaging_limit_tier text,
  verified_name        text,
  erro                 text,
  occurred_at          timestamptz not null default now()
);

comment on table public.canal_verificacoes is
  'Cada pergunta feita a Meta sobre a saude do numero — inclusive as que responderam OK. '
  'Sem a linha de sucesso, "esta tudo bem" volta a ser ausencia de noticia em vez de afirmacao com hora.';
comment on column public.canal_verificacoes.ok is
  'true = a Meta respondeu. NAO significa que esta tudo bem: veja quality_rating e name_status. '
  'false = nao deu para perguntar (token, rede, numero) — e o estado que precisa de gente.';

create index if not exists ix_canal_verificacoes
  on public.canal_verificacoes(tenant_id, occurred_at desc);

alter table public.canal_verificacoes enable row level security;

create policy canal_verificacoes_isolation on public.canal_verificacoes
  for all using (public.is_member_of(tenant_id)) with check (public.is_member_of(tenant_id));
