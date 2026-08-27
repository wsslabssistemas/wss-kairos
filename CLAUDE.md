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
