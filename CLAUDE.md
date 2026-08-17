# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # starts on http://localhost:3001 (not 3000)
npm run build
npm run test         # vitest run (all tests once)
npm run test:watch   # vitest watch mode
npx vitest run tests/unit/calculations/score.test.ts  # single test file
npm run sync-constants  # regenerates constant files from Supabase DB (requires SUPABASE_SERVICE_ROLE_KEY)
npm run lint

npm run consistency  # painel de consistência das notas de atributo (US$0; --save/--baseline)
npm run fontes       # cobertura por fonte externa (US$0). --falta=<fonte>[:reviews] LISTA as lacunas
npm run db:egress    # quanto de egress as últimas 24h custaram (mede no local, quota zero)
```

`sync-constants` needs `SUPABASE_SERVICE_ROLE_KEY` in env. It overwrites the files listed in the **Constants generated from DB** section below — never hand-edit them.

## ⚠️ O banco NÃO tem backup — faça um antes de mudança grande

Conferido na Management API (2026-07-13): **`pitr_enabled: false` e ZERO backups disponíveis**. Não
existe de onde restaurar. E parte do dado é cara de refazer: ~2.100 avaliações de IA (**≈US$60 em
tokens**) e ~14 mil reviews raspadas de 8 fontes.

```bash
node scripts/backup-db.mjs        # → .backups/<timestamp>/ (gitignored)
```

Dump lógico de todas as tabelas em NDJSON gzipado (**34,9 MB / 173.806 linhas em 77 tabelas**,
medido em 2026-08-09) **+ `schema.sql.gz`** (37 KB: 84 tabelas, 67 policies, 13 functions, 9
triggers, 2 views, schemas `public` e `bkp`). **Pagina e confere contra `count: "exact"`**: se
faltar uma linha, ele FALHA em vez de gravar um backup truncado — que é a pior forma possível do
bug das 1000 linhas, porque você só descobre quando precisa restaurar.

🟢 **Roda sozinho, semanalmente**: `~/Library/LaunchAgents/com.geners.animedb-backup.plist`,
domingo 04:00, com `BACKUP_ENV_FILE=.env.supabase-cloud` (obrigatório — sem ele o agente salvaria
o banco LOCAL reportando sucesso).

🔴 **O motivo registrado para ser semanal ("o dump custa ~137 MB de egress, e diário daria
~4,1 GB/mês, 82% do teto") estava em bytes SEM compressão, e o que trafega é comprimido.**
Remedido em 2026-08-10 simulando um backup completo contra o local (76 tabelas, 238 páginas,
187.851 linhas): **157,2 MB crus · 36,3 MB comprimido**. Logo: semanal = **0,16 GB/mês (3%
do teto)** e **diário = 1,09 GB/mês, 22%** — não 82%. O gzip é medido, não suposto
([[gotcha-egress-contado-sem-compressao]]).

⚠️ Isso **libera** a escolha, não a decide: diário cabe folgado na quota, e a pergunta passa a
ser quanto de dado se aceita perder entre backups (hoje, até 7 dias de curadoria). A frequência
segue semanal até alguém decidir o contrário — o que mudou é que o custo deixou de ser o motivo.

🔴 **O schema entrou no backup em 2026-08-10, e a lacuna era real.** Até então o NDJSON era **só
dado**: restaurar exigia um banco que já tivesse tabelas, policies e triggers, e o único lugar
onde isso existia era o `pg_dump` do `db:pull`, rodado à mão. Medido no dia: o backup de dado
tinha **1 dia** e o de schema tinha **11** — e, com o local deixando de ser fonte de verdade, o
`db:pull` para de ser rodado por hábito, então essa metade envelheceria ainda mais justamente
quando vira a única rede. Custa 259 KB e ~3s: **0,24%** do dump completo de 108 MB.

⚠️ O bloco de schema é **fail-soft**: sem `pg_dump` no PATH ou sem `SUPABASE_DB_PASSWORD` ele
avisa e segue, porque o dado já está gravado e conferido — abortar ali jogaria fora o que deu
certo.

⚠️ **Restaurar exige criar as extensions ANTES**: `--schema public` não leva `CREATE EXTENSION`, e
`vector`/`pg_trgm` moram dentro do `public` (o `db-pull-to-local.mjs` já faz isso no passo 4).

⚠️ **As "162 functions" do `pg_proc` no `public` NÃO são do projeto** — 149 vêm dessas duas
extensions e o `pg_dump` as omite de propósito (voltam com a extension). As do projeto são **13**.
Esta linha já disse "162 functions, 47 policies, 11 triggers"; o real, medido na nuvem em
2026-08-10, é **13 / 67 / 9**.

**Retenção: o dono é `scripts/lib/backups-retencao.mjs`, e é ÚNICO.** Ele declara as **7
famílias** que podem existir em `.backups/` (quem cria, o que é, quantas guardar, qual env
ajusta) e todo escritor chama `podar("<família>")`. Ajuste por família: `BACKUP_KEEP` (5),
`PULL_KEEP` (3), `PUSH_STAGE_KEEP` (2), `PUSH_EVALS_KEEP` (3), `COFRE_KEEP` (5),
`SYNOPSIS_LAB_KEEP` (3).

⚠️ **Esta seção já disse "o script mantém os 5 mais recentes" e induzia à conclusão errada.** A
frase era verdadeira e cobria **6 dos 40 diretórios** — a retenção do `backup-db.mjs` só casa
nome de stamp ISO puro. Ancorar em "existe retenção" sem perguntar *de quê* é como o `.backups`
chegou a **1,9 GB** (1,5 GB em 23 dirs `push-curation-*`, quase todos de um dia só, a maioria
**ensaio no cloudsim**).

🔴 **A causa raiz não foi um script esquecido — foi o PADRÃO.** Cada um inventava prefixo e
política próprios, e cada retenção era um regex que enxerga só a própria família: todas
corretas, todas cegas entre si **por construção**. Medido em 2026-08-10: de 7 escritores,
**3 nunca podavam nada** (`push-*`, `synopsis-lab-*`, `fingerprints`), e havia 3 entradas órfãs
de script nenhum — uma de **33 MB**. Mesma armadilha do `LOW_BALANCE_USD` e do
`STRONG_TAG_WEIGHT`, só que em disco, onde o sintoma demora meses porque só dói quando acaba.

⚠️ **A poda é ANTES de gravar, com UMA exceção.** Staging e cofres são podados no começo,
porque ensaio interrompido deixa lixo igual ao de uma execução completa. Só o `backup-db.mjs`
poda no FIM: lá, chegar à linha é a prova de que o backup novo passou na conferência, e podar
antes descartaria um backup bom por causa de um novo que falhou.

🔴 **`podar()` denuncia entrada SEM DONO em toda execução** — é isso que pega o *próximo*
prefixo, não os que já conhecemos. Guardado por
`tests/unit/orchestration/backups-retencao-tem-dono.test.ts`, que **deriva** os escritores do
filesystem (grava em `.backups` + cria diretório) em vez de listar nomes: lista fixa não acha o
que ninguém apontou. Conferido criando um script novo sem família — o teste reprova.

⚠️ Famílias precisam ser **mutuamente exclusivas**: `/^push-\d{4}/` não pode engolir
`push-curation-…` (2 MB × 96 MB por execução, tetos distintos). Por isso todo regex datado
exige o dígito do ano logo após o prefixo.

⚠️ E isso realimenta o problema do deploy: até 2026-08-10 `.backups` ia inteiro no contexto do
Docker (ver `output: "standalone"`). Hoje está no `.dockerignore`, mas continua ocupando disco —
e disco cheio já derrubou a VM do Docker aqui.

Rode antes de: partição per-user (Fase 2), backfill em massa, qualquer migration que dropa coluna.

**Cache de dev incha:** o `.next/dev` (cache do Turbopack) chega fácil a **dobra dígito de GB**. Não
tem teto configurável — limpe periodicamente com `npm run clean` (`rm -rf .next .turbo`; regenera no
próximo `npm run dev`, só a 1ª compilação fica mais lenta). Confira `next-server` órfãos antes
(`pkill -f next-server`): cada dev server zumbi segura o cache e infla o `.next`.

## ⚠️ Egress: o plano free tem 5 GB/ciclo, e desenvolver contra a nuvem estoura

Em 2026-07-29 o projeto foi **restrito** (`exceed_egress_quota`, 16,76 GB contra 5 GB inclusos). O
sintoma engana: o gateway devolve **402 em tudo**, e o erro aparece na UI como Runtime Error apontando
uma `select` inocente de 1 coluna — a primeira query a estourar leva a culpa. Prova de que é infra:
`/auth/v1/health` (que nem toca o Postgres) também dá 402. Postgres direto na 5432 e o endpoint de SQL
da Management API continuam funcionando mesmo restrito — é assim que se tira o dump com o app fora do ar.

🔴 **Os números desta tabela são SEM compressão, e o que trafega é COMPRIMIDO — divida por ~4.**
Medido em 2026-08-10 sobre 24h de `edge_logs`: **1.490,9 MB crus × 373,6 MB com gzip (fator 4,0)**.
Os dois elos foram conferidos separadamente: o `fetch` do Node — que o `supabase-js` usa — manda
`accept-encoding: gzip, deflate` **por padrão** (medido com um servidor local ecoando headers), e o
gateway responde `content-encoding: gzip` (medido com `curl --compressed`). O browser também pede.
⚠️ O que **não** está medido é o Supabase *faturar* o byte comprimido; medi o byte que SAI. É a
leitura defensável, mas a tabela abaixo continua servindo para comparar operações entre si — não para
prever quando a quota estoura.

**Custo por operação, medido no PostgREST (bytes CRUS — ver o fator ~4 acima):**

| Operação | Payload |
|---|---|
| ~~1 página de `/catalog` com `tags(*)`~~ | ~~569 KB~~ — **não é mais o código** |
| 1 página de `/catalog` (24 obras, `WORK_LIST_SELECT` de hoje) | **330 KB** (−42%) |
| catálogo inteiro com o mesmo select (966) | **20,1 MB** |
| um `recalculateAll` (só a leitura de `works`) | **5,3 MB** (1,66 MB comprimido, medido) |

✅ **O corte de −42% JÁ ESTÁ APLICADO** — commit `03d8713`, 30/07/2026, no `main`:
`work_tags(tag_id, tags(id, slug, name, tag_group_id))`. Esta seção o descrevia como opção
disponível por 11 dias depois de aplicado, e um briefing de sessão o repetiu como pendência
aberta. Confira o source antes de reabrir. Sobrou um `tags(*)` em `DUPLICATE_WORK_SELECT`
(`server/actions/works.ts`), que carrega **1 obra** na detecção de duplicata.

Auth é 0–3% do egress; **PostgREST é 97–100%**. **Quebrar a tabela `works` não ajuda**:
`review_digest` + `review_summary` + `canonical_synopsis` são 78% dela e o `WORK_LIST_SELECT` não
pede nenhuma. O peso está nos joins embutidos.

**Como medir de verdade, sem gastar quota** (`scripts/egress-baseline.mjs`): o painel
(Reports → Usage) é a única fonte do acumulado do ciclo e **não é acessível por PAT** —
`/platform/**` devolve 401 "JWT could not be decoded" e `/v1/**` não tem rota de usage. O que dá
para fazer sozinho é ler `edge_logs` pela Management API, agrupar por `(path, search, status)` e
**replicar cada payload contra o LOCAL**, que é réplica. ⚠️ Não some o `content_length` dos logs:
o PostgREST responde chunked e o campo vem NULL em quase toda resposta grande — somá-lo dava
**1,75 MB** para o que eram 374 MB. ⚠️ Retenção de log no free é **1 dia**.

⚠️ **Decomposição das 24h em torno do cutover — o app não é o gargalo:** varredura completa de
tabela (backup/reconciliação) **326,3 MB (87%)** · `recalculateAll` 31,6 MB (19 execuções) ·
app e consultas seletivas **15,7 MB** (545 requisições). Aquele número era o custo do TRABALHO de
virada, não do regime — o regime novo nasceu em 10/08 às 17:43 e ainda não tem um dia medido.

## Desenvolver contra o Supabase LOCAL

```bash
supabase start                 # stack local: API 54321, Postgres 54322, Studio 54323
npm run db:pull                # pg_dump da nuvem → local (DESTRÓI public/bkp do local)
npm run db:local               # aponta o .env.local pro stack local
npm run db:cloud               # volta pra nuvem
npm run db:push-evals -- --yes # leva avaliações de IA feitas no local pra nuvem
```

🔴 **A NUVEM é a fonte de verdade; o local é réplica DESCARTÁVEL** (decidido em 2026-08-10). O
app aponta pra nuvem — é onde a curadoria e os leitores vivem — e os **25 scripts de análise**
apontam pro local, que é o corte de egress que justifica o stack existir. **Nada sobe do
local**, exceto lote declarado via `db:push-evals`.

⚠️ **São DOIS interruptores, e antes era um só.** Até 2026-08-10 o `db:local` movia o app **e**
os scripts juntos, o que tornava essa configuração impossível: dava pra escolher qual dos dois
estaria errado, não acertar os dois.

| quem | arquivo | alvo |
|---|---|---|
| app (`npm run dev`) | `.env.local` | **NUVEM** |
| scripts do `package.json` que só leem | `--env-file=.env.local --env-file=.env.analysis` | **LOCAL** |
| scripts de `scripts/` que só LEEM | idem, declarado no cabeçalho do arquivo | **LOCAL** |
| scripts que GRAVAM (dos dois lados) | `--env-file=.env.local` + `ALVO: NUVEM` no cabeçalho | **NUVEM** |

⚠️ **Esta tabela é de PAPÉIS, não de contagem** — os números vivem numa tabela só, mais
abaixo ("A exigência é DECLARAR o alvo"), que a suíte confere. Aqui eles já disseram
"23 / 29 / 29" enquanto a outra dizia outra coisa: duas contagens do mesmo fato no mesmo
arquivo, divergindo em silêncio.

⚠️ **São 83 entradas, não 25** — a conta de "25 scripts" só enxergava o `package.json`. Ver o
🔴 sobre os 58 arquivos logo abaixo: metade deles grava, e para essa metade o local é o alvo
ERRADO.

O último `--env-file` vence (conferido no Node e no tsx), então `.env.analysis` carrega **só as
3 variáveis de alvo** e herda `ANTHROPIC_API_KEY`, `MAL_CLIENT_ID` e o resto do `.env.local` —
uma 2ª cópia dos segredos divergiria na primeira troca de chave.

```bash
npm run db:analysis-env   # gera o .env.analysis a partir do `supabase status`
```

⚠️ **Rode isto no primeiro uso do repo e depois de qualquer `supabase stop && supabase start`.**
O arquivo é gitignored (`.env*`), então num clone novo ele não existe e os 25 scripts morrem com
`node: .env.analysis: not found` — que é críptico, mas é **de propósito**: a alternativa
(`--env-file-if-exists`) faria todos rodarem contra a NUVEM em silêncio, que é o erro caro que
essa separação existe para impedir. Falhar alto é a escolha certa aqui.

⚠️ **Script que esqueça o `.env.analysis` roda contra a NUVEM e não avisa** — ele funciona,
devolve os números certos e só queima quota (20,1 MB por varredura do catálogo; o pico medido
foi 1,47 GB num dia com zero curadoria). Guardado por
`tests/unit/orchestration/scripts-apontam-pro-local.test.ts`, que **deriva** a lista do
`package.json` e checa também a ORDEM dos dois arquivos — invertida, o `.env.local` sobrescreve
o alvo de volta e o `.env.analysis` vira decoração.

🔴 **O `package.json` cobre 25 scripts; havia 58 fora dele.** Os demais são invocados à mão
pelo comando escrito no CABEÇALHO do arquivo, e esse comando é a interface real deles. Medido
em 2026-08-10, logo depois do cutover: **58 arquivos** em `scripts/` traziam
`--env-file=.env.local` sem `.env.analysis` — entre eles `coherence-audit.ts` e `gold-mae.ts`,
justamente os instrumentos de medição.

⚠️ **Nenhum deles foi editado para ficar errado.** Enquanto o `.env.local` apontava pro local,
aquela linha era o alvo CERTO; o cutover inverteu o **significado** da mesma linha, sem tocar em
arquivo nenhum e sem nada acusar. É a forma mais barata de uma base inteira apodrecer: não é o
código que muda, é o que ele quer dizer.

🔴 **A exigência é DECLARAR o alvo, não "usar o local"** — e a razão é medida: quase metade
GRAVA (catálogo ou o log de custo em `ai_api_calls`). Mandá-los pro local descartável perde o
trabalho no próximo `db:pull`, falha mais cara que o egress que o `.env.analysis` evita. Hoje
cada arquivo `.ts`/`.mjs`/`.js` **rastreado pelo git**, fora do `package.json` e que toca o
banco declara um dos dois (**99 arquivos, remedidos em 2026-08-16**):

| declaração | quantos | o que significa |
|---|---|---|
| `--env-file=.env.analysis` na linha de uso | **44** | só LÊ ⇒ vai pro local, de graça |
| `ALVO: NUVEM` no cabeçalho | **48** | GRAVA ⇒ tem que ir pra nuvem |
| (não tocam o banco) | 7 | fora da régua |

🔴 **ESTES TRÊS NÚMEROS SÃO CONFERIDOS PELA SUÍTE**, e não por quem editar esta seção —
`scripts-apontam-pro-local.test.ts` lê a tabela daqui e a compara com a varredura real. É a
única defesa que funcionou: a tabela dizia "29 / 29" sobre 58 arquivos, foi remedida para
"44 / 39 sobre 89" em 2026-08-15, e **envelheceu de novo no mesmo dia**, porque o PR seguinte
ampliou o escopo da varredura (`.js` entrou, os 7 scripts de tag viraram `ALVO: NUVEM`) e não
voltou aqui. Número em prosa não tem como acusar a própria defasagem — quem acusa é o teste.

⚠️ **A tabela dizia "29 / 29" e envelheceu sem nada acusar** — o universo tinha crescido
de 58 para 89. Pior: **16 desses arquivos não declaravam alvo nenhum**, e o teste não os
via porque filtrava por quem **menciona** `--env-file=.env.local`, o que é uma allowlist
disfarçada. Escapar da varredura não é ser inofensivo: 4 deles traziam
`config({ path: '.env.local' })` no CÓDIGO e liam a NUVEM em toda execução, com o
`.env.analysis` sem poder algum sobre eles.

🔴 **Alvo fixado no código VENCE o `--env-file`, e por isso saiu.** Nos `.mjs` o padrão do
repo é não usar `dotenv`: quem manda é a linha de comando, e sem ela o script falha alto
(`supabaseUrl is required`) em vez de escolher um banco sozinho. Medido depois da correção:
`measure-stale-assessments.mjs` passou a apontar para `127.0.0.1:54321`. Guardado por
`scripts-apontam-pro-local.test.ts`, que agora varre por **quem cria client Supabase** — não
por quem menciona env-file — e reprova declaração de LOCAL que fixe `.env.local` no código
(as duas checagens conferidas com sondas).

⚠️ **`backup-db.mjs` é `ALVO: NUVEM` com sentido INVERTIDO:** ele não grava no banco, grava
o BACKUP — e backup do banco errado é pior que nenhum, porque reporta sucesso. O alvo dele
sai de `BACKUP_ENV_FILE`, que o `--env-file` não alcança.

⚠️ **A classificação por `grep` de `.insert(`/`.update(` tem falso negativo, e ele é do lado
caro.** `chance-recalc-run.ts` chama `recalculateAll`, `backfill-mal-reviews.ts` chama
`saveWorkReviews` e `regen-review-digest.ts` chama `ensureReviewDigest(allowPaid, force)` —
os três gravam via helper importado e passariam por "só lê". Ao classificar um script novo,
olhe os imports, não só o corpo.

✅ **`backfill:interest` e `e1:digest` foram pra NUVEM (resolvido em 2026-08-10).** Os dois
estavam no `package.json` com `--env-file=.env.analysis` (⇒ local) e **gravam no modo
`--execute`** — herdaram o apontamento em bloco dos 25 no cutover, quando a conta de egress foi
feita para leitura e o modo de escrita entrou de carona.

🔴 **O que estava em jogo, medido:** `backfill:interest --execute` planejava **971 previsões,
US$10,60** (teto US$15,89) — o perfil está stale, e nesse caso ele não prevê parcialmente
(70 frescas · 610 contra perfil antigo · 291 ausentes). Pior: o dry-run **imprimia o comando
errado** como passo seguinte, então a instrução impressa levava a queimar US$10,60 num banco
descartável.

⚠️ **Do `e1:digest` esta seção já afirmou "136 obras a US$0,0183 cada", e era INFERÊNCIA.**
Aquele número saiu de contar obras sem digest no banco, sem rodar a ferramenta. Rodado:
`FATAL: works: column works.personal_status_id does not exist`. Ver o 🔴 logo abaixo — o
script não gastaria nada porque não roda.

⚠️ **O dry-run foi junto pra nuvem, e não é descuido: plano e execução TÊM que ser no mesmo
banco.** O executor replaneja e compara (`plan.planSignature !== deps.planSignature` ⇒
`plan_changed`), então planejar no local e executar na nuvem **aborta**. O único par que
"funcionava" era local+local, que é justamente o que queima dinheiro à toa. O egress do
dry-run (poucos MB comprimidos) não paga o risco de US$10,60.

⚠️ **"Ensaiar barato no local" não existe aqui** — as chamadas Claude custam o mesmo contra
qualquer banco. Quem limita o dano é o `--max-cost-usd`, não o alvo.

**Duas camadas, porque são duas portas:** o `package.json` deixou de carregar `.env.analysis`
nesses dois, e o `--execute` chama `exigeAlvoNuvem()` (`scripts/lib/exige-alvo-nuvem.ts`), que
aborta com a linha de comando certa **antes de qualquer chamada paga** — quem copia o comando
do cabeçalho não passa pelo npm script. Guardado pelo mesmo
`scripts-apontam-pro-local.test.ts`, que exige o guard em todo script pago marcado
`ALVO: NUVEM` e **deriva a exceção do cabeçalho do arquivo**, nunca de uma allowlist.

✅ **`e1:scope` e `e1:digest` foram consertados e RODADOS em 2026-08-10.** Ficaram quebrados
~4 semanas desde a Fase F (`329a446`, 14/07/2026), morrendo na primeira query com
`FATAL: works: column works.personal_status_id does not exist`: a Fase F tirou as 19 colunas
pessoais de `works`, o espelho (`user_work_state`) virou a única fonte, e `computeE1ProdScope`
continuou lendo a coluna antiga. Nada acusou — nenhum dos dois roda em CI nem por hábito.

🔴 **O status pessoal passou a ter DONO, e o conserto foi escolher qual.** Em `works` ele era
global por acidente (uma linha só); no espelho há uma linha POR PESSOA. Ler sem `user_id`
devolve o estado de outra pessoa, e ler pelo "usuário corrente" cai no singleton por fallback
([[gotcha-anonimo-vira-dono]]). É operação de CATÁLOGO, então o rótulo é o do dono ⇒
`loadOwnerLabels()`, que já é o dono único dessa leitura (service role + `user_id` explícito +
paginação + guarda barulhento). Montar o `select` no script reabriria os três buracos.

🔴 **O "~23 obras (~US$0,42)" desta seção era INFERÊNCIA, e errou por 7×.** Saiu de subtrair
reviews/tags das 136 obras sem digest, sem rodar a ferramenta. Rodado contra a nuvem: escopo
**610 filtradas, 3 sem digest**, e o `--execute` fechou as 3 por **US$0,0612 reais**. Restam
~0 no escopo. É a mesma armadilha que já tinha produzido o "US$2,49 de trabalho pendente"
sobre um script que nem executava — **rode o dry-run antes de citar qualquer número daqui**.

⚠️ **Dois defeitos, e o segundo estava escondido atrás do primeiro:** o `e1:scope` gravava os
IDs num scratchpad de SESSÃO (`/private/tmp/claude-501/…/<uuid>/`) que já não existe. Ele teria
estourado ENOENT depois de a consulta inteira rodar — mas o script morria antes, na 1ª query.
Hoje escreve em `.e1/` no repo (gitignored, e no `.dockerignore` também, que não herda).

⚠️ `db:local` continua existindo para o caso raro de querer o **app** no local. Ele não mexe
mais nos scripts. E quando o app está no local, uma **faixa de listras** aparece no topo
(`components/layout/db-target-banner.tsx`) — ela mora no layout RAIZ, acima do `AppShell`,
porque as rotas full-bleed (`/login`, `/about`) retornam antes da barra de navegação, e o login
é justo onde saber o alvo mais importa: as contas dos dois bancos são diferentes, e entrar no
errado parece "minha senha não funciona". Listras e não cor chapada de propósito — azul e âmbar
já significam estado de TAREFA (ver "Ação lenta tem DUAS cores"), e ambiente é outra categoria.

```bash
npm run db:health        # os 5 números dos gatilhos + "o local voltou a ser fonte de verdade?"
```

🔴 **`db:push-curation` está APOSENTADO** — exige `--eu-sei-o-que-estou-fazendo`. Ele existia
porque o catálogo tinha DOIS escritores; sem isso, não há o que reconciliar. Para operação em
LOTE rodada no local (reavaliar o catálogo com uma régua nova), use `db:push-evals` (5 tabelas).

⚠️ **O check "local escreveu?" tem DOIS níveis, e o motivo é medido:** uma única visita à home
com o app no local escreve **27 linhas** de `works` — é o `persistReadingDates` cacheando
`chapters_checked_at`. Alarmar nisso faria o comando gritar sempre que alguém abrisse o app no
local, e alarme que sempre toca não é lido. Então o ALARME é só para escrita que apenas a
curadoria produz (`category_scores`, `ai_evaluations`, `work_tags`, e `works` pela **criação**);
`works.updated_at` vira nota informativa.

🔴 **Contagem sozinha não pega EDIÇÃO, e hoje quase toda curadoria é edição** — o catálogo já
está construído. Por isso existe o check "obra editada?", que compara o CONTEÚDO de `works`
coluna a coluna com a nuvem. A lista é de **EXCLUSÃO, nunca de inclusão**: coluna nova entra na
comparação sozinha e o erro cai pro lado seguro. Cada exclusão tem motivo medido — `updated_at`
(trigger, reescreve **981**), os três `*_chapter*`/`chapters_checked_at` (cache de navegação,
27/24/6) e `ai_eval_status` (trigger de destino, 1). Conferido reincluindo cada uma: 981, e 1,
respectivamente.

⚠️ **`total_chapters` é o caso de fronteira e tem tratamento próprio.** É material (entra no
recalc) mas quem o move é o agregador de capítulos, por navegação. Deixá-lo no alarme fazia o
comando disparar por rotina; tirá-lo esconderia divergência que move nota. A comparação roda
**duas vezes** e a diferença isola as obras que divergem só em capítulo — alarme para o resto,
nota informativa para essas (hoje: 1 obra, 55 × 54).

⚠️ **O tamanho do banco soma TODOS os bancos, não `current_database()`.** A 1ª versão media só o
`postgres` e dava 189 MB contra os **213 MB do painel** — 11% a menos, num indicador cujo
gatilho está em 350 MB. `template0`/`template1` somam ~15 MB e o painel ainda conta ~9 MB de
overhead que nenhum SQL mostra. Subestimar atrasa o alarme, que é o pior lado.

⚠️ **O corte é a última RECONCILIAÇÃO, não o último `db:pull`.** A 1ª versão usava só o `pull-*`
e nasceu acusando 981 works: era a curadoria de 11 dias que o push já tinha levado. Hoje o corte
é o mais recente entre `pull-*` e `push-*`.

`[db.migrations] enabled = false` no `config.toml` é **de propósito**: as 173 migrations foram aplicadas
via Management API, têm colisões de número e nunca rodaram do zero. Quem popula o local é o `pg_dump`.

**O banco local é refeito a cada `db:pull`.** Existem DOIS caminhos de volta:

```bash
npm run db:push-evals -- --yes        # só a avaliação de IA (5 tabelas)
npm run db:push-curation -- --dry-run # curadoria INTEIRA: "Atualizar dados" + avaliação +
npm run db:push-curation -- --yes     #   estado de leitura + saídas do recalc (18 tabelas)
```

O `db:push-curation` cobre o que foi **medido** num piloto real, não deduzido do código —
foi assim que apareceram `work_processing_jobs`, `ai_cache_events` e o fato de
`canonical_synopsis` ser um artefato pago próprio. Ferramenta que fecha o escopo:

```bash
npm run db:fingerprint snap antes    # … faz a operação no app …
npm run db:fingerprint snap depois
npm run db:fingerprint diff antes depois   # toda tabela que aparecer precisa estar no PLAN
```

Ele usa **hash de conteúdo, não contagem**: "Atualizar dados" mexe em dezenas de colunas de
`works` sem criar linha — num diff por contagem isso é invisível.

**Fora do push, de propósito:** `formula_config` (mistura saída do modelo com CONFIGURAÇÃO do
usuário — faixas, cores, atalhos de nota), `external_source_health` e `genre_proposal` (derivados).

⚠️ **`--dry-run` dá rollback e SAI ANTES da conferência** — o caminho do COMMIT e todo o código
de verificação ficam sem execução. Ensaie de verdade contra um clone descartável:

```bash
npm run db:cloudsim   # clone da nuvem no Postgres local, a partir do dump do db:pull
npm run db:push-curation -- --target='postgresql://postgres:postgres@127.0.0.1:54322/cloudsim'
```

Foi esse ensaio que pegou o `trg_works_updated_at` (BEFORE UPDATE, `NEW.updated_at = now()`):
o destino reescreve a coluna, então ela **nunca** bate e não serve de invariante.

## `db:diff`: o que ele enxerga, e o que ele NÃO enxerga

```bash
npm run db:diff                    # todas as tabelas, por hash de conteúdo
node scripts/db-diff.mjs works     # detalhe por linha
```

🔴 **Ele nasceu CEGO e ninguém percebeu por seis dias** (PR #354 → corrigido na #356). A
expressão de linha concatenava as colunas com `||` e embrulhava num `coalesce(…, '')`. Em SQL
`NULL || qualquer_coisa = NULL`, então **uma** coluna nula anulava a linha inteira, que virava
`md5('')` — o mesmo valor pra qualquer conteúdo. Como quase toda linha larga tem algum NULL, o
hash da TABELA passava a depender só da **contagem**. Medido: `works` com apenas 5 colunas dava
**981 linhas → 223 hashes distintos**. Três tabelas estavam sob falso "✓ idêntico": `works`,
`tags`, `formula_config`.

⚠️ **Quem denunciou foi a CONTRADIÇÃO entre duas ferramentas** — o `db:push-curation` acusou
`works` divergente e o `db:diff` desmentiu. Quando duas discordam sobre o mesmo fato, uma está
quebrada; descobrir qual sai mais barato do que adotar a resposta conveniente. Guardado por
`tests/unit/orchestration/db-diff-hash-null-safe.test.ts`, que lê o SOURCE (o script roda
`main()` na importação) e **reprova a versão antiga** — conferido, não suposto.

**Divergência ≠ erro.** Retrato de 2026-08-10, **depois** do push que ampliou o PLAN para 30
tabelas: **24 divergentes, 43 idênticas** — e as 24 têm todas motivo escrito. Antes do push eram
28. Reconciliaram nessa rodada: `work_genres`, `tag_subgroup_assignment`, `work_lists` e
`work_list_items` (as quatro que entraram no PLAN), além de `work_embeddings` e
`synopsis_quality_predictions`.

As 24 caem em cinco grupos, **nenhum deles pendente** — o grupo que precisava de decisão foi
resolvido em 2026-08-10:

| grupo | n | exemplos |
|---|---|---|
| carimbo que cada lado escreve sozinho | 2 | `works` (1 linha, `ai_eval_status`) · `tags` (54 linhas, só `adult_score_tier_reviewed_at`) — **medido coluna a coluna**, não suposto |
| linhas que **só existem na nuvem** — o push só sobe | 6 | `work_reviews` −104 · `ai_evaluation_scores` −9 · `curation_requests` |
| per-user fora do escopo do curador — **por desenho** | 6 | `user_calculated_scores` +4838 · `user_work_state` +27 |
| chave surrogate regenerada — **falso positivo** | 1 | `platform_ratings` (240 / 240 / **0**) |
| fora do PLAN, exclusão documentada | 3 | `external_source_health` · `genre_proposal` · `formula_config` |
| fora do PLAN, **decidido em 2026-08-10** | 6 | ver abaixo |

⚠️ **Havia 10 tabelas divergentes sem decisão registrada, e o problema era o REGISTRO.** Gap sem
motivo escrito parece esquecimento e volta a ser rediscutido toda sessão. **Quatro entraram no
PLAN** e as outras seis ficaram fora **com motivo**, impresso pelo próprio `db:push-curation` ao
terminar.

🔴 **A régua: "o local é a verdade" vale pra CURADORIA, não pra LEITURA — e `work_lists` é o
contraexemplo medido.** Pasta de favoritos é ação de **leitor**, feita em produção. Os dois lados
tinham divergido: 5 pastas só no local (91 itens), **1 só na nuvem ("Protagonista Marcante", 11
itens)**, uma pasta **renomeada** (local "Iniciadas" = nuvem "Lendo") e "Ideal" com **mais itens
na nuvem** (4 × 3).

⚠️ **A Ana decidiu (2026-08-10) que o local passa a ser a verdade também aqui, com substituição
completa** — custo aceito e medido: **16 itens e 1 pasta** apagados da nuvem. Isto NÃO é dedução
do script; é escolha registrada, e por isso está escrita no comentário da entrada do PLAN. Se a
premissa mudar (por exemplo, um leitor de verdade passar a criar pastas em produção), a estratégia
de conjunto vira perda de dado alheio e precisa ser revista.

🔴 **`work_lists` vem ANTES de `recommendation_runs` no PLAN.** A FK
`recommendation_runs.list_id → work_lists` é **ON DELETE SET NULL**: apagar pasta apaga a
referência do run **em silêncio**. Hoje são 0 runs com `list_id` preenchido na nuvem (conferido),
mas a ordem não pode depender disso continuar verdade. Já `work_list_items.list_id → work_lists`
é ON DELETE CASCADE — o delete das pastas leva os itens junto, e o `pre` explícito em
`work_list_items` é redundância defensiva, não necessidade.

⚠️ **`work_list_items` não tem `user_id`** — escopa pelo PAI
(`list_id in (select id from work_lists where <curador>)`), mesma forma do fechamento de FK que
`recommendation_runs` já exigia. Vale igual pra `import_rows`, se um dia entrar.

⚠️ `user_settings` fica fora por **segurança**, não por baixo valor: carrega `role`, plano e
saldo, e o local tem contas de teste. Empurrar cria conta fantasma em produção e mexe exatamente
no que o trigger `guard_role_self_escalation` protege.

⚪ `prediction_snapshots` (+6832) · `prediction_ledger` · `pilot_taste_scores` ·
`imports`/`import_rows` — histórico gerado por rodadas locais. Refazível, e produção não fica
errada sem ele.

🔴 **Ao adicionar tabela ao PLAN, o alvo do `on conflict` é a chave NATURAL, não o surrogate.**
`tag_subgroup_assignment` tem PK em `id` e **UNIQUE em `tag_id`**: upsert por `id` insere e viola
o unique se a mesma tag tiver ids diferentes nos dois bancos — erro no meio do push, com metade
do PLAN aplicada. Hoje as chaves coincidem (2831/2831, zero divergindo), mas isso é estado, não
garantia. Mesma família do falso positivo de `platform_ratings`.

⚠️ **O detalhe do `db:diff` NÃO responde "há linha só na nuvem?" em tabela de PK COMPOSTA** — ele
chaveia pela PRIMEIRA coluna do PK, então as linhas da mesma obra colapsam. Em `work_genres` ele
dizia "21 valor diferente" onde o conjunto real de pares `(work_id, genre_id)` diverge em **6, com
zero só na nuvem** — que foi o que autorizou o delete+insert. Compare o conjunto à mão antes de
escolher estratégia destrutiva.

🔴 **`trg_enforce_work_ai_eval_pending_reality` recusa valor empurrado, e está CERTO.** O push
escreveu `works.ai_eval_status = 'pending'` e o destino devolveu `review_pending`, porque a
nuvem tem uma avaliação concluída que o local não tem. É a mesma família do
`trg_works_updated_at` — trigger de destino reescrevendo coluna empurrada —, mas aqui **a nuvem
é a mais correta das duas**: se o push tivesse vencido, teria escondido uma revisão pendente
real em produção. Não "conserte" empurrando mais forte.

⚠️ **`adult_score_tier` bate exatamente nos dois lados** (28 explicit · 25 label · 2922 null) —
a migration 182 está íntegra. Conferido em 2026-08-10, porque `tags` aparecer na lista de
divergentes assusta: é catálogo e governa os pisos 18+.

🔴 **Login no local não funciona de cara:** os usuários são Google-only (`encrypted_password`
NULL) e o `config.toml` vem com todo provider externo `enabled = false` — dá
`Unsupported provider`. O `/login` tem formulário de e-mail+senha, então crie uma senha só no
local (`update auth.users set encrypted_password = extensions.crypt('…', extensions.gen_salt('bf'))`).
Refazer depois de cada `db:pull`. Desde 2026-08-06 há também **"Esqueci minha senha"**
(`/forgot-password` → e-mail → `/reset-password`), e no local o e-mail cai no **Mailpit** (`:54324`).

🔴 **PENDENTE: a recuperação de senha NÃO funciona em produção — falta SMTP.** Medido na
Management API (2026-08-06): `smtp_host`, `smtp_user`, `smtp_pass` e `smtp_admin_email` são
**todos `None`**, `hook_send_email_enabled = false`, e `rate_limit_email_sent = 2` **por hora, no
projeto inteiro**. Com o provedor embutido do Supabase — que é declaradamente de desenvolvimento —
o e-mail não chega de forma confiável a usuário real. **O código está pronto e testado ponta a
ponta; o que falta é só configuração.** Três consequências que se explicam mal quando se esquece
disto:

1. **Traduzir os e-mails é o MESMO item.** `PATCH /v1/projects/{ref}/config/auth` devolve **400**:
   *"Email template modification is not available for free tier projects using the default email
   provider."* Os templates em português já existem em `supabase/templates/*.html` e valem **só no
   local** (via `[auth.email.template.*]`); sobem pra nuvem no dia em que houver SMTP.
2. **Sem domínio próprio, Resend/SendGrid/Mailgun não servem** — exigem domínio verificado
   (SPF/DKIM) pra enviar a terceiros; sem isso só deixam mandar pra você mesmo. O app é
   `satoria.fly.dev`, sem domínio. Então a escolha real é **"Gmail com App Password agora"** ou
   **"domínio próprio primeiro"**, não "Gmail vs. provedor de verdade".
3. **Gmail resolve, com dois preços.** `smtp.gmail.com:587` + App Password (exige 2FA na conta).
   Mas o Gmail **reescreve o `From`** pro endereço autenticado — um e-mail de redefinição de senha
   sai de um Gmail pessoal, que é o formato que as pessoas aprenderam a tratar como phishing. E é
   uso fora do previsto pra conta pessoal. Pro volume atual (3 contas) o teto de envio não pesa.

✅ O que **já** está certo na nuvem, não mexer achando que é pendência: `site_url` =
`https://satoria.fly.dev` e a allow-list já cobre `satoria.fly.dev/**`, `localhost:3001/**` e
`127.0.0.1:3001/**`.

⚠️ **`supabase start` decide o projeto pelo DIRETÓRIO ATUAL.** Rodado de outra pasta, ele sobe um
stack PARALELO com config default nas MESMAS portas — e aí `psql :54322` responde
`relation "public.works" does not exist`, como se o banco tivesse sido apagado. Não foi: o do
projeto está parado no volume dele. Quem denuncia é o nome do container
(`docker ps | grep supabase_auth` → `supabase_auth_animedb-pag_obra` é o certo). Sempre `cd` no
projeto antes, ou passe `--project-id` — inclusive no `stop`, que erra o alvo do mesmo jeito.

🔴 **Signup no local não provisiona `user_settings`:** o `db:pull` dumpa só o schema `public`, e o
trigger `on_auth_user_created` (mig 137) mora em **`auth.users`** — a FUNÇÃO `handle_new_user` vem
no dump, o TRIGGER não. Sem ele, conta nova fica sem linha de settings (sem display_name, sem
preferências — `setHideAdultContent` falha com "sem linha pro usuário atual"). Recriar depois de
cada `db:pull`:

```sql
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();
```

**Corolário de backup:** este `pg_dump` é hoje o **único** backup que inclui schema, policies e
functions. O `scripts/backup-db.mjs` grava **só dado** (as 162 functions, 47 policies, 11 triggers e 2
views do `public` não vão nele), e `supabase/migrations/` não reconstrói o banco.

## Architecture

Next.js 16 App Router (Turbopack). Todo acesso ao banco é server-only, e há **dois clientes** — escolher o
errado não dá erro, dá dado errado:

| Cliente | Use para | RLS |
|---|---|---|
| `createAdminClient()` (service role) | **catálogo** (works, tags, reviews, category_scores…), curadoria, e tudo que roda **sem sessão**: fila de recalc, `after()`, cascatas, scripts | **ignorada** — o `user_id` tem que vir explícito no argumento, nunca implícito no "usuário corrente" |
| `createUserClient()` (sessão, `lib/supabase/user.ts`) | **escrita de dado per-usuário** vinda de uma requisição | **vale** (migration 142): o Postgres filtra por `user_id = auth.uid()` |

As duas trocas erradas, e o que cada uma faz **em silêncio**:
- **Cliente de usuário numa leitura de catálogo** → 0 linhas. `submitPostReadingAttributes` responderia
  "obra sem avaliação IA" — uma mentira plausível, sem erro nenhum.
- **Service role numa escrita per-usuário** → volta a depender de o código lembrar do `.eq("user_id")`.
  Esquecer não dá erro: escreve na linha de outra pessoa (foi exatamente o buraco do PR #127).

**As leituras de background continuam na service role de propósito.** O recalc lê `attribute_bias` e
`user_tag_preferences` do dono **sem sessão**; com o cliente de usuário ele veria zero linhas e
recalcularia as notas dele **sem a calibração dele** — sem erro, sem log, só notas erradas.

**Auth existe** (esta linha já disse o contrário — não confie na memória, confira): Supabase Auth com
`/login`, `/signup` e **logout no menu do avatar na barra superior** (`components/layout/account-chip.tsx` →
`signOutAction`). Quem autoriza é o **papel** (`user_settings.role` → `lib/plans/roles.ts`,
`ensureAdmin`/`roleAllows`), verificado dentro das actions.

### `/my-list` é a lista do LEITOR — e a régua de pertencimento não pode olhar o rótulo

Criada em 2026-08-16. Mesma estrutura de produto do MyAnimeList e do AnimePlanet: catálogo
público compartilhado **+** uma lista por pessoa, definida pelo status que ela deu. O que
faltava aqui não era o dado — era o LUGAR.

Medido no clone local, 988 obras do catálogo:

| | obras | onde aparecia antes |
|---|---|---|
| **Untracked** (nunca tocada) | **697 · 70,5%** | só filtrando `/catalog` |
| **com status seu** = a lista | **291 · 29,5%** | — |
| ↳ em `/reading` (`Reading` + `Hiatus`) | 38 | Acompanhamento |
| ↳ **sem página nenhuma** | **253 · 87% da lista** | só filtrando `/catalog` |

🔴 **O gap não era de organização, era de função:** o banco marca `tracks_progress` em **8**
status e a `/reading` pede **2**. `Started` (40 obras, **39 com capítulos lidos**), `On-hold`
(37) e `Stalled` (28) — 105 obras que o app considera em progresso — não estavam em lugar
nenhum.

⚠️ **Ela NÃO absorve `/reading`, `/ranking` nem `/recommendations`** (decisão da Ana).
`/reading` responde **ritmo** ("saiu capítulo? estou em dia?", bandas + calendário);
`/my-list` responde **estado** ("o que eu já disse sobre esta obra?"). Se cruzam de propósito.

🔴 **A regra de pertencimento tem que ver o id CRU, nunca o rótulo resolvido.**
`is_default_unset` está em **"Want to Read"**, não em Untracked — obra sem linha no espelho
APARENTA "Want to Read" (é o que `personalStatusNameOrDefault` faz, e é correto em outros
lugares). Medido: o curador tem **988 linhas** em `user_work_state`, a conta leitora tem **0**.
Uma régua sobre o rótulo daria à conta nova uma lista com **as 988 obras, todas "Quero ler"** —
cheia, plausível e falsa. Dono: `belongsToMyList` (`lib/my-list/shelves.ts`), que recebe
`personalStatusId` cru e por isso dispensa um campo `hasRow`: sem linha o id é `null`, não tem
prateleira, e a obra cai fora sozinha.

⚠️ **O ramo da NOTA não é enfeite:** 4 obras estão em Untracked **com nota pessoal**. Entram na
lista e em prateleira nenhuma — por isso a soma das prateleiras é menor que o total, e a tela
imprime "4 com nota e sem status" em vez de esconder a diferença.

🔴 **As prateleiras são conferidas no LOAD.** Seis (`lendo`, `pausadas`, `terminadas`, `quero`,
`descartadas`, `reler`), derivadas dos flags de `personal_status` — menos duas uniões que a
tabela não descreve e que são nomeadas por SLUG com falha alta: `pausadas` (`on-hold` +
`stalled`, porque nenhum flag as separa de Reading/Started) e `reler` (`read_again`, que é
`tracks_progress` e cairia em "lendo"). O risco não é o rename: é o status NOVO, que sem a
conferência sumiria da página **em silêncio** — presente no total, ausente de toda prateleira.

⚠️ **A contagem do chip sai das MESMAS obras que a lista abre**, nunca de um `count` à parte:
chip dizendo 78 sobre uma prateleira que abre com 71 é "dois critérios pro mesmo fato" a dois
centímetros um do outro. Conferido no app: cada prateleira abre exatamente o número do chip.

🔴 **Untracked é ZONA DE ENTRADA, não prateleira.** 693 contra 292 — como aba irmã de
"Terminadas (87)" ela dominaria a página e inverteria o significado dela. MAL e AnimePlanet
também não têm essa aba: obra nunca tocada está no catálogo, não na lista. Aqui ela existe
porque o catálogo já vem populado, mas o gesto é **dar status** (via `setReadingStatusForWorks`,
que já existia), não percorrer a pilha. Ordenada por "chegou por último no catálogo" — ordenar
por Nota Prevista exigiria carregar as ~693 com os joins de nota só pra escolher 12, e triagem
não precisa das melhores.

⚠️ A ordem da lista usa **`roundToDisplayScore`**, não o decimal cru — a mesma invariante que
custou 19.624 pares de empate na Prioridade. E nota ausente vai pro FIM, nunca conta como zero.

Guardado por `tests/unit/my-list/prateleiras.test.ts`, que **enumera a tabela** em vez de listar
os 12 status de hoje.

### As rotas são em INGLÊS, e o nome descreve a PERGUNTA da página

Padronizado em 2026-08-16. A URL era metade em português (`/curadoria`, `/leitura`,
`/preferencias`, `/sobre`) e metade em inglês (`/titles`, `/settings`, `/favorites`), sem régua
que dissesse qual usar — então cada rota nova reabria a escolha. Hoje **toda rota é em inglês**;
os RÓTULOS visíveis (aba, top-nav, busca) continuam em português, como o resto do app.

| rota | o que responde |
|---|---|
| `/catalog` · `/ranking` · `/favorites` · `/recommendations` · `/discover` | o catálogo e as formas de percorrê-lo |
| `/reading` · `/dashboard` · `/import` · `/account` (+`/taste-profile`) · `/preferences` | o que é seu |
| `/my-ai-scores` | "Suas notas de IA": Veredito IA e Interesse, por obra — per-user |
| `/curation/*` | a console do curador — ver abaixo |
| `/login` · `/signup` · `/forgot-password` · `/reset-password` · `/welcome` · `/about` · `/guide` | entrada e institucionais |

🔴 **Três nomes mudaram de SIGNIFICADO, não só de idioma** — e é a parte que se perde ao ler
isto como "tradução":

- **`/titles` → `/catalog`.** A rota dizia "titles" e as três superfícies diziam "Catálogo"
  (nav, aba, busca). Este arquivo já registrava a divergência como curiosidade; ela era a
  família "dois critérios pro mesmo fato", com o lado que a pessoa lê sendo o errado.
- **`/ai-evaluation` → `/curation/works`.** A página é a "Curadoria da Obra" e tem QUATRO abas
  (atributos, digests, fontes, revisão); as filas de IA que davam nome a ela saíram em 08/2026
  pro `/my-ai-scores`. O nome descrevia o que a página **era**.
- **`/fila-recomendacao` → `/my-ai-scores`, rótulo "Suas notas de IA".** O nome velho errava
  nos dois pedaços: "recomendação" não aparece no conteúdo (as abas produzem **Veredito IA** e
  **Interesse**, notas por obra — e existe uma `/recommendations` de verdade, então duas rotas
  dividiam a palavra e quem a levava no nome era a que não a produz), e "fila" promete que algo
  anda sozinho, quando ali nada anda: você filtra, seleciona e dispara ações **pagas**. O
  rótulo mudou junto em **quatro** superfícies — aba do browser, `<h1>`, menu do avatar e
  índice da busca —, porque num item de menu é o rótulo que a pessoa lê, não a URL.
  ⚠️ A aba **Untracked** continua lá e não pertence ao nome (é triagem de status, não nota de
  IA). Fica por ora, por decisão da Ana; o destino natural é a zona de entrada da `/my-list`.
- **`/settings` → `/curation/settings`.** Em inglês, `/settings` e `/preferences` viram um par
  quase sinônimo — e são coisas opostas: config do CATÁLOGO (curador) × gosto PESSOAL. O
  aninhamento diz de quem é cada uma sem depender de ninguém lembrar.

🔴 **A console virou UM prefixo, e esse é o ganho estrutural.** `/curadoria`, `/ai-evaluation`,
`/settings`, `/ai-usage` e `/admin` eram rotas IRMÃS: cinco `layout.tsx` idênticos de 3 linhas +
cinco entradas no `CONSOLE_PREFIXES`. Rota nova da console que esquecesse um dos dois lados
nascia sem sidebar ou **sem gate**, renderizando normalmente. Hoje `app/curation/layout.tsx`
cobre tudo e o middleware tem um prefixo só. `/admin` deixou de existir (só hospedava
`model-metrics`).

⚠️ **O aninhamento criou um caso novo: `/curation` é prefixo dos outros quatro.** Por isso
`isEntryActive` casa a raiz por **igualdade** e o resto por prefixo — um `startsWith` uniforme
acende "Visão geral" nas cinco páginas, com dois `aria-current="page"` na tela. Guardado por
`tests/unit/ui/console-nav-rota-ativa.test.tsx`, que **parametriza o `usePathname`**: o teste
que já existia mockava `/curation` fixo, o único valor em que certo e errado coincidem
(conferido com sonda — 5 dos 6 casos reprovam com o bug).

⚠️ **Todo nome antigo responde 308** (`next.config.ts`), inclusive os filhos, via `:path*`. A
ordem das regras é significativa: `?fav=1` e `/settings/calibration` vêm ANTES das amplas que as
engoliriam. Conferidas as 25 no app rodando. E `/preferences → /preferencias` foi **invertido**,
não apagado.

⚠️ **Os diretórios de MÓDULO foram numa leva SEPARADA, e a separação é o ponto.** O replace das
rotas casava só `"/titles`, nunca `@/components/titles` — o caractere ANTES da barra é o que
distingue referência de rota de caminho de import, e sem essa distinção o mesmo `sed` que
renomeia a URL quebra 92 imports. Depois, num PR próprio, os quatro diretórios em português
viraram inglês: `components/conta` → `components/account`, `components/curadoria` →
`components/curation`, `lib/curadoria` → `lib/curation` e **`lib/arte` → `lib/art`** (esse
escapava da varredura por não parecer português a quem lê rápido). Junto foram os dois símbolos
que sobravam — `CuradoriaConsole` → `CurationConsole` e `ContaTabs` → `AccountTabs`.

🔴 **`components/titles/` (92 arquivos) NÃO foi renomeado, e não é esquecimento.** "titles" já é
inglês, mas o nome está errado por outro motivo: a rota virou `/catalog`, os componentes ali
descrevem uma OBRA, e já existem `components/works/` e `lib/works/`. São três nomes para o mesmo
domínio, e escolher entre eles é decisão de arquitetura, não de idioma — o que esta leva fez foi
só tirar o português da frente.

**O `middleware.ts` gateia DUAS famílias, com exigências diferentes.** Ele refresca a sessão em
toda rota e, só nesses prefixos, decide:

| Lista | Prefixos | Exigência |
|---|---|---|
| `CONSOLE_PREFIXES` | **`/curation`** (um só) | sem sessão → `/login`; logado não-curador → `/` |
| `SIGNED_IN_PREFIXES` | `/account`, `/dashboard`, `/discover` | sem sessão → `/login`. **Papel não importa** |

🔴 **A primeira lista tinha CINCO prefixos até 2026-08-16, e virar um só foi o ponto da
renomeação — não o inglês.** `/curadoria`, `/ai-evaluation`, `/settings`, `/ai-usage` e `/admin`
eram rotas IRMÃS na raiz do `app/`: cada uma precisava ser lembrada aqui **e** ter um
`layout.tsx` de 3 linhas montando a shell. Rota nova da console que esquecesse qualquer um dos
dois lados nascia sem gate ou sem sidebar, renderizando normalmente — nada acusa. Hoje o
aninhamento `app/curation/*` faz os dois trabalhos, e os 5 layouts idênticos viraram 1.

⚠️ Esta tabela já dizia `/account`, `/dashboard` quando o código tinha três — `/discover`
entrou sem passar aqui.

**Todo o resto segue sem gate de rota** — visitante anônimo carrega `/catalog`, `/reading`,
`/favorites`, `/ranking`, `/import` e `/recommendations`, que é o desenho: o catálogo é
compartilhado, e os leitores per-usuário devolvem vazio sem sessão (medido rota a rota em
2026-08-09).

🔴 **As duas listas são separadas porque `/account` e `/dashboard` exigem IDENTIDADE, não papel.**
Herdar a checagem de curador jogaria todo leitor logado pra `/` — trancando fora justamente quem
essas páginas descrevem. Daí o `if (!isConsole) return response` logo depois do `if (!user)`.

🔴 **As duas entraram em 2026-08-09 por vazamento MEDIDO, não por precaução.** `/account/taste-profile` e
`/dashboard` anônimos devolviam **200 com o perfil de gosto do DONO** — o resumo em prosa, as tags, a
versão, o alinhamento — com "Entrar" na barra ao lado. Sem sessão, `getCurrentUserId()` cai no
singleton **por design** (o recalc em background precisa do bias dele), então a página tinha um
sujeito: o errado.

⚠️ **Não dá pra corrigir só trocando o leitor por `getSessionUserId()`** — sem sessão a página não
tem sujeito nenhum. Mas gate de rota também não basta sozinho: `getTasteProfileStatusAction` é
consumida por **três** páginas (`/dashboard`, `/recommendations`, `/account/taste-profile`), então ela devolve
um `ProfileStatus` vazio sem sessão e repassa o `userId` adiante. Rota + fonte, as duas.
Guardadas por `tests/unit/orchestration/rotas-de-sessao.test.ts` (que **deriva** os diretórios de
`SIGNED_IN_PREFIXES` — a 1ª versão tinha `app/account` fixo, e foi assim que o `/dashboard` passou
enquanto o `/account` era corrigido) e por `leitores-por-sessao.test.ts`.

🔴 **Gate de rota NÃO funciona só no layout.** A 1ª versão fazia `notFound()` no layout da console e
o Next devolvia **200 com o HTML da página protegida no corpo**, seguido do 404: layout e página
renderizam em PARALELO, então o `notFound()` chega depois de o stream ter começado. O proxy roda
antes de qualquer renderização — é o único ponto onde a decisão cabe. O `notFound()` do layout ficou
como 2ª linha (matcher pode mudar; e o proxy é fail-OPEN quando o usuário está logado mas não tem
linha em `user_settings`, caso que só `isCurrentUserAdmin()` resolve, pois precisa da service role).

**A home (`/`) é uma VITRINE, e bifurca por sessão.** Não é mais o painel de KPIs — esse virou
`/dashboard` ([[project-painel-provisorio]], provisório de propósito).

- **Com sessão:** destaque "Continue lendo" escolhido pela banda **Acompanhando** da `/reading`
  (`lib/reading/pace-bands.ts`, ≥85% lido + leitura recente, desempate por capítulo mais novo),
  faixa de atividade e prateleira "Pra você hoje". ⚠️ `getContinueReading` ordena por última
  LEITURA e corta no limite **antes** de qualquer seleção — pedir poucos itens esconde do
  destaque a obra que acabou de receber capítulo (foi bug real).
- **Sem sessão:** `components/home/public-home.tsx` — raio-X dos 9 critérios de uma obra,
  prateleira por `platform_avg` (com piso de votos), rodapé pra `/about` e `/guide`. Nada
  pessoal: sem sessão os leitores per-usuário devolvem vazio, e o que existia ali antes eram os
  dados do dono.

🔴 **"Pra você hoje" corta por STATUS PESSOAL, não por "ainda não avaliou"** (2026-08-11,
`getTopPicksForToday`). O corte antigo era `user_score == null`, e ele deixava passar tudo que
está EM CURSO: a prateleira oferecia como novidade obras em Reading/Started/On-hold, logo abaixo
de um "Continue lendo" que existe justamente pra essas. Hoje entram só as **não-começadas**
(`is_unread` → Want to Read e Untracked) **+ Read Again**, via `isPickablePersonalStatus`.
Medido no clone local: 739 candidatas de 978 — a prateleira não fica magra.

⚠️ **Não há coluna em `personal_status` que descreva essa união**, então "Read Again" é nomeado
em `status-lookups.ts` — pelo SLUG, via `personalStatusNameBySlugOrThrow`, que ESTOURA num
rename. Guardado por `tests/unit/home/prateleira-pra-voce-hoje.test.ts`, que **enumera a tabela
inteira** em vez de listar os três nomes: status novo no Supabase vira falha em vez de entrar na
prateleira sem ninguém decidir nada.

⚠️ **`personalStatusNameOrDefault` é obrigatório no filtro**: obra sem linha no espelho tem
`personalStatusId` NULL e APARENTA "Want to Read". Sem ele, a conta nova — que não tem linha
nenhuma — veria a prateleira vazia. E o rótulo (`why`) segue o corte: "que você ainda não leu"
descrevia o corte antigo e mentiria sobre as de releitura.

⚠️ **Efeito conhecido, não bug:** "Read Again" é obra JÁ LIDA, logo costuma ter `user_score`, e a
Nota Prevista dessas é **in-sample** (o Ridge treina nas obras com rótulo). Elas tendem a subir
nesta ordenação por construção. No retrato de 2026-08-11 são só 2 obras e nenhuma entrou no
top 12 — mas não conte com isso.

⚠️ **Rótulo depende da publicação:** "quase no fim" só vale pra obra concluída; em `Ongoing` a
mesma banda quer dizer "quase em dia" (você está alcançando os lançamentos, não terminando).

**A navegação é uma BARRA SUPERIOR** (`components/layout/top-nav.tsx`), desde 2026-08-02 — a
sidebar de 13 itens foi removida. A régua original ("o topo é sobre obras, o avatar é sobre você")
**quebrava no primeiro item** — "Minha lista" era sobre VOCÊ e morava no topo — e foi trocada em
2026-08-07 por uma régua de **pergunta**, não de assunto:

| Zona | Pergunta | O que entra |
|---|---|---|
| Esquerda | "pra onde eu vou?" | destinos, hoje **6**, **todos planos** — sem dropdown |
| Centro | "onde está aquilo?" | a busca (⌘K), elástica 190–460px |
| Direita | "o que está acontecendo?" | só o que tem **número ou estado** |
| Avatar | "coisas minhas" | conta, preferências, importar, painel, **a fila de recomendação** |

Hoje: `Minha lista · Acompanhamento · Favoritos · Catálogo · Ranking · Recomendações`, com **o
logo fazendo o papel de Início** (`aria-current` + estado ativo). Saíram: "Explorar ▾" (menu de
UM item) e o relógio da fila (que duplicava um item que já estava dentro do menu).

⚠️ **"Minha lista" já esteve aqui como DROPDOWN e foi removido em 2026-08-07** — ele enterrava
Acompanhamento e Favoritos um clique abaixo. Voltou em 16/08 como **destino plano**, apontando
pra `/my-list`, que é outra coisa: uma rota de verdade, não um menu.

🔴 **O teto de 5 caiu por MEDIÇÃO, e ela achou um defeito que já existia.** Playwright, curador
logado, fonte real, 20 combinações: o nav vai de **531 → 629px (+98)**. Mas "quem encolhe é a
busca" só vale até o `min-w-[190px]` dela — abaixo disso o gatilho **transborda pra esquerda por
cima do nav**, e como o contêiner é `min-w-0` o `scrollWidth − clientWidth` fica **0** nas 20
combinações: invade sem corte, sem rolagem, sem erro. **Com 5 destinos isso já acontecia a 980px
(16px);** com 6 seriam 113px.

✅ **Consertado subindo o degrau do ícone da busca de `md:` (768px) para `xl:`** — a "ordem do
sacrifício" abaixo sempre prometeu esse degrau, mas ele estava ~500px abaixo de onde a barra de
fato aperta. Remedido no app depois: 1600/1440/1280 com o campo (460/441/281px) e 1100/980 com
o ícone (36px), **zero invasão em todas**. ⚠️ O preço é real: entre 768 e 1280 a busca perde o
campo e vira só o ícone (o ⌘K segue).

⚠️ **Destino que não funciona pra quem está vendo não ocupa vaga.** `/recommendations` é per-user
do topo ao rodapé e `/ranking` ordena pela Nota Prevista com presets de alguém — então os dois
exigem `requiresSignedIn`, no topo **e** na bottom-nav. Ao visitante sobra Catálogo + busca +
"Entrar". Guardado por `tests/unit/orchestration/top-nav-regua.test.ts`.

### A busca (⌘K) abre VAZIA e é ancorada no TOPO

Duas correções de 2026-08-11 em `components/search/global-search.tsx`, ambas do tipo que não
quebra nada e só atrapalha quem usa:

- **Sem termo, `matches` é `[]`.** O diálogo abria despejando o índice inteiro (~40 seções de
  Configurações/Preferências/Páginas) na frente do campo que a pessoa veio usar. ⚠️ Isso não é o
  mesmo que "filtrar por termo vazio": `visible` (o que o PAPEL alcança) continua sendo a fonte
  dos chips de escopo.
- **`top-[68px] translate-y-0` no `CommandDialog`.** O `DialogContent` padrão é
  `top-1/2 -translate-y-1/2`, e num diálogo cuja ALTURA depende do resultado isso move a borda
  de cima a cada tecla — o campo de busca escorrega debaixo do cursor. Medido no app com o topo
  fixo: `top` não se move nos quatro estados (0 → 8 → 5 → 0 resultados) enquanto a altura vai de
  156 a 548px; só a borda de baixo acompanha. ⚠️ O `translate-y-0` é obrigatório junto do
  `top-*`: sem ele o −50% do padrão sobrevive e o topo volta a depender da altura.

  ⚠️ **68px é DERIVADO da barra**: `h-14` (56) + 1px de borda + 11px de respiro. Se a barra
  mudar de altura, o respiro muda junto e nada avisa. A 1ª versão usava `10vh`/`sm:14vh`, e o vh
  trabalhava contra no pior caso — quanto mais baixa a janela, mais a lista quer espaço e mais o
  topo descia junto: a 650px de altura dava 91px de topo e **81px** de folga no rodapé, contra
  **104px** com o topo fixo.

🔴 **Centralizar o CAMPO de busca na barra não cabe — é geometria, não gosto.** Medido em
2026-08-11 com a barra de curador (logo 111 + 5 destinos 539 = **650px** à esquerda contra
**~174px** à direita): a largura máxima de um campo centrado é **148px** a 1691px de janela,
**28px** a 1440 e **negativa a partir de 1280** — daí o nav já cruza o centro geométrico. O
mínimo do campo é 190px e hoje ele tem 460px. A barra é assimétrica por desenho (a zona
esquerda são os destinos), então o meio da barra cai DENTRO do nav. Alinhar campo e painel só é
possível movendo o PAINEL até o campo, nunca o contrário — e aí volta a valer o ⚠️ de que o
gatilho é elástico (190–460px) e muda de lugar com papel e badges.

Guardado por `tests/unit/search/busca-global-abre-vazia.test.tsx` — teste de **RENDER** de
propósito, e com uma contraprova dentro. ⚠️ A 1ª versão dele passava verde com o bug ainda no
lugar: os papéis são em **português** (`"curador"`, não `"curator"`), e com um nome inválido
`roleAtLeast` compara `undefined >= undefined` → `false`, o índice fica vazio por motivo errado e
"nenhum item na tela" vira tautologia. Daí o 2º caso, que digita e exige itens > 0.

### A aba do browser diz o nome da PÁGINA, e o sufixo tem um dono só

Até 2026-08-14, **18 das 30 rotas** não declaravam título nenhum e a aba dizia **"SatorIA"** nas
18 — `/ranking`, `/favorites`, `/reading`, `/catalog`, `/account/taste-profile`, `/curation/settings`,
`/curation/requests` e mais 11. Com três abas abertas (o caso normal aqui), as três eram
indistinguíveis: só clicando pra descobrir qual era qual.

Hoje o **`title.template` do `app/layout.tsx` é o dono do sufixo** (`"%s · SatorIA"`), e cada
rota declara **só o próprio nome** (`export const metadata = { title: "Ranking" }`).

🔴 **O sufixo era escrito à mão, em DUAS grafias** — `— SatorIA` nas 9 institucionais e
`· SatorIA` na página da obra. Dois critérios pro mesmo fato, sem nada que os fizesse concordar.
⚠️ Reescrever o sufixo numa página agora produz "Ranking · SatorIA · SatorIA"; quem precisar da
aba sem ele usa `title: { absolute: "…" }`. E `generateMetadata` sem título resolvido devolve
`{}` (herda o `default`) — devolver `"SatorIA"` passaria pelo template.

⚠️ **Rota dinâmica só deriva o nome se a leitura for BARATA**, porque `generateMetadata` roda
numa passada separada da página: o custo é pago duas vezes por visita. `/favorites/[listId]` usa
`getListName` (1 linha, 1 coluna, escopada por dono) e **não** `getListDetail`, que carrega as
obras membras; `/recommendations/[slug]` e `/recommendations/chat/[slug]` ficaram com nome
ESTÁTICO em vez de repuxar a rodada inteira ou o JSONB de mensagens.

⚠️ **Isto NÃO é derivado de `PAGES` (`search-index.ts`) nem do `NAV` (`top-nav.tsx`)**, de
propósito: os rótulos de lá são de busca e de navegação, mais longos ("Importar minha lista",
"Sobre a SatorIA"), e a aba trunca. As três superfícies já divergiam antes disto (a `/catalog` é
"Títulos" no Header e "Catálogo" no nav).

Guardado por `tests/unit/orchestration/titulo-de-aba-por-rota.test.ts`, que **deriva as rotas do
filesystem** — lista fixa não acha a página que alguém adicionar amanhã, que é justamente o caso
— e reprova tanto rota sem título quanto sufixo reescrito à mão (conferido com uma sonda: os dois
falham).

🔴 **A regra "ícone e não item de menu, porque dentro de dropdown o número não é visto" continua
verdadeira** — o que mudou é que agora o **contador vive no gatilho**. Foi isso que permitiu
recolher fila de curadoria + saldo + alerta de fontes no `CurationMenu` (badge = curadoria +
pedidos, ponto âmbar para saldo/fonte) e a fila de recomendação no avatar. **Se o badge sair, os
ícones soltos têm que voltar.** Guardado por `tests/unit/ui/chrome-counters-on-trigger.test.tsx`
— e é teste de RENDER de propósito: a primeira versão varria o source atrás de `recQueue > 0` e
passava com o badge desligado, satisfeita pela mesma expressão no `title` do botão.

🔴 **O ponto SOZINHO não funcionou, e o conserto foi dar-lhe voz** (2026-08-14). Um círculo de
8px provoca "o que é isso?" e cobrava uma navegação até `/curation` pra responder; o `title=`
nativo dizia *"saldo ou fonte externa precisando de atenção"* — uma frase que serve pros dois
problemas e não identifica nenhum. Hoje um tooltip nomeia cada alerta **com o número**
(`Saldo da Anthropic: −$11,10`), e o `aria-label` carrega o mesmo texto.

⚠️ **A COR e o TEXTO saem da mesma lista** (`lib/curation/chrome-alerts.ts`): `alertDotTone`
reduz exatamente os alertas que o tooltip imprime. Um `if` de cor escrito à parte no JSX é como
o ponto fica vermelho e a explicação fala do problema âmbar — a família "dois critérios pro
mesmo fato", aqui a dois centímetros um do outro.

⚠️ **A lista é COMPLETA, nunca "o pior".** Saldo negativo E Comix fora do ar dividem um ponto
só; mostrar apenas o mais grave faria resolver aquele apagar o alerta do outro. Guardado por
`tests/unit/ui/ponto-de-alerta-curadoria.test.tsx` (RENDER, porque o que regride é o componente
deixar de consumir a lista — um teste da função pura passa verde com o `if` paralelo no JSX).

🔴 **Saldo NEGATIVO não espera hover: abre modal** (`components/layout/negative-balance-dialog.tsx`),
**1× por sessão do browser** (`sessionStorage`), com os dois destinos que resolvem — créditos na
Anthropic e reinformar em `/curation/ai-usage`. Saldo BAIXO **não** abre: âmbar informa, vermelho
interrompe; um modal por sessão enquanto o saldo acaba é o alarme que se aprende a fechar sem
ler, e aí ele também não funciona no dia do negativo.

⚠️ **O modal não afirma que a conta zerou** — o app não consulta a Anthropic, ele subtrai o
gasto do último valor digitado. "Negativo" pode significar "você recarregou e não avisou o app",
e o texto diz isso; sem essa frase o aviso manda recarregar uma conta que talvez já tenha saldo.

⚠️ **`LOW_BALANCE_USD` caiu de 5 para 2** na mesma leva (escolha da Ana), e a comparação virou
`<` — exatamente $2 ainda é folga. O limiar é dono único, então o ponto, o tile da Visão geral e
o card de `/curation/ai-usage` mudaram juntos; o `balance-card.tsx` passou a derivar de `balanceTone` em
vez de reescrever `remaining <= LOW_BALANCE_USD`, porque o NÚMERO já era compartilhado mas a
COMPARAÇÃO não era — e foi ela que mudou.

⚠️ **Curadoria é MODO, não ação pontual — e por isso o `CurationMenu` deixou de ser menu**
(2026-08-07). Hoje é um **botão-link** pra `/curation`: badge + ponto colorido, sem dropdown.
Três coisas convergiram:

1. **A régua da própria barra o contradizia.** A zona direita responde "o que está acontecendo?"
   — *só o que tem número ou estado*. Seis links de navegação são a pergunta da zona ESQUERDA.
   O badge pertencia ali; os destinos, não. Eles entraram de carona quando o menu foi criado
   pra consolidar três SINAIS (fila, saldo, saúde de fonte).
2. **O curador também é leitor, e os dois focos não se intercalam.** Ninguém "gerencia um pouco
   enquanto procura o que ler". Oferecer atalhos pra dentro da console a partir de qualquer tela
   comunicava o contrário e enfraquecia a console, que já é o lugar.
3. **A conta de cliques nunca sustentou o menu**: 2 cliques em 5 dos 6 destinos, igual ao
   botão-link — o dropdown só ganhava na Visão geral, o destino menos visitado.

🔴 **O que mudou de verdade é onde os SINAIS moram.** Saldo e saúde de fonte desceram pra
`/curation`; na barra ficou só o ponto colorido dizendo "algo lá precisa de você". Isso torna a
Visão geral **obrigada a explicar o badge inteiro** — ela é a única superfície de triagem que
sobrou. Duas consequências que se pagam caro se forem esquecidas:

- As parcelas do badge saem de **`lib/curation/decision-queues.ts`**, iterada pelos DOIS lados
  (soma do gatilho e `buildDecisions` da página). Enumerar de novo é como os **Pedidos entraram
  no badge e nunca chegaram na página** — um "3" no botão que podia ser 3 pedidos de leitor, com
  a página que devia explicá-lo sem mencionar nenhum. O tipo `Record<DecisionQueueKey, number>`
  faz o `tsc` reprovar os dois consumidores quando uma fila nova aparece (medido).
- O limiar de saldo baixo é **`lib/ai-usage/balance.ts`** (`LOW_BALANCE_USD` + `balanceTone`).
  Estava copiado em dois arquivos; uma terceira cópia é como o ponto alerta e a página pra onde
  ele aponta mostra verde. ⚠️ Os tons são **exclusivos**: saldo negativo NÃO é `"low"` — use
  `balanceAlerting()`, senão o ponto some no pior caso.

⚠️ **Aberto, não esquecido:** abaixo de `xl` o botão é só o ícone 🔧 sem rótulo. Porta fraca pra
um modo de primeira classe — mas dar rótulo permanente reabre a conta de largura (ver a ordem do
sacrifício abaixo).

⚠️ **A ordem do sacrifício.** Quando a barra não cabe, cede nesta ordem: rótulo do "Recalcular
notas" → nome no avatar → rótulo de "Curadoria" → a busca vira ícone. **Os destinos e os
contadores nunca cedem** — por isso a nav é `shrink-0` e quem encolhe é a busca. Na 1ª versão era
o contrário e o texto do link transbordava por cima do vizinho, sem nada acusar. Medido em 14
combinações papel × largura: o pior caso (Curador em 980px com recalc + tarefa + saldo baixo +
Comix instável) fecha em 968 de 978px.

⚠️ **Ação lenta na barra tem dono:** o chip e a faixa de tarefas em segundo plano vivem no
`top-nav.tsx` e são desenhados por `components/tasks/top-nav-tasks.tsx`. Ver a seção
**"Ação lenta tem DUAS cores"** — inclusive por que `components/tasks/sidebar-tasks.tsx` foi
apagado (ficou órfão quando a sidebar saiu, e o feedback sumiu sem nada acusar).

**A console `/curation`** (`components/curation/console-shell.tsx`) é o terceiro braço dessa régua,
desde 2026-08-03 — o 🛠 da barra aponta pra ela. Sidebar PRÓPRIA de dois níveis com Visão geral ·
Curadoria da Obra · Configurações (+ os 4 tópicos) · Uso da API IA · Métricas do modelo. Cada rota
membro entra por um `layout.tsx` de 3 linhas que renderiza a shell — o gate e a sidebar vêm dela.

- ⚠️ **`/curation/settings` PERDEU a `SettingsSubnav`**: os 4 tópicos viraram o ramo "Configurações" da
  sidebar da console. Continuam sendo `?g=` na mesma rota (nenhum deep-link quebrou, inclusive o
  `/curation/settings?g=fontes` do alerta do Comix). `SettingsSubnav` segue viva, para `/preferences`.
- ⚠️ **"Desatualizados" ficou de FORA**, apesar de constar no plano: virou aba de
  `/my-ai-scores` e é de qualquer logado. Item de console que joga o usuário pra fora da
  console é pior do que item ausente. `/ranking/desatualizados` segue como redirect.
- Os contadores da sidebar e os da barra superior saem de **um fetch só**
  (`components/layout/chrome-badges.tsx`, no layout raiz). O coalescing do `useChromeData` é por
  instância — um hook em cada consumidor duplicaria `getSettingsItemPending` (que puxa LINHAS, não
  `count: exact`) e o gatilho do auto-recalc.

**Toda rota é dinâmica (`ƒ`) — e agora POR ESCRITO.** `app/layout.tsx` declara
`export const dynamic = "force-dynamic"`. 🔴 **Não remova sem substituir por outra garantia.**

Motivo: o app é inteiramente per-user, e uma rota prerenderizada congela no HTML do build o que
era verdade pra quem (ou ninguém) estava logado naquele instante — e serve isso pra todo mundo,
**sem erro e sem log**. É a mesma classe do "anônimo vira dono" ([[gotcha-anonimo-vira-dono]]),
por outro mecanismo.

Até 2026-08-02 essa garantia existia **por acidente**: o layout lia `cookies()` pro colapso da
sidebar, e isso bastava pra marcar tudo como dinâmico. Quando a sidebar virou barra superior o
`cookies()` saiu junto e a rede caiu — nada apontava pra ela. Daí a linha explícita.

O preço: as institucionais (`/about`, `/guide`, `/login`, `/signup`) perdem prerender. Pra liberar
essas, **meça**: `next build`, ler a tabela `ƒ`/`○`, marcar rota a rota. Nunca apagar a linha e
torcer. ⚠️ Um grep por `cookies()` **não** responde quem é dinâmica: a detecção do Next é
transitiva (`/favorites` não cita `cookies()`, mas chama `getPersonalStateReader` →
`getSessionUserId` → `cookies()`).

`lib/sidebar-preference.ts` segue no repo como documentação do padrão cookie-vs-localStorage, sem
uso funcional.

```
app/              – Next.js routes (server components by default)
components/       – React components ("use client" where needed)
server/
  actions/        – "use server" functions called directly from client components
  queries/        – server-only DB read helpers (no "use server" directive)
lib/
  ai-evaluation/  – Claude API integration (service.ts)
  calculations/   – deterministic scoring pipeline
  constants/      – GENERATED files (do not edit by hand)
  external/       – third-party API integrations + multi-source merge logic
  format/         – formatação de valor pra tela (money.ts é o dono único de USD)
  import/         – GENERATED files + CSV/XLSX import pipeline
  ml/             – Ridge regression for Nota Prevista / expected_score (pure TS, no native deps)
  supabase/       – client factories
  validations/    – Zod schemas
types/domain.ts   – canonical domain types (partly GENERATED)
scripts/sync-constants.js – DB → TypeScript code generator
supabase/migrations/ – SQL migration history
```

## Ação lenta tem DUAS cores, e elas dizem coisas opostas

Toda ação que demora precisa dizer que está viva. Qual indicador usar depende de **uma
pergunta só: o resultado sobrevive se a pessoa sair da tela?**

| | **Azul — durável** | **Âmbar — request-scoped** |
|---|---|---|
| Critério | grava no banco enquanto roda | o resultado só existe na tela |
| Onde mora | barra superior (segue a navegação) | dentro do diálogo/painel que disparou |
| Promessa | "pode navegar, te aviso ao terminar" | "fique aqui, senão perde" |
| Código | `lib/tasks-store.ts` + `components/tasks/top-nav-tasks.tsx` | `components/tasks/scoped-task.tsx` |

Trocar as duas é um erro **silencioso e caro**: pôr uma ação scoped no azul é convidar a
pessoa a navegar e jogar fora o trabalho dela; pôr uma durável no âmbar prende alguém numa
tela por 33s à toa. **Não deduza pelo nome da action** — confira se ela escreve:
`grep -E 'insert|upsert|update\(' ` no corpo dela. Foi assim que `proposeFavoriteGroups`,
`suggestScoreWeights` e `suggestPostReadingWeights` mudaram de lado: parecem duráveis, só leem.

### Azul: `runTask` (`lib/tasks-store.ts`)

Store de MÓDULO (não estado de componente), então sobrevive à navegação client-side: o store
DONA a promise, e o toast de conclusão + `refreshChrome()` rodam mesmo com a página que
disparou já desmontada. Desenho no chrome: faixa indeterminada na borda de baixo do
`<header sticky>` (periférica, segue o scroll) + chip com contador que abre o `TaskCard`
sozinho por ~4,5s ao começar — o instante em que o olho ainda está no botão clicado.

🔴 **As server actions daqui devolvem `{ error }` em vez de LANÇAR**, e o `runTask` só
distingue falha por rejeição da promise. Sem `throw new Error(res.error)` dentro do `run`, o
indicador anuncia **"pronto" para uma falha** — plausível, errado, sem log. (`refreshEmbeddings`
é a exceção: essa lança.) Guardado por `tests/unit/ui/rerank-task-error.test.tsx`.

⚠️ **`successToast: () => null` quando o desfecho tem mais de um tom.** Embeddings (nada a
fazer / parcial / ok) e aplicação de clusters de tags (`errors[]` = sucesso PARCIAL) seriam
achatados em "success" pelo toast padrão, e o caso de falha sumiria.

⚠️ **Lote usa `setTaskProgress(id, done, total)`** → barra determinada + "3/12" no card. O
`runTask` não conta sozinho; quem itera avisa. A função é no-op se a tarefa não está mais
`running`, senão o laço do caller ressuscita tarefa já dispensada.

### Âmbar: `useScopedGuard` + `ScopedTaskStrip` (`components/tasks/scoped-task.tsx`)

🔴 **A porta de saída depende de a ação morar num modal ou solta na página, e isso não é
intuitivo.** `Dialog`/`Sheet` do Radix são **modais**: o scrim já bloqueia clique fora, então
o link da barra nem é alcançável — a porta real é **fechar o diálogo**. Só ação solta numa
página usa `guardNavigation: true` (interceptação de clique em fase de captura). Ligar
`guardNavigation` numa modal cria um interceptador global que nunca dispara: código morto com
cara de proteção. Guardado por `tests/unit/orchestration/scoped-guard-placement.test.ts`.

⚠️ **Fechar por fora do `onOpenChange` escapa da trava.** O X do `WorkCompareDrawer` chamava
`onOpenChange(false)` direto — todo caminho de fechamento tem que passar pelo `guard`.

🔴 **Voltar/avançar do browser NÃO é coberto** — limitação aceita, não esquecimento. Cobrir
exigiria empurrar entrada falsa no histórico e interceptar `popstate`, o que quebra o botão de
voltar para o app inteiro. `beforeunload` cobre fechar/recarregar a aba; o botão de voltar sai
direto e perde o resultado.

⚠️ **O cronômetro conta TICKS, não `Date.now() - início`**: o lint (`react-hooks/purity`)
barra `Date.now()` no render. O preço é subcontar com a aba em segundo plano — aceitável,
porque a faixa âmbar existe justamente para quem está olhando a tela.

⚠️ **Cronômetro e não barra determinada**: nessas ações não dá pra saber quantas fontes vão
responder, e progresso inventado mente pior do que progresso nenhum.

### Cobertura atual

**Azul (durável):** avaliar IA · recomendar (e por grupo) · digest · gerar tudo · buscar
reviews · inferir tags · regerar sinopse · perfil de gosto · re-rank (obra, lote, cluster,
re-rodar run) · Interesse em lote · deep dive · auditoria de calibração · relatório de viés ·
regenerar artefatos calibrados · embeddings · aplicar clusters e grupos de tags ·
enriquecimento em lote do `/import`.

**Âmbar (scoped):** "Buscar dados" · "Atualizar dados" · desempate de cluster · sugerir grupos
de favoritos · sugerir pesos (IA e pós-leitura).

**Fora dos dois, de propósito:** recalc (tem `RecalcPendingControl` próprio na barra) · chat de
recomendação (UI própria) · resolvedor Comix (job com painel de polling).

🔴 **Pendências conhecidas, não escondidas:**
1. **Reload zera o indicador azul** (store em memória). A ação continua e persiste; só o
   desenho some. Reconstruir pede ler `ai_evaluations.status='processing'` no load.
2. ✅ **Previsão de Interesse POR OBRA ganhou indicador (2026-08-14).** O bloqueio era real e
   a saída não exigiu refatorar o helper: a confirmação de custo é **recursiva** (a 1ª chamada
   volta `blocked_cost_confirmation`, abre modal e re-chama a si mesma), então a tarefa envolve
   só a chamada **de dentro** — a que já passou pelo modal. Em volta da chamada inteira, o
   indicador anunciaria "rodando" enquanto o modal espera clique, afirmando trabalho que pode
   nem começar. Azul (grava `taste_profile` + `synopsis_quality_predictions`), `id` por obra,
   e cobre os TRÊS caminhos: cascata confirmada, "prever com o perfil atual" e a confirmação
   simples. Sintoma que existia: confirmar "Atualizar perfil e prever" fechava o modal e
   deixava a tela ~40s idêntica (perfil 33,4s + previsão 4,9s). Guardado por
   `tests/unit/ui/interesse-por-obra-tem-indicador.test.ts`, que testa os dois lados — que a
   tarefa aparece depois da confirmação **e** que ela NÃO aparece enquanto o modal decide.
3. **Latências medidas** (`ai_api_calls.latency_ms`, p50): perfil de gosto **33,4s** ·
   ranking **14,0s** (p90 47,9s) · digest 13,4s · avaliação IA 17,5s · tags 7,6s · Interesse
   4,9s. Deep dive **sem medição** (zero linhas locais).

## Cor de ESTADO tem um significado só — e o âmbar é do "desatualizado"

Irmã da seção acima (lá a cor diz *onde a ação vive*; aqui ela diz *o que fazer com o
resultado*). Dono único: **`lib/ui/status-tone.ts`** (`STATUS_TONE` + `STATUS_CHIP_BASE`).

Até 2026-08-12 o âmbar dizia **cinco coisas** na mesma página da obra: "Desatualizado"
(Veredito), "Previsão desatualizada" (Interesse), "Inputs: média", avisos de conteúdo,
"síntese corrompida" e "inferência de tags: nunca rodou" — os dois primeiros **no mesmo
card**. Quando tudo é âmbar, nada é urgente: o que CHAMA AÇÃO some no meio do que só
descreve.

| tom | quer dizer | onde |
|---|---|---|
| **`stale`** âmbar | existe, mas os inputs mudaram ⇒ não aplique sem refazer | Veredito · Interesse · Estrutura de abertura · IA-Rk |
| `pending` sky | nunca rodou / está na fila ⇒ falta uma ação sua | "inferência de tags: nunca rodou" |
| `ok` emerald | confirmado, aplicado | "Aplicado" do Interesse |
| `failed` rose | quebrou, corrompeu, falta input obrigatório | digest corrompido · reviews curtas demais |
| `content` red | fato sobre a **obra**, não sobre o sistema | avisos de conteúdo · 🔞 18+ |
| `absent` slate | ausente / não se aplica | "Evidência insuficiente" da abertura |

🔴 **O âmbar ficou com o `stale` por FREQUÊNCIA, não por gosto** (escolha da Ana,
12/08/2026): "desatualizado" aparece em quatro pontos da página e é o estado mais
acionável dela. Os avisos de conteúdo foram pro vermelho do 🔞 — os dois falam da obra,
e ali a proximidade é coerência.

⚠️ **Confiança dos inputs deixou de disputar cor.** `InputConfidenceSeal` é passivo (não
pede ação), então o nível virou **forma**: três pontos, N acesos, com cor só nos extremos
(alta emerald · média slate · baixa rose). Ele fica a dois centímetros de "Previsão
desatualizada" no card do Interesse — eram os dois âmbares.

⚠️ **Escala de VALOR não é estado.** Nota, similaridade, alinhamento e Veredito são rampas
contínuas e vêm sempre com o número ao lado (`8,4`, `72%`); elas seguem usando amarelo no
meio da rampa. O que a régua proíbe é **chip de palavra** em âmbar que não seja
"desatualizado".

⚠️ **Violeta fica FORA da régua**: `✨` é procedência ("quem escreveu isto"), não estado.

🔴 **Estado fica junto da SAÍDA dele — não no rodapé** (2026-08-15, card do Interesse). O
"Previsão desatualizada" era a última linha do bloco, **depois** da justificativa: ~230px
abaixo do único botão que o desfaz e, pior, **depois da seta de aplicar** — ou seja, era lido
quando já não servia pra nada. Hoje é chip âmbar no cabeçalho, encostado no botão, e o rótulo
do botão acompanha o estado (`lib/ui/interest-predict-label.ts`): "Atualizar previsão" só
quando desatualizada, "Prever de novo" quando fresca. Prometer "atualizar" sobre previsão
fresca é oferecer conserto pro que não está quebrado — numa chamada que CUSTA (**1,44¢**,
média medida em 295 chamadas de `synopsis_quality_predict`).

⚠️ **Desatualizada é a REGRA, não a exceção — e isso limita onde o chip cabe.** Medido em
2026-08-15 no clone local, sobre a previsão ATIVA de cada obra (prefere `v4`, cai pra `v3`):
**815 obras têm previsão e 728 estão stale — 89,3%**. Num card de UMA obra o chip informa;
numa COLUNA de lista ele pintaria 9 em 10 linhas e viraria o alarme que sempre toca (mesma
régua do `db:health` e do painel "Estado da obra"). Por isso no `/ranking` o "Desatualizada"
segue **dentro do tooltip** do badge de Interesse, e isso é escolha medida, não esquecimento.

⚠️ **ABERTO, e o inventário já está feito — não re-derive.** `WorkQueueCard`
(`components/ai-evaluation/queue/work-queue-card.tsx`) tem paleta PRÓPRIA (`TONE_CLASS`) e o
tipo é nomeado por **cor** (`tone: "amber"`), não por papel — então a régua acima é inaplicável
ali **por construção**: quem chama escolhe a cor direto. São 12 chips em 4 painéis, e traduzir
não é mecânico:

| chip | hoje | pela régua |
|---|---|---|
| "Desatualizado" ×2 · "Aguardando revisão" · "sinopse curta" | amber · sky · rose | `stale` · `pending` · `failed` ✓ |
| "Não previsto" · "Não avaliado" · "Nunca avaliada pela IA" | **slate** | deveriam ser **`pending`** — "nunca rodou ⇒ falta uma ação sua"; slate é "não se aplica", e são exatamente as obras que a fila existe pra resolver |
| "Confiança baixa" | **amber** | não é "desatualizado" |
| "Modelo antigo" · "Reviews novas" | rose · orange | sem papel óbvio |

🔴 **E este arquivo se CONTRADIZ sobre o "Confiança baixa".** A seção do `STATUS_TONE` diz que
âmbar é exclusivo do "desatualizado"; a seção do `/curation/works` descreve, com aprovação, *"o
chip âmbar diz só 'Confiança baixa'"*. Duas fontes discordando sobre o mesmo fato — não dá pra
unificar a paleta sem escolher qual está errada, e é por isso que isto é PR de **decisão**, não
de refactor. Já saiu daqui o `orange` do "Diverge" (ver a tabela de "dois critérios").

⚠️ **`border-<cor>` não pinta** (o `* { border-color }` do `globals.css` vence utilities no
Tailwind v4) — por isso `box` usa `ring-*` e `outline` carrega `!`. **Medido em 2026-08-14**
no browser com o CSS real: `border-emerald-300` computa `rgb(49, 56, 68)`, o neutro do tema,
igual em qualquer faixa. O mecanismo é o `*` estar **fora de layer** — CSS sem layer vence
`@layer utilities` mesmo com especificidade menor. Não é bug do TW; é ordem de cascata.

### Fundo colorido vai em ALFA, nunca `bg-<cor>-50` sem `dark:`

🔴 O app é escuro por padrão e **não tem seletor de tema** ([[feedback-ver-a-tela-gateada-com-playwright]]),
então fundo claro fixo não é "pior no escuro" — é **branco sobre card escuro em toda visita**.
Medido: `bg-emerald-50` compõe luminosidade **~98%** em lab. Varridas em 2026-08-14 **22 linhas
em 5 arquivos** (`ranking-filters`, `work-form`, `pending-batch-banner`, os dois de avaliação).

A forma: **`bg-<cor>-500/15`** (ou `/20` em botão) compõe com o fundo e serve os dois temas com
UMA classe; só o **texto** ganha `dark:`, porque contraste de texto não é composição. Contorno
colorido usa `ring-1 ring-<cor>-500/40` pelo motivo do ⚠️ acima. É a técnica que `STATUS_TONE`
já usava — o que faltava era aplicá-la fora dele.

⚠️ **O heatmap (`work-heatmap-view.tsx`) fica FORA, de propósito.** Célula preenchida é o
desenho de um heatmap, e a rampa lê bem sobre o escuro — conferido na tela. Alfa lavaria o
gradiente. E a paleta dele tem **12** linhas, das quais um grep por `-50|-100` pega só 9: o
tier `top` é `bg-green-300`. Converter "as que o grep achou" deixaria a rampa meio alfa e meio
sólida, pior que não tocar.

🔴 **Confiança da IA: as CLASSES têm dono, não só os cortes**
(`lib/ai-evaluation/confidence-tone.ts`). Eram **quatro** cópias de `0,75/0,5`, não três — a
quarta (`components/titles/work-form.tsx`) sobreviveu à unificação dos números e só apareceu
nesta varredura. Enquanto cada tela montar a própria string, some uma cópia e nasce outra.

Guardado por `tests/unit/ui/cores-de-estado.test.ts`, que **deriva os tons do próprio
objeto** (papel novo entra na checagem sozinho) e reprova cor repetida entre papéis, e por
um caso de render em `interesse-obra-veredito-pareado.test.tsx` — a colisão é entre
VIZINHOS, e isso só aparece na árvore desenhada.

## O `<SelectValue>` sai VAZIO no SSR — quem o preenche é um portal pós-mount

🔴 **Não é bug do app: é como o Radix funciona.** Quem escreve o texto do gatilho é um
PORTAL que o `SelectItemText` do item selecionado cria, e portal só existe depois do
mount. Logo o HTML do servidor traz o gatilho vazio e ele só é preenchido na hidratação.
Medido em 2026-08-15 na build de PRODUÇÃO contra o banco local:

| | antes | depois |
|---|---|---|
| gatilhos vazios no HTML | **13 em 9 rotas** (nenhum com texto) | **0** |
| tempo com o campo vazio | `/reading` 196–211 ms · `/ranking` 218–370 · `/curation/works` **420–634** | nunca visto vazio (0 de 3 cargas) |

O conserto é passar o rótulo como `children`: **`selectedOptionLabel`**
(`components/ui/select.tsx`).

🔴 **`children` DESLIGA o portal** (`onValueNodeHasChildrenChange`) — o rótulo vira a fonte
permanente do gatilho. Por isso ele TEM que sair da MESMA lista que gera os `<SelectItem>`
(`options`, `SORTABLE_FIELDS`, `SORT_LABELS`…). String escrita à mão ali é "dois critérios
pro mesmo fato" e divergiria em silêncio num rename. ⚠️ Valor sem opção correspondente
devolve `undefined`, o que faz o Radix voltar ao portal — degrada pro comportamento
antigo, nunca pra pior.

⚠️ **Select dentro de diálogo NÃO tem esse flash** — ele só monta quando o diálogo abre,
ou seja, nunca passa por SSR. Por isso a varredura foi por ROTA (contar `select-value`
vazio no HTML servido), não por `grep` de `<SelectValue />`: dos 24 usos, só 13 chegavam
ao HTML. Meça antes de sair editando os 24.

🔴 **E a medição só vale contra o servidor CERTO.** A 1ª rodada depois do conserto deu
"13 vazios" de novo: o `npm start` novo tinha morrido com `EADDRINUSE` e o processo
ANTIGO seguia atendendo a porta, servindo a build velha. O `curl` respondia 200 e o
número era plausível. Confira `lsof -ti:<porta>` e o horário do processo antes de
acreditar num "não mudou nada".

## `shrink-0` com `flex-wrap` no MESMO elemento não encolhe NEM quebra

As duas se anulam. `flex-wrap` faz o container quebrar linha **quando o pai o aperta**;
`shrink-0` é exatamente o que impede o pai de apertar, porque a largura-base vira o
`max-content` — e o `max-content` de um container que quebra linha é **a soma de TUDO numa
linha só**. O bloco trava nessa largura e é desenhado por FORA do pai.

🔴 **É silencioso nos três canais de sempre.** Sem `overflow-hidden` no `Card`, nada é
cortado; sem `overflow: auto`, nada rola; e `document.scrollWidth − clientWidth` continua **0**,
então nem barra de rolagem na página aparece. `tsc` passa, a suíte passa. Só aparece na tela —
foi a Ana quem viu, num screenshot.

Medido em 15/08/2026 no cabeçalho de "Obras parecidas"
(`components/titles/similar-works-card.tsx`), que tinha `sm:shrink-0` ao lado de `flex-wrap`:

| janela | card | controles | vazamento |
|---|---|---|---|
| 1920 · 1600 · 1440 · 1280 | 868px | **855px FIXOS** | 145px |
| 1024 | 684px | 855px fixos | **329px** |

O contador ficava **inteiro** fora do card e "Nota prevista" cortada ao meio. ⚠️ E o card **não
acompanha a janela** — a página é `max-w-6xl` com a coluna da capa fixa —, então o defeito era
constante, não caso de borda.

⚠️ **Quando os controles não cabem numa faixa, divida por PERGUNTA**, a régua da barra superior:
em cima "o que é isto / quantas são / pra onde eu vou"; embaixo "como quero ver esta lista". Foi
o único arranjo que fecha em **altura constante (81px) de 1600 a 1024** — pôr os três controles
juntos numa 2ª faixa dá 3 linhas (122px) em 1024.

⚠️ **jsdom não tem layout** (`getBoundingClientRect` volta zerado), então isto **não é testável
no vitest**; um teste que casasse a string `"shrink-0"` protegeria a grafia, o que esta base
proíbe (ver "Teste de arquitetura tem que casar o FATO"). A verificação é no browser.

## A query string do /ranking é um CONTRATO — e ela fala PONTOS

Os limiares dos 9 atributos (`min_<slug>`/`max_<slug>`) estão **sempre em pontos (0–10)** na
URL. O `/ranking` tem uma unidade **σ** (`?crit_unit=sd`), mas ela é **lente de exibição**: a
UI converte na hora de mostrar e de gravar, e a URL nunca carrega σ.

Não é estilo — é o que mantém correto todo mundo que lê essa mesma query string **sem saber
que σ existe**: `getRanking`, os presets salvos (`ranking_filter_presets` guarda a query
CRUA), o `/favorites` e o `parseFiltersFromSearchParams` do diálogo de recomendação. Numa
primeira versão a URL carregava σ, e `min_romance=-0.5` chegava na recomendação como
"romance ≥ −0,5 **pontos**" — filtro nenhum, sem erro, com resultado plausível.

Corolário de graça: trocar de unidade não reescreve valor, então **nunca muda o resultado**.
Guardado por `tests/unit/orchestration/criterion-unit-url-invariant.test.ts`.

⚠️ **Em eixo normalizado (σ, percentil, log), nada pode ser constante.** Quatro bugs da mesma
família saíram desta feature, todos silenciosos e todos produzindo resultado plausível:
arredondar pro mais próximo em vez de direcional (−54 obras), limiar fora da grade de 0,5 em
que as notas existem (−421 obras), σ na URL lido como pontos por outro consumidor, e domínio
de slider FIXO em vez de derivado dos momentos — este apagava o filtro do usuário, porque o
Radix clampava o valor fora do domínio e o `commit` gravava `null`. Ver
`lib/ranking/criterion-unit.ts`, onde cada um está documentado com o número medido.

## Quem ordena, colore ou agrupa por nota tem que ver o MESMO número da tela

Três invariantes do `/ranking`, todas descobertas pelo mesmo sintoma — resultado plausível na
posição errada, sem erro nem log (2026-08-06):

**1. Arredondamento.** A tela usa `value.toFixed(1)`; o atalho `Math.round(value * 10) / 10`
**não é equivalente** e diverge em **40 dos 1.001 valores de 2 casas** entre 0 e 10 — `value * 10`
é uma multiplicação em ponto flutuante que arredonda ANTES do `Math.round`. Medido: a obra de
`expected_score` 8,35 ordenava como 8,4 e **exibia 8,3**, aparecendo à frente de dois 8,4
legítimos. Use `roundToDisplayScore` (`lib/score-rounding.ts`) em ordenação, faixa de cor,
empate e limiar. Ingestão de dado externo pode seguir com `Math.round` — lá não há número na
tela pra concordar.

**2. A chave da BANDA é a da ORDENAÇÃO.** `buildRankingTiers` devolve alinhado à entrada e quem
consome agrupa RUNS CONSECUTIVOS: bandar pela nota crua uma lista ordenada pela nota exibida faz
o mesmo tier reaparecer várias vezes. Medido: **2 tiers reais viravam 8 blocos "Tier N"** nas 40
primeiras obras (3 → 27 em 200), e na view Faixas ainda duplicava a React key `band-${tier}`.

**3. O tier AGRUPA, não reordena.** Havia um `reorderTiersByFit` no cliente que reordenava cada
tier por `tagOverlapNet` por cima da ordem do servidor, com a premissa falsa de que "dentro do
tier tudo empata" (banda 0,5 cobre 8,5 → 8,0). Ele descartava o 2º nível de ordenação escolhido
**e** a Nota Prevista — a lista saía `8,7 → 8,8 → 8,9 → 9,1 → 8,8 …`. O sinal virou o desempate
FINAL do `getRanking` (depois de todos os níveis, antes do título), então decide só o que
ninguém mais decidiu e vale igual em Lista, Cards, Faixas e Bússola.

🔴 **4. A PRIORIDADE estava fora das três, e ninguém tinha percebido** (corrigido em
2026-08-15). `DecisionCell` imprime `~${score.toFixed(1)}`, mas `compareByField` comparava
`decisionScore` CRU — as invariantes 1 e 2 valiam para `expected_score`, `recommended` e
`user_score`, e a Prioridade ficou de fora **porque a régua estava escrita duas vezes** (aqui e
na chave da banda, cada lado decidindo sozinho). Medido no clone local, 975 obras ativas:

| ordenando por Prioridade | pares empatados |
|---|---|
| pelo decimal cru (como era) | **229** |
| pela nota exibida (`~8,4`) | **19.624** |

⚠️ **O efeito não é cosmético: o 2º nível de ordenação era DECORATIVO.** Como a cadeia é
`níveis escolhidos → overlap de tags → título`, quase nada chegava depois do nível 1 — escolher
"Prioridade, depois Média externa" ordenava só por Prioridade. Caso real: cinco obras exibindo
**"~7,2"** separadas por 0,004 no cru (num grupo de **72** com a mesma nota exibida).

🔴 **E o tooltip da própria célula PROMETIA o contrário** — *"dentro de cada faixa a ordem usa
compatibilidade e desempates, não o decimal"*. Prosa e código afirmando o mesmo fato por
critérios diferentes, com o lado que a pessoa lê sendo o errado
([[gotcha-ui-documentava-formula-morta]]). Hoje o dono único é
**`lib/ranking/display-sort.ts`** (`DISPLAY_ROUNDED_SORT_FIELDS` + `displaySortValue` +
`displayTierKey`), e a chave da banda DERIVA dele em vez de repetir a decisão.

⚠️ **Desempate por média externa/votos na cadeia final seria CÓDIGO MORTO:** `tag_overlap_net`
está preenchido em 975/975 e resolve **100%** dos 19.624 pares. Os externos entram por ESCOLHA
(nível 2), que é o que voltou a funcionar.

Guardadas por `tests/unit/ranking/score-rounding.test.ts`, `build-tiers.test.ts` e
`prioridade-ordena-pelo-numero-da-tela.test.ts` — o último com a contraprova do comportamento
antigo, conferida com sonda.

## Desempatar o que está EMPATADO: o refino por mood, com peso

O caso real: a lista mostra seis obras com a mesma nota e cada uma tem um "porém"
diferente — duas em hiato, uma com arte fraca, uma antiga, uma com pouco conteúdo adulto.
A pessoa abre três abas e não decide. Medido em 2026-08-15: **32 grupos com 5+ obras na
mesma Prioridade exibida**, o maior com 20.

🔴 **A pergunta aqui NÃO é "qual nota prevê melhor o gosto?" — é "o que separa estas
seis?".** Medir um desempatador contra `user_score` responde a primeira e reprova o que
serve para a segunda. Dentro dos grupos empatados, a fração dos pares que cada sinal
separa de forma material:

| sinal | separa | cobertura |
|---|---|---|
| conteúdo adulto · humor · tragédia | 84% · 81% · 80% | 100% |
| **arte (percentil)** | **79,8%** | **97,5%** |
| votos · alinhamento · ação | 74% · 73% · 72% | 100% |
| interesse ♥ | 55,0% | 100% |
| **publicação (dá pra começar agora?)** | **53,9%** | 100% |
| Veredito IA | 46,9% | **49%** |
| média externa · ano | 37,9% · 35,5% | 100% · 84% |
| tipo de hiato | 19,7% | 10% |

⚠️ **O desempate PAGO é o pior candidato a desempatador padrão** — o Veredito IA separa
menos que qualquer sinal grátis e só existe em metade dos pares.

🔴 **As dimensões práticas do `mood-refine` viraram PESO −2..+2**, a mesma escala dos
atributos. Eram booleanas (`alignment`/`popularity`/`synopsis`), o que dava duas convenções
no mesmo diálogo e escondia o lado útil do negativo: hoje dá pra pedir **"mais de nicho"**
(`popularity: -2`), **"ainda em andamento"** (`publication: -1`) e **"mais antiga"**
(`recency: -2`). Entraram junto **arte**, **publicação**, **média externa** e **recência**.

⚠️ **Nem toda dimensão é BIPOLAR, e forçar simetria mentiria.** "Mais popular" tem oposto
útil; "sinopse menos interessante" não tem. Quem declara `down: null` em
`MOOD_DIMENSION_INFO` desenha só 3 níveis (neutro→priorizar) em vez de 5.

⚠️ **`chapters` fica fora do equalizer de propósito:** curta e longa são dois ALVOS, não
menos e mais da mesma coisa boa.

⚠️ **A régua de "dá pra começar agora?" (`startabilityOf`) é ESCOLHA, não medição** —
concluída 1,0 · em andamento 0,6 · hiato 0,25 · cancelada 0. O par tem dois botões, mas a
régua tem QUATRO níveis: pedir concluída empurra hiato e cancelada pra baixo, e pedir em
andamento sobe Ongoing acima de Hiatus. Os ids vêm por SLUG (`isHiatusPublicationStatus` e
vizinhas), nunca comparando nome à mão: a migration 155 documenta o que renomear "Completed"
quebrou.

🔴 **`Unknown` caía no mesmo `return 0` de `Cancelled`** — "não sabemos se acabou" era tratado
como o PIOR caso —, e este arquivo afirmava o contrário ("cai no meio, não em zero"): a prosa
certa e o código errado, a classe de erro de sempre. Hoje devolve `null`, que o cálculo trata
como sem dado (contribuição neutra). São 3 obras, mas o que importa é o modo de falha: status
NOVO no Supabase entraria calado como pior caso.

🔴 **"Leitura" (continuar × começar) entrou em 2026-08-16, e o TERMINAL fica de fora dos dois
lados.** `readingProgressOf`: em curso 1 · não-começada 0 · **terminada/largada `null`**. Em 0,
"quero começar algo novo" promoveria o que você JÁ LEU junto com o que nunca abriu; em 1,
"quero continuar" ofereceria o que não tem como continuar. ⚠️ Separa **37,9%** dos pares
empatados — o teto vem da distribuição: 690 das 978 obras estão em `Untracked`. ⚠️ `Untracked` É
escolha explícita e conta como não-começada; ausência de linha no espelho é desconhecimento e
vira neutro.

⚠️ **A correção segue limitada ao MAE (`MOOD_SWING = 0,9`)** — o mood reordena dentro da
incerteza que já existe, sem inventar distância entre obras.

🔴 **O diálogo MOSTRA o resultado antes de você confirmar** (`components/ranking/mood-preview.tsx`).
Ele prometia "a comparação abre reordenada por isso" e não mostrava nada do efeito: a pessoa
configurava às cegas, clicava, e só então descobria se tinha servido — numa feature cujo
propósito é ajudar a DECIDIR. Hoje as obras do cluster aparecem no rodapé, na ordem que a
comparação vai abrir, com quanto cada uma andou (`↑4`).

🔴 **A prévia NÃO calcula: ela chama `sortByMoodAdjusted`**, a mesma função que o comparador usa
pra abrir. Uma cópia da fórmula aqui seria "dois critérios pro mesmo fato" no pior formato — a
prévia promete uma ordem e a tela seguinte entrega outra, e quem confia na promessa é justamente
quem está tentando decidir. Guardado por `tests/unit/ranking/previa-usa-o-mesmo-calculo.test.tsx`,
que compara a ordem RENDERIZADA com a do dono em **10 moods diferentes** — com um só, duas
fórmulas coincidem por acaso (5 obras têm poucas ordens possíveis), e o teste ainda exige que os
casos gerem ≥5 ordens distintas, senão ele não separaria nada. Conferido com sonda.

⚠️ **A prévia fica FORA da área que rola** — resultado que sai da tela quando se rola pra mexer
num controle não fecha o loop.

⚠️ **`sm:max-w-3xl`, nunca `max-w-3xl`:** o `DialogContent` traz `sm:max-w-lg`, e a variante
responsiva vence a classe base acima de 640px. Com `max-w-3xl` o diálogo ficava em 512px e as
duas colunas do topo espremiam — medido, não suposto.

🔴 **PESO e EXCLUSÃO convivem — são perguntas diferentes.** O par diz "prefiro concluída"
(empurra pro topo, ninguém some); o bloco **"Não mostrar"** diz "não me mostre hiato" (a obra
sai da comparação). Colapsar as duas num controle só obrigaria a escolher entre "prefiro" e
"não quero". O bloco nasce COLAPSADO (escolha da Ana) porque excluir é o caso raro — sete
linhas de chip permanentes devolveriam a parede que este redesenho desmontou —, e o contador
fica no gatilho (`2 categorias · 3 de 5 obras`) pra exclusão ativa nunca ficar escondida.

⚠️ **A exclusão tira da COMPARAÇÃO, não só da prévia.** `filterMoodWorks` é o dono e os dois
lados o chamam; sem isso a prévia mostraria 3 obras e o drawer abriria com 5 — o mesmo defeito
que o teste de equivalência da prévia existe pra impedir do outro lado.

🔴 **Os baldes saem de FLAGS, e a tentação errada era `hideFromInterest`.** Ela parecia agrupar
as "descartadas", mas também é true em `Stalled`, `Read Again` e `Finished` — varreria leitura
em curso pro balde de descarte. "Descartada" = `isTerminal` sem `isFullyRead` (Dropped) +
`isDismissedPersonalStatus` (Not Now / Not Interested).

⚠️ **"Not Now" e "Not Interested" não têm flag NENHUMA true** — reconhecê-las por ausência de
sinal quebraria no primeiro status novo com as flags em branco. Por isso `isDismissedPersonalStatus`
as nomeia por SLUG e ESTOURA num rename, mesmo padrão de "Read Again" na prateleira "Pra você hoje".

🔴 **E a mesma medição corrigiu `readingProgressOf`:** ele usava `isUnread`, que é true SÓ em
Untracked e Want to Read — "Not Now" e "Not Interested" caíam no lado "já comecei", afirmando
que a pessoa abriu obras que ela adiou ou recusou. Hoje a régua é `tracksProgress`.

⚠️ **Obra sem status sobrevive a qualquer exclusão** — "não sei" não é "não serve", e sumir em
silêncio é o pior desfecho de um filtro.

🔴 **O refino ganhou um BOTÃO na lista em 2026-08-16, e isso não contradiz a decisão de
não pôr uma barra permanente** — "além de poluir a tela, não é sempre que vai ser usado" era
sobre os CONTROLES ficarem à mostra. O gatilho é um botão ("Refinar") na barra de
`/ranking` e `/favorites`; o popup é o mesmo, com `scope="list"` trocando só os textos.
Duas fórmulas conforme a porta de entrada fariam a mesma escolha produzir ordens diferentes
em duas telas. E sem presets fixos: quem monta a combinação é quem está escolhendo.

⚠️ **O estado é EFÊMERO e fora da URL, de propósito.** Mood é "o que eu quero agora", não
configuração de lista — e há um motivo mecânico junto: `RankingFilters` reescreve a query
string inteira no "Aplicar filtros", então um parâmetro que entrasse por fora do rascunho
seria apagado em silêncio (ver "O painel de filtros é RASCUNHO"). O preço aceito é o refino
se desfazer ao navegar; por isso o estado ativo é visível no chip (`3 ajustes · 12 obras
fora`) e desfazível num clique.

🔴 **A normalização é por CONJUNTO, e é isso que obriga o comparador a HERDAR.**
`computeMoodFit` tira o min/max de cada dimensão das obras que recebe: medido em 2026-08-16
sobre as 126 favoritas, o mesmo mood aplicado à lista inteira × a janelas de 5 obras dá ordem
DIFERENTE em **até 17 de 25 janelas**. Por isso `applyMoodToList` (`lib/ranking/mood-list.ts`)
é dono único, devolve o mapa de valores junto da ordem, e o `WorkCompareDrawer` recebe
`moodAdjustedById` quando o refino veio da lista — em vez de recalcular sobre a seleção. É a
família "mesma função, CONJUNTOS diferentes" do `/discover`.

⚠️ **Excluir vem ANTES de normalizar** — obra fora da lista não pode esticar a régua de quem
ficou. E a **célula imprime o número ajustado** (borda tracejada), nunca a base: a lista está
ordenada por ele, e mostrar outro é a invariante que custou 19.624 pares de empate.

⚠️ **A prévia do popup desenha 6 obras no modo lista, mas CALCULA sobre todas** — cortar antes
de ordenar reintroduziria o bug do conjunto, com a prévia prometendo uma ordem de um universo
que não é o da lista.

⚠️ **O diálogo passou de 3 toggles para 7 linhas de equalizer (835px) e estourava a
janela**: medido, a 800px de altura o topo ia a −17px e a 700px o botão de confirmar saía
da tela, sem scroll pra alcançá-lo. Hoje a lista rola e o rodapé não (`max-h-[90vh]` +
`overflow-y-auto` só na lista).

🔴 **A ARTE saiu da página da obra e entrou nas listas** (`ArtCell`) — era o único dos
separadores fortes visível só onde não ajuda a escolher ENTRE várias. Mostra o
**percentil**, nunca a estimativa em pontos: a escala é comprimida a ~0,49× a do rótulo, e
um número em pontos convida à comparação errada com uma nota de critério. Sem estimativa é
"—", nunca 0 nem "média". ⚠️ Ela é PESSOAL (treinada nos rótulos do dono) e passa pelo
overlay de `PERSONAL_SCORE_FIELDS` — para quem não é o dono vem NULL, de propósito.

## O Veredito na Prioridade era um IMPOSTO, não um ajuste

🔴 **Até 2026-08-16 a Prioridade fazia `expected×(1−w) + (alignment/10)×w`, e isso converte
UNIDADE sem converter ESCALA.** Medido no clone local (981 obras com Prevista, 695 com
veredito): o Veredito IA tem média **54,2** na escala 0–100 e a Nota Prevista vale **76,9** na
mesma escala. O termo entrava 2,27 pontos abaixo da âncora, então o "ajuste" era um
deslocamento para baixo — **625 das 695 obras desciam**, média −0,49.

🔴 **E como 29% do catálogo não tem veredito, isso virava ORDENAÇÃO:** 37.230 pares invertiam
em favor de quem simplesmente não passou pelo re-rank, contra dezenas no sentido oposto. A
maior alavanca da Prioridade não era o gosto de ninguém — era **ter sido processada**.

Hoje o veredito entra como **desvio padronizado**: quantos σ ele destoa da própria
distribuição, convertidos para a escala da Prevista.

```
z     = (alignment − verdict_mean) / verdict_std
score = expected + peso × expected_std × z          peso = 0,35 × confiança (× 0,5 se stale)
```

| variante | shift médio | sobem/descem | inversões pró-sem-veredito | rho c/ `user_score` |
|---|---|---|---|---|
| Prevista pura | 0 | — | — | **0,6456** |
| `alignment/10` (antiga) | −0,485 | 70/625 | 37.148 | 0,5828 |
| centrada na mediana | −0,014 | 336/328 | 14.564 | 0,6226 |
| **z-pareado (hoje)** | **+0,001** | **367/328** | **2.460** | **0,6433** |

⚠️ O rho é **in-sample** (o Ridge da Prevista treinou nessas 210 rotuladas), então ele compara
as VARIANTES DO AJUSTE entre si — todas sobre a mesma base enviesada —, e não mede acurácia
absoluta. O que ele sustenta: corrigir a escala recupera quase todo o dano.

🔴 **A régua vive em `formula_config` (migration 193: `verdict_mean`, `verdict_std`,
`expected_std`), medida no recalc sobre o CATÁLOGO.** Derivá-la das linhas visíveis faria a
mesma obra ter Prioridades diferentes conforme o filtro — é o mesmo motivo pelo qual `gpt_mean`
mora lá. Quem lê é `getVerdictScale()` (`server/queries/verdict-scale.ts`), com `select("*")`
para tolerar a coluna não migrada.

⚠️ **Sem régua, o veredito NÃO ajusta e a Prioridade é a Nota Prevista.** É degradação para o
lado seguro e medido (Prevista pura tem o melhor rho da tabela) — a alternativa seria voltar ao
imposto. Consequência operacional: **entre aplicar a migration e rodar o primeiro recalc, a
Prioridade fica igual à Prevista.**

⚠️ **`alignment_stale` passou a valer meio peso** (`STALE_CONFIDENCE_FACTOR = 0.5`). Antes o
veredito desatualizado pesava igual ao fresco — `computeDecisionScore` nem recebia o campo. São
15 obras hoje, mas o modo de falha é o que importa: um veredito de antes afirmando tanto quanto
um de agora.

⚠️ **A régua é do catálogo do DONO**, porque `formula_config` tem uma linha só. Para outra
pessoa, o veredito dela é padronizado pela dispersão dele — desloca levemente a calibração, não
vaza nada (são dois escalares agregados) e continua muito melhor que o `alignment/10` que valia
para todo mundo. Quando `user_calculated_scores` tiver régua própria, `getVerdictScale` passa a
receber o `userId`.

Guardado por `tests/unit/calculations/prioridade-veredito-z-pareado.test.ts`, que inclui a
contraprova do defeito: um veredito **62** — acima da média do catálogo — DERRUBAVA uma obra de
8,0 na fórmula antiga e hoje a sobe.

## A Prioridade agora EXPLICA de onde vem (e por que não soma mais coisa)

O comparador tem um painel no hover da linha "Prioridade"
(`components/titles/decision-breakdown-panel.tsx` + `lib/calculations/decision-breakdown.ts`):
âncora (Nota Prevista), ajuste do Veredito **com o peso efetivo**, e os quatro sinais que já
entram na Prevista com os valores da obra — Alinhamento, Interesse (seu ⊕ previsto), Média
externa, Votos.

🔴 **Ele nasceu de uma pergunta que a ausência dele respondia errado:** "a Prioridade ignora o
Alinhamento, o Interesse e a nota externa?". Não ignora — consome os quatro **dentro da Nota
Prevista**, com peso APRENDIDO (`BASELINE_NUMERIC_FEATURES`). O que a `decision.ts` evita é
RE-aplicá-los por cima.

⚠️ **E somá-los de novo foi MEDIDO, não suposto** (2026-08-15, 210 rotuladas, ridge 5-fold
out-of-fold contra o `user_score` do dono): **Prevista sozinha rho 0,643 · os 7 sinais juntos
0,626**. Os externos são os mais fracos contra o gosto (média 0,271, votos 0,225).

🔴 **O que os dados sustentam é "NÃO MELHORA", e não "piora" — os dois ICs cruzam zero:** os 7
juntos dão Δrho −0,017 [−0,050, +0,015], P(melhor) = 16,3%; a melhor variante (Prevista +
Alinhamento) dá +0,007 [−0,010, +0,023]. Esta seção nasceu dizendo "derruba a ordenação" e a
frase chegou até a **tela** do painel — inferência além da medição, na superfície onde ela é
mais cara. O argumento que decide não é a diferença de rho: é que **nem com os pesos ÓTIMOS há
ganho**, e peso escrito à mão só pode ser pior que o ótimo. Replica o gate Fit×Mérito de
07/2026.

⚠️ **O peso do Veredito sai de `decisionAlignWeight`, nunca reescrito no componente** — e é
ZERO quando não há veredito (28,9% das obras), senão o painel afirmaria um ajuste que não houve.

🔴 **A ênfase dos 9 atributos entrou no painel porque a OMISSÃO gerou a pergunta certa** — *"e a
seleção de atributos pra colocar ênfase, vocês consideram?"*. Consideram: as 9 notas são as
features nº 1 do Ridge e viram `IA(n)` (a Nota.IA) ponderadas por `score_weights`. **Mas o peso
que vale pode não ser o seu.** Medido em 2026-08-15: `formula_config.score_weights_auto = true`,
então o sistema usa os pesos INFERIDOS do histórico e os declarados em `/preferences` viram
fallback (treino < 20). Os dois divergem em **7 dos 9**, e três com o SINAL INVERTIDO:

| critério | declarado | inferido (em vigor) |
|---|---|---|
| `tragedy` | **−15** | **+11,4** |
| `drama` | −5 | +7,0 |
| `adult_content` | +6 | −15,1 |
| `fantasy_nobility` | 56,8 | 38,0 |
| `protagonist` | 31,6 | 46,2 |

⚠️ **E o inferido acerta MAIS o gosto do dono:** ordenando as 210 rotuladas pela Nota.IA, rho
**0,584 com o peso inferido × 0,499 com o declarado**. Ou seja, o automático está certo em estar
ligado — o problema era só a tela não dizer qual dos dois está valendo. Hoje o painel imprime
`ênfase automática` ou `ênfase sua`.

⚠️ **A ordenação da Nota.IA muda pouco entre os dois** (Spearman 0,857, |Δ| mediano 0,27 ponto),
e ela chega à Prevista diluída — `IA(n)` é uma feature entre 20, e a Nota.Calc pesa ~0,05 no
blend. Não espere que trocar o toggle reordene o catálogo.

⚠️ **Alfa de texto não se lê na cor computada:** `text-background/50` dava **3,87:1** (abaixo do
AA de 4,5:1 em 12px) e medir sem compor o canal alfa sobre o fundo dava "18:1". Hoje `/65`
(6,6:1) e `/60` (5,5:1), medidos no browser.

## Na Bússola, EMPATE é regra — e ponto empilhado imita o estado aceso

`computeWorkForces` **arredonda pra inteiro** antes de virar posição (`round(chance_score)`,
`round(platform_avg × 10)`), e a posição é o percentil com midrank. Logo, valores diferentes
viram a **mesma coordenada**: medido em 2026-08-08 nas 40 obras do topo, **dois pares** caem no
mesmo pixel (ex.: chance 56,04 e 56,32 → 56, com nota 8,1061 e 8,0987 → 81).

Isso produzia dois bugs de uma vez, os dois silenciosos:

1. Os dois pontos desenhavam um **anel** — porque o de cima tem `border-background` — e o anel
   era **idêntico ao estado aceso**. Foi lido como estado por quem usa e por quem mantém.
2. Quando o MAIOR era pintado por último, ele cobria o menor inteiro: obra **invisível e sem
   hover**, presente só na lista lateral.

Três defesas, em `components/ranking/bussola-plane.tsx`:

| Defesa | O que garante |
|---|---|
| `spreadTies` | empatados se afastam num círculo — **≤40% de um passo de percentil** e **nunca cruzam a mediana** (a cor vem do quadrante; cor e posição não podem discordar) |
| `byDrawOrder` | pinta do maior pro menor, então ponto pequeno nunca some |
| aceso com anel **neutro** (`--foreground`) | sobreposição de pontos não consegue imitar |

🔴 **`boxShadow` inline VENCE a classe do Tailwind** — o `focus-visible:ring-2` do ponto nunca
chegou a aparecer, era proteção de mentira. Quem marca o foco é o próprio aceso (`onFocus`
acende o ponto), e por isso o `lit` também é passado no modo absoluto.

⚠️ **O tooltip é a lupa: mostra o CRU** (nota externa 8,1 e 1.278 votos), porque "81" e "66" são
as forças normalizadas — não são nota nem votos. A Nota Prevista abre o card com
`getScoreTextColor` e as faixas de `/preferences` (`scoreThresholds.expected`, passada pelos
dois consumidores); sem elas caem os cutoffs fixos do `ScoreBadge`. **Cor própria aqui seria uma
2ª régua pro mesmo número.** O bloco da nota é `float`, não item de flex: ao lado, ele encolhia
TODAS as linhas do título (46 caracteres viravam 4 linhas num card de 268px; hoje 320px + float
= 2 linhas).

Guardado por `tests/unit/ranking/bussola-empilhamento.test.tsx` e `bussola-legenda-lista.test.tsx`
— inclusive um teste que falha se a prop de faixas for ignorada, que era o jeito silencioso de a
cor da nota regredir pro fallback.

## A página da obra tem SEIS abas, e a régua delas é a PERGUNTA — não a procedência

Medido em 13/08/2026 na obra mais completa do catálogo (*Villains Are Destined to Die*, 196
reviews, 8 fontes, 98 tags), viewport 1400×1000: **Notas & Avaliações tinha 3.496px — 3,5
telas** —, e **76% dela eram dois blocos**: "Notas por critério" (1.735px, nove cards de
justificativa) e o card de reviews (933px). Bússola + Notas calculadas + Externas somavam
1.054px, ou seja, cabiam numa tela.

| Aba | Pergunta | O que entra |
|---|---|---|
| Visão Geral | *"quero ler isso?"* | Estado da obra · Sinopses + Interesse · Estrutura de abertura |
| **Análise da IA** | *"o que a IA entendeu dela?"* | Resumo + 9 atributos · síntese das reviews · estimativa de arte · Deep Dive |
| Notas & Avaliações | *"quanto vale perto das outras?"* | Bússola · Notas calculadas + Veredito · Avaliações externas |
| Meu Status · Recomendações · Gêneros e Tags | como estavam | |

🔴 **A régua NÃO é "gerado por IA", e a diferença é estrutural.** Por procedência, a
**sinopse consolidada** (escrita por modelo), o **Interesse previsto**, a **Estrutura de
abertura** e as **tags inferidas** teriam que sair da Visão Geral — e o **Veredito IA**, que
é LLM puro, sairia de perto da Nota Prevista e do Alinhamento, quebrando o único lugar onde
os três números comparáveis aparecem juntos. O que separa é **o que se faz com o conteúdo**.

⚠️ **O caso difícil, e a régua que o resolve:** os 9 atributos são números, mas cada um vem
com justificativa em prosa e faixa da rubrica — são a *leitura* da obra. A Nota Prevista é o
modelo estatístico *em cima* dessa leitura. Por isso os atributos vão pra aba da IA e a
Prevista fica em Notas, mesmo os dois sendo "nota".

**Botões: a ação mora onde o resultado aparece.** "Avaliar com IA" e Deep Dive na aba da IA;
"Recalcular Veredito" junto do Veredito; "Analisar abertura" e "Prever interesse" dentro dos
cards deles. **Exceção única: "Gerar tudo"** fica no topo da Visão Geral — ele não pertence a
nenhum resultado, porque cria todos.

⚠️ **Resultado medido depois:** Notas **3.496 → 650px**, Visão Geral 906 → 982px (o painel de
estado entrou, o card do Resumo saiu), e a **aba nova nasceu com 2.949px**. Mover é metade do
trabalho: o scroll mudou de endereço. A outra metade é a **grade compacta dos 9 critérios**
(nota + faixa + barra, justificativa abrindo ao lado, ~1.735 → ~520px) — decidida, ainda não
implementada, e vale PR próprio.

Guardado por `tests/unit/orchestration/abas-da-obra.test.ts`, que **recorta cada
`<TabsContent>` do source** e falha quando um bloco muda de aba. ⚠️ Ele lê o arquivo **sem os
comentários**: eles citam o que foi movido ("as datas saíram daqui"), e a 1ª versão reprovou
acusando a própria explicação da mudança.

### O painel "Estado da obra" responde uma pergunta que morava em três lugares

`components/titles/work-state-panel.tsx`, no topo da Visão Geral: **Matéria-prima** (quantas
reviews, de quantas fontes, quantas foram ao prompt da avaliação, quantas entraram na síntese,
e os chips de fonte vinculada) · **Frescor** (criada, dados, avaliada, síntese, tags, sua
leitura) · **Precisa de você**. Antes: duas caixinhas embaixo da capa (que saíram), o número
de reviews da avaliação **enterrado no tooltip do selo ✨**, e o "Veredito desatualizado"
visível só dentro da aba de Notas.

🔴 **Chip de pendência é o que é RARO e acionável.** Medido nas 988 obras: **562 (57%)**
receberam reviews depois da última avaliação e **502 (51%)** nunca tiveram tags inferidas —
alarme para isso deixaria o painel âmbar em quase toda obra, e alarme que sempre toca não é
lido (mesma armadilha do `db:health`). O que é maioria vira **número**; só o raro vira chip:
Veredito desatualizado (17 · 1,7%), avaliação a revisar (1), nunca avaliada (6), sem síntese
(136).

⚠️ Os chips **não navegam**: as abas são `Tabs` não-controladas (`defaultValue`), e linkar pra
dentro de uma aba exigiria subir esse estado pro cliente inteiro.

### O "Resumo da avaliação IA" não era redundante com a sinopse — era com os critérios

Medido em 400 obras (vocabulário de 4+ letras, sem palavras comuns): o resumo sobrepõe
**4,4%** do da sinopse (Jaccard; **nenhuma** obra passa de 0,17), **14,8%** do consenso do
digest, e **46%** do das nove justificativas — com **35% das obras acima de 50%**. A sinopse
conta o **enredo**; o resumo diz **tipo e tom** ("manhwa *wholesome* de reencarnação, tom leve
e caloroso, drama moderado"), e é a única frase da página que faz isso.

Por isso ele **deixou de ser card próprio** e virou a **primeira linha do bloco "Notas por
critério"**: 353 caracteres de mediana, e é o contexto que os nove números pedem. Na Visão
Geral eram dois parágrafos cinzas disputando o mesmo olhar.

⚠️ **Uso melhor, ainda não feito:** o hover de obra nas listas e o comparador mostram a
*sinopse* (847 caracteres de enredo). O resumo tem 353 e responde "que tipo de obra é essa?",
que é a pergunta de quem varre uma lista.

### Dois ajustes da faixa de stats

🔴 **"0 / 73" só aparece pra quem acompanha progresso**, e a régua vem do banco
(`personal_status.tracks_progress`), nunca de uma lista de nomes. Hoje os quatro sem progresso
são Want to Read, Untracked, Not Now e Not Interested — em todos, o zero é o default de quem
nunca abriu a obra, e desenhado como fração ele lê como leitura ABANDONADA. Status novo no
Supabase entra na régua sozinho. ⚠️ O popover de edição continua inteiro (é por ele que se
começa a acompanhar) e a barra volta assim que o número sai do zero, antes mesmo de salvar.

**Títulos alternativos: inglês primeiro** (`lib/titles/title-language.ts`). São **10.072
títulos** no catálogo — 63,6% em alfabeto latino, o resto em japonês/chinês (18,4%), coreano
(6,3%), cirílico (5,9%), tailandês (4,7%) e árabe (1,0%) —, e sem ordenação o chip legível
aparece em posição aleatória.

🔴 **Inglês só por sinal POSITIVO, nunca por ausência de sinal.** A 1ª versão classificava
"ASCII sem marca de outra língua" como inglês e promovia romanização asiática ("Neukdae
Sillang", "S-geup Dungeon-ui Yeojuin") ao topo. Hoje decide por palavra funcional inglesa ou
morfologia (`'s`, `-ing`, `-ed`, `-tion`); o erro que sobra é o barato — um título inglês sem
palavra funcional cai um grupo. Conferido à mão em **70 títulos sorteados**, sem falso
positivo. ⚠️ `a`, `o`, `e`, `no`, `do` ficaram FORA da lista inglesa: com eles, "A Herdeira
Acidental" contava como inglês. ⚠️ O título ATUAL e o ORIGINAL não entram na ordenação — não
são "alternativos", são identidade, e cada um tem marcador próprio.

## Dado gerado por IA carrega um SELO — e nenhuma procedência fica solta na tela

Todo bloco da página da obra cujo conteúdo saiu de um modelo leva o selo ✨
(`components/ui/ai-provenance.tsx`), e modelo/prompt/data/confiança vivem **só** no tooltip
dele. Régua de 2026-08-08, em 11 superfícies: Resumo da avaliação IA · Notas por critério ·
Sinopse consolidada · Interesse previsto · Síntese das reviews (+ resumo em prosa) · Veredito
IA · Deep Dive · Tags inferidas · Atributos da obra. O ℹ️ de "Obras parecidas" ganhou o modelo
do embedding no tooltip que **já** explicava o método — busca vetorial não é texto de LLM, e
dar a ela a mesma marca da sinopse afirmaria algo falso.

Dois problemas que a ausência da régua produzia:

1. **Duplicação.** "Resumo da avaliação IA" e "Notas por critério" imprimiam a MESMA faixa
   (`Modelo · Confiança · Reviews · Data`) da MESMA avaliação, escrita em dois lugares. Hoje um
   objeto só (`aiEvalProvenance`) alimenta os dois selos.
2. **Omissão.** A sinopse canônica é ESCRITA por um modelo e a página não dizia isso em lugar
   nenhum. Por isso o selo é a **marca**, não só o botão: ele aparece mesmo com o modelo
   desconhecido ("sem registro"). Escondê-lo apagaria o fato de o texto ser de IA.

🔴 **O que NÃO vai pro selo: ESTADO.** "Desatualizada" (Interesse) e "Desatualizado" (Veredito)
ficam na tela. Não são procedência — são o que impede aplicar ao pipeline de notas um número
que a IA já não sustenta. Enterrá-los num tooltip devolve o "aplicar cego".

**A DATA é a primeira linha do tooltip, e fala em dias** (2026-08-12). A pergunta que se faz
olhando um selo é *"isso ainda vale?"* — quem responde é o quando, e ele estava em 2º lugar
num formato (`10/08/2026`) que não diz se foi hoje de manhã ou há três meses:

| quando | sai assim |
|---|---|
| hoje / ontem | `Hoje às 09:14` · `Ontem às 22:40` |
| 2 a 6 dias | `Terça às 14:30` |
| 7 dias ou mais (e futuro) | `10/08/2026` |

⚠️ **O corte é 6 dias, não 7:** na volta da semana o nome do dia repete o de hoje — numa
quarta, "Quarta" seria hoje ou sete dias atrás. Dono: `formatProvenanceWhen`
(`lib/date-utils.ts`), usado pelo selo, pelo rodapé do card de reviews, pelo tooltip do
embedding e pelo aviso de previsão velha.

🔴 **Fuso FIXO (`America/Sao_Paulo`), nunca o do runtime.** O selo renderiza no server
component da obra E dentro de cards `"use client"`; o servidor no Fly roda em UTC e o
navegador em UTC−3, então o SSR escreveria "Hoje às 21:40" e a hidratação "Hoje às 18:40" —
a mesma classe de quebra da sidebar em `localStorage`. O formatador antigo resolvia isso
por SLICE do ISO (determinístico, porém em UTC: 02:30Z aparecia como o dia seguinte).

**O ✨ tem TRÊS usos, e o terceiro é proibido** (mesma data). A marca é o que dá sentido ao
selo; se ela aparece como enfeite, deixa de significar "um modelo escreveu isto":

| uso | regra |
|---|---|
| **selo** violeta clicável | conteúdo na tela saiu de um modelo — tooltip de proveniência |
| **em botão**, com texto | a ação CHAMA um modelo (e custa): "Atualizar previsão", "Avaliar com IA" |
| ~~ícone fixo de título/aba/métrica~~ | **não** — não abre nada e gasta a marca |

Saíram nesta leva: o ✨ do título de **"Obras parecidas"** (o card é busca vetorial, não
texto de LLM — hoje é um alvo, e o ℹ️ ao lado continua sendo quem explica o método e mostra
o modelo do embedding), o ✨ da métrica **Veredito IA** do mesmo card (o rótulo já diz IA), o
**segundo** ✨ de "✨ A IA sugere ✨" no Interesse (ficou só o selo clicável), o da **aba
Recomendações** (virou 💡 — aba é navegação) e o de **"inferência de tags: nunca rodou"**,
que virou chip `pending` da régua de estado.

⚠️ **Fora da régua, de propósito:** Nota Prevista, Nota.Calc, Alinhamento e a Bússola são Ridge
e aritmética em TS, sem LLM — selo "gerado por IA" ali seria mentira. A caixa lateral
("Última avaliação em / Atualizada em") também fica: é painel de FRESCOR da ficha, e
"Atualizada em" nem é de IA.

🔴 **Modelo não existe pra todo mundo, e o número é medido.** Sinopse, síntese/resumo de reviews
e tags não têm coluna de modelo; o que existe é o log central (`ai_api_calls`, ligado por
`metadata->>'work_id'`), e ele **só começa em 03/07/2026**. Medido em 2026-08-08 no clone local:

| Artefato | tem o artefato | modelo recuperável |
|---|---|---|
| sinopse consolidada | 980 obras | 327 (**33%**) |
| síntese das reviews | 841 | 487 (58%) |
| resumo em prosa | 885 | 498 (56%) |
| Veredito IA (via `alignment_run_id`) | 501 | 66 (**13%**) |
| tags inferidas | 475 | **0** — nenhuma chamada grava `work_id` |

Não fixe o modelo numa constante: `synopsis_consolidator` e `review_digest` têm **2 modelos
distintos** no histórico, então "Sonnet" mentiria em toda obra antiga, em silêncio.

⚠️ **Dentro do tooltip, tom secundário é `text-background/<alfa>` — nunca token de página.**
O `TooltipContent` é invertido (`bg-foreground` + `text-background`). `text-foreground` ali é
invisível nos dois temas (bug de 2026-07-03); `text-muted-foreground` é pior de achar: passa no
escuro e cai pra ~3:1 no CLARO (medido). Guardado por `tests/unit/ui/ai-provenance-selo.test.tsx`,
que lê o ARQUIVO — a 1ª versão varria `AiProvenanceSeal.toString()` e não enxergava
`ProvenanceRow`, que é justamente quem desenha o corpo.

## No card de reviews, o organizador é o EIXO — e o texto longo mora fora do corpo

`components/titles/work-reviews-card.tsx` + `lib/reviews/digest-view.ts` (2026-08-09). O card
agrupava os traços por POLARIDADE (Elogios/Ressalvas/Críticas), que responde "a internet
gostou?" — pergunta que `platform_avg` já responde melhor. Quem responde "ela é boa **no que me
importa**?" é o `axis` de cada traço, e ele **existia no dado e vivia só no `title=` do chip**.

Medido no clone local (841 obras com digest, 6.178 traços):

| O quê | Número |
|---|---|
| eixos distintos por obra | **6** em 8 traços (mediana) — quase todo chip falava de outro assunto |
| tamanho do "chip" | **64 caracteres** de média (p90 87, máx 157) — é frase, não chip |
| vocabulário de eixos | 8 valores cobrem **99,1%**; a cauda são 55 ocorrências |
| sínteses feitas com <10 reviews | **206 obras (24,5%)**, 26 delas com ≤3 |
| reviews com nota | **17,9%**; só **291 de 882** obras têm ≥5 |

Quatro invariantes que se pagam caro se forem esquecidas:

- 🔴 **O texto do traço NÃO vai na linha da régua.** Ele mora no painel ao lado, num espaço
  **já reservado** — é isso que mantém a altura do card estável ao trocar de eixo (medido:
  873px → 873px). Inline, cada clique empurra a régua e o card pula.
- ⚠️ **Eixo desconhecido não é remapeado.** `normalizeAxis` só normaliza caixa e corta no
  primeiro segmento antes da barra; forçar "roteiro → escrita" mentiria sobre o que a review
  disse. Os limiares do sinal (`reviewSignal`) e o mínimo do histograma
  (`MIN_RATINGS_FOR_HISTOGRAM`) também moram lá — uma 2ª cópia é como a barrinha diz "forte"
  e o popover explica um critério diferente.
- ⚠️ **Intensidade ≠ contagem.** Os glifos repetidos (`▼▼`) contam o tom DOMINANTE; a pílula
  conta todos os traços do eixo. Moralidade com 1 negativo + 1 misto é "▼ criticado" com
  contador 2 — juntar os dois faz "▼▼" aparecer onde há uma crítica só.
- 🔴 **`flex-1` + `height:%` = gráfico invisível.** Ao tentar esticar o histograma para ocupar
  o vão da coluna, as barras sumiram nos dois temas: porcentagem precisa de altura
  **resolvida** no pai, e `min-h-*` não serve de base. Altura fixa (`h-14`) é o que funciona.

⚠️ **Container query mede o CARD, não a página.** A página da obra é `max-w-6xl` (1152px), mas
o card mede **868px** ali dentro — `@4xl` (896px) nunca disparava e as duas colunas viravam
pilha, em silêncio. Meça no app antes de escolher o breakpoint. E o rodapé é **irmão** do
`CardContent`: sem `@container` próprio, as classes `@2xl:` dele eram letra morta.

### O layout SEGUE O DADO — a coluna fixa era vão na maioria das obras

Duas linhas fixas (`[texto | 292px]` em cima, `[régua | painel]` embaixo) só ficam cheias na
obra completa. Medido nas **852 obras com síntese** (12/08/2026):

| caso | obras | o que acontecia |
|---|---|---|
| só avisos (sem notas de leitor) | **459 · 53,9%** | 292px reservados pra um bloco de ~130px |
| notas + avisos | 270 · 31,7% | linha de cima cheia; o vão descia pro lado da régua |
| **nada** na coluna direita | 81 · 9,5% | 292px vazios e o texto espremido em 1fr |
| só notas | 42 · 4,9% | — |

E o vão de baixo é **estrutural**: **91% das obras têm 5 a 7 eixos** (régua de 190–260px)
contra **2,2 traços** no eixo mais citado (painel de ~110px). Hoje:

- **sem histograma** ⇒ não existe coluna: consenso e divergência **dividem a largura**, e a
  divergência ganha corte de 10 linhas em vez de 4 (389 caracteres de mediana cabem inteiros
  em meia largura; empilhada sob o consenso, 4 linhas seguem certas);
- **avisos de conteúdo vão pro vão MAIOR**, e ele muda de lugar: com histograma ficam no topo
  (o gráfico tem 250px contra um consenso longo), sem histograma descem pro lado da régua;
- **o painel do eixo não estica** (`items-start`) — quem define a altura da linha é a régua, e
  o texto continua num espaço já reservado.

⚠️ **8 obras não têm traço nenhum**, e sem régua os avisos não têm onde encostar: existe um
ramo só pra elas. Sem ele, o bloco sumiria em silêncio junto com a régua que passou a
hospedá-lo. Guardado por `tests/unit/reviews/digest-layout-adaptativo.test.tsx`.

Guardado por `tests/unit/reviews/digest-view.test.ts` e `tests/unit/work-reviews-card.test.tsx`
— este último é teste de RENDER de propósito: um teste que lesse o objeto do digest passaria
verde com o eixo fora da tela, que era exatamente o estado anterior.

## Dinheiro tem UM dono, e a unidade muda com a escala

Todo valor em USD na interface passa por **`lib/format/money.ts`** — `formatUsd`,
`formatUsdApprox` (estimativa, com "~") e `makeUsdScale` (régua compartilhada). A régua:
**abaixo de 10¢ o valor sai em centavos** (máx. 2 casas, sem zeros mudos: `5,67¢`, `0,2¢`),
**de 10¢ pra cima em dólares** (`$0,13`, `$38,50`), sempre em **vírgula pt-BR**.

O corte é 10¢ e não US$1 porque é ali que o dólar **colapsa**: a maioria das chamadas de IA custa
entre US$0,0001 e US$0,09, e com 2 casas isso vira "$0.00". Acima de 10¢ o inverso vale — `$0,57`
lê melhor que `57,3¢`.

⚠️ **Isso não é cosmético — o formato antigo apagava diferença real.** Medido em 2026-08-07 na
coluna "custo por chamada" do `/curation/ai-usage`: `tag_classifier` (0,57¢), `tag_inference` (1,09¢) e
`synopsis_quality_predict` (1,27¢) exibiam **todas o mesmo "$0.01"** — custos 2,2× distintos com
o mesmo rótulo, sem erro e sem log.

🔴 **A duplicação é o modo de falha, não a fórmula.** Até 2026-08-07, **seis arquivos** formatavam
dinheiro por conta própria (oito funções, duas convenções incompatíveis):
`components/settings/ai-usage/format.ts` (ponto), **três cópias literais** dela (card de saldo, os
dois gráficos), a de 4 casas do badge dev, e a dupla `formatUsd`/`formatUsdExact` de
`lib/cost-preview/catalog.ts` (vírgula) — além de ~12 `toFixed()` soltos em toasts e mensagens de
servidor. O sintoma era visível: o `/curation/ai-usage` mostrava `$0.06` e o popup de custo mostrava
`~$0,05` na mesma sessão. É a mesma armadilha do `LOW_BALANCE_USD`; uma 7ª cópia é como duas telas
voltam a discordar sobre o mesmo número.

🔴 **Valor que aparece ao lado de outro usa `makeUsdScale`, nunca `formatUsd` um a um.** Toda
comparação lado a lado é uma **régua** e precisa de uma unidade só: eixo de gráfico, par
estimativa/teto, gasto contra cap, e a lista inteira quando ela existe pra ordenar as opções.

⚠️ **"Régua" é mais largo que "eixo", e foi assim que as duas primeiras versões erraram.** A 1ª só
cobria eixo, e a lista "Quanto custa cada ação" saiu com `~8,15¢` ao lado de `até $0,12` **na mesma
linha**. A 2ª esqueceu **coluna de tabela** — em "Por operação" a coluna Custo tinha `$0,33` e
`0,46¢` (o "0,46" lê como MAIOR, sendo 70× menor), e a coluna Custo/sucesso tinha `$0,30` e `0,3¢`,
dois "0,3" que diferem 100×. **Coluna ordenável é o pior caso**: a mistura inverte a leitura de quem
é maior. A 3ª esqueceu a **quebra que SOMA um total** — o badge de custo por obra imprimia `$0,13`
sobre `5,37¢ · 3,98¢ · 1,53¢ · 1,14¢ · 0,50¢`, e a conta parava de fechar de olho.

**Hoje são 15 réguas** — conferido, **não** contado de cabeça. Esta linha já dizia "12" quando eram
13, porque a coluna "Custo USD" da tabela **Por modelo** (`app/curation/ai-usage/page.tsx`) nunca entrou na
conta. Antes de mexer neste número, rode:

```bash
grep -rn 'makeUsdScale(' --include='*.ts' --include='*.tsx' . \
  --exclude-dir=node_modules --exclude-dir=.next \
  | grep -v 'lib/format/money.ts' | grep -v '^\.\?/\?tests/'   # → 15 em 2026-08-08
```

Contagem que fecha com ele:

| Quantas | Onde |
|---|---|
| 2 | gráficos (diário, por operação) |
| **4** | colunas de tabela — Custo do log de chamadas, Custo e Custo/sucesso de "Por operação", **Custo USD de "Por modelo"** |
| 1 | a lista "Quanto custa cada ação" (`cost-menu`) |
| 1 | o bloco de custo (`cost-summary`) |
| 1 | os botões do confirm (`cost-confirm`) |
| 1 | o toast do backfill de Interesse |
| 3 | mensagens de bloqueio por teto (`synopsis-quality`, `interest-ui`, `interest-backfill`) |
| 1 | o badge dev de custo por obra |
| 1 | o card de saldo |

⚠️ **Elemento recorrente cuja distribuição senta EM CIMA do corte precisa de régua própria** — senão
ele troca de unidade a cada navegação e inverte a leitura sem nada acusar. Medido em 2026-08-08 no
badge dev de custo por obra: das **520 obras** com custo atribuído a mediana é **US$0,079 (7,9¢)**,
a dois centavos do corte de 10¢ — 338 em ¢ e 182 em $. A saída não foi fixar centavos no código:
`components/titles/dev-work-ai-cost.tsx` monta **uma régua** com o total, todas as parcelas e o
baseline, e o número do **gatilho** sai dela. Como toda parcela é pequena, isso dá ¢ pra qualquer
obra de hoje (máx. 58,2¢) e volta pra $ sozinho no dia em que uma passar de US$1. Mesma correção em
`balance-card.tsx`: informado − gasto = restante são termos de uma conta só.

⚠️ **Régua de coluna sai das linhas VISÍVEIS**, não do conjunto todo — filtrar por modelo no log de
chamadas muda o que está sendo comparado, e a unidade tem que acompanhar.

⚠️ **A unidade sai do MENOR valor não-nulo, não do maior** — é o menor que colapsa em `$0.00`,
então é ele quem decide se a régua precisa de centavos. O maior só exerce **veto**: a partir de
US$1 a régua inteira vai pra dólar, senão um eixo de US$0,001 a US$7,76 imprimiria `776¢`. Zero
não opina (num eixo ele é sempre o 1º tick, e fixaria tudo em centavos).

🔴 **Sob veto, o menor da série NÃO pode virar `$0,00`** — isso afirma que não houve custo. Medido:
`suggest_groups` custou US$0,0046 e o veto do US$25,91 da mesma coluna puxou a régua pra dólar. Por
isso `asDollars` tem o mesmo `<$0,01` que `asCents` já tinha; zero de verdade segue `$0,00`.

⚠️ **Quem embute o `CostSummary` numa tela que também mostra dinheiro tem que PASSAR a régua**
(`scale`). Derivar uma de cada lado não basta: o card conhece o custo por item e os passos da
cascata, o rodapé conhece a ação secundária — mesmas entradas aparentes, réguas diferentes.

**Fora daqui, de propósito:** `scripts/*.ts` — é saída de terminal pro dev, e mudar o formato
quebraria a comparação com logs de execuções antigas.

Guardado por `tests/unit/format/money.test.ts` (10 casos, inclusive saldo negativo — que antes
saía `$-4.20`, com o cifrão na frente do sinal) e por
`tests/unit/format/dev-work-cost-regua.test.tsx` — este último é teste de **render**, de propósito:
o `money.test.ts` passava verde enquanto o badge chamava `formatUsd` quatro vezes em separado. O
que regride nesta classe não é a fórmula, é o **escopo**, e escopo só aparece na árvore desenhada.

## Em quantos grupos a obra está é DESEMPATE — e o número não promete gosto

Uma obra pode estar em vários grupos de favoritos (M-pra-N desde a migration 123), e a
**recorrência** — em quantos ela aparece — é curadoria manual. Medida em 2026-08-15 nas 126
favoritas da nuvem (12 grupos, 186 vínculos, 117 obras agrupadas):

| em N grupos | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| obras | 9 | 71 | 28 | 14 | 3 | 1 |

✅ **O que autoriza a feature: ela é ORTOGONAL ao que já existe.** Correlação com a Nota
Prevista **0,13** e com o Alinhamento **0,11**; a média prevista é plana entre as faixas
(7,63 → 7,83 → 7,77). E ela **separa 309 dos 481 pares empatados na Prevista exibida —
64%**, número da mesma família do "arte desempata 67%". Logo: entra como **nível de
ordenação** e **linha do comparador**, não como um ranking próprio.

🔴 **NÚMERO, nunca chip aceso.** 2+ grupos são **36% das favoritas** — destaque em 1 de cada
3 linhas é o alarme que ninguém lê, a mesma régua que mantém o Alinhamento fora dos chips de
lista. A cor também não serve de identificação: os 12 grupos usam **4 cores**, e `Spicy`,
`Best Spicy` e `Fotos boas` dividem o mesmo rosa. Quem nomeia é o **hover**.

🔴 **O texto da UI fala em RECORTES, nunca em gosto — e isso é medido, não estilo.** Os
grupos têm duas naturezas: uns descrevem a obra (`Spicy`, `Best Spicy`, `Fotos boas`,
`Ideal`), outros o estado dela no fluxo (`Lendo agora`, `Next`, `Ongoing`, `Ranking`,
`Iniciadas`, `Recomendações`, `Recomendado`, `10 de agosto`). Das 46 obras em 2+ grupos:
**8 só-tema · 8 só-fluxo · 30 mistas** — e a de maior recorrência (5) tem **quatro** de
fluxo. "Onde seu gosto converge" seria falso em 38 das 46. Separar as duas leituras exigiria
marcar o TIPO do grupo (coluna nova em `work_lists`): **decidido em 2026-08-15 NÃO fazer**.

⚠️ **Grupo contido em outro infla a contagem sem convergência nenhuma.** `Best Spicy` (13)
está 100% dentro de `Spicy` (53), e é o **único par assim em 33 possíveis (3%)** — raro o
bastante para virar aviso no card do grupo contido, que é o que impede a coluna de mentir.

**Dono único: `getGroupMembership()`** (`server/queries/lists.ts`, `cache()` por requisição).
Quatro superfícies consomem dele — a coluna, a ordenação, o card derivado e o comparador —
porque quatro contagens próprias é a classe "dois critérios pro mesmo fato" com quatro lados.
`groupCountsFrom()` deriva o Record que o `getRanking` ordena. **Custo: ZERO consulta nova**
em /favorites; `getListsWithSummary` e `getListsForPicker` já paginavam esses itens e
descartavam o vínculo.

**`/favorites/multi` é o TERCEIRO pseudo-id** (com `all` e `ungrouped`) — irmão do "Sem
grupo": as duas visões derivadas respondem perguntas opostas sobre a mesma coleção ("o que
falta organizar" × "onde os recortes se cruzam"), nenhuma tem linha em `work_lists`. Corte
2+, sem limiar inventado: quem destaca é a ordenação.

🔴 **O default de ordenação precisa ser UMA constante para os dois lados.** O painel de
filtros tem default próprio (`expected_score:desc`); sem recebê-lo da página, ele desenhava
**"N. Prevista · 1 nível" sobre uma lista ordenada por Grupos** — e o "Aplicar filtros"
seguinte reescrevia a URL, apagando a ordenação da página (o bug do rascunho da seção
abaixo, agora pela ordenação). Medido na tela; `tsc` e a suíte passavam limpos.

⚠️ **A coluna só é ORDENÁVEL onde o dado existe.** Em /catalog e /ranking a contagem não é
carregada, então a entrada em `sortableColumns` é condicional a `groupsByWorkId` — senão o
clique no cabeçalho reordenaria por `expected_score` em silêncio. Quem pegou isso foi
`tests/unit/orchestration/coluna-ordenavel-tem-campo-aceito.test.ts`, que passou a entender
emissão condicional (a regra é derivada da FORMA do código, não uma exceção com "groups"
dentro).

Guardado por `tests/unit/favorites/recorrencia-em-grupos.test.ts` (aninhamento, corte 2+,
gate do anônimo), `tests/unit/ui/coluna-grupos-recorrencia.test.tsx` (RENDER — um teste que
lesse o mapa passaria verde com o número fora da tela) e
`tests/unit/orchestration/recorrencia-uma-fonte-so.test.ts`, que **captura o identificador**
de que cada ponta deriva em vez de casar o nome da variável. As três foram conferidas com
sondas.

## O painel de filtros é RASCUNHO — navegar por fora dele apaga o filtro

`RankingFilters` (usado por `/ranking` **e** `/favorites`) escreve tudo em `draftSearch` e só o
"Aplicar filtros" navega. 🔴 **Qualquer coisa que mude a URL sem passar pelo rascunho é apagada
no Aplicar seguinte**, porque ele reescreve a query string inteira a partir de uma foto que não
conhece aquela mudança — sem erro, com cara de "não aplicou".

Foi assim com o segmentado "Esconder tags evitadas", o único controle feito de `<Link href>`.
Hoje ele é rascunho como os demais, e o rascunho **adota a URL** quando ela muda por fora
(ajuste durante o render, com `lastApplied` em STATE — ler `ref.current` no render é proibido
pelo lint do React). Isso cobre o resto da classe: `updateSort` do cabeçalho da tabela, chips da
view Faixas e o voltar/avançar do browser. Ao adicionar controle no painel, use `updateParams`;
se precisar navegar na hora, navegue **a partir do rascunho** (como `applyPreset`/`clearAll`).

## Em σ, use LIMIAR — nunca argmax

Os chips de "atributos em destaque" do card mostram o que passa de **|z| ≥ 1σ** (até 3), com o σ
**impresso**. Não é estilo: o `work-signature.ts` rotulava a obra pelo ARGMAX do z-score e foi
removido em 2026-08-05 porque o campeão vencia por margem < 0,25σ em **47%** do catálogo —
remedido em 06-08 e deu **46,9%**. Com limiar, 93,5% das obras têm ≥1 destaque (mediana 3), e o
σ impresso deixa a margem visível em vez de afirmar um "dominante" que o dado não sustenta.

A cor diz **direção** (acima/abaixo do catálogo), nunca valor — Tragédia +1,3σ não é boa nem
ruim. Quem opina é o ▲/▼, que cruza com `score_weights`; para peso NEGATIVO, "contra" só quando
`score > threshold`, porque abaixo dele o `calculateGPT` não penaliza nada.
⚠️ `score_weights` é tabela COMPARTILHADA — o ▲/▼ herda a Fase 3, igual à Nota.IA, que já lê
essa mesma tabela global no recalc per-usuário.

## Tag amada tem DOIS níveis, e o segundo é forma — não um verde mais escuro

A ênfase **2×** (`user_tag_preferences.weight ≥ STRONG_TAG_WEIGHT`, o botão ✨ de
`/preferences`) aparece no chip como **♥ preenchido** (amada) ou **⊘** (evitada), e as fortes
vêm **primeiro** dentro do bloco. Três superfícies, um componente só
(`components/ui/tag-stance-mark.tsx`): card Tags da obra · prévia e popover do comparador ·
"Informações sobre a obra" da `/my-ai-scores`. Régua desde 2026-08-08.

Medido no clone local (981 obras, 164 declarações): **895 obras (91,5%)** misturam os dois
níveis no mesmo bloco "Amadas", **43%** dos chips amados são 2× (4.851 de 11.364), mediana de
**11,6 amadas por obra** (máx. 56). Não é caso raro — é metade de um bloco inteiro pintado igual.
Do lado vermelho é o oposto e por isso importa mais: evitada forte existe em **32 obras**, e era
exatamente ela que sumia entre três evitadas comuns.

🔴 **O sinal é FORMA porque os dois níveis dividem a mesma cor de stance.** Trocar o glifo por
"um verde mais firme" devolve o problema pra quem enxerga cor com dificuldade — e, com 43% dos
chips no nível forte, o gradiente vira ruído em vez de leitura.

⚠️ **`STRONG_TAG_WEIGHT` (`lib/tags/segment.ts`) é o dono único do limiar.** Ele já governava o
filtro "Esconder tags evitadas → só as fortes" (`hide_avoided=strong`), onde estava **copiado**
como `>= 2` em `/ranking` e `/favorites`. Uma 3ª cópia é como a tela marca de forte uma tag que
o filtro não esconde — mesma armadilha do `LOW_BALANCE_USD`.

⚠️ **Tag vinda do PERFIL de gosto nunca é forte, de propósito.** A régua de lá é `strength` 0–1
(inferida pelo modelo; medido: 0,55–0,95, média 0,78) — outra escala, cujo "alto" precisaria de
um limiar inventado. Por isso `TagStanceInfo` carrega `source: "declared" | "profile"`: sem ele o
tooltip diria "você marcou" sobre algo que ninguém marcou, e a pessoa iria procurar em
`/preferences` uma linha que não existe.

⚠️ **Quem RESSORTA depois do `segmentTags` precisa de `strong` como 1ª chave.** A partição por
nível é estável, mas a página da obra reordena por proveniência (externa antes de IA) — omitir
`strong` ali desfaz a partição em silêncio, e os dois níveis voltam a se intercalar.

**Fora da régua, de propósito:** `/preferences` (é onde a ênfase se DECLARA — já mostra o 2×) e
os chips do perfil em `/account` (régua `strength`, não `weight`; mesmo desenho ali afirmaria que
os dois números são o mesmo).

## A `/account/taste-profile` PROVA que entende você — e três números mentem se forem "melhorados"

`components/account/taste-profile-panel.tsx` + `lib/ai-recommendation/profile-tag-origin.ts`
(v3, 2026-08-09). A página responde UMA pergunta — "o quanto vocês entendem meu gosto?" — e a v2
respondia em **4.020px com a prova em 6º lugar**. Hoje é **hero + 4 abas** (A prova · Seus
critérios · Tags e temas · O que isso muda). O estado das abas mora no componente PAI: os painéis
desmontam, e estado dentro deles zeraria a cada ida e volta.

**A manchete é concordância INDEPENDENTE, não correlação.** `getRatedWorksForProfile` manda obra
(título, notas, sinopse, critérios, tags) e **nunca** manda `user_tag_preferences` — conferido no
código. Então tag que aparece nos dois lados com a mesma stance é evidência, não eco. Medido no
v23: **17 de 17 concordam · 23 a IA descobriu sozinha · 130 declaradas ficaram fora do destilado**.
🔴 Se um dia o prompt do perfil passar a receber as preferências declaradas, isto vira **circular**
e a seção tem que SAIR da tela — a UI não percebe sozinha.

Os três números que ficam piores quando alguém tenta melhorá-los:

1. 🔴 **Só declaração de nível TAG conta.** `getDeclaredTagPreferences` EXPANDE grupo/subgrupo pra
   todas as tags membras — certo pro ranker, e aqui infla de graça: quem marca um grupo inteiro faz
   qualquer tag dele "concordar" sem nunca ter opinado sobre ela. Medido: com expansão, **314
   declaradas e 23 concordâncias**; só nível tag, **147 e 17**. Dono do limiar:
   `COUNTS_AS_DECLARATION`.
2. 🔴 **O "N de 20" fica no ALINHAMENTO, nunca na Nota Prevista.** Pela Prevista dá número melhor —
   **18 de 20, corr. 0,851 contra 0,769** — e errado: `calculations.ts` treina o Ridge nas obras
   COM `user_score` e prevê pra TODAS, inclusive essas, então o `expected_score` persistido delas é
   **in-sample**. Seria o modelo confirmando o rótulo em que foi ajustado. Por isso
   `getAlignedWorkSplit` ordena as TRILHAS por `expected_score` em **cópias** — o array original
   segue por `personal_fit`, de que a confirmação depende.
3. ⚠️ **Stance oposta é CONFLITO, nunca confirmação.** Somar os dois transformaria discordância em
   prova de acerto — o único caso em que a manchete sobe enquanto o entendimento piora.

🔴 **TAG ≠ TEMA, e a diferença é FUNCIONAL.** `netNameOverlap` — quem calcula o Alinhamento — só
consome os NOMES de `loved_tags`/`avoided_tags`: um TEMA (frase livre da IA) não existe no
catálogo, não casa com obra nenhuma e **não entra no cálculo do alinhamento** — só contextualiza
prompts. ⚠️ Esta linha dizia "`computePersonalFit` … + critérios", e os dois pedaços estavam
errados: a função foi REMOVIDA em 15/08/2026 (morta desde 27/06) e critério nunca entrou no
Alinhamento. Por
isso a distinção é de **FORMA** (pílula × linha de texto), não de cor: os dois já dividem a cor de
stance, e frase de ~60 caracteres nunca foi chip.
⚠️ Coração de **contorno**, nunca preenchido — o preenchido é o marcador de ênfase 2×
(`TagStanceMark`, 3 outras superfícies), e tag de perfil **nunca é forte** (escala `strength` 0–1).

⚠️ **As 9 `criterion_preferences.note`** (uma frase da IA por critério) existiam no banco desde
sempre e a v2 **não mostrava nenhuma** — era o dado mais explicativo do perfil, 100% invisível. Na
linha do critério, **faixa** (`ideal_min`–`ideal_max`) e **peso** são campos ROTULADOS e separados:
na v2 a barra desenhava a faixa e o "%" ao lado era o peso, sem nada dizendo que eram grandezas
diferentes — em Humor a barra é larga (4–8,5) com peso 50% e em Romance é estreita (7–9,5) com 90%,
então "barra maior = número maior" se invertia.

A página inteira é saída de LLM: reusa `AiProvenanceSeal` (não faça outro selo). Guardada por
`tests/unit/ui/perfil-gosto-painel.test.tsx`, que é teste de **RENDER** de propósito — a `note`
fora da tela, o tema com forma de tag e o mesmo número impresso duas vezes passariam verdes num
teste que lesse o objeto do perfil.

## No comparador, o CABEÇALHO identifica e as LINHAS comparam

`components/titles/work-compare-drawer.tsx` (2026-08-14). A régua responde a uma pergunta só:
*isto compara obras entre si?* Se sim, é linha — ordenável, ocultável no seletor "Linhas", e
sujeita ao "só diferenças". Se só identifica a obra, fica no cabeçalho da coluna.

O que a ausência dela produzia, medido no mockup que replica o CSS antigo:

| sintoma | medida |
|---|---|
| vão entre título e Sinopse | **24px e 8px alternando** entre colunas vizinhas (`justify-between` + título de 1 ou 2 linhas) |
| altura do cabeçalho | 137px, com capa de 78px |
| depois | **118px** de altura, capa **94px**, botão Sinopse a 83px do topo em TODAS as colunas (medido no app) |

O que mudou de lugar: **Interesse** (♥♥♥) saiu de dentro do botão de Sinopse e virou linha —
era a única medida da tela fora de uma linha, logo a única que não dava pra ordenar nem
esconder. **Publicação** e **Meu status** viraram duas linhas (dimensões diferentes: uma é da
obra, a outra é sua; juntas, o `flex-wrap` quebrava em coluna estreita e esticava a altura de
todas as colunas). **18+ e ano** subiram pro cabeçalho, e a linha "Ano" passou a nascer oculta —
some do padrão, continua no seletor porque é o único jeito de ORDENAR por ano.

🔴 **Dois defeitos que a tela escondia, os dois da família "dois critérios pro mesmo fato":**

- **"Só diferenças" media Capítulos por `lidos/total` e a célula imprimia só o total.** Duas
  obras com 45 capítulos e leituras diferentes sobreviviam ao filtro e apareciam como `45` e
  `45` — o filtro parecendo quebrado. Hoje `chaptersCellText()` é dona das duas pontas.
- **Cores claras fixas sem variante `dark:`** — `text-rose-600` no ♥ e `bg-rose-50
  text-rose-700` no popover da sinopse: no tema escuro, ♥ vermelho sobre fundo escuro e um
  bloco quase branco.

⚠️ **`is_adult` e `isFavorite` já vinham do banco e eram descartados** (`getWorksByIds` é
`select *`). Exibi-los custou uma linha no tipo e uma no mapeamento — zero query, zero egress.

⚠️ **Célula é CENTRALIZADA por padrão** (`CompareCell`), porque cada linha é lida na horizontal
e alinhamento misto faz o olho reancorar. A exceção é Gêneros·Tags, texto corrido em muitos
chips, onde a borda esquerda é o que dá o que ler.

⚠️ **Mudar CHAVE de linha exige bump do `ROWS_CONFIG_STORAGE_KEY`** (hoje `v6`).
`normalizeRowsConfig` descarta chave desconhecida: sem o bump, quem tinha "status" escondido
veria as duas linhas novas VISÍVEIS — a escolha da pessoa invertida em silêncio.

⚠️ **O grupo "Básico" ganhou cabeçalho colapsável** quando foi de 3 para 5 linhas — era o único
sem, e o que mais cresceu. A condição é "existe ALGUMA linha visível": título de seção sobre
nada é pior que título nenhum, e o seletor de Linhas pode esconder as cinco.

⚠️ **O tooltip do título traz os alternativos**, ordenados por `sortByTitleLanguage` (o mesmo
dono da página da obra — sem ele, o alternativo legível cai em posição aleatória entre
romanizações). Corta em 3 + "(+N)": `title=` nativo não rola nem tem largura máxima.

Guardado por `tests/unit/ui/comparador-linhas-e-cabecalho.test.ts`.

## Três controles do painel de filtros que mentiam pelo desenho

Todos de 2026-08-14, em `components/ranking/ranking-filters.tsx` (`/ranking` e `/favorites`):

🔴 **O "Todos" de status não fazia nada quando já estava marcado.** Ele gravava `null`, e em
`/favorites` — onde a ausência do parâmetro JÁ significa "sem filtro" — o painel relia o mesmo
estado e redesenhava tudo marcado. Chegar a "só Completed" custava desmarcar os outros quatro a
dedo. Hoje ele volta ao PADRÃO (`Completed` · `Want to Read + Untracked`), e o padrão sai de
`BASELINE_PUBLICATION_STATUSES`/`BASELINE_PERSONAL_STATUSES` — as mesmas constantes que a página
já usava como filtro implícito. Escrever a lista no `onClick` levaria a um estado que a página
não reconhece como padrão, e o "Todos" reacenderia no render seguinte.

🔴 **O filtro de arte tinha o mais restritivo no MEIO**: `Tudo · Forte · Sem fraca`, sendo que
"Forte" é o topo 20% e "Sem fraca" corta só o fundo 20%. Segmentado é lido como escala. Hoje é
`Tudo · Sem os 20% piores · Top 20%`, com ordem em `ART_FILTER_ORDER` e o "20%" **derivado de
`ART_BAND_CUTOFFS`** — o número no botão e o que corta a faixa são o mesmo fato.

⚠️ Havia uma 2ª cópia dos rótulos (`ART_FILTER_LABELS`) que **ninguém lia**: repetia palavra por
palavra o texto de `ART_BAND_LABELS` (o do card da obra) e só era exercitada por um teste que
lia o objeto, não a tela. Foi apagada; o tooltip do controle deriva de `ART_BAND_LABELS`.

⚠️ **Custo medido dos rótulos novos:** o segmentado vai de 180 para **249px** e a linha passa a
quebrar em duas de 1440 a 1920px (o vizinho "Esconder tags evitadas" não quebra). Não estoura o
card, e **o painel não cresce**: "Conteúdo exibido" tem **53px de folga vertical** contra os
~36px que a quebra consome. Encurtar para caber exigiria algo como "Sem 20%", que não diz de quê.
⚠️ O controle é gateado por dono, então **não dá para vê-lo sem sessão** — as larguras acima
foram medidas clonando a linha vizinha no browser, com a fonte real, e a árvore desenhada é
guardada por `tests/unit/ranking/filtro-de-arte-render.test.tsx` (que monta o segmentado pelo
MESMO `ART_FILTER_ORDER.map` do painel: uma cópia dos três botões passaria verde com o painel
enumerando à mão de novo).
⚠️ Os cortes saíram de `lib/art/model.ts` para **`lib/art/bands.ts`** por peso de bundle: o
painel é `"use client"` e importar o modelo levaria `lib/ml/{ridge,logistic,preprocessing}` junto.

⚠️ **O chip de ordenação escala com a quantidade de níveis** (`SORT_CHIP_SCALE`): 1 nível ocupa
a linha (36px/14px), 5 ficam compactos (26px/12px). Duas armadilhas medidas: `SelectTrigger` traz
`data-[size=sm]:h-8` e **seletor de atributo vence classe** — sem `!` na altura, o trigger fica
em 32px sempre (a `h-6` original já era letra morta); e `flex-1` com `flex-wrap` estica o ÚLTIMO
chip da última linha (medido: 329px contra 157px), por isso o `grow` vale só no nível único.

## Inline type imports and Turbopack

Turbopack (Next.js 16) fails to parse `import { type Foo }` inline syntax when a client component is traversed from a server context. Always use separate `import type` statements:

```ts
// ❌ breaks Turbopack
import { workFormSchema, type WorkFormValues } from "@/lib/validations/work.schema"

// ✅ correct
import { workFormSchema } from "@/lib/validations/work.schema"
import type { WorkFormValues } from "@/lib/validations/work.schema"
```

Also: files without extensions (e.g. `work-form` alongside `work-form.tsx`) are resolved by Turbopack before the `.tsx` file. Rename any such files to `.bak` or `.unused`.

## `output: "standalone"`: `npm start` ≠ `next start`, e o servidor não lê `.env`

`next.config.ts` usa `output: "standalone"` (pacote enxuto pra imagem Docker). Isso muda o servidor de
produção, e três coisas falham **sem erro claro** — todas resolvidas em prod pela plataforma (Fly), mas
que mordem ao rodar local:

- **`next start` NÃO funciona** com standalone (o próprio Next avisa e sobe um servidor que não serve
  a build). O servidor certo é `.next/standalone/server.js`. `npm start` já aponta pra
  `scripts/start-standalone.mjs`, que faz isso — **não troque de volta pra `next start`**.
- **`public/` e `.next/static/` ficam FORA do pacote** (num deploy real vão pro CDN). Sem copiar pra
  dentro, o servidor responde **200 com a página inteira sem CSS e sem JS** — parece bug de estilo, é
  de deploy. O Dockerfile copia (linhas 21-23); o script `start-standalone` reproduz local.
- **`server.js` não lê `.env.local`** (em prod quem injeta as env é a plataforma). Sem isso, toda
  página morre com `supabaseKey is required` numa tela genérica. O script injeta local.

Corolário do file tracing: ele erra pro lado de **incluir demais**. Já puxou `.cache/comix-chrome/`
(o Chrome de 90 MB do sidecar, que o Next nunca executa) pra dentro do artefato —
`outputFileTracingExcludes: { "**/*": [".cache/**"] }` corta. Ao adicionar dependência pesada que só um
sidecar usa, confira se ela vazou pro standalone (`du -sh .next/standalone`).

🔴 **O `.dockerignore` NÃO herda o `.gitignore`, e o sintoma disso é um 401.** São arquivos
separados com sintaxe parecida, e o Docker só lê o primeiro. Em 2026-08-10 o contexto do
`flyctl deploy` era **1,7 GB / 4.267 arquivos** — `.backups/` (1,4 GB), `.cache/`, `Imagens/`,
`.local-experiments/`, **todos já no `.gitignore`**:

```
load build context   471,5s     (74% dos 638,5s da build)
```

O deploy falhou com `ensure depot builder failed (status 401)` **depois de a build passar
inteira** (19/19 etapas, 12 camadas enviadas): o arrendamento do builder do Depot venceu antes
do fim e a retomada não autenticou. Parece credencial (`flyctl auth whoami` estava válido) e é
tamanho. Depois de excluir: **1618 MB → 19 MB (87×)**, build de 638,5s → **108,1s**.

⚠️ **`node_modules` sozinho casa só a RAIZ** — `services/comix-render/node_modules` (28 MB, de
um sidecar que este Dockerfile nem deploya) passava batido. Precisa de `**/node_modules`.

⚠️ Regra de leitura: se a saída mostra camadas sendo exportadas/enviadas, o problema **não** é
credencial. Leia o `WARN Build context is …` no topo antes de mexer em auth.

## Preferência de UI que o servidor renderiza vai em COOKIE, nunca em localStorage

O servidor **não enxerga** `localStorage`. Se o estado inicial de um componente é lido dele, o HTML
do SSR sai com um valor e o primeiro render do cliente sai com outro — a **hidratação quebra** e o
React descarta a árvore inteira e re-renderiza.

Isto já custou caro: o colapso da sidebar morava em `localStorage`, e **toda navegação** com o menu
recolhido jogava `Hydration failed` + `Cannot read properties of null (reading 'parentNode')` no
console — e o menu **piscava** de expandido pra trilho. Sobreviveu meses porque o sintoma parece
ruído de dev e "o app funciona".

```ts
// ❌ o servidor não sabe disto → SSR diverge do cliente
const [collapsed, setCollapsed] = useState(() => localStorage.getItem("x") === "1")

// ✅ cookie: o layout (servidor) lê e passa como prop → os dois lados começam iguais
// app/layout.tsx:  const collapsed = (await cookies()).get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1"
// <Sidebar defaultCollapsed={collapsed} />
```

Ver `lib/sidebar-preference.ts`. Duas armadilhas vizinhas:

- **`adjust-during-render`** (setState durante o render quando o pathname muda) dispara **na própria
  renderização de hidratação** se o "último valor sincronizado" começar em `null`. Semeie-o com o
  valor inicial — senão ele roda antes da hidratação terminar e recria o mesmo bug.
- **Nome de cookie não aceita `:`** (não é token válido no RFC 6265). Use `sidebar_collapsed`.

## Dados do "chrome" têm TRÊS estados, e o terceiro é clicável

Componentes do chrome (chip da conta, badges, saldo) buscam via `useChromeData` **no cliente** —
existe uma janela real em que o dado é `null`. Tratar `null` como "vazio/não logado" é um bug: o menu
da conta, na primeira versão, abria **sem o "Sair"** nessa janela — um app aparentemente sem logout.
Renderize um estado de carregamento explícito e **nenhuma ação de auth/irreversível** até o dado
chegar. Pra testar esse ramo, atrase a server action no Playwright (`page.route` + delay quando
`headers()["next-action"]`) — em dev ela resolve rápido demais e o estado nunca aparece.

## O avatar é DERIVADO da URL — não existe coluna de configuração

`user_settings.avatar_url` é dona única, e guarda **uma string com três formas**: `""` (o chip cai
no ícone), `/avatar.svg?estilo=…&cabelo=…` (montado em `/account`) ou a URL de um upload no bucket
público `avatars`. Quem consome — `components/layout/account-chip.tsx`, o card de `/account`,
qualquer `<img>` futuro — vê só uma URL comum e **não sabe montar avatar**. É isso que os mantém
triviais.

| peça | papel |
|---|---|
| `lib/avatar/render.ts` | renderizador ÚNICO: `config → SVG`. Paletas, 12 personagens + 12 símbolos |
| `lib/avatar/url.ts` | fronteira de confiança: `sanitize`, `config ↔ URL`, `isValidAvatarUrl` |
| `app/avatar.svg/route.ts` | redesenha a partir da query string, `immutable` por 1 ano |
| `components/account/avatar-picker.tsx` | o painel (estilo, cabelo, pele, olhos, fundo, sortear, upload) |

🔴 **Preset É uma configuração — não um segundo conjunto de arquivos.** As miniaturas da grade são
desenhadas com a config ATUAL do usuário, pelo mesmo `renderAvatar`. Se a galeria tivesse imagens
próprias, ela e o resultado divergiriam no primeiro ajuste de paleta, em silêncio — a família
"dois critérios pro mesmo fato" de novo. Guardado por `tests/unit/avatar/avatar-picker.test.tsx`,
que é teste de **RENDER** de propósito: miniatura fixa passaria verde num teste de função pura.

🔴 **`sanitizeAvatarConfig` é defesa contra INJEÇÃO, não higiene.** O renderizador interpola cor
direto em atributo SVG e a rota responde `image/svg+xml` — documento **executável** se alguém
navegar até ele. Cor só passa por `/^[0-9a-f]{6}$/i`; estilo só se existir em `ESTILO_POR_ID`.
Valor fora da régua **vira o padrão em silêncio**, de propósito: URL antiga de uma paleta
aposentada tem que continuar desenhando alguém, senão um rename esvazia o chip de todo mundo.

⚠️ **O diretório chama-se `avatar.svg` e isso não é estética.** O matcher do `middleware.ts` exclui
`.*\.(svg|png|…)$`, então a rota não paga refresh de sessão a cada carregamento do chip. Movê-la
pra `/api/avatar` reintroduz esse custo em toda navegação, sem nada acusar.

⚠️ **O preview do painel usa data URI, não a rota.** Mexer numa cor gera URL nova a cada clique, e
cada uma seria uma requisição — o avatar piscaria enquanto a pessoa escolhe. Só o que vai pro banco
é a URL.

🔴 **Imagem que não carrega é ESTADO, e o `onError` calado já custou caro.** Até 2026-08-14 o
`avatar_url` do dono apontava para `djbreiyzwoevbmoscqiq.supabase.co` — um projeto Supabase
**extinto** (o host nem resolve). O `<img onError>` caía no ícone padrão e a tela afirmava "você
não tem avatar"; o dado ficou meses inválido sem nada acusar. Hoje o painel diz que a imagem não
carrega. **Foi pelo campo de texto "URL da imagem" que aquele ponteiro entrou** — ele SAIU: era a
terceira forma de definir a mesma coisa.

🔴 **O bucket `avatars` não existia neste projeto até a migration 191.** A metade de Storage da
090 foi aplicada no projeto ANTERIOR; `storage.buckets` na nuvem tinha só `criteria-icons`, e o
`uploadAvatar` — vivo no código desde a 090 — falhava em toda tentativa. ⚠️ `db:pull` dumpa só o
schema `public`, então o stack local também não tem o bucket e **nunca vai ter por replicação**.

⚠️ **Paletas e `CONFIG_PADRAO` em hex MINÚSCULO.** O sanitize normaliza pra minúsculo, então com
paleta em maiúsculo a ida e volta `config → URL → config` deixa de ser identidade e a comparação
"esta cor está selecionada?" passa a depender de `toLowerCase()` espalhado. Guardado no
round-trip de `tests/unit/avatar/avatar-url.test.ts`.

⚠️ **Controle sem efeito não fica na tela:** símbolo não tem pele nem olhos, e a máscara da
Kitsune cobre o rosto (`substituiRosto`) — nesses casos os dois controles somem. O corte é por
propriedade do estilo, nunca por uma lista de ids.

⚠️ **Ao desenhar estilo novo, três armadilhas medidas no Chromium:** gradiente `objectBoundingBox`
num traço VERTICAL não pinta (bbox de largura zero — a spec manda não renderizar), daí
`userSpaceOnUse`; ponta de cabelo solta deixa o crânio à mostra e lê como coroa; e vale abaixo da
linha da franja auto-intersecta o caminho e abre buraco no preenchimento. Confira a 36px, não a 120.

## Capa que não carrega: o fallback existia e estava DESLIGADO em 34 de 36 telas

Irmã da regra do avatar logo acima — lá o `onError` calado afirmava "você não tem avatar"; aqui
ele afirma "esta obra não tem capa". `components/ui/cover-image.tsx` aceita **`urls`** (candidatas
em ordem) e avança no `onError` até uma carregar; com **`url`** (uma só) ele não tem pra onde ir e
desenha o traço "—". A docstring dele promete o fallback, e **34 dos 36 pontos de uso passavam
`url`**: capacidade construída e desligada é pior que ausente, porque quem lê o componente acha
que está coberto.

🔴 **E o host inteiro da Comix caiu sem nada acusar.** Medido em 15/08/2026 nas 990 obras da
nuvem, capa por capa: **29 (2,9%) exibiam capa morta**, e em **21** havia alternativa VIVA na
própria `work_covers` — o app tinha a capa boa na mão. **23 das 29 eram `static.comix.to`**, e
numa amostra de 15 capas de lá **ZERO respondem 200**: é o mesmo Cloudflare de 11/08 que matou o
fetch de reviews da Comix, e ele levou as capas junto. `<img>` que falha não emite erro, não corta
layout e não gera rolagem — o defeito viveu 4 dias invisível.

**Duas frentes, porque são dois problemas.** O `urls=` cura quebra futura sozinha, mas conserta
**uma tela por vez**; consertar o DADO conserta as 34 de uma vez, e é o que a ferramenta faz:

```bash
npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/repick-dead-covers.ts
#   ALVO: NUVEM · US$0 · ensaio por padrão; --execute grava e salva o estado anterior
```

⚠️ **Ela escolhe por `scoreCover`, não "a próxima da ordem".** Pegar a próxima promovia uma
miniatura do Google Imagens e um `i.pinimg.com` de 736px tendo CDN de verdade na mesma lista.
🔴 `encrypted-tbn*.gstatic.com` fica em ÚLTIMO como desempate: aquelas URLs **expiram**, então
promovê-la recria o próprio defeito. Isso **não** é preferência de fonte — essa régua já foi
medida e reprovada em 07/2026 (a ordem por fonte acertava a melhor capa em só 32% das obras);
`tbn` não é fonte, é proxy temporário de uma.

⚠️ **"Viva" é a ASSINATURA do arquivo, nunca o `content-type`:** a Tappytoon devolve `image` (sem
a barra) num JPEG válido, e um `startsWith("image/")` reprovou 2 capas boas na 1ª medição. Do
outro lado o Cloudflare devolve 403 com `text/html` — então o status também não basta sozinho.

⚠️ **Sobram 7 obras sem NENHUMA capa viva.** Aí o fallback não tem o que escolher: precisam de
capa nova de alguma fonte. E 33 telas seguem passando URL única — cobertas pelo conserto no dado,
mas não se curam sozinhas na próxima fonte que cair.

## Supabase: o `select` corta em 1000 linhas, sem avisar

`supabase.from(x).select(...)` devolve **no máximo 1000 linhas** por padrão, **sem erro e sem
aviso** — a query "funciona" e você trabalha com um recorte achando que é o universo.

```ts
// ❌ silenciosamente truncado (work_reviews tem ~14k linhas)
const { data } = await sb.from("work_reviews").select("work_id, source")

// ✅ pagine
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from("t").select("...").range(from, from + 999)
  if (!data?.length) break
  linhas.push(...data)
  if (data.length < 1000) break
}
// ✅ ou, quando só precisa contar
const { count } = await sb.from("t").select("*", { count: "exact", head: true })
```

Isto já custou caro: um backfill mirou em **22** obras quando o alvo real eram **339**, e teria
terminado "com sucesso" tendo processado 6% do trabalho. É o padrão mais perigoso do projeto —
**um erro que produz resultado**. Ao contar qualquer coisa acima de ~1k linhas, confirme com
`count: "exact"` antes de confiar no `select`.

🔴 **O caso mais próximo de disparar, achado em 2026-08-14 e corrigido:** a leitura de
`work_embeddings` em `loadEmbeddingCandidates` não tinha `.range()` NEM `.limit()`. Medido no
mesmo dia: **985 linhas — 15 do corte.** Passando de 1000, as linhas truncadas sumiriam do mapa
de hashes, as obras correspondentes pareceriam "nunca embedadas" e seriam **re-embedadas e
re-pagas a cada execução**, com o painel dizendo "N atualizados" e nada acusando.

⚠️ **A tabela vizinha tinha o problema INVERSO, e o mesmo dono.** `works` era lida com
`.limit(2000)` — opt-out explícito do corte — numa requisição só, com quatro joins e as colunas
mais gordas da tabela: **8,6 MB crus em 978 linhas**, a maior resposta única do app. É a
suspeita do `TypeError: terminated` que o painel de embeddings exibia (undici lança isso quando
o CORPO da resposta morre no meio, o que acontece se o PostgREST estourar o `statement_timeout`
DEPOIS de mandar os headers). ⚠️ Hipótese, não causa confirmada — a falha não foi reproduzida e
um corte de rede dá a mesma mensagem.

Hoje as duas paginam em faixas de **200** (o peso ali é BYTE, não linha: 1000 linhas dessa
projeção são os mesmos 8,6 MB). Medido depois: carga a quente da página de `/curation/settings` em
**0,3s** — a paginação não custou latência. E a falha de transporte passou a ganhar contexto
(`comContexto`): `fetchAllRows` rotula só o erro que o PostgREST DEVOLVE, enquanto queda de
conexão é exceção LANÇADA pelo `fetch` e subia crua até o toast. Guardado por
`tests/unit/orchestration/embeddings-leitura-paginada.test.ts`, conferido reprovando a versão
antiga.

## Constants generated from DB

These files are **fully overwritten** by `npm run sync-constants` and must not be edited by hand:

| File | Source table(s) |
|---|---|
| `lib/constants/criteria.ts` | `criteria` (eval_type=IA) + `publication_status` + `personal_status` + `source` |
| `lib/constants/post-reading-criteria.ts` | `criteria` (eval_type=User) |
| `lib/constants/tag-groups.ts` | `tag_group` |
| `lib/constants/tags.ts` | `tags` + `genres` (autocomplete catalog) |
| `lib/constants/ui-labels.ts` | `ui_labels` (`LABELS` keyed by field → `{full, short, abbrev, tooltip_full, tooltip_short}`; free-floating UI names/tooltips not owned by another table) |
| `lib/external/types.ts` | `source` (ExternalSourceId only, rest preserved) |
| `lib/external/source-order.ts` | `source` (`EXTERNAL_SOURCE_ORDER`, coluna `order`; só o bloco entre os marcadores `<generated:external-source-order>`). ⚠️ Esta ordem governa DOIS usos ao mesmo tempo: a EXIBIÇÃO das fontes no diálogo E a PRIORIDADE das reviews no prompt da IA (`REVIEW_SOURCE_PRIORITY` em `index.ts` é DERIVADA dela). Mexer no `order` do Supabase muda os dois. |
| `types/domain.ts` | `PUBLICATION_STATUSES`, `PERSONAL_STATUSES`, `PLATFORMS`, `CRITERION_SLUGS` arrays |

The canonical list of AI evaluation criteria (`CRITERION_SLUGS`) comes from the `criteria` table where `eval_type = 'IA'`. Any change to criteria must go through the DB and then `sync-constants`.

`sync-constants` also backfills `work_tags` from the legacy `works.genres` text array using the `genre` tag group.

## Scoring pipeline

> **History (read this first):** the original pipeline had four named scores — Nota.IA → Nota.Calc → Nota.Pr → Nota.Final. The `Nota.Pr` + `Nota.Final` stage was **retired** and replaced by a single **Nota Prevista** (`expected_score`). `lib/calculations/final.ts`/`stacker.ts` were deleted and the `final_score`/`predicted_score` columns dropped in migration 099 (2026-06-14); `lib/calculations/prediction.ts` (dead code, no callers) has since been removed too. The user-facing score is now **Nota Prevista**; **Nota.Calc** lives on as an internal ensemble anchor.

Today a work's score flows through three stages:

1. **GPT (Nota.IA)** — weighted sum of `category_scores` using `score_weights`. Negative-weight criteria (drama, tragedy) only penalise when above `max_negative_threshold`. Result is clamped 0–10 then amplified: `GPT.N = 5 + (GPT - 5) × 1.25` (`lib/calculations/gpt.ts`).

2. **Nota.Calc** (`calc_score`) — blends GPT.N with platform average using Bayesian pseudo-vote pooling, then applies chapter and observation penalties (`lib/calculations/score.ts`). Computed both with and without the observation nudge (`calcScoreNoObs`). Persisted as `calc_score`; kept as a feature/ensemble anchor for stage 3, not shown to the user as the headline score.

3. **Nota Prevista** (`expected_score`) — the headline predicted score. A **single Ridge regression** (`trainExpectedPredictor` in `lib/calculations/expected.ts`) trained on works with a manual `user_score`. Features: the 9 category scores, GPT.N, platform avg, log(votes), chapters, synopsis quality, loved/avoided tag overlap, criterion-fit score, release age, run length, plus categorical publication status (one-hot) and origin country. (8 post-reading "quality" features are added only on the paid plan via `includeQuality`.) The Ridge output is then **blended with Nota.Calc** (`calcScoreNoObs`) using a weight grid-searched on out-of-fold predictions to avoid leakage — `w = 1` (no blend) when training set < 30 or the model is a stub. The observation adjustment is **not** a feature; it is added deterministically once after the blend. Below `MIN_TRAIN = 20` labelled samples the predictor falls back to the training mean. Persisted as `expected_score`.

Recalculation is triggered server-side by `recalculateAll()` in `server/actions/calculations.ts`, sempre via
a fila em `server/recalc/queue.ts` (debounce de 1h; um teste de arquitetura garante que só o runner
importa). ⚠️ **Não existe recálculo por obra** — `recalculateWork` foi citado aqui por muito tempo e
**não existe no código** (conferido 2026-07-29: zero referências). Toda edição de dado custa uma leitura
do catálogo inteiro: **5,3 MB** por rodada (medido). É o maior consumidor de egress do projeto. The honest cross-validated MAE of Nota Prevista is stored in `formula_config` (`cv_mae_expected`). Since the `user_score` label switched from craft to **taste** (2026-07-16 — the average of the 7 fixed taste axes, excluding the "Final"; see `computeTasteUserScore`), the absolute cvMAE rose to **~0.73** (was ~0.58 under craft). This is a **scale artifact**, not a regression: the taste target has a wider spread (σ 0.95→1.25, baseline MAE 0.73→0.98), so normalized the model is slightly better (cvMAE/baseline 0.79→0.75). Don't read the raw ~0.73 as "the model got worse".

## "Alinhamento" é SÓ TAG, e é uma soma sem denominador

Quarto número da página da obra, ao lado dos três acima — e o único que não passa
por Ridge nem por LLM. Dono: `netNameOverlap` (`lib/ai-recommendation/personal-fit.ts`),
chamado no **bloco 5** de `server/actions/calculations.ts`:

```
netName        = Σ strength(amadas presentes) − 1.5 × Σ strength(evitadas presentes)
personal_fit   = (netName − min) / (max − min)          ← min-max sobre o catálogo
personal_fit_percentile = percentil midrank             ← O NÚMERO DA TELA
```

Casamento por **nome em minúsculo, ignorando o grupo** (validado por bootstrap em
27/06/2026: acc-par ~0,544 contra ~0,514 do `group::name`). O perfil é o **efetivo**
— persistido ⊕ tags declaradas em `/preferences`, com encolhimento `λ = n/(n+k)`,
`k` = 5 amar / 8 evitar.

⚠️ **Critério NÃO entra.** `criterionAlignment` existe e é usada, mas como **feature
do Ridge da Nota Prevista** (bloco 2b), não aqui. E `work_genres` também não — só
`work_tags`.

⚠️ **Não confundir com as colunas `alignment_*` da MESMA tabela**, que são o
**Veredito IA** (LLM). O nome da coluna e o rótulo da UI não se correspondem.

🔴 **Sem denominador ⇒ o nº de tags é o TETO do número.** Medido em 15/08/2026 nas
988 obras do clone local:

| tags da obra | obras | percentil médio | mediana |
|---|---|---|---|
| 0–10 | 18 | **8,5** | 6,3 |
| 11–24 | 194 | 26,7 | 21,7 |
| 25–39 | 348 | 45,0 | 45,7 |
| 40–99 | 393 | 64,2 | 71,4 |
| 100+ | 35 | **80,8** | 84,5 |

Spearman nº de tags × percentil: **+0,584**. Distribuição de tags: p10 19 · p25 26 ·
mediana 35 · p90 74 · máx 261.

🔴 **O erro é DIRECIONAL, e é isso que decide onde a ressalva cabe.** Alinhamento ≥75
com <25 tags: **3 obras (0,3%)** — não dá pra inflar sendo pouco tagueado. Já <30 com
<25 tags: **139 (14,1%)**. Logo, valor ALTO é confiável sempre; valor BAIXO em obra
sub-tagueada é ambíguo entre "não combina" e "não sabemos o que é". A ressalva vive no
**tooltip** (opt-in) e a contagem de tags entrou na Matéria-prima do painel "Estado da
obra" — **não** vira chip em lista, pelos mesmos 14,1% (1 em 7 linhas é o alarme que
sempre toca). O `/ranking` não recebe a contagem de propósito: o payload dele não
embute `work_tags` (corte de egress) e, medido, o **top 50 por Nota Prevista não tem
nenhuma obra abaixo de 25 tags** — é justo onde a ressalva menos serve.

⚠️ **Normalizar por nº de tags foi testado e REPROVADO** (03/07/2026): `net/nTags`
piora a acc-par em −0,040 (IC exclui zero), `net/√n` e `net/ln` são neutros. O volume
carrega sinal real — nº de tags tem Spearman **+0,470** com `user_score`, porque é em
boa parte proxy de popularidade. Corolário de produto: o Alinhamento serve pra
**ordenar o que você vai gostar**, não pra **achar joia de nicho**; obra sub-tagueada é
punida por dado faltando. O conserto sem trade-off é COBERTURA de tags, não fórmula.

Guardado por `tests/unit/ui/alinhamento-materia-prima.test.tsx` (RENDER, com contraprova
que reprova o texto antigo) e por `estado-da-obra-painel.test.tsx`.

## O badge "Recalcular notas" só acende com mudança MATERIAL

`markRecalcPending` é chamado de **30 lugares** e o default é MARCAR — e isso está
certo: não marcar deixa nota velha na tela sem nada acusar. O preço era o badge
acender por salvar uma sinopse, por marcar "Lendo" e por ação de leitor cujo estado
o recalc global nem lê.

A régua é **`lib/calculations/recalc-inputs.ts`**, dono único da lista do que o
`recalculateAll` de fato consome (o `select` de `calculations.ts` cruzado com as
features de `expected.ts`), em dois grupos:

| Grupo | Entradas | Vale para |
|---|---|---|
| **Catálogo** | `category_scores`, `platform_ratings`, `total_chapters`, `year` (+`year_end`), `publication_status`, `original_title`, `work_tags`, `catalog_membership` | qualquer um que mexa |
| **Pessoal** | `user_score` (o RÓTULO), `observation_adjustment`, `synopsis_quality`, `attribute_bias`, `tag_preferences`, `taste_profile` | só o **DONO** — é o dele que o recalc global lê |

⚠️ **Fora da régua, conferido:** `personal_status_id`, `chapters_read`,
`last_read_at` e `is_favorite` (estão em `PERSONAL_COLUMNS`, mas em nenhuma
feature) e as 8 `post_*_score` — `QUALITY_NUMERIC_FEATURES` é array VAZIO e
`L0_QUALITY_ENABLED = false`. A pós-leitura entra por UM caminho só, o
`attribute_bias`. Sinopse, capa, títulos alternativos e external ids também não
entram — e note que `work_tags` ENTRA enquanto `work_genres` não.

`markRecalcPending(context, { changed, actorId })`: `changed` omitido = "não sei"
e marca; `[]` = não marca; só-pessoal de quem não é o dono = não marca.

🔴 **O gate falha ABERTO, de propósito.** Dono indeterminado, `changed` ausente,
dúvida de qualquer tipo ⇒ marca. Um badge a mais custa um clique; um a menos
devolve nota errada, calada.

Três armadilhas que custaram a descobrir:

- 🔴 **`numeric` do PostgREST volta como STRING.** Sem `sameRecalcValue`,
  `"8.5" !== 8.5` e todo diff diria "mudou" — o gate nasceria inútil, marcando
  sempre, e **ninguém notaria**, porque o resultado é idêntico ao de antes.
- ⚠️ **`platform_ratings` é delete-e-reinsere**: "houve escrita" é sempre verdade e
  não diz nada. Compare VALOR (digest ordenado), nunca "passou pelo código".
- ⚠️ **`createWork`/`createWorksBatch` continuam marcando de propósito** — é assim
  que a obra nova ganha a primeira Nota Prevista. Obra sem rótulo não entra no
  treino (imputer e scaler são fitados só nele), mas `personal_fit_percentile` é
  percentil sobre o catálogo inteiro.

Declaram materialidade hoje: `updateWork`, `updateWorkStatus`,
`submitPostReadingAttributes`, `saveTagPreferences` e `taste_profile_new_version`.
`setReadingStatusForWorks` **deixou de marcar** (só grava status e capítulos). Os
demais marcam sempre.

⚠️ **Ainda marcam à toa, conhecido e não escondido:** `updateWorkExternalData`
quando "Atualizar dados" não acha nada novo; `setSynopsisQuality` e
`calibration-revert` quando regravam o mesmo valor.

O `context` — que era descartado — vai pro log com prefixo `[recalc-pending]`,
marcou ou pulou. É a única medição que existe da frequência real por caller:
`grep '\[recalc-pending\]'`, não estimativa.

Guardado por `tests/unit/calculations/recalc-inputs.test.ts` e
`tests/unit/orchestration/recalc-pending-inventario.test.ts` — este último enumera
os call sites do SOURCE e falha quando um aparece, some ou muda de declaração, que
é a defesa contra o próximo caller entrar no badge sem ninguém decidir nada.

## AI evaluation flow

Two distinct paths both ultimately call `requestAiEvaluation()` in `lib/ai-evaluation/service.ts`:

**Path A — "✨ Avaliar" (`/curation/works`, "Curadoria da Obra")**

⚠️ A página virou **duas** em 2026-08-02: `/curation/works` ficou só com a fila de **atributos**
(curadoria do catálogo — do dono), e as filas de **Veredito IA / IA-Rk / Interesse / Sinopse**
foram pra **`/my-ai-scores`** (qualquer logado).

🔴 **"Aguardando revisão" nomeava uma ação que não existia — corrigido em 2026-08-14.** O modal
de revisão só abria como RESULTADO de uma avaliação paga (`handleEvaluate` → confirmação de
custo → `triggerAiEvaluation`), então a única forma de ver a avaliação **já gravada** era pagar
outra. O ciclo se contradizia por escrito: ao terminar uma avaliação, o toast oferece "Revisar"
apontando pra `/curation/works` (`components/titles/ai-evaluation-button.tsx`), e a página não
sabia revisar. Hoje `loadAiEvaluationForReview` (só leitura, sem LLM) abre a avaliação
persistida — medido no app: **2,2s e zero chamada à Anthropic**.

⚠️ **Ela devolve a MESMA forma do caminho pago** (`{ evaluation, currentScores,
currentEvaluation }`) porque quem consome é o mesmo `AiEvaluationReviewForm`. Um segundo formato
faria as duas telas divergirem na primeira mudança do formulário. E **não** passa pelo
`confirmCost`: pedir confirmação de gasto numa leitura ensina a clicar "ok" sem ler, e é
justamente esse popup que precisa ser levado a sério no botão ao lado.

🔴 **O botão sai de `works.ai_eval_status`, NUNCA de `matchedFilters`.** `matchedFilters` responde
"por que a obra apareceu" — a intersecção com os filtros LIGADOS. Uma obra em `review_pending`
que entre pela lista por confiança baixa chega com `["low-confidence"]`, e derivar dali esconderia
o botão de quem está esperando revisão. Estado é fato do banco; filtro é uma pergunta que alguém
fez. É a família "dois critérios pro mesmo fato", aqui decidindo se a ação existe.

🔴 **A confiança tinha sumido do card em `73a9510`**, quando as ações viraram pilha vertical: a
`ConfidencePill` foi apagada e nada entrou no lugar. Sobreviveu só DENTRO do chip de confiança
baixa — ou seja, sumia justamente na obra em "Aguardando revisão", que é quando o número decide
se dá pra aceitar a nota —, enquanto o seletor "Ordenar" seguia oferecendo **Confiança IA**: dava
pra ordenar por um número que o card não mostrava. Hoje ela vive na **linha de procedência**,
junto de data e modelo/prompt — os três são fatos sobre a MESMA avaliação —, e o chip âmbar diz só
"Confiança baixa": o número tem **um** lugar.

⚠️ **Os cortes 0,75/0,5 agora têm dono: `confidenceBand` (`lib/ai-evaluation/confidence-ruler.ts`).**
Estavam copiados no formulário de revisão e no comparador, e o card seria a terceira cópia — duas
telas discordando sobre a mesma avaliação ser verde ou âmbar. ⚠️ Isso COLORE, não julga acerto: a
confiança mede volume de evidência (rho 0,44 com nº de reviews) e **não é comparável entre
modelos** — é o assunto do resto daquele arquivo.

Guardado por `tests/unit/ai-evaluation/card-confianca-e-revisar.test.tsx` — teste de **RENDER** de
propósito (um teste que lesse o objeto do work passaria verde nos dois defeitos), com o caso do
"apareceu por OUTRO filtro" explícito. Conferido com três sondas: derivar do filtro, esconder a
confiança e devolvê-la ao chip reprovam.

🔴 **A terceira aba de `/curation/works` é "Digests" (2026-08-14)** — a fila do digest
estruturado, que era um painel CEGO em `/curation/settings?g=ia`: sabia dizer "125 pendentes" e
processava 10 obras que ninguém escolhia nem via. Digest é curadoria de CATÁLOGO (pago,
compartilhado, do curador), que é o critério da página; `/my-ai-scores` seria errado, é
per-user. O **resumo** (Haiku, ~0,2¢, automático, 979/979) FICOU no `/curation/settings`: é manutenção,
não fila de decisão, e levá-lo junto poria na console um painel permanentemente zerado.

🔴 **A aba tem um PISO de reviews, e ele é medido: 4 reviews úteis**
(`lib/reviews/digest-gate.ts`). Com 1-2 reviews o modelo não tem consenso pra destilar e
produz um digest que PARECE um digest — e o consultor IA o consome como sinal. Medido sobre
os 846 digests da versão vigente, pela taxa de "digest magro" (o modelo não alcançar os 3
traços que o próprio prompt exige, que é estrutural e não interpretação de prosa):
**1 review 75% · 2 → 50% · 3 → 25% · 4 → 0% · 5-19 → 0% · 20+ → 1-4%**.

⚠️ **A contagem é a ÚTIL (≥40 chars), não a crua** — e trocar as duas MUDA o limiar: o corte
"<3" pega 8 obras contando cru e 18 contando útil. O digest descarta review curta antes do
prompt (`isUsefulReviewText`), então a régua da tela tem que ser a régua do gate.

⚠️ **As faixas baixas têm 4 obras cada** — "25%" é UMA obra. O que os dados sustentam é que
**≥4 é limpo** (200+ obras, ~0%) e **≤2 é ruim**; o 3 é indistinguível dos dois. 5 e 10 foram
considerados e não têm apoio: nada muda de 4 a 19. Arredondar pra cima é a escolha defensável
pela assimetria (digest ruim mente, digest ausente só falta).

⚠️ **O piso vem ANTES do `force`** em `classifyDigestReadiness`: forçar não cria consenso que
as reviews não têm. E o RESUMO **não** herda o piso — é Haiku, é texto pra ler, e uma review só
já vale um parágrafo.

🔴 **O lote antigo (`consolidatePendingReviewDigests`) foi APOSENTADO, não corrigido.** Ele
chamava `consolidateReviewsDigestDetailed` DIRETO: corpus próprio (só `work_reviews`, sem as
reviews manuais externas que o caminho por obra inclui), zero gate de readiness, zero dedup de
job. Eram dois caminhos para o mesmo artefato divergindo em silêncio, e o piso teria que ser
escrito duas vezes. O lote novo (`generateDigestsForWorks`) itera `ensureReviewDigest` — o
mesmo caminho do botão da página da obra. Guardado por `tests/unit/reviews/digest-gate.test.ts`.

⚠️ **A aba NÃO soma no badge violeta do topo** (escolha da Ana): é backfill pago e opt-in, e um
contador de 100+ ali faria o badge viver cheio e parar de significar "decisão esperando". O
número da aba conta só as **elegíveis** — prometer as bloqueadas faria a aba nunca zerar.

⚠️ **As bloqueadas ficam na lista, não somem.** Elas respondem "por que essa obra nunca sai da
fila?"; sem checkbox, sem botão, com o chip dizendo o que falta.

🔴 **Dois defeitos desta leva passaram por `tsc` E pela suíte, e só a página os pegou:**
`export const` num arquivo `"use server"` derruba o MÓDULO INTEIRO em runtime (só função async
pode ser exportada) e `works.cover_url` não existe — capa mora em `work_covers`. Nenhum dos
dois é erro de tipo. O primeiro virou
`tests/unit/orchestration/use-server-so-exporta-async.test.ts`, que **deriva a lista do
filesystem** e foi conferido reprovando o código quebrado. O badge da barra também se dividiu:
`curadoria` e `rec-queue`. `/ranking/desatualizados` segue como redirect pra aba nova.

### A 4ª aba é "Fontes", e a pergunta dela é por FONTE — não por obra

🔴 **"Obras sem vínculo externo" é conjunto VAZIO.** Medido em 2026-08-15 (clone local, 978
obras ativas): **nenhuma** obra está sem vínculo nenhum e a **mediana são 8 de 9 fontes**. O
que existe são **1.424 lacunas** espalhadas por fonte:

| fonte | obras sem vínculo avaliado |
|---|---|
| kitsu | 363 |
| myanimelist | 338 |
| mangadex | 251 |
| mangago | 175 |
| comick | 129 |
| anilist | 81 |
| animeplanet | 72 |
| mangaupdates | 15 |
| comix | **0** |

Daí o **mapa de chips por fonte vir ANTES da lista**: sem ele a única entrada seriam as **629
obras com ≥1 lacuna — 64% do catálogo**, que é o alarme que sempre toca.

⚠️ **Lacuna ≠ "a obra não existe lá".** Chutei que MAL/Kitsu não indexam manhwa coreano; a
medição INVERTEU: por script do título original, o coreano é o **melhor** coberto no MAL (26%
de lacuna) contra 60% do jp/cn e **67% das obras sem título original**. É enriquecimento
inacabado, não ausência estrutural — buscar acha.

⚠️ **A lacuna custa evidência, e a relação é monotônica:** 0 lacunas → **57,2** reviews úteis
em média; 3 → 24,5; 5 → **7,4**. Abaixo do piso de 4 reviews úteis do digest: **1,1%** das
obras sem lacuna contra **57%** das com 5. Por isso o card carrega `usefulReviews` e marca
"evidência escassa" — é o que separa lacuna que dói de lacuna que só existe.

🔴 **Os três estados de `work_external_ids` têm DONO ÚNICO: `classifySourceLink`**
(`lib/external/source-link-state.ts`) — `linked` (id + não rejeitado) · `absent` (rejeitado
SEM id = "não existe aqui", DECIDIDO) · `gap` (sem linha, ou qualquer outra forma). Só `gap` é
trabalho. Eram DUAS cópias do mesmo `if`: esta fila e o card de cobertura do Comix em
`/curation/settings` (`getComixCoverageLists`) — as duas telas falando da MESMA linha, e uma podia dizer
"pendente" enquanto a outra dizia "resolvida". ⚠️ Rejeitado COM id volta pra `gap` de
propósito: descartar um candidato não nega a obra na fonte.

🔴 **O universo de fontes é `SELECTABLE_EXTERNAL_SOURCES`** (derivado da tabela `source`), que
é o MESMO que o `SourceSelectionStep` desenha. Lista escrita à mão aqui faria a aba acusar
lacuna numa fonte que o diálogo não sabe resolver: a obra entra na fila, você abre o diálogo,
ela não aparece, e ela volta pra fila no carregamento seguinte — sem erro nenhum.

🔴 **`tallySourceGaps` (`lib/external/source-gaps.ts`) é puro porque a ORDEM é a invariante:**
os contadores do mapa somam o universo inteiro e **só depois** o chip de fonte recorta a lista.
Invertido, filtrar por Kitsu zeraria os outros oito chips e a única saída visível seria limpar o
filtro. Guardado por `tests/unit/external/source-gaps.test.ts` — conferido invertendo a ordem, o
teste reprova.

⚠️ **Status e Interesse são a EXCEÇÃO a essa regra, e é coerente:** eles recortam o UNIVERSO da
pergunta ("dessas obras, quais têm lacuna?") e por isso entram ANTES do tally; o chip de fonte
recorta a RESPOSTA. Medido no app: com `♥♥♥♥` a lista dá 50 e os chips viram MAL 19 / Kitsu 17;
com `♥♥♥♥ + kitsu` a lista dá **17** e "Qualquer uma" segue **50**. ⚠️ O painel de filtros é
compartilhado e desenha Interesse em TODA aba — não repassá-lo produziria um chip aceso que não
filtra nada.

**A fila é a LISTA EXIBIDA, na ordem exibida** (ou só as selecionadas). O diálogo hospeda o
`SourceSelectionStep` — o MESMO passo do "Atualizar dados" —, e reusar não é economia: ele já
distingue "fonte fora do ar" de "obra sem match" (senão uma queda de infra vira rejeição
gravada) e traz o hid manual da Comix. A busca (`revalidateWorkSources`) é **US$0** e **ÂMBAR**
(só lê; o resultado morre com a tela), e por morar num modal do Radix a porta de saída é fechar
o diálogo — nada de `guardNavigation`.

⚠️ **Sem `dot` na aba**, mesma régua do Digests: 629 de 978 obras acenderiam o badge da barra
permanentemente.

🔴 **O caminho `countOnly` pede só `id`, e o motivo é medido: 857 KB × 46 KB** (18×, 978 obras).
Quem o chama é `getCuradoriaTabCounts`, cujo cache é invalidado pela tag `ai-eval-tab-counts` —
**compartilhada com `/my-ai-scores`** —, então toda mutação nas duas repagaria a projeção
dos cards contra a NUVEM. As colunas de status ficam fora da projeção porque são filtro `.in()`
resolvido no SQL.

✅ **O lote de "não existe nessa fonte" existe (2026-08-15)** — é ele que de fato esvazia a
fila, porque a maioria das 1.424 lacunas se fecha declarando ausência, não achando vínculo.
Dono único: **`markSourcesAbsent`** (`server/external-ids/absence.ts`), para o qual o
`markComixAbsent` passou a DELEGAR — a guarda que impede o upsert de apagar vínculo válido
mora lá, e duas cópias dela divergiriam.

🔴 **O botão só existe com um chip de FONTE ativo.** "Marcar como ausente" sem dizer onde é
afirmação sem sujeito: a obra tem lacuna em várias fontes e o lote gravaria na errada. Sem
chip aparece a dica de como chegar lá, não um botão desabilitado.

🔴 **E NÃO há varredura automática por trás — a decisão é medida, não gosto.** Testado contra
verdade conhecida em 2026-08-15 (30 obras que comprovadamente ESTÃO no mangago, amostradas
das 803 vinculadas): uma busca por título com o limiar de aceite (0,72) deixaria **7% delas
abaixo do corte** ⇒ em 175 obras, **~12 declarações FALSAS** de "não existe" — e `absent` tira
a obra da fila para sempre, então ninguém revisita. As duas que falharam não eram salváveis
por variantes (0,00 e 0,50 mesmo com `original_title` e alternativos). ⚠️ A busca do mangago
FUNCIONA (6/6 em ~1s, medido no mesmo dia); o que reprova a automação não é a fonte estar
fora, é a taxa de erro do casamento por título.

⚠️ **A guarda do servidor é obrigatória e tem teste com sonda:** o `onConflict:
"work_id,source"` sobrescreveria um `external_id` ativo com NULL, e a lista da UI pode estar
defasada (vínculo entra em background pelo resolve resiliente). Removê-la reprova
`tests/unit/external/marcar-ausente-em-lote.test.ts` — conferido.

⚠️ **O DESFAZER não tem action própria, de propósito** — quem reverte a ausência é o próprio
diálogo de fontes: marcar "Não decidir agora" faz o passo OMITIR a fonte do payload e o
`saveWorkSourceSelections` apaga a linha (rejeitada SEM id não é vínculo aceito, então cai no
`toDelete`). Uma action dedicada seria um endpoint HTTP a mais para o que o fluxo já faz. ⚠️ Mas
isso põe uma promessa da UI ("dá pra desfazer") dependendo de regra escrita em OUTRO arquivo —
travado por `tests/unit/external/desfazer-ausencia-pelo-dialogo.test.ts`, que também exige que o
mesmo caminho NUNCA apague um vínculo aceito omitido do payload.

⚠️ **A Comix não tem o que marcar: 976 vinculadas + 2 já declaradas ausentes = 978, lacuna
ZERO.** O chip dela aparece apagado e o lote nunca é oferecido. Para "reverificar" uma obra da
Comix o gesto é outro — marcar ausência SOBRE um vínculo existente, que a guarda recusa de
propósito; ali o caminho é o diálogo por obra.
`triggerAiEvaluation(workId)` → `fetchExternalEvaluationContextForWork()` → `requestAiEvaluation()`
- Uses saved work data (**ALL persisted synopses**, genres, grouped tags, cover). The primary synopsis is the prompt's main reference; every other persisted synopsis enters as `[S1]…[Sn]` blocks (`splitSynopsesForEvaluation` in `lib/work-derived.ts`), with `source = "manual"` ones labeled as user-written/high-authority. Fresh external `[C]` blocks that duplicate a persisted synopsis are filtered out (`isSameSynopsis`) — but only when additional synopses exist, so single-synopsis works keep a byte-identical input and preserve the eval cache `input_hash` (the `additionalSynopses` field is omitted from both hash versions when empty). If the work has accepted `work_external_ids`, reviews/context are fetched from those confirmed source IDs; otherwise it falls back to title search.
- Review sources (each only when the candidate has that source's ID): MangaUpdates + AniList + MyAnimeList + Kitsu (reactions) + AnimePlanet + MangaDex (forum comments) + ComicK (curated reviews + comments) + Comix (per-work comment thread, mini-reviews). Comix has no formal reviews API; `fetchComixReviews(hid)` walks detail `id` → `threads/lookup?page_identifier=manga{id}&page_url=/title/{hid}` → `threads/{threadId}/comments` (cursor-paginated). ⚠️ Este caminho é **TOKEN-FREE**: usa `fetchComixDetailRaw`/`fetchComixThreadJson`, **não** o `fetchComixJson` — então o circuito de auth aberto pela busca gateada **não** o bloqueia (medido 2026-08-04: circuito aberto e, na sequência, 52 e 57 reviews normais em ~1,3s). 🔴 **A previsão que estava escrita aqui — "se a Comix voltar a desafiar, ~30% do acervo de reviews passa a depender do bypass da noite pro dia" — SE REALIZOU em 2026-08-11.** O plain fetch morreu: `https://comix.to/` e o SSR de `/title/{hid}` respondem **403 + `cf-mitigated: challenge`**. Toda a cadeia (4 chamadas) passou a depender de bypass, e o **FlareSolverr é hoje a única camada que atravessa** — o sidecar não passa na Comix desde 29/07 (medido no log: **1.168 tentativas, ZERO sucessos**), embora siga atravessando mangago/anime-planet/comick em ~1s.

⚠️ **A falha não foi a Comix desafiar — foi o CUSTO de descobrir isso.** O sidecar é a camada PRIMÁRIA e desiste em ~13,2s (espera do interstitial). Com 4 chamadas na cadeia, eram ~55s contra o teto de 25s (`TIMEOUT_REVIEWS_COMIX_MS`): a fonte vinha **vazia em toda obra**, enquanto o FlareSolverr resolvia a mesma cadeia em **2,4s**. Corrigido por um **circuito POR HOST** em `renderHtmlViaSidecar` (`comix-render-client.ts`) — `upstream_blocked` marca o host por 15min em vez de repagar a espera a cada chamada. Guardado por `tests/unit/external/comix-render-host-circuit.test.ts`.

🔴 **Duas falhas latentes se somaram, e cada uma escondia a outra.** O sidecar quebrou em 29/07 e ninguém soube, porque o plain fetch ainda funcionava; quando o plain fetch caiu, o sidecar quebrado virou o caminho. **Camada de fallback que ninguém exercita apodrece em silêncio** — o log do sidecar tinha a resposta há 13 dias.

⚠️ **O pior caso está coberto, medido:** 1ª obra de cada janela de 15min paga a sonda (13,2s) + solve frio do FlareSolverr (12,4s) = 25,8s ⇒ estoura a 1ª passada, e a **2ª passada dirigida recupera em 4,2s** (`acquire-reviews.ts`). Não vale encurtar a sonda — a complexidade não paga um caso que o mecanismo existente já resolve.

🔴 **A DESCOBERTA DE HID está morta nos TRÊS caminhos — e só o acervo atual salva.** Medido em
2026-08-11: `searchComix` (API) gateada por token · `/resolve` do sidecar `no_xhr` (a SPA não
monta) · `scripts/resolve-comix-hids.mjs`, que é **Chrome REAL com perfil persistente**, cego em
headful E headless ("input de busca não encontrado"). Impacto hoje é **zero — 981/981 obras já
têm hid** —, então isso só morde obra NOVA, e a saída é `setComixHidManually`. Reviews e detalhe
de quem já tem hid seguem funcionando: são token-free e passam pelo FlareSolverr.

⚠️ **O que foi corrigido não foi a descoberta, foi a MENTIRA.** O resolvedor imprimia
`matched=0 noMatch=N error=0` e saía com código 0 — indistinguível de "essas obras não estão na
Comix", que é plausível para título japonês romanizado. Hoje `comixSearch` devolve `null` para
"não consegui buscar" (≠ `[]`, "busquei e não achei"), o resumo tem uma coluna `blind=` e o script
**sai com código 3**, que `resolveComixHidForWork` já trata como não-conclusivo. Ressuscitar a
busca exigiria stealth (o FlareSolverr passa e o Playwright não, e não se sabe por quê) — não
compensa enquanto o impacto for zero.

🔴 **O gate de saúde media UM TERÇO do que a Comix precisa, e o terço podia mentir.** Só
`lib/external/comix.ts` o alimentava: os 1.168 bloqueios do sidecar e a busca cega nunca moveram
indicador nenhum. Pior, `withTimeout` só para de ESPERAR — a promise segue viva e suas chamadas
chamam `recordComixOk()` lá na frente, então a coleta que o app **jogou fora** voltava e pintava o
painel de verde. Hoje: `delivery_timeout` (reportado pelo orquestrador) desqualifica um `ok` que
chegue nos 2min seguintes; `search_blind` sai do resolvedor; e `sidecarBlocked` entra em
`ComixStatus` **sem** rebaixar o estado — o FlareSolverr cobre, e alarmar viraria o alarme que
sempre toca. A Visão geral (`/curation`) troca só o texto do cartão. Guardado por
`tests/unit/external/comix-gate-honestidade.test.ts`.
- Reviews go through `selectReviewsForEvaluation()` before the prompt — stratified per-source sampling with an **adaptive** quota: `perSource = min(maxPerSource, ceil(total / sourcesWithReviews))`, capped by `AI_EVAL_REVIEW_CAPS = { total: 30, maxPerSource: 12 }` (service.ts), then global round-robin in `REVIEW_SOURCE_PRIORITY` order (MangaUpdates first). So few-source works fill the budget (2 sources → up to 24, not 16) instead of being stuck at a fixed 8/source. All sources are always fetched in parallel; the cap is applied at selection time only (no fetch short-circuit). The full pool persists to `work_reviews`. **The prompt selects from the UNION of fresh fetch + persisted `work_reviews` pool** (`mergeFreshWithPersistedReviews`, dedup by source+text, rejected sources filtered): CF-gated sources dropping out (sidecar 503 busy / Cloudflare block) can no longer shrink the evidence to 1–2 reviews when dozens are already persisted. Only the fresh pool is re-persisted (persistence semantics unchanged); when nothing is recovered the input is byte-identical to fresh-only, preserving the eval cache `input_hash`.
- Passes `sourcedReviews: SourcedReview[]` (rich format with source, matchScore, sourceTitle)
- Also passes `externalContext` (synopsis strings from external sources)
- Saves results to `ai_evaluations` + `ai_evaluation_scores` tables
- User reviews and optionally edits scores before they're committed to `category_scores`

**Path B — "✨ Buscar dados" form (`/catalog/new`)**
`searchAllSources()` → user chooses candidate → `fetchMultiSourceDetails()` → user chooses final data → `evaluateCandidateForCreate()` → `requestAiEvaluation()`
- "Buscar dados" only finds candidate/source matches. "Usar" extracts metadata, lets the user pick synopses/covers/conflicts, then runs AI against the final selected data.
- Review/context sources come from the accepted external IDs for the selected candidate, not from a second independent title search.
- Passes `sourcedReviews: SourcedReview[]`; final selected synopsis is sent as the primary synopsis. Extra external context is omitted when a selected synopsis exists to avoid evaluating unselected synopsis blocks.
- Scores go into form fields; if saved unchanged they are persisted as `source: "ai_accepted"` with an `ai_evaluation_id`
- Works with all 9 criteria set get `ai_eval_status = "done"` and skip the Avaliar queue
- Completed AI evaluations that still need review use `ai_eval_status = "review_pending"`

Post-processing applied to every evaluation (in `service.ts`):
- ⚠️ O piso/teto por TAG saiu do código e virou **dado** em `tags.adult_score_tier` (migration
  **174**, 2026-08-02): antes eram três `Set`s hardcoded em `lib/ai-evaluation/adult-content-rules.ts`,
  enquanto o FLAG `works.is_adult` já lia `tags.adult_indicator[_strong]` do banco — as duas fontes
  divergiam, e tag nova classificada pelo enricher afetava o flag mas nunca o piso da nota.

🔴 **`explicit` afirma que a CENA é mostrada — não que haja sexo no enredo.** A lista migrada
na 174 misturou atos gráficos (Cunnilingus, Anal Sex) com tags de **circunstância**: que vez
(`First-Time Intercourse`, 83 obras), em que estado (`Drunken Intercourse`), onde
(`Outdoor/Public/School/Office/Toilet`), posição (`Doggy Style`, `Missionary Position`) e até
`Clothed Intercourse` — sexo **vestido** valendo piso 9,0 = "há cena de sexo explícito".
Corrigido pela **migration 182** (2026-08-09): as 18 viraram `label` (piso 7,0, a faixa "sexo
mostrado PARCIALMENTE"), que é o que elas de fato sustentam. `explicit` foi de 46 → 28.

Medido antes: **64 obras** tinham como única evidência de "explicit" uma tag de circunstância,
**todas** em 9,0–9,5, e em **24 delas a prosa da própria avaliação argumentava faixa 0-3 ou 4-6**
— ex.: *"Faixa 4-6 (Suggestive): … os leitores afirmam que a obra NÃO é smut/explícita"*, obra
persistida em 9,0 por causa de `Drunken Intercourse`.

🔴 **Baixar um piso NÃO desfaz o que ele subiu.** `clampAdultContentScore` é one-way — só empurra
pra dentro da faixa. Sem `scripts/adult-content-retroactive-bounds.ts --heal`, as 64 ficariam
congeladas em 9,0 e o script diria "nada a gravar". O `--heal` só age sob um fingerprint estreito:
nota persistida ACIMA da que a avaliação entregou **E** valendo exatamente um piso (9/7/5) **E**
não sustentada pelos limites de hoje. ⚠️ A 1ª versão usava a nota da avaliação como baseline
direto e o dry-run deu **219** diffs contra as 51 reais — ela reescrevia toda divergência entre
`category_scores` e `ai_evaluation_scores`, inclusive ajuste manual posterior. Ampliar esse
critério é apagar curadoria em silêncio.

⚠️ **O embed do PostgREST traz os NOVE critérios.** `ai_evaluations(ai_evaluation_scores(...))`
sem `.eq("ai_evaluations.ai_evaluation_scores.criterion_slug", "adult_content")` devolve todos, e
pegar `[0]` dá o baseline de outro critério — mediu 8,0 numa obra cuja avaliação dizia 7,0, e o
relatório saiu inteiro plausível. Erro que produz resultado.
✅ **A 174 está aplicada na nuvem** (confirmado 2026-08-07). Esta seção afirmou o contrário
por dias — ver o aviso logo abaixo.

✅ **As migrations 174, 175 e 176 estão aplicadas na nuvem** (confirmado 2026-08-07). Este bloco
dizia "pendentes" desde 08-02/03-08 e **continuou dizendo depois de aplicadas** — um 🔴 falso que
carrega em toda sessão e induz a reaplicar migration ou a segurar deploy sem motivo. O que cada
uma fez, que segue valendo:

| # | Tabela | O que trouxe |
|---|---|---|
| 174 | `tags.adult_score_tier` | tirou do código os três `Set`s de piso/teto por tag |
| 175 | `recommendation_chats.user_id` | deu dono ao chat (sem ela o insert falhava) |
| 176 | `ai_eval_read_acks.user_id` | deu dono ao "marcar como lido" |

⚠️ A 176 **trocou a PRIMARY KEY** de `(work_id, queue)` para `(user_id, work_id, queue)`, e o
`onConflict` do upsert em `server/actions/ai-eval-read.ts` acompanha. Os dois já estão no ar
juntos; separá-los de novo (revert de um só) troca "ack de cada um" por "último que clicou
vence", em silêncio.

🔴 **Lição de manutenção, mais cara que as migrations em si:** status de migration envelhece e
**nada avisa**. Um bloco 🔴 desatualizado é pior que ausência de bloco, porque ele é lido como
verdade conferida. Ao anotar pendência aqui, escreva a **data** e a **forma de conferir**
([[project-conferir-migration-na-nuvem]]) — e apague o aviso no mesmo PR que aplica.
- `enforceR19AdultContentRule`: raises `adult_content` to ≥ 7.0 if R19 marker detected anywhere in input
- `enforceExternalContentRatingRule`: raises `adult_content` to a floor from the accepted external sources' content rating (MangaDex `contentRating` / ComicK `content_rating`) — `suggestive`→5, `erotica`→7, `pornographic`→8. Chained with the R19 rule; both are monotonic so the effective floor is the max of whichever triggered.
- ~~`enforceNeutralCoupleDynamicsWhenNoRomance`~~: **removido na v23** (2026-08-09). Forçava `couple_dynamics = 5.0` quando `romance ≤ 3`, partindo de "sem romance, não há dinâmica" — premissa que morreu com a ampliação do critério pra vínculos centrais. Travava **17 das 18** obras sem romance. Quem decide "não aplicável" agora é o prompt, por ausência de VÍNCULO — não de romance. ⚠️ As ~31 justificativas que ele reescreveu seguem no banco (ver `lib/criteria/justification.ts`)
- `enforceAuditableReviewUsage`: **non-fatal since v20 (2026-06-27)** — generic review citation is accepted ("algumas reviews apontam…"), so it no longer requires/validates specific review IDs (`R1`, `R2`…) nor throws. It only records an informational `reviewAudit` (`required` = "havia reviews no prompt"; `usedReviewIds` = whatever IDs the model happened to cite, often empty with generic citation). `review_usage` is now an OPTIONAL tool/schema field. (Earlier behavior: threw + retried when IDs weren't cited — removed because a citation slip discarded otherwise-valid evals.)

## A auditoria de critérios NÃO escreve mais sozinha

`/curation/settings?g=notas&open=ai-audit`. A IA relê obra a obra e sugere ajustes nos
atributos; a curadora aceita, edita ou rejeita. Até 2026-08-16 uma parte escrevia direto no
banco sem passar por ninguém. **Desligado**, e o motivo é medido — dono único da política:
`lib/ai-calibration/policy.ts`.

🔴 **O gate de auto-aplicação exigia `confidence ≥ 0,8` numa escala que o modelo não
produz.** Medido nas 765 pendentes: a confiança **satura em 0,85**, a mediana é **0,60** e
só **6 (0,78%)** alcançam 0,80 — a faixa que o próprio prompt define como certeza forte
(0,9+) **nunca aparece**. O gate vivia na cauda de uma distribuição que ninguém tinha olhado
(a régua de "o limiar sai da DISTRIBUIÇÃO, nunca do olho", aplicada a um caminho que GRAVA).

🔴 **E no topo da escala a precisão observada é 0 de 2.** As duas únicas sugestões de 0,85
foram julgadas erradas pela curadora: uma pôs `fantasy_nobility` em 3,0 numa obra com
nobreza clara (empatando-a com as que não têm nada — o auditor não vê como o catálogo usa a
escala), e a outra derrubou `couple_dynamics` para 3,0 lendo `Villain Couple` + tags de
personagem tóxico como se descrevessem o vínculo ENTRE os protagonistas, **contra o consenso
das reviews**, que chamava o casal de *"match made in heaven"*.

✅ **O auditor ERA menos informado que o avaliador que ele corrige** — tinha tags, sinopse,
`user_score` e os `post_*`, e **zero reviews**, enquanto a avaliação lê até 30 de 8 fontes.
Corrigido na v3 (ver abaixo): ele recebe o digest e as âncoras de distribuição.

🔴 **As 3 auto-aplicações do último run mostram os dois vieses de uma vez:** duas subiram
`adult_content` por tag de circunstância (`Doggy Style` → 9,0 → 10,0) — o mecanismo que a
**migration 182 rebaixou de propósito** —, e a terceira subiu `protagonist` de 7,0 para 8,5
justificando com *"user_score altíssimo (9.4)"*, que é a **feature sendo empurrada na direção
do rótulo**.

**A fila hoje tem 504 pendentes, não 765** — 261 foram fechadas como `superseded` pela
varredura de `scripts/limpar-fila-calibracao.ts` (204 fora de escopo · 52 baseline morto ·
5 score travado). Os motivos têm precedência, então não somam em paralelo.

**Escopo por critério, também em `policy.ts`.** `AUDITABLE_CRITERIA` é **derivado** de
`CRITERION_SLUGS` menos `AUDIT_OUT_OF_SCOPE` — critério novo entra como auditável sozinho, e
tirar um exige escrever o motivo (o texto vai pro prompt, não é comentário). Fora hoje:

| critério | por quê |
|---|---|
| `adult_content` | tem piso/teto determinístico por procedência, e **a calibração não chama o clamp** (zero ocorrências em `calibration.ts`) — sugerir ali é uma 2ª régua pro mesmo número |
| `couple_dynamics` | é o único de VALÊNCIA e a rubrica ampliada (v23) foi **revertida**; a sugestão nasce sobre régua meia-aplicada. Era o 3º maior gerador de fila (88 pendentes) |

⚠️ **São TRÊS camadas, do mesmo desenho de `LOCKED_SOURCES`:** o enum da tool não deixa o
modelo nomear o critério, o filtro do serviço descarta, e a action não persiste nem como
pendente. Guardado por `tests/unit/ai-calibration/politica-de-auditoria.test.ts`, que varre a
grade inteira de (confiança, Δ) em vez de conferir a constante — conferido com sonda: religar
o auto-apply reprova.

🔴 **`PROMPT_VERSION` sobe junto com a régua (hoje `v3`), e isso tem consequência operacional:** a versão
entra em `calibration_runs.prompt_version` e é o que `loadLastRun` compara pra detectar drift
⇒ **o primeiro run depois desta mudança é uma varredura COMPLETA**. Não subir faria o rótulo
do run mentir e o run seguinte rodar incremental sobre régua diferente.

### v3: o auditor ganhou evidência e escala — e a confiança CAIU

Piloto de 16/08/2026 (`scripts/pilot-audit.ts`, 30 obras, **US$0,1778 medidos em
`ai_api_calls`**), depois de o prompt passar a receber o **digest das reviews** e as
**âncoras de distribuição** do catálogo:

| | v2 (sem evidência) | **v3 (com digest + âncoras)** |
|---|---|---|
| confiança máxima | 0,85 | **0,65** |
| mediana | 0,60 | 0,55 |
| sugestões ≥ 0,80 | 6 de 765 | **0 de 38** |
| justificativas citando o consenso | — | **30 de 38** |

🔴 **Dar evidência ao modelo o deixou MENOS confiante, não mais — e isso encerra a questão
do auto-apply.** Não é regressão: com o consenso das reviews na frente, ele para de afirmar
a partir de tag. Mas significa que o gate de 0,8 não é alcançável **nem no melhor cenário
construído pra alcançá-lo**. A auditoria é, por medição, uma fila revisada por humano — e a
"confiança" do modelo não é sinal utilizável pra automatizar escrita neste desenho.

⚠️ **O que MELHOROU não é contável, é lido.** As justificativas passaram de inferência a
partir de tag para citação verificável: *"Reviews destacam 'tom geral leve, evitando drama
pesado'"* sobre um `drama` 5,0 → 3,5. Isso é falsificável abrindo a obra — a régua antiga
("Tags indicam 'Villain Couple'…") não era.

⚠️ **`drama` (12) e `tragedy` (8) concentram 53% das sugestões**, e são justo os dois com
viés positivo medido na fila anterior (+1,03 e +1,72). O sinal é consistente entre as duas
versões do prompt, o que é evidência a favor de ele ser real.

**Duas escolhas de desenho, as duas medidas:**

- 🔴 **Digest, não review crua.** As reviews da pool somam **20.023 chars por obra** (94k no
  pior caso) — no lote de 10 seriam ~50k tokens por chamada, forçando lote de 1–2. O digest
  cabe em **2.406** e é o mesmo consenso, já destilado. Custo real do run completo,
  extrapolado do piloto: **~US$1,16** para as 196 obras.
- 🔴 **Obra sem digest fica FORA do run** (`temEvidenciaParaAuditar`, em `policy.ts`). São
  **16 de 212**. Auditar sem o consenso é reproduzir o juiz cego que errou as duas de 85%.
  Elas não somem caladas: `nSkippedNoDigest` sobe até o resumo do run.

⚠️ **As âncoras vão no USER prompt, nunca no system** — o system tem `cache_control`, e a
distribuição muda a cada recalibração do catálogo. No system, ela invalidaria o cache a cada
run.

### A nota calibrada agora diz que é calibrada — e a prosa segue o número

🔴 **A nota mora em `category_scores` e a prosa que a explica mora em `ai_evaluation_scores`,
então mover uma sem a outra faz a página da obra se contradizer.** Medido em 2026-08-16:
das 37 notas com `source = 'ai_calibrated'`, **27 exibiam justificativa que contradiz a
própria nota** — a 1,79 ponto de distância em média —, e `ai_calibrated` **não aparecia em
nenhuma UI** (grep: zero), então o número reescrito seguia creditado ao selo ✨ da avaliação
que não o produziu.

Hoje o card lê `getCalibrationProvenanceForWork` e, quando a nota é calibrada, imprime a
justificativa **da sugestão que a moveu** mais a linha `Ajustada pela auditoria · <quando> ·
antes <nota>`. ⚠️ A prosa é **recuperada por chave natural**, nunca copiada: a linha da
sugestão continua dona do próprio texto, e não há duas cópias pra divergir.

⚠️ **A linha é procedência, não estado** — sem cor. Âmbar ali significaria "desatualizado"
(ver `STATUS_TONE`), e sem alfa no texto: a 10,5px o `/80` derruba o contraste abaixo do AA.

**Duas guardas fecharam o resto do loop:**

- 🔴 **Aceitar sugestão confere o VALOR, não só o `source`.** Uma reavaliação reescreve a nota
  mantendo `ai_accepted`, então checar procedência deixa passar o caso comum: **132 das 583
  pendentes (23%) tinham baseline morto**. Divergindo, a sugestão vira `superseded` (ela não
  errou — envelheceu) com a mensagem dizendo de quanto pra quanto a nota andou.
- 🔴 **Reavaliar apagava calibração em silêncio: 44 casos.** O upsert de `submitAiReview`
  sobrescrever está CERTO (evidência mais fresca, revisada no formulário); o que não podia era
  o silêncio. Hoje as sugestões afetadas viram `superseded` e o caso é logado.

### `bandCoherence`: a única checagem de coerência que sobrevive, e os dois falsos positivos dela

Dono: `lib/criteria/justification.ts`. A pergunta é estrutural — *a nota cai na faixa que a
prosa citou?* —, sem interpretar uma palavra. Ela já existia como regex dentro do
`coherence-audit.ts` e tinha **dois** furos, os dois produzindo número alto e plausível:

| furo | efeito medido |
|---|---|
| **citação composta** (`Faixa 7-8/9`, `Faixa 4-6 a 7-8`, `Faixa 7-8 / limiar 9-10`) | ler só o 1º par e comparar por igualdade de string deu **6 de 6 amostrados falso positivo** |
| **a fresta do meio ponto** | os bins da rubrica são de inteiros e **não se tocam** — nenhum contém 3,5 · 6,5 · 8,5. Comparar contra `[lo, hi]` cru reprova **226** notas de borda, nenhuma erro de julgamento |

Corrigida, a régua dá **19** no escopo do script (nota ↔ a avaliação que a produziu) e **73**
no escopo da PÁGINA (nota ↔ prosa que ela exibe: 27 calibradas + 25 `ai_accepted` +
21 `ai_edited`). Os dois números são legítimos e respondem perguntas diferentes — o 2º é o
que a pessoa vê. ⚠️ Uma varredura minha em SQL deu **483** antes de amostrar; foi a
amostragem que derrubou o número, exatamente como o cabeçalho do `coherence-audit.ts` manda.

⚠️ **A fresta do meio ponto JÁ ESTAVA documentada** em `bandBarBounds` desde 2026-07-22
("132 dos 205 pontos-fora-da-faixa eram só isto") — e eu a redescobri do zero. Antes de
escrever régua nova sobre faixa, leia aquele bloco.

⚠️ **A auditoria serve à CONSISTÊNCIA dos atributos (filtros e desempate do `/ranking`),
não à Nota Prevista** — os 9 atributos somam 0,002 de MAE, e isso está fechado
([[project-atributos-nao-chegam-na-nota-prevista]]). A descrição do card diz isso por
escrito; prometer previsão ali é prometer o que foi medido e não existe.

## Duas réguas para as notas de atributo, e o que cada uma consegue ver

Objetivo é **precisão E coerência**, e são medidas diferentes — colapsar as duas em MAE foi
o erro que fez a auditoria de 2026-08-09/10 gastar US$2 em medições que não decidiram nada.

| | instrumento | n | piso de detecção |
|---|---|---|---|
| **Precisão** | `scripts/gold-mae.ts` contra `.gold/gold-FILLED.csv` | 30 obras | **0,10** no MAE absoluto · **0,136** na diferença pareada |
| **Coerência estrutural** | `scripts/coherence-audit.ts` (checagem A) | 8.673 atributos | dezenas de casos |
| **Consistência** | `npm run consistency` (2026-08-10) | 8.757 notas · 5.733 pares | comparação por retrato |
| **Coerência semântica** | — **não existe** | — | — |

🔴 **O piso de 0,10 é o fato mais importante desta seção.** Bootstrap do gold (4000
reamostragens): MAE do catálogo 0,78, IC95% **[0,68 – 0,88]**. O ganho realista de uma
reescrita de prompt é ~0,05 — **abaixo do que o instrumento enxerga**. Foi por isso que
quatro tentativas (v23, v24-pesada, v24-cirúrgica, v25) falharam: o experimento nunca teve
como dar certo.

⚠️ **São DOIS pisos, e confundi-los subestima o instrumento.** O 0,10 é do MAE **absoluto**
(bootstrap de uma versão sozinha). Comparar duas versões é teste **PAREADO** — mesmas obras,
mesmos critérios —, e aí o que vale é o erro padrão da diferença: medido em 2026-08-15,
**0,049** sobre n=270 pares critério-obra ⇒ menor diferença detectável **0,136**. O
pareamento ajuda, mas não o bastante: continua acima do ganho de ~0,05.

🔴 **Dá pra PREVER o gold sem rodá-lo, e o método está VALIDADO** (2026-08-15). Amostre os
deltas empíricos de um piloto sobre as notas do catálogo no gold set (Monte Carlo). Calibrado
contra a v25 — o único caso com piloto julgado **e** gold rodado —, a simulação **exagera a
piora em ~32%** (fator 0,69 geral / 0,68 ponderado), e esse fator corrige a previsão. Foi
assim que a v27 foi reprovada **sem rodar o gold**: previsão calibrada **0,947 geral / 0,785
ponderado** contra o catálogo em 0,776 / 0,637, com **P(bater) = 0,0%** em 4000 réplicas.

⚠️ **Uma rodada de gold custa ~US$1,09** (medido: `custo.usd` do JSON da v25, 32 chamadas em
30 obras) — **não** os US$1,20 do piloto. Os dois são amostras de 30 obras e custam quase o
mesmo, e por isso é fácil usar um número pelo outro; esta seção já fez isso, citando "US$1,2"
para o gold a duas linhas do JSON que registra 1,09.

🔴 **O gold da v25 ficou 5 dias em disco sem nunca ter sido computado.** O JSON
(`.pilot/gold-v25-2026-08-10T01-30-06-192Z.json`, US$1,09) já trazia `gold`, `catalogo` e
`novo` por obra — bastava somar. Calculado em 2026-08-15: **geral 1,04 · ponderado 0,97**, a
PIOR das cinco. Pagar a medição e não computá-la é a forma mais cara de não medir; ao rodar o
`gold-mae.ts`, **compute o MAE na mesma sessão**.

🔴 **Mas ampliar o gold NÃO é o investimento que destrava — e esta seção já disse que era.**
O gold mede PRECISÃO; o que a v23/v25 mudavam era CONSISTÊNCIA e COERÊNCIA. Levar o gold de
30 para 100 obras derruba o piso pra ~0,055 e continuaria sem enxergar o efeito pretendido,
porque a pergunta é outra. O que faltava era a terceira linha da tabela.

**`npm run consistency`** (`scripts/consistency-panel.ts`) mede as quatro dimensões, tudo em
SQL sobre o catálogo, **US$0 e sem falso positivo de regex**:

| dimensão | retrato de 2026-08-10 (v26) |
|---|---|
| dispersão (σ e faixa dominante) | 4 críticos: `protagonist` σ 0,89 · `romance` 1,16 · `action` 1,35 (**0% em 9-10**) · `fantasy_nobility` 1,66, todos ≥69% numa faixa só |
| réguas vivas | **11 combinações** (10 versões × 4 modelos) — e a **v26 cobre ZERO obras** |
| reprodutibilidade | amplitude 0,99 pt → **0,32 pt** controlando versão+modelo ⇒ **68% da instabilidade é MISTURA de régua**, não modelo |
| coerência prosa×nota | delegada ao `coherence-audit.ts` |

🔴 **Só o modo `--baseline` responde "melhorou?".** Salve o retrato antes
(`npm run consistency -- --save=.consistency/<nome>.json`) e compare depois — um número solto
não decide nada, e foi exatamente medir sem retrato anterior que fez a empreitada v23–v25
gastar US$2 sem concluir. ⚠️ O piso aqui é o **ruído entre duas rodadas idênticas: 0,289**
(151 pares); movimento menor que isso não é distinguível de ruído.

🔴 **Mas `--baseline` NÃO enxerga um PILOTO — use `--piloto=` (seção 5).** O
`pilot-prompt-*.ts` não grava em `category_scores` nem em `ai_evaluation_scores`, de propósito,
e as dimensões 1–3 leem exatamente essas duas tabelas: rodar o piloto e depois o painel compara
o catálogo com ele mesmo, e os dois retratos vêm idênticos. Foi a lacuna que quase produziu a
**quinta** rodada inconclusiva.

```bash
npm run consistency -- --piloto=.pilot/piloto-v27-<ts>.json
```

🔴 **Antes de reprovisionar qualquer medição paga, LISTE `.pilot/` e `.consistency/`.** O
piloto da v27 (30 obras, **US$1,20**) foi gerado 55 minutos depois do commit que o exigia e
ficou 4 dias sem **julgamento formal**. Julgar é **US$0**; o mesmo aconteceu com o gold da
v25, que ficou 5 dias em disco sem ninguém somar o MAE. A parte cara é a chamada ao modelo —
e ela já foi paga.

⚠️ **Esta seção já afirmou que "ninguém olhou o piloto por 4 dias", e é FALSO — o erro é
mais interessante que a versão errada.** O achado central já estava numa memória de 11/08
(`atributos-nao-chegam-na-nota-prevista`), em tabela: *"prompt novo (v27) — não descomprime
— piloto US$1,20: `action_adventure` Δ 0,00"*. Alguém olhou, extraiu e gravou. O que falhou
foi o **loop não fechar**: a branch seguiu dizendo "NÃO MERGEAR sem o piloto", este arquivo
seguiu listando a v27 como pendência, e a memória que tinha a resposta não era consultada
por quem lia o commit.

🔴 **A lição, então, não é "olhe o disco antes de pagar" — é que uma conclusão registrada
FORA do repositório não desarma a pendência que mora DENTRO dele.** É a família "dois
critérios pro mesmo fato", com os dois lados em mídias diferentes: memória contra branch,
e a que decide o gasto é sempre a que a próxima pessoa lê. Quando medir algo que uma branch
ou uma seção daqui declara pendente, **feche nos dois lugares no mesmo dia** — o commit da
medição e o texto que a pedia.

⚠️ **E comparar as obras do piloto CONTRA o retrato do catálogo é pior que não medir**: os
estratos são deliberadamente não representativos (foram escolhidos para concentrar os
mecanismos), então a diferença mediria a AMOSTRA, com sinal plausível. A seção 5 é **pareada** —
as mesmas obras, antes × depois.

🔴 **O piso de 0,289 é de AMPLITUDE por nota e NÃO se aplica a faixa** (0,3 pt não cruza no meio
da faixa e cruza na borda). O piso na grandeza certa é a **troca de faixa entre rodadas
idênticas: 12,2%** (165/1352 pares, medido 2026-08-10), e a dimensão 3 passou a imprimi-lo. Usar
um pelo outro é a mesma troca de régua que reprovou a v23–v25 pelo gold.

⚠️ **O veredito é `z`, nunca múltiplo do piso.** A 1ª versão comparava `flipPct > piso * 2`, com
o "2" inventado — e ele deu falso negativo de beira de faca no primeiro uso real (24,4% contra
piso 12,2%, reprovado por um `>` estrito). Porcentagem não tem noção de tamanho de amostra: 3 de
12 e 60 de 240 são o mesmo múltiplo e evidências opostas (1,3σ × 5,9σ). Guardado por
`tests/unit/orchestration/piloto-piso-de-faixa.test.ts`.

✅ **Rejulgado o piloto v25 que já estava em disco (US$0):** 57/234 notas trocaram de faixa =
24,4% contra piso 12,2% ⇒ **z = 5,7, distinguível**. `fantasy_nobility` −1,13 com **50% de troca
de faixa, 13 pra baixo e 0 pra cima** (o mecanismo nº 3, a "REGRA OBRIGATÓRIA" virada piso, é o
que de fato cedeu); `action_adventure` −0,56, 4↓/0↑; `protagonist` −0,29, 4↓/2↑ — fraco. O
**controle não se moveu de forma distinguível** (z=1,3). ⚠️ Isso é CONSISTÊNCIA: a v25 mexeu no
que mirava, e mesmo assim ficou **mais longe** da curadora no gold (0,87 × 0,77). Os dois
resultados não se contradizem — respondem perguntas diferentes.

⚠️ **Consistência não é acurácia**: uma régua pode ficar perfeitamente consistente e estar
consistentemente errada. Os dois instrumentos respondem perguntas diferentes e **nenhum dos
dois sozinho autoriza trocar a régua do catálogo**.

⚠️ **Decomposição do erro (medida, n=30):** os três critérios que valem **71%** do produto —
`protagonist` 31,8%, `fantasy_nobility` 24,4%, `couple_dynamics` 14,8% — já são os mais
precisos (0,47 · 0,47 · 0,65) e o erro deles **não é viés, é discordância genuína**. Todo o
viés corrigível está em `drama`, `tragedy`, `action` e `romance`, que somam 19,6% do peso.
A precisão está perto do teto prático desta arquitetura.

🔴 **Correção de viés determinística: REPROVADA por leave-one-out.** In-sample parecia ótima
(0,776 → 0,646 geral / 0,637 → 0,579 ponderado); em LOO-CV dá **0,730 geral e 0,708
ponderado — o ponderado PIORA**. Os deslocamentos dos critérios pesados são ajustados em
ruído, e aplicar deslocamento a erro não-sistemático adiciona erro. Não aplicar. E não
repetir o teste in-sample achando que mede alguma coisa.

🔴 **Regex sobre prosa de modelo NÃO mede semântica.** Três checagens de coerência semântica
foram construídas e removidas no mesmo dia após validação manual: "prosa nega, nota ≥5"
(6/6 falso positivo), "intensidade fraca no topo da faixa" (5/5), "valência por leitor"
(~6/8, e marcava 51% do catálogo). O vocabulário aparece negado, comparado ou como nome de
gênero — *"ritmo mais agitado que slice of life"* casa com o padrão de ausência e afirma o
oposto. Só sobrevive a checagem **estrutural**: extrair `Faixa X-Y` da prosa e comparar com
`bandForScore`. ⚠️ **Sempre rode `--sample` e conte falso positivo antes de usar qualquer
número deste script numa decisão.**

## O dicionário dos atributos: a rubrica finalmente tem uma TELA

`/guide/attributes` (2026-08-16). A régua que decide o que "romance 7,5" quer dizer existia em
DOIS lugares e nenhum era interface: a tabela `criteria` no Supabase e o prompt da avaliação.
Na tela só apareciam pedaços — a página da obra mostra a faixa **daquela** obra, o formulário
pós-leitura mostra a da nota que você arrasta, e `/preferences` mostra a `description` sem as
faixas. Quem quisesse a diferença entre 6 e 8 em drama não tinha onde ler.

🔴 **Tudo DERIVA de `CRITERIA_INFO` + `CRITERIA_RUBRICS`** (`lib/criteria/glossary.ts`), e isso
não é preciosismo: a página existe para responder o que o MODELO leu ao pontuar. Uma cópia em
prosa envelheceria em silêncio e a página passaria a ensinar uma régua que não está em vigor —
pior que não existir. Mesma família do `CRITERIA_SCALE_LEGEND` dos prompts de ranking.

⚠️ **As 5 ressalvas de uso são escritas à mão, e ficam FORA do banco de propósito**
(`lib/criteria/glossary-notes.ts`): o texto de `criteria.ranges` vai para o PROMPT, então cada
linha nova ali muda a régua da IA e obriga a subir `PROMPT_VERSION`. Explicação para humano não
pode custar uma reavaliação do catálogo. O teste reprova nota cujo slug não exista.

⚠️ **A cobertura impressa ("cobre 7,0–8,9") sai de `bandBarBounds`, nunca do rótulo.** O rótulo
"7-8" não cobre 8,5 e o BIN cobre; imprimir o rótulo cru faria a página contradizer a nota que a
obra exibe — que é justamente o mal-entendido que ela existe para desfazer.

🔴 **O índice NÃO gruda, e isso foi decidido EM USO** (2026-08-16). Ele nasceu `sticky` e as
medições diziam que cabia — **288px, 29% de uma tela de 1000px**. Cabia e mesmo assim estava
errado: em movimento a barra permanente espreme o verbete contra a borda de baixo e a página
vira índice com um pouco de conteúdo. **Porcentagem de tela não captura isso; só usar captura.**

O que substituiu são duas peças mais baratas, e juntas elas fazem o mesmo trabalho:

| peça | custo | o que responde |
|---|---|---|
| **o título do verbete gruda** (`sticky top-[57px]` no cabeçalho de cada `<article>`) | ~44px | "que atributo eu estou lendo?" |
| **botão "Ver os atributos"** (`components/guide/back-to-top.tsx`) | 42px, e só depois de uma tela rolada | "como volto para escolher outro?" |

⚠️ O sticky do título para sozinho no fim do próprio verbete, porque é preso ao pai — não
precisa de JS. E com o índice estático o **scroll-spy saiu junto**: destacar o item ativo só
serve enquanto o índice está na tela, e quando ele está na tela você está no topo, onde nenhum
verbete está sendo lido. Isso devolveu o `AttributeIndex` ao servidor, sem `"use client"`.

🔴 **Quatro defeitos que só apareceram no APP, e que um mockup não tem como reproduzir:**

| o que | por quê |
|---|---|
| o índice marcava o ÚLTIMO verbete em qualquer posição | o `AppShell` põe `overflow: hidden` no body e quem rola é um **div interno** — `window.scrollY` fica preso em 0 e a condição de fim-de-página é sempre verdadeira. **Vale para qualquer scroll novo neste app**: o `BackToTop` precisa da mesma descoberta de scroller |
| o índice nascia **cortado pela metade** | o `<header>` gruda em `top: 0` com `z-40`; quem grudar em `top-0` fica embaixo dele. O valor é `top-[57px]` = `h-14` + 1px de borda — é ele que o título do verbete usa hoje |
| o índice marcava o verbete ANTERIOR ao clicado | a linha de leitura do spy era 30% da janela (300px) e a barra media 288px: o alvo parava a 304px e ainda não tinha cruzado |
| o "voltar ao topo" **parava no meio do caminho** | esconder o elemento FOCADO durante rolagem suave devolve o foco ao body e o navegador **CANCELA a animação**. Medido: parava em 869px de 3.000, com o botão já sumido. `blur()` antes do `scrollTo` resolve |

⚠️ **As artes vêm de `Imagens/Atributos/Fundo Branco` e essa pasta MENTE no nome:** as nove
trazem o xadrez de transparência **rasterizado** (dois cinzas neutros, rgb 253 e 246 — 2,7% de
diferença, invisível num pixel e evidente em bloco). `scripts/preparar-artes-atributos.mjs` limpa
o xadrez, tira o fundo por preenchimento **a partir da borda** (só o que liga ao exterior; os
brancos internos — dentes do emoji, brilhos das gemas — ficam) e recupera o alfa com curva
γ=1,8, sem a qual o glow quase-branco volta como **névoa cinza** sobre o fundo escuro. Saída em
WebP q85, três tamanhos: **13.342 KB → 471 KB** em 27 arquivos.

🔴 **A ENTRADA não está no git** (`Imagens/` está no `.gitignore` e no `.dockerignore`) e a SAÍDA
está (`public/attributes/`, 528 KB). Num clone novo o script falha por falta da pasta — o certo,
mas significa que **se as artes originais de 1254² se perderem, o que resta são os WebP de 480px**.

⚠️ **Nada disso roda em runtime.** Com `output: "standalone"` o otimizador de imagem do Next roda
no servidor do Fly, e estas artes são imutáveis: pagar CPU por elas a cada request seria trocar
400 KB de disco por latência permanente. Por isso `<img>` cru, não `next/image`.

⚠️ **ABERTO, medido e adiado (2026-08-16): no celular o índice ainda come a primeira tela.**
Abaixo de 660px ele vira 5 linhas de 2 colunas:

| aparelho | índice | % da tela |
|---|---|---|
| iPhone SE (375×667) | 561px | **84%** |
| iPhone 14 (390×844) | 561px | 66% |
| Pixel (412×915) | 561px | 61% |
| tablet (768×1024) | 308px | 30% |

Nada está quebrado — **zero overflow horizontal** nas quatro larguras, a tabela rola sozinha, a
arte do verbete fica em 200px —, e o custo CAIU quando o índice deixou de grudar: hoje se passa
por ele uma vez, em vez de conviver. O que sobra é a primeira impressão: quem abre o dicionário
no celular vê uma parede de ícones antes de "Como ler a escala". A saída desenhada é uma **tira
horizontal rolável** (uma linha, artes ~56px, ~110px de altura) só abaixo de 660px, sem tocar no
desktop. ⚠️ É uma media query, não um redesenho — o número a bater é 561px.

⚠️ **Também aberto: a página tem UMA porta de entrada só** (o card do `/guide` + a busca ⌘K).
O lugar que falta é o cabeçalho do bloco "Notas por critério" da aba Análise da IA — quem está
olhando as 9 notas de uma obra é exatamente quem quer saber o que elas significam. **Não** ponha
no chip de faixa (são 9 por obra, e o chip já mostra a rubrica daquela faixa no tooltip) nem
DENTRO de um tooltip: o do Radix fecha quando o mouse sai do gatilho, e o link fica
inalcançável.

Guardado por `tests/unit/guide/dicionario-de-atributos.test.ts`, que **deriva de
`CRITERION_SLUGS`** (critério novo no Supabase entra na página sozinho, ou reprova) e foi
conferido com **5 sondas**. Uma delas pegou um caso fraco: a versão inicial checava só que a
cobertura impressa CAI na faixa, e "0,0–3" também cai — passava verde escondendo o meio ponto.
Hoje o limite é testado pelos dois lados.

## Quem escreve prosa sobre uma obra precisa saber o que os números dela QUEREM DIZER

Ranking e Deep Dive recebem `category_scores: tragedy=6.0, couple_dynamics=8.0, …` como números
**crus** — sem a rubrica e sem as justificativas que os produziram — ao lado das tags em texto e
do digest inteiro. Sem saber que 6,0 em `tragedy` é *"perdas isoladas ou reversíveis"*, o
consultor escreve a prosa a partir do digest e os números viram enfeite.

Medido em 2026-08-09 sobre **281 itens de ranking** persistidos: **21 descrevem abuso,
toxicidade ou violência numa obra cujo `couple_dynamics` ≥ 7** — a faixa que significa relação
**saudável**. Caso real (`tragedy=6.0`, `couple_dynamics=8.0`): *"o tom é predominantemente 'dark
ambience' com abuso físico extremo e tragédia como pano de fundo constante"* — vocabulário da
faixa 9-10 sobre um 6,0, com a lista de atributos ao lado na mesma tela.

A correção é uma constante só, em `lib/ai-recommendation/prompts.ts`:

| | |
|---|---|
| `CRITERIA_SCALE_LEGEND` | os rótulos das 4 faixas dos 9 critérios, **derivados de `CRITERIA_RUBRICS`** |
| `CRITERIA_COHERENCE_RULE` | proíbe prosa que contradiz o número; manda **declarar** a divergência |

🔴 **A legenda é DERIVADA, nunca escrita à mão.** `sync-constants` reescreve as faixas a partir
do banco; uma cópia literal aqui é a 2ª régua pro mesmo número — mesma armadilha do
`LOW_BALANCE_USD` e do `STRONG_TAG_WEIGHT`. Só os **rótulos** entram (o texto antes dos
dois-pontos): a rubrica inteira são ~5k caracteres e o que falta ali é vocabulário de
intensidade, não a casuística.

⚠️ **A legenda precisa avisar que `couple_dynamics` é valência** — senão ela ENSINA o erro:
"0-3 Destrutiva" lido na chave de presença vira "quase não tem dinâmica", que é o oposto.

⚠️ **Quando o digest contradiz os atributos, isso é INFORMAÇÃO — não um empate a resolver em
silêncio.** A regra manda registrar a divergência em `risks` nomeando os dois lados e abaixar o
`confidence`. Escolher um lado sem dizer que havia outro é o que faz a mesma obra ser descrita de
dois jeitos em duas telas. E a regra diz explicitamente que **não** é permissão pra ignorar as
reviews — senão conserta um viés e abre o oposto.

⚠️ **São DOIS consumidores, e o Deep Dive tem uma cópia PRÓPRIA de `formatCategoryScores`** — é
fácil corrigir só o ranking e achar que acabou. Guardado por
`tests/unit/ai-recommendation/legenda-de-faixas.test.ts`, que verifica os dois prompts.

✅ **O que NÃO era problema, medido:** a suspeita de que avaliação e digest liam amostras
diferentes das mesmas reviews. Os tetos de fato divergem (avaliação 30 total/12 por fonte,
estratificada por **nota do reviewer**; digest 40 total/8 por fonte, as mais **longas**) e 358
obras passam do teto — mas replicando os dois seletores sobre as reviews persistidas, o **Jaccard
mediano é 78,9%** (p10 64,3%, p90 100%, **nenhuma obra abaixo de 50%**). As duas leem
essencialmente a mesma evidência; a discordância entre os artefatos vem da TAREFA, não da
amostra. Unificar os seletores não vale o custo de re-rodar tudo.

## Quatro critérios tinham colapsado numa faixa só — e cada um por um motivo diferente

Medido em 2.393 avaliações (2026-08-09), share por faixa da rubrica:

| critério | 0-3 | 4-6 | 7-8 | 9-10 | σ |
|---|---|---|---|---|---|
| `action_adventure` | 19,9% | **73,5%** | 6,6% | **0,0%** | 1,31 |
| `protagonist` | 0,1% | 18,8% | **77,4%** | 3,7% | **0,87** |
| `romance` | 1,5% | 16,3% | **73,7%** | 8,4% | 1,16 |
| `fantasy_nobility` | 3,4% | 7,4% | 76,2% | 13,0% | 1,42 |

Isso custa duas vezes: **feature quase-constante não contribui nada pro Ridge** da Nota Prevista
e não discrimina em filtro nem em ordenação do `/ranking`.

🔴 **NÃO ESTÁ CORRIGIDO. Esta seção dizia "Corrigido na v25" e era falso** — a v25 foi
**revertida** no commit `0ab2ae7` e o prompt vigente é a **v26** (texto da v22 + a description
da migration 181). Conferido em 2026-08-10 no source: a regra antiga do piso segue intacta em
`service.ts` (*"Se há QUALQUER evidência … a nota deve ser ≥ 5"*) e nenhum dos quatro
mecanismos abaixo está no `SYSTEM_PROMPT`.

⚠️ **O que segue valendo é o DIAGNÓSTICO, não o conserto.** Os quatro mecanismos abaixo são a
análise de por que cada critério colapsou — continuam corretos e continuam sendo o desenho a
implementar. O que não existe é a implementação.

🔴 **E o instrumento que faltava já existe: `npm run consistency`** (2026-08-10). As quatro
tentativas foram reprovadas pelo gold, que mede PRECISÃO, quando o que elas mudavam era
CONSISTÊNCIA — régua errada para a pergunta. O que este bloco pede (descomprimir faixa, dar σ
a um critério colapsado) é exatamente o que o painel enxerga sobre 8.757 notas, e o gold, com
n=30 e piso 0,10, não enxerga. **Salve o retrato ANTES de mexer no prompt**
(`npm run consistency -- --save=…`) — sem o retrato anterior a tentativa nasce inconclusiva,
que foi o destino das quatro. E leia a seção **"Duas réguas para as notas de atributo"**:
os dois instrumentos são complementares, e passar num não dispensa o outro.

🔴 **O instrumento foi usado, e a 5ª tentativa também REPROVOU — agora pela régua certa**
(2026-08-15, `arquivo/prompt-v27`). A v27 portava o texto da v23 por cima da main mirando os
mecanismos 1 e 4. O piloto (30 obras, US$1,20, pago em 11/08 e julgado só agora) deu movimento
**distinguível do ruído** — 22,6% de troca de faixa contra piso 12,2%, z = 5,1 — **nos lugares
errados**:

| mecanismo mirado | resultado |
|---|---|
| **1** · `action_adventure`, remover o piso ≥5 | **Δ 0,00**. No estrato escolhido pra concentrar o mecanismo (6 obras de slice of life), **nenhuma caiu para 0-3** |
| **4** · `protagonist` passivo | as 3 obras do estrato ficaram **8 → 8**; no geral **subiu** +0,29 |
| — (não mirado) | `tragedy` **+1,05**, o maior movimento — e pesa **0,2%** na Nota Prevista |

⚠️ **O F-controle andou tanto quanto os estratos-alvo** (|Δ| 0,71 contra 0,61–0,71; faixa
22,2% contra 22,6% geral), com humor −2,5, drama +2,0, tragedy +2,0. Controle que anda igual
ao tratamento **impede ler o efeito como local** — o z=5,1 mede deriva global, não correção
dirigida.

Os quatro mecanismos, então — a tentação é tratar como um problema só, e não é:

🔴 **1. O piso de 5 se sobrepunha à RUBRICA.** Ele existe contra dois vieses reais (baixar por
execução fraca, baixar por silêncio das fontes) — mas estava vencendo até evidência POSITIVA de
ausência. Medido: das 1.027 justificativas de `action_adventure` que afirmam ausência ("slice of
life", "uneventful", "nada acontece"), **316 (30,8%) ficaram ≥5** — enquanto a faixa 0-3 do
critério diz literalmente *"cotidiano, sem conflito externo relevante (slice of life)"*. A prosa
citava a definição da faixa e a nota não ia pra lá. ⚠️ Ao mexer nisto, mantenha explícito o que o
piso ainda protege: corrigir um viés reabre o outro.

🔴 **TESTADO EM 2026-08-15, e o piso NÃO era o mecanismo causal.** A v27 removeu as duas
frases (*"a nota deve ser ≥ 5"* e *"0-4 são RESERVADAS"*) e `action_adventure` **não se
moveu** — Δ médio 0,00 no piloto, e nenhuma das 6 obras de slice of life caiu para 0-3. A
contradição entre o piso e a rubrica **é real e segue no ar**, mas removê-la não muda a nota:
o modelo não estava obedecendo àquele piso. Quem reabrir este mecanismo precisa de outra
hipótese sobre por que a prosa afirma ausência e o número não acompanha — trocar o texto do
piso já foi tentado e medido.

🔴 **2. A posição DENTRO da faixa era surda à intensidade que a própria prosa declarava.** Entre
notas 4–6,9, a justificativa com "pontual/esporádico/não domina" distribuía **31/32/35%** (em
4–4,9 / 5 / >5) contra **33/35/31%** da prosa neutra — idênticas. A palavra "pontual" não mudava
o número. Caso real: *"eventos pontuais, sem dominar o tom geral"* → **6,0**, o topo da faixa. A
regra nova tem PRECEDÊNCIA explícita sobre "prefira o valor central" e sobre "use o valor mais
alto da faixa inferior" — sem isso ela nasce letra morta.

🔴 **3. A "REGRA OBRIGATÓRIA" de `fantasy_nobility` virou piso.** Justificativa citando o gatilho
(reencarnação/regressão/transmigração/isekai) → **97,9% ≥7**, média 8,11; sem citar → 81,1% e
7,14. Como **48%** das avaliações citam o gatilho num catálogo majoritariamente isekai/vilã, a
regra deixou de distinguir qualquer coisa. Hoje esses tropos são **dispositivo narrativo**, não
estrutura: uma regressão para um escritório contemporâneo não é `fantasy_nobility` 7-8. ⚠️ O
antídoto ficou escrito no prompt — *"se a sua justificativa poderia ser copiada para metade das
obras do catálogo, ela não é evidência de 7-8"*.

🔴 **4. `protagonist` perdeu a AGÊNCIA do gate.** A faixa 0-3 abre com *"sem agência, decisões
irrelevantes"*, mas o prompt só autorizava faixa baixa pra "ESQUECÍVEL / GENÉRICO / SEM
PERSONALIDADE / SUBSTITUÍVEL". Medido: das **151** justificativas que chamam o protagonista de
passivo ou sem agência, **51% ficaram ≥7** — a faixa que exige "agência clara, decisões movem a
trama" — e só 9 abaixo de 5. ⚠️ A régua que separa os dois casos: *"Mary Sue", "irritante",
"fria" são sobre COMO ele é e não rebaixam; "passivo" e "sem agência" são sobre O QUE ELE FAZ e
rebaixam.* Sem essa distinção nomeada, consertar a agência reabre o viés de qualidade.

### Qual versão de prompt está VIVA (confira antes de acreditar em qualquer seção acima)

`PROMPT_VERSION` em `service.ts` é a fonte; este bloco é resumo e **envelhece**. Estado em
2026-08-10:

| versão | o que trouxe | está no prompt? |
|---|---|---|
| v18 | saída verbosa (o outro lado do `CONCISE_OUTPUT`) | sim, no toggle |
| v21 | citação de review por **consenso**, sem exigir IDs | sim |
| v22 | piso/teto de `adult_content` por **procedência** | sim |
| v23 | `couple_dynamics` como escala de **valência** (4 checagens, TOLERAR×QUERER) | ❌ **revertida** |
| v24 | *(nunca foi versão de prompt — ver abaixo)* | — |
| v25 | descompressão dos 4 critérios colapsados | ❌ **revertida** |
| **v26** | **texto da v22 + a `description` da migration 181** | ✅ **VIVA** |
| v27 | porte da v23 por cima da main | ❌ **arquivada** — reprovou no piloto (`arquivo/prompt-v27`) |

🔴 **v26 não é "v25 + 1": é a v22 de volta.** A única diferença real em relação à v22 é que a
`description` do `couple_dynamics` vem ampliada do banco (migration 181), e isso entra no prompt
porque `buildCriteriaPromptSection()` cola a description acima das faixas. O número subiu em vez
de voltar pra "v22" porque a versão entra na chave de cache (`canonicalInputHash`) e é gravada em
`ai_evaluations.prompt_version` — reusar "v22" faria o cache servir avaliação da régua antiga
como se fosse da nova, **e o rótulo no banco mentiria**. Guardado em
`tests/unit/ai-evaluation/prompt-version-pin.test.ts`, que fixa o **sha256 do `SYSTEM_PROMPT`**
à versão (inclusive as rubricas interpoladas, porque `sync-constants` mexer numa faixa também
muda a régua).

⚠️ **A v24 nunca foi versão de prompt, e isso NÃO é um bug:** `ai_api_calls` tem 65 chamadas
de `ai_evaluation` rotuladas `v24` (2026-07-29) — **todas as 65 são obras do gold set**, da
investigação de rubrica que comparou v23/v24 contra o julgamento da curadora. `ai_evaluations`
gravou v22 nelas porque **versão de RUBRICA ≠ versão de PROMPT**: são dois eixos, e o log carrega
o primeiro enquanto a tabela carrega o segundo. Reusar "v24" como versão de prompt misturaria os
dois eixos em qualquer query por `prompt_version`.

⚠️ **O que SOBREVIVEU da empreitada v23–v25** (não foi tudo revertido — só o prompt):

| entregue | onde vive |
|---|---|
| `couple_dynamics` com description ampliada | **migration 181**, aplicada local + nuvem |
| 18 tags de circunstância deixam de valer piso 9,0 | **migration 182**, aplicada local + nuvem |
| legenda de faixas nos prompts de ranking e deep dive | `lib/ai-recommendation/prompts.ts` |
| `realinharFaixaCitada` + backfill (149 → 23 incoerências) | `service.ts` + `scripts/backfill-faixa-citada.ts` |
| remoção do clamp `enforceNeutralCoupleDynamicsWhenNoRomance` | `service.ts` |
| harness de acurácia contra o gold | `scripts/gold-mae.ts` |

🔴 **Antes de mexer em rubrica ou prompt de avaliação, leia `.gold/gold-FILLED.csv` e
[[project_rubric_redesign_gold_verdict]].** São 30 obras que a curadora avaliou **às cegas** nos 9
critérios — a única régua de ACURÁCIA que existe. Medir "a nota mudou no rumo pretendido" é
consistência, não acurácia, e já enganou uma vez: a v23 mudava no rumo e ficava MAIS LONGE da
curadora. Harness: `scripts/gold-mae.ts`. Baseline a bater: **catálogo 0,77 geral / 0,64
ponderado** — v24-pesada 0,82 · v23 0,87 · v24-cirúrgica 0,89 · **v25 1,04 / 0,97**, nenhuma
bateu. ⚠️ **São CINCO derrotas, não quatro**: a v25 esteve fora desta linha até 2026-08-15
porque o gold dela foi pago e nunca computado. E a melhor perdeu por **+0,05** — o padrão não
é "quase lá", é uma classe de tentativa que não funciona.

🔴 **ENTANGLEMENT:** as 9 notas saem de UMA leitura do modelo, então mexer na rubrica de um
critério recalibra o modelo inteiro e move os vizinhos — e isso NÃO é controlável por tamanho de
edição (a v24-cirúrgica quebrou couple/romance/humor tanto quanto a pesada). Um piloto de v25 em
2026-08-09 reproduziu a assinatura: `humor` e `fantasy_nobility` caíram ~1,2 ponto no **grupo de
controle**, sem nenhuma regra mirando neles.

## A rubrica tem DUAS naturezas de escala, e `couple_dynamics` é a única de valência

Oito critérios medem **presença/intensidade** (0 = não está lá). `couple_dynamics` mede
**valência**: 0-3 = o vínculo faz MAL a quem está nele, 9-10 = faz BEM. Nota baixa ali não
quer dizer "não tem vínculo".

🔴 **E o slug MENTE: `couple_dynamics` não é sobre casal.** O critério virou "Dinâmica entre
Protagonistas" em `95226f7` (2026-07-27) e as faixas passaram a falar de **vínculos centrais**
— mas a ampliação ficou **pela metade por 13 dias, e nada acusava**: a `description` no banco
continuou "a relação entre o **casal principal**", o guia de tags dizia "apenas quando a tag
descreve o casal", e o clamp de romance seguia vivo. Como `buildCriteriaPromptSection()` cola a
description ACIMA das faixas, o modelo lia título amplo + descrição restrita + rubrica ampla no
mesmo bloco. Fechado pela **migration 181** + v23.

✅ **A 181 está aplicada na nuvem** (2026-08-09, projeto `obwlwu…pizd`). Conferir com
`select md5(description) from criteria where slug='couple_dynamics'` via Management API e
comparar com o local — bateram em `f3b2adbd15b1f4e1d42f1c85373d17b6`. ⚠️ O
`scripts/apply-migration.mjs` deriva o ref do `NEXT_PUBLIC_SUPABASE_URL` do `.env.local`: com o
env apontando pro LOCAL ele não acha ref nenhum e sai. O ref da nuvem mora em
`.env.supabase-cloud` ([[project-conferir-migration-na-nuvem]]).

⚠️ **O vínculo a avaliar tem ORDEM, não é uma lista solta:** casal principal → família (pais,
irmãos, filhos) → demais recorrentes (mestre/discípulo, equipe, rivalidade, amizade). Pegue o
PRIMEIRO que a obra tiver, e diga na justificativa qual foi. Sem a ordem, obra com casal E
família fica ambígua e as notas deixam de ser comparáveis entre si — mesma classe das réguas
misturadas. O **5 significa "sem vínculo central recorrente"** (protagonista isolado), nunca
"sem romance".

Até a **v22** as meta-regras de presença do `SYSTEM_PROMPT` valiam pros 9, e isso produzia
três absurdos silenciosos:

- *"se há QUALQUER evidência de presença, a nota deve ser ≥ 5"* proibia nota baixa sempre
  que existisse um casal — justo o caso que a faixa 0-3 existe pra descrever;
- a coerência justificativa×faixa manda "recorrente/constante" pra faixa ALTA. Em
  `couple_dynamics` "atrito **recorrente**" é uma relação PIOR — a regra estava invertida;
- a exceção que dispensa essas regras listava só `drama` e `tragedy`.

🔴 **E a seção de sinais indiretos mapeava `"possessive but I love it" → 0-3`** — a leitora
declarando que GOSTA virava dano à relação, contradizendo a regra dedicada logo abaixo, que
manda checar consenso/satisfação/tom antes. Medido em 2.393 avaliações: justificativa citando
posse/ciúme/yandere caía em 0-3 em **19,1%** dos casos contra **5,4%** quando não citava (3,5×),
e `couple_dynamics` era **o critério mais instável dos 9** (amplitude média **1,52 pt** entre
reavaliações da mesma obra; 36,7% variando ≥2 pt; pior caso 6,0).

🔴 **O que vem abaixo foi ESCRITO, medido e depois REVERTIDO — não está no prompt.** A v23
existiu, foi ao ar por horas e voltou no commit `0ab2ae7` junto com a v24/v25; o prompt vigente
é a **v26**. Conferido no source em 2026-08-10: nenhuma das isenções, nem o TOLERAR×QUERER, nem
a linha do tempo estão no `SYSTEM_PROMPT`. **O desenho abaixo permanece como a especificação a
implementar** — foi discutido em detalhe com a curadora e as regras foram refinadas em duas
rodadas de feedback dela; jogar fora custaria refazer isso. O que não existe é o código.

A **v23** isentava `couple_dynamics` das três meta-regras, e a regra própria passava a
exigir quatro checagens antes da nota: (a) consenso, (b) satisfação, (c) tom e **(d) linha do
tempo** — em regressão/reencarnação/transmigração, o tóxico da vida ANTERIOR é contexto
estabelecido e não conta (mesma lógica que `tragedy` já aplica ao background). São **496 obras**
com tag desse tipo, 256 delas hoje com `couple_dynamics` ≤ 6.

⚠️ **Por que reverteu, já que o diagnóstico estava certo:** o problema nunca foi a qualidade da
regra — foi não existir instrumento capaz de dizer se ela melhorou alguma coisa. Ver
**"Duas réguas para as notas de atributo"**: o piso de detecção do gold set é 0,10 e o ganho
disponível é ~0,05. Sem isso resolvido, escrever regra nova só troca um viés conhecido por um
desconhecido, ao custo de reavaliar o catálogo.

⚠️ **O sinal decisivo é a REAÇÃO do outro personagem, não a intensidade do comportamento.**
Tag de posse descreve um lado; sem indício de como o outro reage, ela **perde peso** em vez de
puxar pra baixo.

🔴 **Opinião de leitor não escolhe faixa — mas a RECLAMAÇÃO é a melhor fonte da reação do
personagem, e descartá-la joga a evidência fora junto.** A 1ª redação da regra mandava "extraia o
FATO e DESCARTE o julgamento" listando como descartáveis justo as frases que **carregam** o fato:
leitores comentam o que os incomodou, e pra isso descrevem o que a personagem fez ou sentiu.

A separação é pelo **SUJEITO da frase**, nunca pelo tom:

| frase fala de… | exemplo | uso |
|---|---|---|
| **o leitor** | "eu não aguentaria", "achei sufocante", "tenho raiva do ML" | preferência — não escolhe faixa |
| **a personagem** | "ela aceita", "ela está desconfortável", "ela perdoou" | **fato sobre a reação** — peso alto |

Uma frase costuma ter as duas:

| reclamação / elogio | fato extraído | faixa |
|---|---|---|
| "ela é **idiota de aceitar** o ciúme dele" | ela **TOLERA** | **4-6** |
| "**amo** como ela **provoca o ciúme dele de propósito**" | ela **QUER** | 7-8 |
| "é **absurdo** ela **perdoar** como ele a tratou **na linha do tempo original**" | ela **perdoou** + item **(d)** | o maltrato não conta |
| "**tenho raiva** desse ML que não respeita a FL **mesmo quando ela está desconfortável**" | ela está **desconfortável** e ele ignora | **0-3** |

Os dois primeiros falam do **mesmo comportamento** e separam-se só por ela tolerar ou querer —
é isso que prova que nem o tom da review nem o comportamento decidem sozinhos.

🔴 **TOLERAR não é QUERER, e nenhum dos dois APAGA a toxicidade — minimiza.** É o erro que mais
puxa pro lado permissivo, e a 1ª redação caiu nele: mapeava "aceitação" direto pra 7-8, a faixa
que exige **respeito mútuo e conflito RESOLVIDO** — não conflito **absorvido por um lado só**.

| | |
|---|---|
| **DESEJADA** — ela participa, retribui, conduz | 7-8 (9-10 só com parceria e crescimento) |
| **TOLERADA** — aguenta, releva, perdoa e segue | **teto 6** |

⚠️ **Dois tetos, porque a reação dela sobe a nota no máximo UMA faixa:** dano visível + tolerância
→ 0-3 vira 4-6, **nunca** 7-8. E abuso real no **desenvolvimento** → **teto 8** mesmo com redenção
encenada e perdão explícito — 9-10 é *"parceria, apoio mútuo e crescimento conjunto"*, que não
convive com histórico de abuso dentro da própria obra.

⚠️ **Perdão sem mudança ENCENADA é tolerância, não reconciliação** (teto 6): a obra precisa
mostrar a virada dele, não só a interrupção do comportamento.

⚠️ Leitores discordando sobre a REAÇÃO dela ("ela aceita numa boa" × "ela sofre") é divergência
**real sobre a obra** — pontue pelo sinal mais frequente e abaixe a `confidence`. Não é o mesmo
que divergência de gosto.

🔴 **Mudar o texto do prompt sem trocar a `PROMPT_VERSION` é erro silencioso duplo:** a versão
entra na chave de cache (`canonicalInputHash`) e é gravada em `ai_evaluations.prompt_version`,
então o cache serve avaliação da régua antiga como se fosse da nova e o rótulo no banco mente.
Guardado por `tests/unit/ai-evaluation/couple-dynamics-valencia.test.ts`, que **fixa o sha256 do
`SYSTEM_PROMPT` à versão** — inclusive as rubricas interpoladas de `CRITERIA_RUBRICS`, porque
`sync-constants` mexer numa faixa também muda a régua.

⚠️ **O catálogo hoje é uma MISTURA de réguas.** As notas vigentes vêm de **9 versões de prompt**
(medido 2026-08-09: v19=227 obras, v21=220, v20=152, v18=146, **v22=91**, v17=83, v16=47 — a versão
corrente cobria 9,4%). Controlando por mesmo modelo + mesma versão, a amplitude entre reavaliações
cai de 1,52 para **0,45** — ou seja **~70% da instabilidade medida vem da régua ter mudado**, não do
modelo. Isso contamina toda comparação entre obras: ordenação do `/ranking`, os limiares
`min_<slug>`/`max_<slug>` (em pontos), `ideal_min..ideal_max` do perfil, o Ridge e o `personal_fit`.

The model is `claude-sonnet-5` (`SONNET_MODEL`), prompt version **`v26`** (toggled by `CONCISE_OUTPUT` in `service.ts`: `v26` concise output / `v18` verbose — flipping it falls back to the old caches; `v21` = concise + **consensus** review citation, `v22` = piso/teto de `adult_content` por procedência), up to 2 attempts (4500 max tokens on **both** attempts; temperature 0.2 then 0). Opus 4.7 and Haiku 4.5 are supported as per-evaluation overrides (the A/B "Reavaliar com…" buttons); Opus 4.7 doesn't accept the `temperature` param. MAE values stored in `formula_config` reflect calibration runs against the current model+prompt; the hardcoded fallbacks in `calibration.ts` (1.27/0.92) are historical defaults from the original spreadsheet — not authoritative.

## Importação (`/import`)

Quatro métodos, **todos pela MESMA reconciliação** (`analyzeExternalListImport` → buckets de
auto-update / conflitos / ambíguos / novas / sem-mudança → `commitExternalListImport`). O input comum é
`ExternalListInput { filename, contentBase64, source?, username? }`; o servidor **re-parseia no commit**
(determinístico), então só recebe as decisões do usuário indexadas por posição.

| Método (`ExternalListSource`) | Como entra | Parser |
|---|---|---|
| Arquivo — `myanimelist` / `mangaupdates` / `animeplanet` | upload (.json / .json / .xml.gz) | `parseExternalList` |
| `anilist` | **API pública por usuário** (`fetchAniListUserMangaList`, GraphQL `MediaListCollection`) — sem arquivo | `parseAniListList` (ordena por `mediaId`: o commit re-busca e a ordem tem que bater) |
| `titles` | **lista colada, um título por linha** (só-título, curadoria em massa do admin) | `parseTitleList` |

Título tem vírgula/`;` no meio → o único separador seguro da lista colada é **quebra de linha**. A
dedup contra o DB é a própria reconciliação (matcher Jaccard + rede `pg_trgm`), igual para todos.

**"Revisar pendentes" mostra SÓ obras criadas por importação** (`getPendingReviewWorks`: junta
`import_rows.status = "imported"` ao filtro `ai_eval_status = "pending"` + não-arquivada). Obra criada
em `/catalog/new` **NÃO entra** aqui, mesmo sem avaliação IA — antes entrava e poluía a lista.

### Import multi-user (Bloco 02 do destrave — feito)

O import deixou de ser `ensureAdmin`-only: o gate é `ensureReadingStateWriter` (sessão +
`own_state`), e cada importação registra o dono:

- **Per-user**: `imports.user_id` (migration 170; backfill → dono) + RLS; o estado pessoal da
  lista (nota/status/capítulos) vai pra `user_work_state` de quem importou via
  `writeReadingState` (cliente de sessão). `getPendingReviewWorks`, Histórico e "última
  importação" do `/import` filtram por `imports.user_id`; obra criada é catálogo compartilhado.
- **`buildMatchContext(supabase, userId)`**: o lado "atual" do diff é o estado de QUEM importa
  (works + `user_work_state` dele), não mais o espelho do dono. As três leituras são paginadas —
  `work_external_ids` tinha 6.9k linhas com o índice de match SILENCIOSAMENTE truncado em 1000.
- **Plano free**: sem gate novo, por decisão (2026-07-31) — o leitor importa igual; a aba
  "Revisar pendentes" só INDICA que o enriquecimento usa IA (assinatura/créditos). Recalc:
  dono → fila global; demais → `recalculateForUser` em `after()` (+ fila global se criou obra).

## External data sources

> **Bypass de Cloudflare — leia antes de mexer em fonte externa.** Mangago e AnimePlanet devolvem
> **403 `cf-mitigated`** a um fetch do Node: elas **dependem** de um bypass. A Comix é pior — a API
> dela (`/api/v1/*`) responde `403 Missing token`, e o token vai num parâmetro `_` que **assina a
> query** (não dá pra forjar nem reescrever). Só um browser real resolve.
>
> Há duas camadas, nesta ordem (`fetchHtmlWithCfFallback`):
> 1. **Sidecar `comix-render`** (`services/comix-render/`, Playwright, `COMIX_RENDER_URL`) — `/resolve`
>    descobre a Comix; `/render` atravessa o Cloudflare das demais. **Sobe sozinho em dev** via launchd
>    (`com.geners.comix-render`). Ver o README do serviço: duas armadilhas silenciosas moram lá (flags
>    de automação e `content_rating`).
> 2. **FlareSolverr** (Docker `:8191`) — rede de segurança **e ÚNICA via do ComicK**.
>    🔴 **As duas camadas NÃO são substituíveis** (medido 2026-08-04, 6 buscas por condição):
>    ComicK volta **6/6 com FlareSolverr** e **0/6 com o sidecar sozinho**. Quem cobre Mangago e
>    AnimePlanet é o sidecar (81 e 12 reviews em 4 obras); o FlareSolverr sozinho cobre as duas de
>    forma ERRÁTICA (20 e 4, e só em 2 das 4 obras). Os números de Mangago/AnimePlanet são de UMA
>    rodada por condição — o do ComicK foi remedido com repetição justamente porque o agregado
>    dava 1/4 num cenário e 4/4 noutro.
>
> **Em dev, o Docker/FlareSolverr é OPCIONAL — o sidecar é a camada primária.** O sidecar não tem
> nenhum fio pro FlareSolverr (só o cita em comentário); ele atravessa o Cloudflare com o Chromium
> próprio do Playwright. **Comprovado com o Docker DESLIGADO** (2026-07-22): container parado, porta
> 8191 morta, e `POST :8790/render` de `anime-planet.com/manga/berserk` voltou 200 com HTML real (não
> desafio) em ~3,75s. O FlareSolverr só é acionado se o sidecar devolver `null` (ver
> `fetchHtmlWithCfFallback`). Regra prática: dia a dia pode fechar o Docker; deixe aberto só em
> aquisição pesada (import em massa / backfill), pela redundância.
>
> 🔴 **Isso deixou de valer para a COMIX em 2026-08-11 — lá o FlareSolverr é OBRIGATÓRIO.** O
> sidecar não atravessa a Comix desde 29/07 (1.168 tentativas, zero sucessos) e o plain fetch
> morreu quando ela voltou a desafiar. Com o Docker fechado, a Comix entrega **zero reviews** — e
> não é o sidecar que está fora, é ele respondendo `upstream_blocked`. Para mangago/anime-planet/
> comick a regra acima segue valendo (`render_ok` em ~1s, medido no mesmo dia). ⚠️ A assimetria é o
> ponto: "o sidecar é a camada primária" é verdade **por host**, não em bloco.
>
> **MyAnimeList**: metadados vêm da **API oficial v2** (`lib/external/myanimelist.ts`, header
> `X-MAL-CLIENT-ID` ← `MAL_CLIENT_ID` no env; OAuth só serve pra dados de usuário logado). Reviews
> vêm de **scraping direto** (`myanimelist-reviews.ts`) porque a v2 **não tem reviews** — não existe
> endpoint nem campo. O **Jikan** (scraper de terceiros que ficava em 504 e derrubava a fonte inteira)
> foi **apagado**. Sem `MAL_CLIENT_ID`, o MAL degrada em silêncio: some da busca e da média de
> plataforma — e ele costuma ser a fonte com **mais votos** de todas.

`lib/external/index.ts` is the multi-source orchestration layer:
- `searchAllSources(query)` — parallel search across AniList, MangaUpdates, ComicK, Kitsu, MyAnimeList, MangaDex, AnimePlanet, Mangago **e Comix**; merges by title similarity (threshold 0.65 for grouping, 0.72 for accepted)
  - ⚠️ **A Comix ESTÁ em `SEARCH_CONNECTORS`** (esta linha dizia o contrário até 2026-08-04) — mas
    hoje volta sempre VAZIA: `/manga*` exige o token de assinatura `_=` e responde `Missing token`.
    **Não é Cloudflare, é autenticação, e nenhum bypass atravessa** (medido em 3 condições: sem
    nada, só sidecar, sidecar+FlareSolverr — idêntico nas três). Ela devolve `[]` e não erro, então
    **nem em `failedSources` aparece**: some do relatório sem deixar rastro, e num diagnóstico
    agregado isso é indistinguível de "a obra não está na Comix". A 1ª negativa abre o circuito de
    auth (`COMIX_AUTH_CIRCUIT_TTL_MS` = 30min) e as chamadas seguintes custam 0ms — o custo de
    mantê-la na lista é uma requisição falha de ~0,4s por processo. Quem de fato dá o hid a uma
    obra NOVA é o cross-ID do sidecar (`quickResolveComixHidForWork`), que sem `COMIX_RENDER_URL`
    devolve `false` na hora.
- `fetchMultiSourceDetails(candidate)` — hydrates a candidate from all platforms by ID, filters accepted sources (titleScore ≥ 0.72 AND synScore ≥ 0.18 AND composite ≥ 0.62), then calls the AI. Reverse-substring matches ("Fake Lady" inside "The Fake Lady and Her Rabbit Duke") são graduados por proporção pra evitar falsos positivos.

Client-side fetches (ComicK ratings, AnimePlanet ratings) live in `lib/external/client-fetches.ts` and are called directly from `ExternalSearch` component to avoid the server action round-trip.

Review/context fetching is centralized in `lib/external/index.ts`:
- `fetchExternalEvaluationContextForCandidate()` hydrates confirmed source IDs and gathers reviews/context only from accepted sources.
- `fetchExternalEvaluationContextForWork()` is the fallback for works without confirmed IDs; it searches title variants, accepts a candidate, then delegates to the candidate-based context builder.

## Database schema summary

Core tables: `works`, `category_scores`, `calculated_scores`, `platform_ratings`, `score_weights`, `formula_config`, `ai_evaluations`, `ai_evaluation_scores`, `tags`, `tag_group`, `work_tags`, `criteria`, `source`, `imports`, `import_rows`.

AI recommendation tables: `taste_profile`, `recommendation_runs`, `deep_dive_results`, and `recommendation_chats` (conversational recommendation chat — paid-only; 1 row per conversation, messages in a JSONB array with a compact per-turn recommendation snapshot). The chat is a thin layer over `runRecommendationAction` (it reuses the ranker; each recommend turn still creates a `recommendation_runs` row). All Claude calls log to `ai_api_calls`.

RLS está ligada em todas as tabelas e o cliente **anônimo** não lê nada (nem o catálogo) — é intencional:
o catálogo é servido pelo servidor, não pelo browser.

Desde a **migration 142**, as 9 tabelas com dono (`user_tag_preferences`, `attribute_bias`,
`user_attribute_assessment`, `ranking_filter_presets`, `prediction_ledger`, `prediction_snapshots`,
`recommendation_runs`, `user_work_state`, `user_settings`) têm políticas: o usuário **autenticado** só
enxerga e só escreve as **próprias linhas** (`user_id = auth.uid()`). O `with check` é o que impede
escrever uma linha com o `user_id` de outra pessoa.

⚠️ **`user_settings.role` mora numa tabela que o próprio usuário pode atualizar** → um trigger
(`guard_role_self_escalation`) impede que ele mude `role`, saldo ou os ids de identidade. Sem esse
trigger, a política de update seria um caminho de **auto-promoção a Curador**. `auth.uid()` é NULL na
service role, que passa direto.

O catálogo **não tem política**: é lido/escrito pela service role, que ignora RLS.

`works.ai_eval_status`: `"pending"` (never evaluated / needs AI run) | `"review_pending"` (AI completed / needs review) | `"done"` (accepted/saved) | `"skipped"`.
`ai_evaluations.status`: `"processing"` | `"completed"` | `"failed"` (separate from the work status).

`category_scores.source`: `"manual"` | `"imported"` | `"ai_accepted"` | `"ai_edited"`.

## A classe de erro que mais custou aqui: DOIS critérios para o MESMO fato

Quase todo bug caro deste projeto tem a mesma forma. Não é lógica errada — é **duas coisas
que deveriam concordar sobre um fato, medindo-o por critérios diferentes**. A mais cega
vence, em silêncio, e o resultado é plausível.

Quatro ocorrências MEDIDAS em 2026-08-13/14, todas com suíte verde:

| onde | um lado media… | o outro media… | o que aconteceu |
|---|---|---|---|
| painel de embeddings | linha ausente em `work_embeddings` | o `input_hash` do texto | contador dizia "0 pendentes · 100%" e **desabilitava** o botão; no mesmo clique, 84 obras foram embedadas |
| `db:health` "obra editada?" | md5 da linha inteira | — (não olhava direção) | 978 obras "divergindo" por `art_signal`, que a NUVEM tem e o local não: o regime normal virando alarme |
| teste de `.backups` | a string literal `".backups"` | o filesystem, no `podar()` | 3 escritores gravando sem família, invisíveis por escreverem `".backups/x"` |
| dono de um id externo | o texto de uma review | o slug da URL da fonte | hid removido da obra ERRADA, e o resolvedor o recriou 2h37 depois |
| `deep-dive.ts` × RPC | um `as SimilarRow[]` em TS | o `RETURNS TABLE` em SQL | a migration 151 tirou `user_score`; "obras similares na biblioteca" saiu VAZIA por um mês |
| banda dos tiers | `DEFAULT_TIER_BAND_WIDTH` = 0,25 (medido) | `formula_config.tier_band_width` = 0,5 | a constante é só FALLBACK e a coluna é NOT NULL ⇒ o valor medido **nunca esteve em vigor**; o /ranking agrupou uma semana na largura que a medição reprovou, e a UI mostrava "0,5 (Padrão)" |
| lista do `/discover` | percentil sobre as **737 candidatas** (a barra `sim`) | percentil sobre o **pool de ~50** (o número que ORDENA) | a combinação exibia **97** onde as duas barras diziam 100, e 92 onde diziam 99 e 97; a ordem da lista saía diferente da do servidor |
| botão de prever Interesse | a obra dizia "Prever de novo" | a fila dizia "Reprever" (e o popup, "Prever") | mesma ação com **três nomes**; e uma instrução na tela (`shadow-compare-panel`) mandava clicar num "Reprever" que já não existiria — ver `lib/ui/interest-predict-label.ts` |
| card da fila de Interesse | chip "Diverge"/"Bate" (`diverges`) | chip `Δ +1`/`Δ 0` (`delta !== 0`) | o **mesmo predicado**, nas mesmas duas cores, desenhado 2× no mesmo card, com uma 3ª cópia da paleta hand-rollada no `Δ`. Medido: o chip aparecia em 45 de 815 obras (5,5%) e nas 45 o `Δ` já dizia o mesmo — e ele PERDIA a precedência pro "Desatualizado" justo nas 676 stale que tinham o que comparar. Ficou o `Δ` |
| explicação do Alinhamento | o **texto** do tooltip e o docstring diziam "40% tag + 30% critério + 30% consistência" | o **código** roda `netNameOverlap` (só tags, sem critério) | a fórmula descrita foi APOSENTADA em 27/06 e virou código morto; as duas superfícies seguiram documentando-a por ~2 meses, e quem lesse o arquivo pra entender o número aprenderia a fórmula errada. Aqui o "outro lado" não era um segundo cálculo — era **prosa**, que não tem como divergir barulhentamente |
| nota calibrada × prosa da avaliação | `category_scores.score`, que a auditoria reescreve | `ai_evaluation_scores.justification`, que ela não toca | **27 das 37** notas calibradas exibiam prosa contradizendo o próprio número (1,79 ponto de distância), sob o selo ✨ de uma avaliação que não as produziu — e `ai_calibrated` não aparecia em UI nenhuma, então nada sinalizava a troca de autor |
| aceitar sugestão de calibração | a guarda olhava o `source` do score | a nota em si tinha mudado | reavaliação reescreve o valor mantendo `ai_accepted` ⇒ **132 das 583 pendentes (23%)** julgavam um número que já não existia, e aceitar sobrescrevia a reavaliação mais nova sem erro |
| régua de coerência faixa × nota | um regex por script, com o 1º par de números | `bandForScore`, que usa bin semiaberto | **483 acusações**, das quais 226 eram meio ponto na borda e 6 de 6 amostradas eram citação composta. O real são 71 — e quem derrubou o número foi a AMOSTRAGEM, que o cabeçalho do próprio script já mandava fazer |

🔴 **A régua: quando duas coisas afirmam o mesmo fato, uma tem que ser DERIVADA da outra.**
É o que já vale para `LOW_BALANCE_USD`, `STRONG_TAG_WEIGHT`, `CRITERIA_SCALE_LEGEND`,
`decision-queues.ts` e `interest-predict-label.ts` — e é a mesma régua, não uma parecida. Ao ver um contador ao lado de uma
ação, a pergunta é: *os dois chamam a mesma função?* Se não, um vai mentir sobre o outro, e o
que mente costuma ser o que decide se o botão fica clicável.

⚠️ **"Chamam a mesma função?" NÃO BASTA — foi o que a lista do `/discover` mostrou (15/08/2026).**
Ali os dois lados chamavam `blendCandidates`, na mesma unidade (percentil 0–100). O que diferia
era o **universo** em que o percentil foi medido: 737 candidatas de um lado, o pool exibível de
~50 do outro, porque a função **repercentila o que recebe** e quem chamava já passava um
percentil pronto. Percentil, z-score, ranking e "top N%" só querem dizer alguma coisa junto do
conjunto em que foram medidos — então a pergunta completa é *a mesma função, sobre o mesmo
CONJUNTO?*

🔴 **E o comentário no código afirmava que sim:** *"reusar o percentil aqui mantém a régua
idêntica à do servidor em vez de recalcular sobre um subconjunto"*. Comentário que descreve a
INTENÇÃO em vez do que o código faz passa a **defender** o defeito na revisão — quem lê confere
a frase e não a chamada. Foi o que manteve este vivo, e o que o denunciou não foi leitura de
código: foi a curadora olhando a tela e reparando que o número não era a média das duas barras
ao lado dele.

⚠️ **Contador barato + ação completa é um par legítimo — o que não pode é o barato TRANCAR a
completa.** `countStaleEmbeddings()` puxaria o catálogo inteiro a cada visita ao `/curation/settings`;
manter o contador barato foi certo. Errado foi `disabled={pendingCount === 0}`, que deu a uma
medida incompleta poder de veto sobre a completa. Hoje o botão só apaga o TOM quando o
contador é zero, e o `title` explica a assimetria.

🔴 **Constante de código que é FALLBACK de um valor no banco não muda nada sozinha — e
mensagem de commit não é prova de escrita.** O commit da banda dos tiers anunciava
*"formula_config.tier_band_width, atualizado junto"*; o `updated_at` da linha era de **duas
semanas antes** dele. A prova barata é ler a linha nos DOIS bancos, com o carimbo. E a correção
é migration, não UPDATE à mão: a **190** mexe nos dois lados (`SET DEFAULT` para banco novo +
`UPDATE … WHERE` para o que já existe), e `tests/unit/ranking/tier-config.test.ts` **deriva** o
default da migration mais recente que define a coluna ([[gotcha-constante-de-fallback-nao-poe-nada-em-vigor]]).

⚠️ **`as X[]` sobre resposta de RPC é a versão SILENCIOSA disto.** O tipo é uma AFIRMAÇÃO
sobre um contrato que mora em SQL, e o compilador não a verifica. Quando a migration 151
tirou `user_score` do `RETURNS TABLE`, o campo passou a chegar `undefined`, `loved`/`avoided`
ficaram sempre vazios e o prompt do Deep Dive imprimia "(nenhuma obra similar…)" enquanto
promete o contrário — por um mês, sem erro nem log. Guardado por
`tests/unit/orchestration/rpc-similares-contrato.test.ts`, que **deriva as colunas do RETURNS
TABLE da migration vigente**: lista fixa envelheceria na próxima migration.

### Teste de arquitetura tem que casar o FATO, não a grafia

🔴 Se dá para satisfazer o teste **mudando como se escreve** algo, sem mudar o comportamento,
ele protege a grafia. `backups-retencao-tem-dono.test.ts` procurava `'".backups"'` — literal
fechado — e por isso três scripts que usavam `".backups/backfill-tags"` nunca entraram na
varredura. Um deles gravava sem dono havia meses. Quem os pegou foi o `podar()` do `db:pull`,
olhando o diretório de verdade.

⚠️ Ao escrever varredura de source, pergunte: *qual é a menor mudança inocente que fura isto?*
Se a resposta for "escrever o mesmo caminho de outro jeito", o padrão está estreito demais.

### Alarme: o limiar sai da DISTRIBUIÇÃO, nunca do olho

🔴 O projeto já repete "alarme que sempre toca não é lido" no `db:health` e no painel
"Estado da obra". O que faltava era o corolário: **medir a distribuição antes de escolher o
corte.** Em `/discover`, "avisar quando houver > 3 pares repetidos" acenderia em **25%** das
listas; a distribuição real pós-diversificação era `[0,1,1,2,2,2,2,3,3,4,4,23]` — mediana 2,
p90 4 —, e só `> 5` isola o caso que informa (1 em 12). O limiar vive em
`NEAR_DUPLICATE_WARN_AT` com a distribuição escrita ao lado.

⚠️ Vale para alarme e para VEREDITO: comparar contra "o dobro do piso" foi o que quase
reprovou o piloto v25 por um `>` estrito. Porcentagem não sabe o tamanho da amostra — 3 de 12
e 60 de 240 são o mesmo múltiplo e evidências opostas (1,3σ × 5,9σ).

### Evidência: o que a coisa É vence o que alguém VIU

🔴 Ao decidir a quem pertence um dado externo, a fonte é o **identificador da própria fonte**
— slug da URL, id canônico —, nunca prosa de terceiro. Medido: uma review dizia *"The correct
title for this manhwa is: Oppa's Friends…"* e eu tirei o hid `rdx28` de *My Brother's Friend*
com base nisso. O slug dizia o contrário
(`comix.to/title/rdx28-my-brothers-friend-cant-be-this-big`): a reclamação era sobre a página
estar com título e capa trocados, num estado que a fonte depois corrigiu. Texto de leitor
descreve o que ele viu naquele dia; o slug descreve o que a página é.

⚠️ **E só remover não fecha caso de vínculo errado** — o resolvedor recria. Ou se dá o id
CERTO, ou se marca a ausência (`markComixAbsent` → `is_rejected=true`, lido por
`ensureComixHid`). Ferramentas: `scripts/diag-external-ids-compartilhados.ts` (vê) e
`fix-external-ids-compartilhados.ts` (corrige), com o `db:health` vigiando como "id repetido".

### O que essas quatro têm em comum, na prática

Antes de confiar num número da tela ou de um script, pergunte **de onde ele vem** e **o que
mais afirma a mesma coisa**. Foi assim que apareceram: o painel contra o botão, o `db:health`
contra a comparação coluna a coluna, o teste contra o `podar()`, a review contra o slug. Duas
fontes discordando não é ruído — é uma delas quebrada, e descobrir qual sai mais barato do
que adotar a conveniente ([[gotcha-doc-afirma-correcao-revertida]]).

## Tests

`npm run test` → **3.148 passando (+24 pulados) em 300 arquivos** (295 passando + 5 pulados);
medido em 2026-08-16 depois do dicionário dos atributos (+23 casos em
`guide/dicionario-de-atributos`), com `find tests -name '*.test.ts*'` = 300 conferido contra
os 300 executados. Antes: **3.125 em 299** (v3 da auditoria).
⚠️ Esta rodada precisou de `--maxWorkers=4`: com o pool default duas rodadas cheias
acusaram **1 falha cada, em arquivos DIFERENTES** (`recalibrar-limpa-recalc-pendente` e
`ranking-status-exclusao`), os dois passando isolados e com a árvore limpa — é a flakiness
de carga descrita abaixo, e o número só fecha depois de reproduzir verde.
Base: **3.088 em 297** (`/my-list`), antes **3.082 em 296** (rotas em inglês), **3.076 em 295**,
**3.053 em 292**, **3.043 em 291** e **3.021 em 290**.

⚠️ **A renomeação tocou ~40 arquivos de teste e não somou nenhum caso** — os testes de
arquitetura DERIVAM o que checam (rotas do filesystem, prefixos do middleware, escritores
do disco), então mover diretório não os quebra. Os dois que reprovaram foram os que casavam
a rota como texto em regex ESCAPADA (`/não a de \/preferencias/`), que é justamente a forma
que um replace de rota não enxerga.

⚠️ **Quatro arquivos foram REESCRITOS junto, não só somados** — `decision.test.ts`,
`decision-breakdown.test.ts`, `prioridade-decomposicao-render.test.tsx` e
`previa-usa-o-mesmo-calculo.test.tsx` fixavam a fórmula antiga do Veredito. O último falhou por
um motivo diferente e instrutivo: ele varre o SOURCE do `MoodPreview` procurando
`computeMoodFit`, e passou a reprovar o **comentário** que explica por que não se pode cortar
antes de ordenar. Hoje ele varre o código sem comentários — a mesma correção que
`abas-da-obra.test.ts` já tinha precisado fazer.

⚠️ **Duas rodadas desta medição acusaram "1 failed" e quatro seguintes passaram limpas**, com
o total idêntico nas seis (2.976 + 1 = 2.977), ou seja **sem truncamento de arquivo**. Não
consegui capturar QUAL teste — as rodadas seguintes passaram antes de eu prender o nome. É
consistente com a flakiness de carga descrita abaixo, mas fica registrado como não
identificado, e não como "era a máquina".

✅ **Este número foi RE-MEDIDO, não incrementado.** A linha anterior avisava que o arquivo
`tests/unit/ui/pendencias-ia-abrem-em-aba-nova.test.tsx` estava fora da conta por não estar
commitado, e mandava re-medir quando o #426 entrasse. Somar "+2 de cabeça" teria acertado o
número por sorte desta vez e é como esta linha envelheceu todas as outras.

⚠️ **Confira o TOTAL EXECUTADO contra o disco, sempre.** Aqui: `find tests -name '*.test.ts*'`
deu **286** e o Vitest executou **286** — é essa igualdade que descarta truncamento silencioso,
não o "0 failed" do rodapé.

🔴 **E confira o DIFF antes de acreditar num verde.** Em 2026-08-15 três edições já aplicadas
e testadas (o `showGroupsSort` do painel, o `defaultSort` da página) **sumiram do disco no meio
da sessão** — causa não identificada, provavelmente buffer velho do editor salvando por cima.
A suíte continuou verde (nenhum teste as cobria) e quem denunciou foi o `tsc`. Antes de dar
por pronto, `git diff` nos arquivos que você tocou; a memória do que foi editado não é prova
de que está no disco.

⚠️ **"Errors 1 error" no rodapé COM tudo passando é a flakiness de carga, não queda de teste** —
apareceu numa rodada (com dev server + Chromium abertos) e não reproduziu em três seguintes, com
contagem idêntica nas quatro. A régua é a de sempre: re-rode limpo antes de concluir qualquer
coisa, nos dois sentidos.

🔴 **Este número tem que ser medido DEPOIS do rebase, não antes — e eu quase publiquei o de
antes.** A branch nasceu de `4af3e64`, e enquanto ela existia entraram na `main` os PRs #403 e
#404, com **6 arquivos de teste**. Medido na base velha dava "2.787 em 263" — verdade sobre uma
árvore que ninguém mais teria. É a mesma família do 🔴 da árvore SUJA: ali o excesso vem do que
não está commitado, aqui a falta vem do que já está na `main`. **Meça no que vai virar o merge.**

⚠️ **Na 1ª medição de 14/08 dois arquivos falharam por `ENOSPC` — disco a 399 MB livres —, não
por teste.** Isolados, os dois passavam. Disco cheio aqui não é hipótese: o `.next` tinha 3,2 GB
(`npm run clean` devolveu 6,4 GB). Falha cujo texto é `no space left on device` não é queda de
teste, mas **também não autoriza chamar de verde sem re-rodar os acusados**.

🔴 **Medir isto numa árvore SUJA conta o que não está no commit — e a correção de 14/08 CAIU NA
MESMA armadilha.** O "2.807 em 266" saiu de 6 arquivos ainda **não commitados** por outra sessão;
o "2.813 em 267" que o substituiu foi medido na mesma árvore e herdou os mesmos 6. Conferido com
`git ls-tree`: `main` tem **260** arquivos de teste e a branch tinha **261** — nunca 267. Não
basta re-rodar: rode `git status` **e** confira o total contra
`find tests -name '*.test.ts*' | wc -l`, que é o número que existe no disco. ⚠️ E confira
também os ARQUIVOS executados: sob carga o Vitest deixa arquivo de fora e ainda diz "0 failed"
(ver o aviso abaixo) — total executado menor que o do `find` é execução incompleta, não queda de
teste. A linha já disse "~1.780 em
~157", "~2.353 em 218", "2.386 em 221", "2.408 em 225", "2.428 em 228", "2.433 em 228",
"2.440 em 229", "2.717 em 255", "2.727 em 255", "2.753 em 258", "2.776 em 261", "2.784 em 263",
"2.788 em 264", "2.807 em 266", "2.813 em 267", "2.828 em 270", "2.833 em 271", "2.872 em 274"
, "2.883 em 274", "2.891 em 275", "2.896 em 276", "2.913 em 277", "2.935 em 280", "2.945 em 281"
, "2.971 em 285", "2.973 em 286" e "2.976 em 286", todas
envelhecendo sem nada acusar — **re-meça antes de editar este número**,
não incremente de cabeça. ⚠️ O "2.717" durou menos de um dia: dois PRs do mesmo dia somaram 10
testes e nenhum dos dois tocou nesta linha. Envelhecer aqui é o normal, não a exceção. Vitest, jsdom, alias `@` → raiz. A
descrição antiga ("só `tests/unit/calculations/`, sem teste de componente") estava desatualizada
havia muito: hoje `calculations` é a 4ª maior pasta, atrás de `synopsis-interest` (36),
`external` (30) e `orchestration` (19), e há `.test.tsx` de componente.

⚠️ **Sob carga, a suíte FALHA sem nenhum teste falhar.** Com dev server + Supabase local +
Chromium abertos, o pool de forks estoura timeout ao subir workers
(`[vitest-pool-runner]: Timeout waiting for worker to respond`) e alguns arquivos simplesmente
não rodam. Medido em 2026-08-09: **9 arquivos numa execução, 7 arquivos DIFERENTES na seguinte**
— o conjunto é aleatório, e o rodapé ainda diz "0 failed". Antes de chamar de verde, re-rode os
acusados isolados (`npx vitest run --maxWorkers=2 <arquivos>`); se passarem, era a máquina.

⚠️ **O Vitest NÃO faz checagem completa de tipos do projeto.** Suíte verde não garante que
compila — quem responde isso é `npm run build`. Rode-o antes de abrir PR que mexa em tipos
compartilhados. (E `next build` disputa o `.next` com o `next dev`: pare o dev antes.)

Vale conhecer `tests/unit/orchestration/`: além de unidade, ele guarda **testes de arquitetura**
que varrem o source e falham quando uma invariante é violada — ex.: só o runner da fila pode
importar `recalculateAll`; os leitores per-usuário não podem usar `getCurrentUserId()`. Servem
pra classe de erro que não quebra build nem runtime, só serve o dado errado.
