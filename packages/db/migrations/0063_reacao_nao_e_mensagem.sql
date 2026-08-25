-- 0063 — REAGIR COM EMOJI NÃO É ESCREVER
--
-- POR QUE
-- A Taiane respondeu a campanha dizendo que por enquanto não voltaria, foi
-- agradecida, e duas horas depois **reagiu com um emoji** à mensagem de
-- despedida. O webhook registrou a reação como mensagem de entrada — e a
-- conversa, que estava resolvida, voltou para a lista como *"aguardando
-- resposta"*.
--
-- ⚠ REAGIR É O EQUIVALENTE A ACENAR COM A CABEÇA. Cobrar resposta de um aceno
-- cria pendência fantasma, e pendência fantasma é pior que lista errada: ela
-- ensina a pessoa a ignorar o contador de "aguardando", que é justamente o
-- número que existe para ninguém ficar sem resposta.
--
-- ⚠ E O PIOR SERIA RESPONDER. Com o botão de gerar ao lado, alguém geraria uma
-- resposta comercial para um 👍 — mensagem paga, no nome da empresa, para quem
-- acabou de dizer que não quer voltar agora. Insistir depois do não é
-- exatamente o que faz a pessoa bloquear o número.
--
-- ⚠ MAS A REAÇÃO NÃO PODE SUMIR. Ela É sinal: a Taiane reagiu bem a uma
-- despedida, o que é diferente de silêncio. Apagar seria o defeito oposto —
-- e este projeto já pagou caro por descartar o que a Meta manda (o array de
-- status inteiro, ignorado até 17/ago).
--
-- A saída é o mesmo princípio do `input_kind` desde o começo: **papel, não
-- meio.** A reação entra como `customer_reaction` — fica no histórico, aparece
-- na conversa, e não conta como mensagem esperando resposta nem entra no
-- tempo de resposta da Gestão.

alter table public.interactions drop constraint if exists interactions_input_kind_check;

alter table public.interactions add constraint interactions_input_kind_check
  check (input_kind in ('customer_message','agent_briefing','system_initiated','customer_reaction'));

comment on constraint interactions_input_kind_check on public.interactions is
  'customer_reaction = a pessoa reagiu com emoji. Fica registrado porque E sinal, mas NAO conta como mensagem esperando resposta nem entra no tempo de resposta.';

-- As reações já gravadas como mensagem, antes desta migration.
update public.interactions
   set input_kind = 'customer_reaction'
 where direction = 'inbound'
   and input_kind = 'customer_message'
   and content like '%"reaction"%';
