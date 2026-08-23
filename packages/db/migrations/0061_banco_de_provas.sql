-- 0061 — O BANCO DE PROVAS: o número que autoriza (ou proíbe) o automático
--
-- POR QUE
-- O fundador disse, sobre deixar a validação da IA com a equipe: *"os vendedores
-- são preguiçosos, não possuem intelecto e vontade suficiente para conduzir uma
-- conversa correta, deixar para eles fazerem o ajuste na máquina é muito
-- arriscado."*
--
-- ⚠ ISSO INVALIDA UMA PREMISSA NOSSA, e a consequência é maior que a frase.
-- A `0060` guarda a correção do vendedor porque ela seria "o sinal mais rápido
-- de qualidade da IA". Esse sinal **só existe se alguém corrigir**. Se a equipe
-- manda sem ler, a tabela fica vazia e o aprendizado não sai do zero — e a
-- decisão de ligar o automático continuaria sendo tomada por intuição, a dele
-- contra a minha, sem nenhum número.
--
-- Este é o número. Pega MENSAGEM REAL de cliente que já está no banco (1.145
-- entradas, 320 pessoas), roda o motor sem enviar e registra o julgamento de
-- UMA pessoa confiável: **enviaria como está · ajustaria · erro grave**.
--
-- ⚠ POR QUE MENSAGEM REAL, e não teste com conhecidos.
-- A alternativa proposta era mandar para 10 amigos e pedir que perguntassem
-- coisas. Amigo pergunta o que IMAGINA que um lead pergunta; lead escreve
-- "qnt custa?" às 23h. Pior: **amigo não detecta o erro caro**, que não é a
-- resposta esquisita e sim a plausível e errada — o *"segunda à tarde não temos
-- horário livre"* de 20/ago passaria por ótimo. Teste com entrada inventada
-- mede fluência, que já sabemos que existe.
--
-- ⚠ E O VEREDITO É FECHADO, de três valores. Nota livre existe, mas ao lado:
-- caixa de texto como resposta principal vira acervo que ninguém soma, e o que
-- falta aqui é justamente poder SOMAR — "em 30 mensagens reais, 24 eu enviaria
-- sem tocar, 5 ajustaria, 1 estava errada".

create table if not exists public.provas (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  contact_id     uuid references public.contacts(id) on delete set null,
  -- ⚠ De onde veio a mensagem julgada. É o que impede julgar duas vezes a
  -- mesma entrada e é o que permite voltar ao caso concreto depois.
  interaction_id uuid references public.interactions(id) on delete set null,

  mensagem       text not null,
  sugestao       text not null,
  -- O motor RECUSOU escrever (trava anti-invenção). Recusa não é erro: é o
  -- produto funcionando. Contá-la como "erro grave" apagaria a diferença entre
  -- "inventou" e "teve o bom senso de não inventar".
  escalou        boolean not null default false,
  faltam_fatos   text[],

  veredito       text not null check (veredito in ('enviaria','ajustaria','erro_grave')),
  nota           text,

  julgado_por    uuid references public.memberships(id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table public.provas is
  'Julgamento humano de sugestoes da IA sobre mensagens REAIS ja recebidas. E a medicao que autoriza ou proibe a resposta automatica — sem ela a decisao e intuicao.';
comment on column public.provas.escalou is
  'O motor recusou escrever por falta de fato. Recusa e o produto funcionando, nao defeito: nao pode ser somada como erro.';

-- Uma entrada é julgada uma vez. Sem isto a mesma mensagem voltaria na próxima
-- rodada e o placar contaria a mesma opinião duas vezes.
create unique index if not exists ux_provas_interacao
  on public.provas(tenant_id, interaction_id)
  where interaction_id is not null;

create index if not exists ix_provas_tenant on public.provas(tenant_id, created_at desc);

alter table public.provas enable row level security;

-- Mesma regra do resto: dado comercial da empresa, isolado por tenant (Lei 3).
create policy provas_isolation on public.provas
  for all using (public.is_member_of(tenant_id))
  with check (public.is_member_of(tenant_id));
