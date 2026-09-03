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

## ❌ O QUE FALTA — dele (só duas, e nenhuma é técnica)

| # | O quê | Onde |
|---|---|---|
| 1 | **Exportação de títulos em aberto** (`Codigo`, valor, vencimento) | Sem ela não dá para dimensionar quem abandonou devendo |

✅ ~~**Nome de exibição rejeitado**~~ — **fechado por decisão em 31/ago.** Na
tela de quem recebe aparece "Be FITNESS 💪02" com a logo, e o fundador decidiu
não trocar. Era a pendência mais antiga do projeto.

⚠ **Tudo o mais que dependia dele foi feito em 30/ago:** as três migrations
aplicadas, o agendador reserva instalado, o segredo rotacionado e sincronizado,
e o acesso administrativo ao Supabase e à Vercel liberado.

## ✅ O QUE MUDOU EM 2 E 3 DE SETEMBRO

- **`origem_ia` chegou a 69 casos, 82,6%** — o limiar de ~50 foi ultrapassado.
  A fase 2 está autorizada pelo número; falta a decisão dele.
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
| **Fase 2: a IA responde e agenda sozinha** | Amostra de `origem_ia`. Hoje **75% em 16 casos** — pouco. Esperar ~50 |
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
