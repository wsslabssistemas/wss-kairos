-- O ARQUIVO QUE O CLIENTE MANDA — guardar a chave antes que ela expire.
--
-- ⚠ O CASO, em 02/set/2026. A aluna Ana Clara escreveu dizendo que cancelou e
-- continua sendo cobrada no cartao, e mandou um COMPROVANTE junto. No sistema
-- ficou registrado apenas:
--
--     (documento recebido — abra no WhatsApp)
--
-- So que nao existe "abra no WhatsApp": o numero e da Cloud API e nao aparece
-- em aplicativo nenhum. O arquivo estava atras da API da Meta, e a unica chave
-- para busca-lo — o `media_id` — era lida pelo webhook e JOGADA FORA.
--
-- ⚠ E A META APAGA A MIDIA EM POUCOS DIAS. Nao e um dado que da para recuperar
-- depois: ou se guarda a chave na hora, ou o comprovante do cliente sai do
-- alcance para sempre. Numa conversa sobre cobranca indevida, esse arquivo e a
-- prova — e quem fica sem ela e a empresa, na frente da cliente.
--
-- ⚠ POR QUE A CHAVE E NAO O ARQUIVO. Guardar o binario exige bucket, politica
-- de retencao e uma decisao sobre dado pessoal que ninguem tomou ainda. A
-- chave cabe numa coluna, custa nada, e transforma "perdido" em "a um clique"
-- durante a janela da Meta. O arquivo em si e o passo seguinte, e agora ele
-- fica POSSIVEL — hoje nem isso era.

alter table interactions
  add column if not exists media_id   text,
  add column if not exists media_tipo text;

comment on column interactions.media_id is
  'ID da midia na Meta, quando a mensagem trouxe arquivo. A URL de download e temporaria e o arquivo expira em poucos dias — sem esta chave, nao ha como buscar.';
comment on column interactions.media_tipo is
  'Tipo declarado pela Meta (document, image, audio, video, sticker). Decide o icone na tela e a extensao no download.';
