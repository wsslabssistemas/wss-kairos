# Be Fitness — o checklist único

> **Este é o arquivo para olhar agora.** Escopo: **a Be Fitness operando o
> canal oficial.** Atualizado: **3 de setembro de 2026.**
>
> A campanha saiu do papel nesta semana. O que segue é o estado real, e o
> `ESTADO_DO_PROJETO.md` §0 tem o detalhe de cada peça construída.

---

## 🟢 ONDE ESTAMOS

| | |
|---|---|
| Mensagens enviadas pela Meta | **61** · 7 falhas · **13 pessoas responderam** |
| Qualidade do número | **Alta**, degrau 250/dia |
| Modo | `auto` · 30/dia · 15 por rodada · recorte **365 dias** |
| Alunos vigentes | **300** (meta: 400) |
| Ex-alunos ainda não contatados | **920** |
| Destes, elegíveis no recorte de 365 (conferido em 30/ago) | **156** |
| Os mesmos, no recorte de 180 | **0** — a faixa já foi toda falada |
| Banco de provas | 39 julgadas · **0 erro grave** |
| Gasto de IA no mês | R$ 80,55 |

**A taxa do primeiro lote foi 31%** no grupo mais recente. O ciclo fechou de
ponta a ponta: modelo entregue e lido → pessoa responde → IA gera → ele edita →
envia → ela responde de novo.

---

## ❌ O QUE FALTA — dele

| # | O quê | Por que trava |
|---|---|---|
| 1 | **Submeter os 2 modelos do convênio na Meta** (`convenio_reconhecimento`, `convenio_retomada`) | Sem eles as 1.090 pessoas de convênio não recebem nada: fora da janela de 24h não existe texto livre |
| 2 | **Marcar `messages` no webhook da página do Facebook** | A página está configurada e **zero mensagens chegaram**. É um clique, e NÃO depende da análise: `pages_messaging` já está concedida |
| 3 | **Exportação de títulos em aberto** (`Codigo`, valor, vencimento) | Sem ela não dá para dimensionar quem abandonou devendo — é o "terceiro estado" |
| 4 | **Perguntar à SCA se existe API/exportação de check-in** | Resolveria convênio E plano direto de uma vez, sem planilha |
| 5 | **Ligar recarga automática de crédito da IA** | Em 4/set o saldo acabou às 17h35 e uma conversa ficou 3h esperando |

✅ ~~**Nome de exibição rejeitado**~~ — **fechado por decisão em 31/ago.** Na
tela de quem recebe aparece "Be FITNESS 💪02" com a logo, e o fundador decidiu
não trocar. Era a pendência mais antiga do projeto.

⚠ **Tudo o mais que dependia dele foi feito em 30/ago:** as três migrations
aplicadas, o agendador reserva instalado, o segredo rotacionado e sincronizado,
e o acesso administrativo ao Supabase e à Vercel liberado.

## ✅ O QUE MUDOU EM 2 E 3 DE SETEMBRO

- **`origem_ia` chegou a 69 casos, 82,6%** — o limiar de ~50 foi ultrapassado.
  ✅ **Decidido em 4/set: a fase 2 foi construída.** Nasce desligada; o
  interruptor é próprio (`resposta_automatica`), separado do modo do motor.
- ⚠ **A campanha repetia a mesma abertura**: 56 pessoas receberam o texto do 1º
  toque duas vezes, 7 dias depois. Corrigido — o modelo agora é escolhido pelo
  TOQUE, e toque sem texto próprio não sai. O 2º toque foi ligado
  (`followup_retomada`) com o ok dele.
- ⚠ **O teto de 30/dia estava sendo gasto por quem RESPONDIA cliente.**
  Corrigido: conta só conversa proativa (`system_initiated`).
- **Instagram e Facebook recebendo.** Só respondem por enquanto pelo
  aplicativo — o envio por esses canais ainda não existe, e campanha por
  eles a plataforma não permite.
- **Arquivo que o cliente manda abre no painel** (foto, PDF, áudio, vídeo).
  Áudio ainda vira texto. ⚠ A Mêta apaga a mídia em poucos dias.
- **E-mail do sistema funcionando** (Resend), em português, e o convite pode
  ir por e-mail ou por link.
- **Validade dos tokens vigiada** — o sistema pergunta à Meta e avisa na tela.

## ❌ O QUE FALTA — minhas, e o que cada uma espera

| O quê | Espera |
|---|---|
| ~~**Fase 2: a IA responde sozinha**~~ | **LIGADA em 4/set**, nos três canais. Primeira noite: 6 respondeu, 5 recusou, 2 desistiu, 1 escalou |
| ~~Pausa de 20–40s / aviso de decisão pendente~~ | **Feitas.** O aviso aparece em TODA tela, não só em Automação |
| ~~Alerta ativo (e-mail)~~ | **Feito, e a chave já está na Vercel** |
| ~~Responder por Instagram e Facebook~~ | **Feito em 4/set** — e provado: a resposta ao Thyago saiu pelo Instagram às 21h16 |
| ~~Marcar na agenda / registrar combinado / encerrar / motivo de saída~~ | **Feitos em 4/set** — o sistema faz sozinho |
| ~~Planilha por link do Google Sheets~~ | **Feito em 4/set** — lê todas as abas, identifica e a pessoa confirma |
| ~~A técnica curada não chegava em quem redige~~ | **Feito em 31/ago** — os quatro pontos. Ver `ESTADO_DO_PROJETO.md` §0.000 |
| ~~Corpo do modelo vem do repositório~~ | **Feito em 01/set** — o WABA id chegou sozinho pelo webhook, os 5 modelos vêm da Meta e o vigia reconfere 1×/dia |
| ~~Importação exigia saber o tipo do arquivo~~ | **Feito em 01/set** — o sistema identifica e a pessoa corrige |
| ~~Ficha dobrada invisível~~ | **Feito em 01/set** — virou contradição, com o nome da outra ficha |
| ~~Relógio do espaçamento medindo batida~~ | **Feito em 30/ago**, na véspera da primeira rodada autônoma |
| Pausa de 20–40s antes da resposta automática | Vem junto da fase 2 |
| Aviso de "decisão esperando humano" | Vem junto da fase 2 |
| **Terceiro estado** (abandonou com contrato aberto) | A exportação de títulos em aberto |
| Fonte de captação por webhook | Nada — dá para fazer, e conecta com o site novo |
| Clima no envio | **Parado de propósito**: com 30 mensagens/dia não há como medir |

## ❌ O QUE FALTA — minhas

| O quê | Espera |
|---|---|
| **Ligar a régua do convênio** | Os 2 modelos aprovados. A biblioteca curada e os check-ins já estão no lugar |
| **Importar as abas de check-in pela tela** | Hoje o cruzamento foi feito por script; a leitura por link já existe, falta identificar essas duas abas |
| **Desempenho das telas** | Gestão faz 5 leituras da tabela inteira; medido em 3/set, ainda não corrigido |
| **A régua do "chega" para as réguas novas** | O princípio está no código (despedida, pausa com prazo, encerramento respeitado pela fila). Falta valer para toda régua nova por construção |

## ⚠ AS ARMADILHAS DESTA SEMANA — leia antes de mexer no canal

- **O agendador do GitHub PULA execução, e não avisa.** Quando ele disser que
  não saiu, olhe **Automação → Últimas rodadas do motor** ANTES de procurar
  defeito. O botão *Enviar agora* resolve na hora.
  ⚠ **Corrigido em 27/ago:** ele passou a bater de 15 em 15 minutos (nunca no
  minuto `:00`, que é o pior), a cadência virou ajuste do motor, e a tela agora
  mostra *"agendador vivo — última batida há N min"* mesmo quando está tudo
  certo. O alarme toca em **1 hora**, não em 26.
  ⚠ **E em 30/ago o reserva entrou no ar** (`scripts/agendador-reserva.sql`):
  `pg_cron` no Supabase, batendo em 0/15/30/45, deslocado do GitHub. O GitHub
  deixou de ser provedor único — para a campanha parar, os dois precisam falhar
  no mesmo dia.
- **⚠ O AGENDADOR NUNCA TINHA ENTREGADO NADA — corrigido em 30/ago à noite.**
  As 61 mensagens saíram todas do botão *Enviar agora*. O motor agendado não
  conseguia LER o manifesto (a policy exige sessão, e no cron não há), então a
  fila saía vazia e ele registrava *"Nenhum candidato passou nas regras agora"*.
  Conferido depois do conserto, pela simulação: **895 avaliados, 15 escolhidos.**
- **A LINHA EM `motor_execucoes` PROVA O RELÓGIO, NÃO A CAMPANHA.** Linha com
  `enviadas = 0` e *"Nenhum candidato passou nas regras agora"* é agendador vivo
  com campanha parada. Olhe **`enviadas`**, nunca a existência da linha.
  ⚠ E **`avaliados = 0` é pior ainda**: não é "ninguém passou", é "ninguém foi
  olhado" — ou seja, a fila nem foi montada.
  ⚠ **E o relógio do espaçamento foi corrigido em 30/ago**: ele media BATIDA e
  passou a medir **ENVIO** (`enviadas > 0`). Antes disso, uma batida que rodava
  e mandava zero — inclusive uma que estourava com exceção — comprava 240
  minutos de silêncio, com a tela dizendo "agendador vivo". Guardado por
  `espacamento_test.mjs`, que lê o código do chamador.
- **A Meta conta BYTES, não letras** — cada acento vale 2. "492/512" recusa.
- **A Meta devolve o remetente sem o nono dígito.** `variantesArmazenadas`
  cobre os dois sentidos; não mexer sem rodar `telefone_test`.
- **`maxDuration` mora na PÁGINA**, não no arquivo de ações.
- **O preço do Sonnet 5 vira em 31/08/2026** (promoção US$ 2/10 → US$ 3/15).
  `preco_ia_test` guarda os dois lados.
- **Editou manifesto? Rode `node scripts/seed-skills.mjs <segmento>`.** O banco
  não sabe do repositório. `manifesto_no_banco_check.mjs` confere.

---

## O que NÃO entra agora (e por quê)

- **Os 9.158 cadastros.** ⚠ E quando entrar, o primeiro corte NÃO é por data:
  é **separar quem já pagou de quem nunca pagou**. Os 1.088 ex-alunos vieram do
  arquivo de RECEBIMENTOS — existe relação comercial. Boa parte dos 9 mil nunca
  comprou nada, e mandar mensagem para eles é prospecção fria, com outro risco
  de bloqueio e outro peso de LGPD.
- **Marcar os outros motivos no roteamento** (renovação, follow-up, recompra,
  combinado). Essas pessoas já conversam com alguém pelo número de sempre;
  trocar o número no meio da relação é o defeito que o fundador nomeou. E o
  `wa.me` é de graça.
- **Segmento novo.** A fila de 15 está escrita; falta validação externa.

---

## As três empresas reais

| Empresa | Ramo | Estado |
|---|---|---|
| **Be Fitness** | academia | Canal no ar, campanha rodando, DNA completo, equipe com acesso |
| **Darvil Engenharia** | energia solar | Entrou. **DNA vazio.** |
| **Feltros Bandeira** | indústria | Empresa criada. **DNA vazio.** |
| **WSS Kairós** | software_b2b | A do fabricante |

⚠ **A validação ainda é N=1.** A tese da Skill só está provada quando uma
segunda empresa, de outro segmento, rodar no mesmo núcleo sem ninguém escrever
código. A Be Fitness é do próprio fundador.
