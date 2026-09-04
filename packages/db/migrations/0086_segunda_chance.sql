-- FALHA PASSAGEIRA MERECE SEGUNDA CHANCE — e ela nao tinha nenhuma.
--
-- ⚠ O CASO, 4/set as 17h35. O Thyago escreveu "Boa tarde" pelo Instagram. A
-- fase 2 esperou 24 segundos, tentou gerar a resposta e ouviu da API:
-- *"Your credit balance is too low"*. Ela fez o certo — **nao inventou, nao
-- mandou nada, e chamou uma pessoa**.
--
-- O fundador recarregou o credito as 20h50. E nada aconteceu.
--
-- ⚠ PORQUE A FASE 2 SO ACORDA QUANDO CHEGA MENSAGEM. A do Thyago ja tinha
-- chegado e ja tinha falhado; a condicao que causou a falha desapareceu, e nao
-- havia ninguem para perceber isso. **A mensagem dele ficaria esperando ate
-- alguem abrir a tela** — dentro de uma janela de 24h que fecha as 17h35 de
-- amanha.
--
-- ⚠ E AS DUAS FALHAS NAO SAO A MESMA COISA, e tratar como uma so erra dos dois
-- lados:
--
--   • **decisao** — a trava anti-invencao se recusou a escrever porque falta um
--     fato. Repetir isso mil vezes da o mesmo resultado, e o que resolve e uma
--     PESSOA. Retentar aqui seria queimar dinheiro de IA para chegar na mesma
--     recusa.
--   • **acidente** — acabou credito, a rede caiu, a Meta piscou. A condicao
--     passa sozinha, e nao tentar de novo transforma um tropeco de um minuto
--     numa conversa perdida.
--
-- Por isso a diferenca fica GRAVADA, e nao adivinhada por texto: `transitorio`.
-- Adivinhar pelo `porque` seria classificar prosa por palavra-chave, e no dia
-- em que a mensagem de erro mudasse o retry pararia em silencio.

alter table respostas_automaticas
  add column if not exists transitorio  boolean not null default false,
  add column if not exists retentado_em timestamptz;

comment on column respostas_automaticas.transitorio is
  'A falha foi de acidente (credito, rede, provedor), nao de decisao. So o acidente merece nova tentativa: repetir uma recusa da trava anti-invencao chega na mesma recusa.';
comment on column respostas_automaticas.retentado_em is
  'Quando a segunda chance foi dada. UMA por falha: retry sem teto vira laco infinito no dia em que a causa nao passar.';

-- A fila do retry: acidente, ninguem viu ainda, e ainda nao foi retentado.
create index if not exists respostas_automaticas_retry_idx
  on respostas_automaticas (tenant_id, occurred_at)
  where transitorio and retentado_em is null and visto_em is null;

-- ⚠ O TRIGGER APPEND-ONLY PRECISA DEIXAR `retentado_em` MUDAR. Sem isto, a
-- marca da segunda chance seria recusada pela propria trava que protege o
-- registro — e o retry rodaria para sempre no mesmo caso, sem conseguir anotar
-- que ja tinha rodado.
create or replace function respostas_automaticas_append_only()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id      is distinct from old.tenant_id
  or new.contact_id     is distinct from old.contact_id
  or new.occurred_at    is distinct from old.occurred_at
  or new.decisao        is distinct from old.decisao
  or new.porque         is distinct from old.porque
  or new.esperou_ms     is distinct from old.esperou_ms
  or new.interaction_id is distinct from old.interaction_id
  or new.transitorio    is distinct from old.transitorio then
    raise exception 'respostas_automaticas e registro de execucao: so visto_em, visto_por e retentado_em podem mudar';
  end if;
  return new;
end;
$$;
