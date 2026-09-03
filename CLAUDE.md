# COS — Commercial Operating System

Plataforma de inteligência comercial multi-tenant. **Fabricante:** WSS Labs.
Um núcleo único (CIE) + especializações por segmento (Skills declaradas em dados).

**Leia antes de propor qualquer coisa**, nesta ordem:
`docs/blueprint/ESTADO_DO_PROJETO.md` (o que existe e as armadilhas já pagas) →
`docs/blueprint/COS_Plano_de_Execucao.md` (a fila e **o que está congelado**) →
`docs/blueprint/COS_Escolas_de_Venda.md` (a técnica que o produto vende).
Fundação e histórico: `COS_GRD_Core.md`, `COS_Journal_Migracao.md`.

**Este arquivo guarda o que não muda** — as leis, a stack, as convenções e as
decisões fechadas. **O estado do projeto mora só no `ESTADO_DO_PROJETO.md`.**
Já foram duas fontes; a daqui apodreceu em silêncio e passou meses ensinando
"ainda não existe aplicação" para toda conversa nova. Estado volátil em dois
lugares não fica sincronizado — fica errado no lugar menos visitado.

---

## O que é o produto

O produto vendável é o **núcleo**. Academia foi a primeira Skill instalada; hoje
são nove (academia, barbearia, clínica, distribuidora, automação, escola
esportiva, indústria, sob medida, energia solar). Segmento é **arquivo de
configuração**, não sistema separado.

**O ativo não é o código.** É a biblioteca comercial curada. Código se copia em
duas semanas; a curadoria, não. Toda decisão de arquitetura deve proteger esse ativo.

---

## As três leis (inegociáveis)

1. **O núcleo nunca conhece segmento.** `packages/core/` não importa de
   `packages/skills/` e não contém vocabulário de mercado (aluno, matrícula,
   corte, consulta). Verificável por lint.
2. **Skill é dado, nunca código.** `packages/skills/` só aceita `.yaml`, `.json`,
   `.md`. Nenhum arquivo executável.
3. **Nenhum acesso a dados sem contexto de empresa.** Toda consulta exige
   `tenant_id`. RLS no Postgres é a defesa real, não a aplicação.

Violação das três deve **falhar o build**, não gerar comentário em revisão.

---

## Stack decidida (não reabrir sem motivo novo)

| Tema | Decisão |
|---|---|
| Framework | Next.js 15 + TypeScript |
| Banco | Supabase (Postgres) com RLS |
| Hospedagem | Vercel |
| API | Hono em rota catch-all `/api/[[...route]]` (limite de 12 funções na Vercel) |
| ORM | Drizzle, migrations versionadas em Git |
| Busca semântica | pgvector |
| Jobs de fundo | Inngest (motor proativo não roda em serverless) |
| IA | Vercel AI SDK |
| Cobrança | Por atendimentos/mês. **Nunca por tokens.** |

---

## Convenções do repositório

```
packages/db/migrations/   # schema e dados de produto. Numerados, imutáveis.
packages/db/seeds/        # seeds de demonstração. Local e staging. NUNCA produção.
packages/db/tests/        # verificações com valor esperado escrito no arquivo.
packages/skills/          # manifestos YAML por segmento. Dado puro.
docs/blueprint/           # fundação, Journal, GRD, estado do projeto.
```

São **três categorias**, não duas. Confundi-las é o que faz dado fictício
vazar para produção ou biblioteca faltar em ambiente novo:

| Categoria | Onde | Roda em produção? | O que é |
|---|---|---|---|
| **Migration de schema** | `migrations/` | Sim | DDL. Cria e altera estrutura. |
| **Product seed** | `migrations/` | **Sim** | Dado que *é* o produto: Skills e biblioteca curada. Sem ele o núcleo não funciona. |
| **Demo seed** | `seeds/` | **Nunca** | Tenants e contatos fictícios para desenvolver e demonstrar. |

- Product seed mora em `migrations/` de propósito: precisa rodar **uma vez, em
  todo ambiente**, na mesma sequência numerada do schema. É por isso que
  `0003_seed_skills.sql` e `0004_seed_knowledge_academia.sql` estão lá — o
  prefixo `seed` no nome descreve o conteúdo, não a categoria.
- Demo seed nunca entra na sequência numerada. Se um dia rodar em produção,
  foi erro humano — e por isso existe a regra do prefixo abaixo.
- Todo seed de demonstração usa slug com prefixo `demo-`, para que um `delete`
  jamais alcance um tenant real.
- Todo teste declara o valor esperado em comentário. "Parece certo" não é critério.
- **Verificação que lê arquivo normaliza `\r\n` antes de casar padrão.** Os
  arquivos aqui estão em CRLF e o CI roda em LF: duas travas já mediram coisa
  diferente na máquina do fundador e no CI — uma falhando à toa, a outra
  medindo errado em silêncio. Trava que discorda do CI é trava que se desliga.
- O nome da query salva no Supabase é igual ao nome do arquivo, sem extensão.

---

## Decisões já fechadas (não sugerir o contrário)

- **WhatsApp só por API oficial da Meta.** Provedor não-oficial arrisca banir o
  número do cliente pagante.
- **Prospecção fria B2C não será construída.** LGPD e risco de banimento.
  B2B frio com dados públicos é permitido.
- **Vendedor não é tabela.** É um `membership` com papel `agent`.
- **Etapa da jornada é texto validado por manifesto**, não enum no banco — enum
  exigiria migration a cada segmento novo e quebraria a Lei 2.
- **Jornada é grafo**, não linha: avança, pula e retrocede. Por isso existe
  `contact_stage_history` append-only.
- **Separação estratégia/fato.** A biblioteca guarda estratégia com
  `required_facts`; os números vêm de `commercial_dna`.
- **Trava anti-invenção.** Falta fato exigido, o motor devolve `escalate` e
  **não redige**. Prompt não resolve essa classe de erro; verificação estrutural resolve.
- **⚠ ESCRITA SEM ERRO CONFERIDO É ESCRITA QUE VOCÊ ACHA QUE FEZ.** A classe
  que mais custou em ago/2026, três vezes na mesma semana. O caso pior:
  `upsert` com `onConflict` sobre índice **parcial** — o Postgres não infere
  índice parcial sem repetir o predicado, o PostgREST não sabe expressar isso,
  e **toda gravação falhava em silêncio**. O contato do cliente era criado e a
  frase dele sumia, com 200 devolvido à Meta e tudo verde por fora.
- **⚠ AGENDADOR NÃO É GARANTIA — E ELE PULA EM SILÊNCIO.** O cron do GitHub
  atrasa e às vezes **não executa**, sem avisar ninguém. Em 27/ago as 15
  mensagens das 9h não saíram: produto no ar, modo em `auto`, 39 candidatos
  esperando, nenhum erro em lugar nenhum. **"Não rodou" era indistinguível de
  "não havia ninguém para falar"** — a assinatura desta casa, agora na peça que
  gasta dinheiro sozinha. Toda rodada fica em `motor_execucoes`, com a ORIGEM
  separada (agendador × botão), e a tela tem alarme de silêncio. **Toda peça
  agendada precisa de registro da execução, não só do resultado.**
- **⚠ EXISTE ACESSO ADMINISTRATIVO — e ele tem duas armadilhas medidas.**
  `SUPABASE_ACCESS_TOKEN` mora em `apps/web/.env.local`: dá para aplicar
  migration sozinho por `POST /v1/projects/<ref>/database/query`. E o CLI da
  Vercel está autenticado, com o projeto vinculado.
  ⚠ **A API da Supabase recusa o User-Agent do Python** — `urllib` devolve 403
  e a MESMA consulta por `curl` devolve 201. Meia hora foi gasta em 30/ago
  procurando defeito no conteúdo quando o problema era o cabeçalho.
  ⚠ **A Vercel não devolve segredo nem pelo CLI**: variável marcada como
  *Sensitive* volta VAZIA em `vercel env pull`. Segredo que só existe lá é
  segredo perdido — o caminho é rotacionar, nunca "recuperar". E toda troca de
  variável exige **redeploy** para valer.
- **⚠ TIQUE AGENDADO É PROBABILIDADE, NÃO COMPROMISSO — E O MINUTO `:00` É O
  PIOR DE TODOS.** No mesmo 27/ago o GitHub perdeu as DUAS execuções do dia, e
  a investigação mostrou que nunca tinha sido pontual: em 8 execuções o tique
  atrasou 22, 25, 26, 49, 50, 52, 54 e 162 minutos, com `created_at` igual a
  `run_started_at` em todas — **não era fila nem falta de runner, era o
  agendador demorando para criar a execução.** A documentação do `schedule`
  avisa: sob carga *"some queued jobs may be dropped"*, e nomeia o começo de
  cada hora como o pior momento. Estávamos no minuto zero.
  **Mas a causa raiz era de projeto, não do GitHub:** 15 mensagens penduradas
  em UM tique, duas vezes ao dia. A regra que ficou:
  **trabalho agendado se pendura em MUITAS batidas pequenas, e quem decide a
  cadência é o produto, nunca o agendador** — bater de 15 em 15 minutos faz um
  tique perdido custar 15 minutos em vez de meio dia. Ver `lib/espacamento.ts`
  e o cabeçalho de `.github/workflows/motor.yml`.
  ⚠ E **a batida recusada precisa virar linha no banco** (`motor_execucoes.
  pulada`): sem ela, uma tabela com duas linhas por dia é idêntica à de um
  agendador morto, e o defeito que a `0066` fechou volta pela porta da própria
  correção.
  ⚠ E **agendador único continua sendo ponto único de falha.** As quatro
  camadas acima melhoram muito o GitHub; só um segundo relógio em outra
  infraestrutura tira ele do caminho crítico. Ver `scripts/agendador-reserva.sql`
  — **instalado e testado em 30/ago**, `pg_cron` no Supabase.
  ⚠ E **O RELÓGIO DO ESPAÇAMENTO MEDE ENVIO, NUNCA BATIDA.** A correção acima
  nasceu com o defeito dentro: ela media a última rodada "não simulada e não
  pulada", e rodada que ACONTECE e manda zero grava exatamente essa linha — a
  que estoura com exceção também, porque o `catch` registra com `pulada` no
  padrão `false`. **Uma batida vazia comprava 240 minutos de silêncio**, e as
  "16 chances" só valiam para o tique que o GitHub descarta. Hoje o filtro é
  `enviadas > 0` e o parâmetro se chama `ultimoEnvioISO`. A regra geral:
  **trava de cadência conta trabalho FEITO, nunca visita recebida** — a mesma
  família do "cadência conta toques dados, não datas vencidas".
  ⚠ E **função pura não enxerga `select` errado.** O defeito morava no filtro
  da consulta, fora da função — nenhum caso de borda o pegaria. A trava que
  fecha essa classe lê o **código do chamador** (`espacamento_test.mjs`), como
  `paginacao_check` e `tema_check` já fazem.
- **⚠ LEITOR QUE SERVE TELA E MÁQUINA RECEBE O CLIENTE — NUNCA CRIA O DELE.**
  Em 30/ago descobriu-se que **o motor agendado nunca montou fila**: as 61
  mensagens da campanha saíram todas do botão, e as 11 rodadas do agendador
  tinham `avaliados = 0`. `getSkillFormConfig` criava o próprio cliente de
  sessão; no cron não há sessão, a policy `skills_read_installed` negava, o
  `maybeSingle()` devolvia `null` **sem erro**, e a fila saía vazia. O motor
  registrava *"Nenhum candidato passou nas regras agora"* — indistinguível de um
  dia sem trabalho. Quarta ocorrência de **RLS que devolve vazio não é erro**, a
  primeira numa peça que roda sozinha. `skills_client_check.mjs` tem a categoria
  **`ambos`** para isso.
  ⚠ E **manifesto sem etapa ESTOURA**, não segue: zero etapas é leitura
  quebrada, nunca operação normal. Deixar seguir foi o que permitiu o defeito
  sobreviver dias parecendo saúde.
  ⚠ E **ZERO AVALIADOS NÃO É "NINGUÉM PASSOU", É "NINGUÉM FOI OLHADO".** Toda
  lista vazia precisa separar as duas — e a primeira explicação que dei para o
  silêncio (o recorte de 180 dias) era plausível, aritmeticamente correta e
  errada. **Explicação plausível para um silêncio é o jeito mais rápido de
  arquivar um defeito.** Só o contador de avaliados desempatou.
- **⚠ TRANSIÇÃO DE ETAPA TEM QUE TER VOLTA.** Em 28/ago saiu *"você treinou com
  a gente e acabou parando"* para uma aluna com **contrato até 2027**. A causa:
  a sincronização sabia **tirar** da etapa ativa quem sumia da planilha e nunca
  aprendeu a **trazer de volta** quem rematriculou — atualizava a vigência a
  cada importação e deixava o rótulo velho. E a frase que explica já estava
  escrita no mesmo arquivo, sobre o defeito espelhado: *"etapa que só avança
  mente com o tempo"*. **Defeito simétrico, meia correção.** Ao escrever uma
  transição, escreva a inversa ou anote por que ela não existe.
- **⚠ FATO DO MUNDO VENCE RÓTULO DO SISTEMA — e o veto mora no fato.** Etapa é
  interpretação nossa; contrato correndo é fato do cliente. Por isso a recusa de
  mandar reativação para quem tem vigência futura ficou **no motor**, não só na
  sincronização: consertar a origem do dado é necessário e nunca é suficiente,
  porque dado errado chega por caminhos que ninguém previu. A regra geral:
  quando existir um fato verificável que contradiz o rótulo, **verifique o fato
  no momento de agir**, não só na hora de gravar.
- **⚠ CONTAR NÃO SUBSTITUI CONFERIR.** A trava da sincronização mede QUANTOS
  somem da planilha e passou tranquila em 8,8% — abaixo do limite de 15% —
  enquanto **20 daqueles sumidos eram alunos em dia**, um deles com o ano pago à
  vista. Trava de proporção pega planilha truncada; não pega erro de identidade.
  Toda trava estatística precisa de uma companheira que olhe **quem**, e a
  contradição entre duas fontes (sumiu da lista × contrato até 2027) tem que
  aparecer na tela **antes** de gravar.
- **⚠ A EXPORTAÇÃO DO CLIENTE NÃO É A REALIDADE — ela tem um filtro que ninguém
  declarou.** "Relação de plano ativo" na Be Fitness era, na prática, uma lista
  de **cobrança em aberto**: quem pagou o ano à vista sumia dela. Duas
  exportações do "mesmo" relatório deram 304 e 362 pessoas. Antes de tratar um
  arquivo como verdade, **confira três nomes na origem** — foi o que separou
  "vinte cancelamentos" de "dois alunos em dia".
- **⚠ O MESMO SINTOMA PODE TER CAUSAS OPOSTAS, e o aviso não pode chutar qual.**
  Os dois barrados de 28/ago tinham contrato até 2027: uma havia rematriculado
  (etapa errada), o outro abandonou sem cancelar (etapa certa). O texto dizia
  *"corrija o cadastro"* — ação certa para ela, pedido absurdo para ele.
  **Aviso que erra o diagnóstico é aviso que ninguém lê na próxima vez.**
  Descreva o fato observado e nomeie as causas possíveis; não escolha uma.
- **⚠ A META CONTA BYTES, NÃO LETRAS.** O contador dela mostrou "492/512" e a
  gravação falhou: em UTF-8 cada acento ocupa 2 bytes, e em português quase toda
  frase tem acento. O erro dela diz "characters" e mede byte. **Funciona em
  inglês e mente aqui** — produto brasileiro que copia limite de documentação
  gringa herda o defeito. Ver `lib/perfil-canal.ts`.
- **⚠ A META DEVOLVE O REMETENTE BRASILEIRO SEM O NONO DÍGITO.** Saiu para
  `5551993742002` e voltou `555193742002`: a busca não achou o cadastro e o
  webhook criou um contato DUPLICADO. É a Lilian com a direção invertida —
  consertar um lado e não o outro faz o defeito voltar com outra cara.
  `variantesArmazenadas` cobre os dois sentidos, e **fixo (8 dígitos começando
  em 2-5) NÃO ganha o nono**.
- **⚠ PREÇO DE API TEM DATA DE VALIDADE.** O custo da IA foi cobrado 1,5× a
  mais por meses: o Sonnet 5 está em promoção de lançamento (US$ 2/10) e o
  código usava a tabela cheia (US$ 3/15). ⚠ E **a promoção acaba em
  31/08/2026** — fixar o preço novo faria mentir de novo, cobrando de MENOS,
  que é pior: teto que não morde não protege ninguém. A virada é por data, em
  `lib/preco-ia.ts`, testada dos dois lados.
- **⚠ HORÁRIO GOVERNA QUEM INICIA CONVERSA, NUNCA QUEM RESPONDE.** A janela
  (9h–19h) existe em UM lugar só: `lib/motor.ts`, o motor proativo. Responder a
  quem perguntou não tem hora — lead que escreve às 2h de domingo está no
  momento de intenção, e restringir a resposta ao horário comercial remove
  exatamente as horas em que a automação ganha. Foi decisão do fundador, e o
  código já era assim.
- **⚠ A SIMULAÇÃO IGNORA A JANELA; O ENVIO NUNCA.** Quem confere a lista nome
  por nome precisa poder fazer isso às 8h — com a janela valendo na simulação,
  a conferência só começava quando a campanha já podia sair, o pior momento.
  Simular não manda mensagem nenhuma.
- **⚠ FECHAR CONVERSA POR ENGANO É O ERRO CARO.** Quem some da lista de
  "aguardando" espera para sempre, e ninguém descobre. Por isso só fecha
  sozinho o que NÃO PODE conter pergunta — texto **sem uma única letra** (emoji,
  pontuação). "ok", "obrigada" e "combinado" são palavras: viram sugestão,
  nunca decisão. E a regra é a ausência de letra, **não uma lista de emojis** —
  lista de emoji nunca fica pronta.
- **⚠ REAGIR NÃO É ESCREVER.** Reação com emoji vira `customer_reaction`: fica
  no histórico porque é sinal, e não conta como mensagem esperando resposta. No
  automático, responder a um 👍 é mensagem paga respondendo a um aceno.
- **A PERGUNTA ERRADA COLETA MENTIRA.** "Por que você saiu?" soa como cobrança
  e a resposta vira "falta de tempo" — a saída socialmente segura, que quase
  nunca é verdade. O que muda a resposta é oferecer **alternativas concretas**:
  escolher entre três opções custa menos que confessar. E nunca com oferta na
  mesma mensagem, senão a pergunta vira isca.
- **DEPOIS DO SIM, PARE DE VENDER; DEPOIS DO NÃO, PERGUNTE O MOTIVO.** As duas
  regras dizem a mesma coisa: **a decisão é do cliente, não da agenda nem da
  oferta.** Insistir depois do sim reabre o que já estava fechado, e quem se
  sente empurrado não discute — some.
- **⚠ EDITOU MANIFESTO? O BANCO NÃO SABE.** O manifesto que o sistema LÊ mora
  na tabela `skills`; o YAML é a fonte, e quem leva um ao outro é
  `node scripts/seed-skills.mjs <segmento>`, **rodado à mão**. Em 20/ago a
  correção do "horário que não existe" foi escrita, commitada, o CI passou e a
  Vercel publicou — **e o erro aconteceu de novo em 21/ago, com outra lead**,
  porque o banco seguiu com a versão velha por quatro dias. "Está no
  repositório" não é "está valendo". Guardado por
  `manifesto_no_banco_check.mjs` (roda local, precisa de `.env.local`).
- **Mover a fonte de verdade é fácil; achar todos os LEITORES é o trabalho.**
  O `phone_number_id` foi para `tenant_secrets` e a busca do tenant no webhook
  continuou lendo `tenants.settings`: a mensagem chegava, a assinatura passava,
  e era descartada dois blocos adiante. Ao mudar onde um dado mora,
  `grep` pelo nome antigo antes de fechar.
- **Credencial de canal é POR EMPRESA e mora em `tenant_secrets`** (0056/0057),
  com RLS ligada e **nenhuma policy** — em Postgres isso nega a todos, e só o
  `service_role` alcança. Nunca em `tenants.settings`: a policy `tenants_select`
  libera a linha inteira para qualquer membro, e um token da Meta manda
  mensagem em nome da empresa.
- **Ter credencial não liga o canal.** Por onde SAI (link × número do sistema) e
  quem DISPARA (pessoa × motor) são decisões diferentes; tratar como uma faria
  salvar um token trocar o número de saída da empresa inteira, em silêncio.
- **Campo que a pessoa COPIA de outra tela usa o nome da outra tela.** Rótulo
  inventado vira problema de tradução no meio de uma tarefa difícil.
- **Formulário não reenvia o que já existe.** Campo preenchido com o valor salvo
  transforma aba antiga em máquina do tempo: ela regrava o valor velho por cima
  do novo ao salvar qualquer outro campo. Mostre como texto; o campo só troca.
- **Todo motivo da fila precisa de uma data a partir da qual uma conversa o
  CUMPRE.** Sem isso a pessoa fica na lista para sempre e a lista nunca
  encolhe — que não parece defeito, parece trabalho acumulado. Já aconteceu
  duas vezes: `combinado` (10/ago) e `renovacao` (15/ago), e na segunda o
  comentário do código afirmava que só o primeiro tinha o problema.
- **CAMPO CINZA COM O MOTIVO ESCRITO GANHA DE CAMPO QUE SOME.** A caixa de
  resposta do canal sumia quando a janela de 24h fechava, e o fundador leu isso
  como "a aba só serve para olhar, não dá para escrever". Campo AUSENTE é
  indistinguível de campo que NÃO FOI FEITO. Vale para lista vazia também: ela
  precisa dizer se é "ainda não aconteceu" ou "está quebrado".
- **A trava anti-invenção também vale para NEGAR.** Ela nasceu olhando o lado de
  afirmar demais (preço, condição, promoção) e deixou passar o oposto: o prompt
  mandava *"diga que aquele horário já está ocupado"* para qualquer horário fora
  da lista — numa academia, onde nada está disputado. **Negar o que existe é
  pior de detectar que afirmar o que não existe:** a lead desiste na hora, não
  reclama, e nada aparece em tela nenhuma.
- **⚠ A BIBLIOTECA CURADA FOI ESCRITA PARA CONVERSA QUE ENTRA; O MOTOR PRODUZ
  CONVERSA QUE SAI.** Todo gatilho era pergunta do cliente ("quanto custa",
  "o que você recomenda"). Em campanha proativa quem pergunta é o sistema e o
  cliente **responde** — e resposta de WhatsApp tem uma palavra. Em 31/ago
  `"Emagrecer"` casou com ZERO entradas, e quatro entradas da academia não
  tinham gatilho nenhum, **inclusive a que governa a reativação inteira**.
  Segmento novo precisa de gatilho dos DOIS lados.
- **⚠ TEXTO ESCOLHIDO PELO MOTIVO REPETE — O TOQUE É QUE TEM NÚMERO.** O canal
  pegava o modelo em `modelos[motivo]`, e o motivo de quem não respondeu
  continua o mesmo na semana seguinte: **56 pessoas receberam a mesma abertura
  duas vezes, 7 dias depois**, com o *"estou falando de um número novo"* dentro
  — verdade na primeira, mentira na segunda. Fora da janela de 24h a Meta só
  entrega modelo aprovado, então não existe "escrever diferente na hora": ou o
  toque tem o texto dele, ou **não sai**. Nunca cair para o anterior — cair
  para trás é o defeito. E a régua curada já dizia o que cada toque deve falar
  (dia 0 gancho, dia 7 o que mudou, dia 21 retorno sem risco, dia 45 encerrar):
  mais um caso de **ativo curado que não chegava em quem escreve**. Ver
  `modeloDoToque`.
- **⚠ A CONSULTA DA BIBLIOTECA É A SITUAÇÃO, NUNCA SÓ A ÚLTIMA MENSAGEM.**
  Mensagem + as falas dele na conversa + etapa e objetivo do manifesto. Com a
  palavra solta a busca não tem sinal; com a situação, a entrada certa vem em
  primeiro.
- **⚠ FALLBACK DE BUSCA NÃO PODE INVENTAR RELEVÂNCIA.** Sem casamento o código
  mandava `allEntries.slice(0, 6)` — as seis primeiras na ordem do banco — sob
  o rótulo de "entradas relevantes", e cinco eram de contorno de objeção numa
  conversa sem objeção. É a regra dos 1.000 outra vez (sem `ORDER BY`, o que
  volta é arbitrário), só que o arbitrário vira **técnica de venda aplicada a
  um cliente real**. **Técnica errada com confiança é pior que técnica
  nenhuma:** hoje o bloco fica vazio e o prompt DIZ que ficou.
- **⚠ MODELO APROVADO TEM QUE VIRAR FALA NO HISTÓRICO.** Gravar
  `(modelo "reativacao_ex_aluno")` faz a IA responder a um "Oi sim" sem saber
  qual era a pergunta — o fundador nomeou como *"resposta jogada ao ar"*. O que
  se grava é o **texto renderizado no momento do envio**, nunca uma referência
  ao corpo: histórico é registro do que aconteceu, e um texto reaprovado amanhã
  não pode mudar a conversa de ontem. Ver `modelos_canal` (`0070`).
- **⚠ ATIVO CURADO QUE NÃO CHEGA EM QUEM REDIGE NÃO EXISTE.** `churn_reasons`
  traz, por motivo de saída, o que fazer — *"foi tempo? fale de horário, não de
  preço"* — e era carregada só para preencher um `<select>` de encerramento.
  Numa conversa de reativação é o material mais valioso que temos. Ao curar
  qualquer coisa nova, pergunte **quem lê isso na hora de escrever**.
- **⚠ NÃO PERGUNTE A QUEM OPERA O QUE O CONTEÚDO RESPONDE.** A tela de
  importação pedia que a pessoa dissesse qual arquivo era qual antes de
  qualquer leitura — e quem sabe isso é o arquivo. Errar essa escolha não dá
  erro: dá comparação silenciosa entre coisas diferentes. Identificação
  automática **roda os leitores de verdade** (lista própria de cabeçalho é uma
  segunda versão da regra) e **propõe, nunca decide**: a correção fica sempre à
  mão. Ver `identificarPlanilha`.
- **⚠ ESCONDER NÃO É CONSERTAR.** `idsComGemeoAtivo` tirava da fila a ficha
  duplicada — decisão certa, para não falar com quem já é cliente — e com isso
  o cadastro dobrado ficou invisível por um mês. Toda vez que o sistema
  esconder algo para se proteger, **alguém precisa ver o que foi escondido**.
- **O sinal mais rápido de qualidade da IA é a CORREÇÃO DO VENDEDOR.** Quando
  alguém adapta a mensagem antes de enviar, é um vendedor experiente corrigindo
  o modelo no contexto exato, de graça. Isso era jogado fora. Hoje o par
  sugerido × enviado é guardado (`0060`) e os 6 mais recentes voltam para o
  prompt. Vale mais que o desfecho HOJE: são 14 fechamentos na base inteira e
  desfecho demora semanas — vinte mensagens adaptadas geram vinte lições numa
  tarde. **Prefira isto a reescrever prompt no escuro.**
- **QUANDO O MOTOR SE RECUSA, A RECUSA TEM QUE APARECER NA TELA.** Ja custou
  TRES relatos de "esta quebrado" para acertos do produto. O pior deles: a
  trava anti-invencao devolve a mensagem **vazia** junto com `escalar: true`, e
  a tela testava `{texto && ...}` — string vazia e falsa em JavaScript, entao
  nao renderizava nem a mensagem nem o aviso. A pessoa clicava, o botao girava,
  a tela ficava identica. **Trava silenciosa e indistinguivel de botao
  quebrado.** Teste `!== null`, nunca a verdade do valor.
- **Toda lista de trabalho precisa de TETO e de ESPACAMENTO.** O alarme de
  silencio da fila nao tinha nenhum dos dois quando a etapa nao declarava
  cadencia: a pessoa voltava a cada 5 dias, para sempre. `max_attempts` deixava
  de existir exatamente onde a regua ja tinha desistido de saber o que dizer.
  Intervalo fixo tambem e defeito — 5 dias serve para quem esfriou ontem, e e
  perseguicao para quem esta calado ha tres meses.
- **Toda chamada externa precisa de RELOGIO e de caminho de degradacao.** Em
  19/ago o `getUser()` do middleware rodava em toda requisicao sem limite de
  tempo: uma lentidao do Auth virou tela branca de 25s no produto inteiro,
  **inclusive na tela de entrar**. E o middleware cobria `/api/*`, entao Auth
  lento podia segurar o webhook da Meta ate ela DESATIVAR a assinatura. No
  estouro, degradar (deixar passar) e melhor que redirecionar: a defesa dos
  dados e a RLS, nao o middleware.
- **Rodar a SUÍTE DO CI, não um subconjunto dela.** Em 20/ago quatro commits
  seguidos foram para a `main` com o CI vermelho, porque eu rodava só os testes
  que julgava afetados. O que quebrou foi o `acentuacao_check` — prosa sem
  acento num manifesto, que é arquivo LIDO POR GENTE. "Rodei os testes
  relevantes" é o mesmo erro do typecheck: cobertura escolhida por quem
  escreveu o código. O comando tira a lista do próprio `ci.yml`:
  `grep -oP '(?<=run: )node packages/db/tests/\S+' .github/workflows/ci.yml`
- **`npx next build` ANTES do push, sempre que mexer em rota, página ou ação.**
  `tsc --noEmit` não vê as regras do Next: em 18/ago o typecheck passou limpo e
  a Vercel quebrou em 20 segundos com `exited with 1`, porque um arquivo
  `"use server"` exportava uma constante (`maxDuration`) — e arquivo de ação só
  pode exportar função assíncrona. O fundador recebeu o e-mail de falha e
  perguntou se precisava contratar plano por falta de memória. **Não era**:
  falha em 20 segundos é compilação; estouro de memória demora e falha
  diferente. **Typecheck verde não é build verde.**
- **`maxDuration` mora na PÁGINA, nunca no arquivo de ações.** É a página que
  governa a duração das ações invocadas a partir dela.
- **Tela que chama IA declara `maxDuration`.** O padrão da Vercel mata a
  função no meio da geração e não devolve nada: o botão gira para sempre, sem
  erro. Mesma classe do corpo de 4,2 MB da sincronização — limite de
  plataforma que se apresenta como silêncio.
- **A lista de trabalho tem ração diária** (`lib/racao.ts`). A tela de quem
  executa mostra o teto do dia e o progresso, **nunca o acervo inteiro** —
  dívida de três dígitos toda manhã é o que faz alguém parar de executar. O
  acervo é leitura de gestão. E a ração é pré-requisito da automação: motor
  proativo sem teto é uma máquina de queimar o número do cliente pagante.
- **Cadência conta TOQUES DADOS, não datas vencidas.** No acervo todos os
  passos já venceram; escolher o "último vencido" faz uma mensagem quitar a
  régua inteira e a pessoa nunca mais voltar. O vencimento do próximo passo é o
  mais tarde entre a data da régua e um intervalo desde a última conversa.
- **Passo cuja janela passou é PULADO, não atrasado.** Só contar toques manda
  o toque do dia 7 (*"como foi sua primeira semana?"*) para quem está na etapa
  há três anos — fluente e errado, que é o pior defeito de uma mensagem que sai
  no nome do cliente. Vencidas todas as janelas, vale o `goal` da etapa e o
  "ninguém fala com ele há N dias": genérico e honesto ganha de específico e
  falso. É a trava anti-invenção aplicada ao MOMENTO, como a do pretexto é
  aplicada ao ASSUNTO.
- **Três motores reais** (Context, Decision, Memory). Os outros sete "Engines"
  dos documentos fundadores são fronteiras conceituais — não criar pasta para
  honrar documento.

---

## ⚠ A regra dos 1.000 — leia antes de escrever qualquer `select`

**O PostgREST devolve no máximo 1.000 linhas e NÃO AVISA.** Não vem erro, não
vem flag: vem um número plausível e menor.

**`.limit(5000)` não protege.** O teto é do servidor; um `.limit()` maior só dá
a impressão de que alguém pensou no assunto. E **sem `ORDER BY` as 1.000 que
voltam são arbitrárias**, nem estáveis entre duas chamadas iguais.

**E o caso mais perigoso não tem `.limit()` nenhum** — consulta sem limite
parece inocente e é a mais exposta.

- Leitura de tabela que cresce (`interactions`, `contacts`,
  `contact_stage_history`, `services_rendered`, `usage_ledger`,
  `course_progress`) usa **`lerTudo`** de `lib/paginado.ts` — **com `ORDER BY`
  estável**, senão a própria paginação pula e repete linha entre as páginas.
- `.limit(n)` pequeno continua legítimo — é "os 6 da tela", decisão de produto.
- Se a tabela de fato não pode crescer, escreva **`// paginacao-ok: <motivo>`**.
- `paginacao_check.mjs` está no CI e a **linha de base é ZERO** (a varredura
  fechou em 14/ago/2026). Não existe dívida tolerada: consulta nova ou usa
  `lerTudo`, ou escreve o motivo.

**Escrever não é ler.** `insert`, `update` e `delete` sem `.select()` não
devolvem linha — não há o que cortar, e o UPDATE alcança tudo que o filtro
alcança. Mas `update().select()` DEVOLVE linhas: contar `data.length` para
dizer "N atualizados" reportaria 1.000 com 3.000 alterados.

Custou três vezes. A última foi em 14/ago/2026, ao vivo: o Analista de Gestão
afirmou ao fundador que fazia 20 dias que ninguém usava o sistema, quando havia
32 interações no dia anterior. Ele só pegou porque conhece a operação de cor —
**ninguém tem como desconfiar de um dado que não apareceu.**

**E consertar a ocorrência não fecha a classe:** naquele dia as `interactions`
de quatro telas foram paginadas e os `contacts` das mesmas quatro ficaram como
estavam — a metade que dá o DENOMINADOR de leads, carteira e conversão.
Denominador cortado faz a conversão **subir** sozinha. Ao paginar uma consulta,
**pagine as vizinhas da mesma tela ou explique por que não.**

---

## Métricas canônicas (implementar uma vez, consumir em todo lugar)

- Conversão = **convertidos distintos ÷ leads do período**. Nunca ÷ atendimentos.
- Resultado conta **pessoas distintas**, nunca eventos.
- Tempo de resposta em **mediana e p90**, nunca só média.
- Toda dimensão de análise é **enum**, nunca texto livre.

---

## Estado atual — em uma linha

**Não existe checklist aqui de propósito.** O estado vive em
`docs/blueprint/ESTADO_DO_PROJETO.md`, atualizado a cada entrega. Esta seção já
foi uma cópia dele e ficou meses desatualizada — dizendo "ainda não existe
aplicação" enquanto o produto estava no ar.

O mínimo para se situar (confira no `ESTADO_DO_PROJETO.md` antes de usar como
verdade): aplicação Next.js no ar em `kairos.wsslabs.com.br`, migrations
`0001`–`0066` aplicadas, **canal oficial da Meta operando com campanha real**, **15 segmentos com 285 entradas curadas**, motor com IA
e trava anti-invenção estrutural, e um módulo de curso com 45 lições.

## Invariantes de segurança conquistadas (não regredir)

Cada uma nasceu de um achado de auditoria e já está corrigida. O que importa
aqui não é o histórico — é **o motivo**, que continua valendo e que é fácil de
desfazer sem perceber.

- **A biblioteca curada não é legível por `authenticated`** (`0006`). O Supabase
  expõe `public` via PostgREST: com a policy antiga, qualquer teste grátis
  baixava a curadoria inteira de todos os segmentos com uma chamada. Hoje o
  `authenticated` lê só o conhecimento do próprio tenant; a biblioteca global é
  `service_role`, com retrieval server-side. **Estratégia nunca chega ao
  browser** — e tela nova que use a biblioteca com o client do usuário volta
  vazia, o que é o comportamento certo.
- **`decisions` é append-only por trigger, não por policy** (`0006`). RLS é
  row-level, não column-level: a policy de UPDATE deixava reescrever
  `context_snapshot`, `rationale` e `cost_cents`. O trigger
  `t_decisions_append_only` só aceita mudança em `outcome`, `outcome_at` e
  `executed_at`, **para todo papel, inclusive `service_role`**. DELETE fica
  livre, por causa da cascata da LGPD.
- **`required_facts` é validado, não confiado** (`required_facts_check.sql` +
  validador no CI). Um typo no caminho deixava a entrada em ESCALA para sempre
  — falha na direção que *parece* segura, e por isso ninguém procura.
- **Um único DNA corrente por tenant** (`0007`), garantido por índice único no
  banco. Teste `dna_single_current_test.sql`.
- **A trava de DNA verifica atualidade, não só presença** (`0029`). Dado de um
  ano atrás passava como PRONTO e era afirmado com a confiança do dado de
  ontem: mentir sem nunca ter inventado.
- **Diagnóstico olha todo mundo; o prefixo `demo-` protege escrita.** O
  `dna_coverage_check` filtrava por `demo-` e voltava vazio para as empresas
  reais — e zero linhas parece "nada errado".
- **`tenants.skill_key` × `tenant_skills` não é contradição**, é papel
  diferente: a junção é o que está instalado (fonte da RLS), a coluna é a ativa.
  A regra única virou teste: `tenant_skill_coherence.sql`.

---

## Auditoria — o que continua aberto

Três itens, todos com motivo registrado para **não** terem sido feitos ainda.
Adiar com motivo escrito é decisão; adiar sem, é esquecimento.

- ~~**P1 — Telefone não está em E.164.**~~ **Fechado em ago/2026**, junto com a
  camada de envio — que era exatamente o gatilho combinado. Destravou por
  **escopo**: um país só, com as regras da Anatel, que são fechadas, então o
  comprimento desambigua sem biblioteca de telefonia e sem chute. A regra que
  preservou a preocupação original: `paraE164BR` **deriva e nunca grava**, então
  derivação errada faz mensagem não sair em vez de destruir cadastro.
  Ver `ESTADO_DO_PROJETO.md` §3.6.
- **P2 — Dinheiro como string de exibição no DNA** (`"R$ 169,00"`), o que impede
  análise por faixa de preço. Correção: inteiro em centavos + moeda, como já faz
  `lib/money.ts`. Mexe no editor, nos seeds, no prompt e no dado já gravado das
  empresas reais, e o ganho é um relatório que ainda não existe. Fazer junto com
  o primeiro relatório que precise disso.
- **P2 — `embedding vector(1536)` sem índice.** E índice ANN interage mal com
  RLS: o índice devolve top-k e o RLS filtra depois, então o resultado pode vir
  curto sem erro nenhum. Reforça a decisão do retrieval server-side.

---

## Limites que precisam de honestidade

- **A validação é N=1.** Be Fitness é do próprio fundador. A tese da Skill só
  está provada quando uma segunda empresa, **de outro segmento**, rodar no mesmo
  núcleo sem ninguém escrever código.
- **Não existe "IA que aprende" ainda.** Com 11 matrículas/mês, uma empresa não
  produz aprendizado estatisticamente válido. Até haver agregação entre dezenas
  de empresas, a Commercial Memory é escrituração honesta. Não vender o contrário.
- **O gargalo do produto é o onboarding**, não o motor. O extrator de DNA por
  entrevista é tão crítico quanto o CIE e não está em nenhum documento fundador.
- **Zero desfecho registrado é o bloqueio que mais aparece.** Já travou o M2
  (qual escola converte) e o score de potencial do preço sugerido. Antes de
  desenhar qualquer coisa que dependa de "o que converteu", confira se existe
  desfecho no banco — e, se não existir, **entregue a versão medida e declare a
  recusa** em vez de estimar. Número inventado com aparência de número é pior
  que campo vazio: campo vazio ninguém usa para decidir.

---

## A classe de defeito que mais custou (ago/2026)

Seis defeitos seguidos na entrada do produto, e **nenhum apareceu como erro**.
Todos se apresentaram como sucesso, silêncio ou lista vazia — e por isso todos
foram descobertos por uma pessoa de fora tentando usar, nunca relendo código.

- **RLS que devolve vazio não é erro.** `skills_read_installed` só mostra a
  Skill instalada; com o cliente do usuário, perguntar sobre segmento não
  instalado volta zero linhas, sem aviso. Pegou **três vezes**, com sintoma
  diferente a cada uma. Guardado por `skills_client_check.mjs`.
- **Sucesso pode significar fracasso.** O Supabase responde "ok, sem sessão"
  quando o e-mail já tem conta — de propósito, para a tela não virar
  verificador de cadastro. Ler isso como "precisa confirmar" mandou uma
  vendedora esperar um e-mail que não existia.
- **Ordem de chamada é invariante escondida.** `memberships.user_id` referencia
  `profiles`, e criar conta não cria perfil. Corrigir a ordem resolve o caso; o
  gatilho do `0054` resolve a classe.
- **RLS não é filtro de negócio.** Ela responde "o que você PODE ver", nunca "o
  que esta tela QUER ver". `listMemberships` sem `user_id` mostrava a mesma
  empresa uma vez por membro.

**Método que funcionou, e o que não funcionou:** reproduzir a operação contra o
banco real e comparar o mesmo `select` com clientes diferentes achou metade
deles. Reler o código não achou nenhum. Log de plataforma também não — a Vercel
registrou uma requisição em 24 horas.

**E a ordem do socorro:** quando uma pessoa está travada, destrave a pessoa
primeiro e conserte a causa depois. Em 10/ago isso foi feito ao contrário e
custou horas de uma funcionária parada enquanto a causa raiz era investigada.

---

## Como trabalhar comigo

- Antes de escrever código, diga o que vai fazer e por quê. Discordar é bem-vindo.
- Nada de código spaghetti e nada de `override` para contornar um problema —
  se a solução precisa de gambiarra, a modelagem está errada.
- Erros: aponte, corrija, siga. Sem rodeio e sem se desculpar demais.
- Prefira a correção estrutural à correção de prompt.
- O repositório é a verdade. O Supabase é só onde ela é executada.
- **`git push` depois de cada entrega.** Ele testa no deploy da Vercel, que
  builda do GitHub — commit local é invisível para ele. Em ago/2026 isso custou
  uma conversa inteira: 19 commits parados, e ele reportando como ausentes
  coisas prontas. Ao ouvir "isso não está aí", confira `git status -sb` antes
  de reabrir o código.
