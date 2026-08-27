# Be Fitness — o checklist único

> **Este é o arquivo para olhar agora.** Escopo: **a Be Fitness operando o
> canal oficial.** Atualizado: **27 de agosto de 2026.**
>
> A campanha saiu do papel nesta semana. O que segue é o estado real, e o
> `ESTADO_DO_PROJETO.md` §0 tem o detalhe de cada peça construída.

---

## 🟢 ONDE ESTAMOS

| | |
|---|---|
| Mensagens enviadas pela Meta | **61** · 7 falhas · **13 pessoas responderam** |
| Qualidade do número | **Alta**, degrau 250/dia |
| Modo | `auto` · 30/dia · 15 por rodada · recorte 180 dias |
| Alunos vigentes | **300** (meta: 400) |
| Ex-alunos ainda não contatados | **920** |
| Banco de provas | 39 julgadas · **0 erro grave** |
| Gasto de IA no mês | R$ 80,55 |

**A taxa do primeiro lote foi 31%** no grupo mais recente. O ciclo fechou de
ponta a ponta: modelo entregue e lido → pessoa responde → IA gera → ele edita →
envia → ela responde de novo.

---

## ❌ O QUE FALTA — dele

| # | O quê | Onde |
|---|---|---|
| 1 | **Nome de exibição rejeitado** — sai "Seja Fitness2" | Caso no suporte da Meta, com o erro 1675034 e o identificador |
| 2 | **Campanha nova no Meta** apontando para o número novo | Não dá para trocar telefone de campanha rodando |
| 3 | **Segundo modelo aprovado**, para quem saiu há mais de um ano | Aprovação leva dias — pedir cedo |
| 4 | **SMTP próprio no Supabase** | Resend ou Brevo, ~10 min. Destrava o alerta por e-mail |
| 5 | Subir o teto global de IA na aba Fabricante | Está R$ 130; a soma das 4 empresas é R$ 195 |
| 6 | Decidir sobre `teste-a@exemplo.com` (owner com acesso real) | Tela de Equipe |
| 7 | **Aplicar a migration `0067`** (antes do deploy — ver abaixo) | SQL Editor do Supabase |
| 8 | **Agendador reserva**: ligar `pg_cron` e `pg_net` e rodar `scripts/agendador-reserva.sql` | É o que tira o GitHub de ponto único de falha |

## ❌ O QUE FALTA — minhas, e o que cada uma espera

| O quê | Espera |
|---|---|
| **Fase 2: a IA responde sozinha** | O número de `origem_ia` — quantas sugestões saem sem edição |
| Pausa de 20–40s antes da resposta automática | Nada, é pequeno |
| Aviso de "decisão esperando humano" | Vem junto da fase 2 |
| Lembrete de atualizar a base | Registrar a data da última sincronização |
| Clima no envio | **Parado de propósito**: com 30 mensagens/dia não há como medir |

---

## ⚠ AS ARMADILHAS DESTA SEMANA — leia antes de mexer no canal

- **O agendador do GitHub PULA execução, e não avisa.** Quando ele disser que
  não saiu, olhe **Automação → Últimas rodadas do motor** ANTES de procurar
  defeito. O botão *Enviar agora* resolve na hora.
  ⚠ **Corrigido em 27/ago:** ele passou a bater de 15 em 15 minutos (nunca no
  minuto `:00`, que é o pior), a cadência virou ajuste do motor, e a tela agora
  mostra *"agendador vivo — última batida há N min"* mesmo quando está tudo
  certo. O alarme toca em **1 hora**, não em 26. **Ainda falta o agendador
  reserva** (`scripts/agendador-reserva.sql`) — sem ele o GitHub continua
  provedor único.
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
