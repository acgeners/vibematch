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
```

`sync-constants` needs `SUPABASE_SERVICE_ROLE_KEY` in env. It overwrites the files listed in the **Constants generated from DB** section below — never hand-edit them.

## ⚠️ O banco NÃO tem backup — faça um antes de mudança grande

Conferido na Management API (2026-07-13): **`pitr_enabled: false` e ZERO backups disponíveis**. Não
existe de onde restaurar. E parte do dado é cara de refazer: ~2.100 avaliações de IA (**≈US$60 em
tokens**) e ~14 mil reviews raspadas de 8 fontes.

```bash
node scripts/backup-db.mjs        # → .backups/<timestamp>/ (gitignored)
```

Dump lógico de todas as tabelas em NDJSON gzipado (24 MB / ~120k linhas hoje). **Pagina e confere
contra `count: "exact"`**: se faltar uma linha, ele FALHA em vez de gravar um backup truncado — que é
a pior forma possível do bug das 1000 linhas, porque você só descobre quando precisa restaurar.

**Retenção:** depois de um backup bem-sucedido o script mantém os **5 mais recentes** e apaga os
antigos (só dirs com nome de stamp ISO) — sem isto o `.backups` cresce sem limite (~30M/execução).
Ajuste com `BACKUP_KEEP=<n>`.

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

**Custo por operação, medido no PostgREST (sem compressão):**

| Operação | Payload |
|---|---|
| 1 página de `/titles` (24 obras, `WORK_LIST_SELECT`) | **569 KB** |
| idem, trocando `work_tags(tag_id, tags(*))` por 4 colunas | 330 KB (**−42%**) |
| catálogo inteiro com o mesmo select (966) | **20,1 MB** |
| um `recalculateAll` (só a leitura de `works`) | **5,3 MB** |

Auth é 0–3% do egress; **PostgREST é 97–100%**. Há três consumidores: curadoria, navegação/dev e
**scripts de análise** — este último é o mais fácil de esquecer e explica o pico do mês (1,47 GB num dia
com zero escrita de curadoria). **Quebrar a tabela `works` não ajuda**: `review_digest` +
`review_summary` + `canonical_synopsis` são 78% dela e o `WORK_LIST_SELECT` não pede nenhuma. O peso
está nos joins embutidos.

## Desenvolver contra o Supabase LOCAL

```bash
supabase start                 # stack local: API 54321, Postgres 54322, Studio 54323
npm run db:pull                # pg_dump da nuvem → local (DESTRÓI public/bkp do local)
npm run db:local               # aponta o .env.local pro stack local
npm run db:cloud               # volta pra nuvem
npm run db:push-evals -- --yes # leva avaliações de IA feitas no local pra nuvem
```

`db:local` também redireciona **os 23 de 44 scripts do `package.json` que rodam com
`--env-file=.env.local`** (`pilot2:*`, `baselines:ranking`, `e1:*`) — eles leem o catálogo várias vezes
por execução, então rodá-los no local é o maior corte de egress disponível, de graça.

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

🔴 **Login no local não funciona de cara:** os usuários são Google-only (`encrypted_password`
NULL) e o `config.toml` vem com todo provider externo `enabled = false` — dá
`Unsupported provider`. O `/login` tem formulário de e-mail+senha, então crie uma senha só no
local (`update auth.users set encrypted_password = extensions.crypt('…', extensions.gen_salt('bf'))`).
Refazer depois de cada `db:pull`. Desde 2026-08-06 há também **"Esqueci minha senha"**
(`/recuperar-senha` → e-mail → `/nova-senha`), e no local o e-mail cai no **Mailpit** (`:54324`).

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

**O `middleware.ts` protege UMA coisa: a console de curadoria** (desde 2026-08-03). Ele refresca a
sessão em toda rota e, só nos prefixos `/curadoria`, `/ai-evaluation`, `/settings`, `/ai-usage` e
`/admin`, decide: sem sessão → `/login`; logado não-curador → `/`. **Todo o resto do app segue sem
gate de rota** — visitante anônimo carrega `/titles`, `/painel`, `/leitura` e vê o catálogo (que é
compartilhado por design).

🔴 **Gate de rota NÃO funciona só no layout.** A 1ª versão fazia `notFound()` no layout da console e
o Next devolvia **200 com o HTML da página protegida no corpo**, seguido do 404: layout e página
renderizam em PARALELO, então o `notFound()` chega depois de o stream ter começado. O proxy roda
antes de qualquer renderização — é o único ponto onde a decisão cabe. O `notFound()` do layout ficou
como 2ª linha (matcher pode mudar; e o proxy é fail-OPEN quando o usuário está logado mas não tem
linha em `user_settings`, caso que só `isCurrentUserAdmin()` resolve, pois precisa da service role).

**A home (`/`) é uma VITRINE, e bifurca por sessão.** Não é mais o painel de KPIs — esse virou
`/painel` ([[project-painel-provisorio]], provisório de propósito).

- **Com sessão:** destaque "Continue lendo" escolhido pela banda **Acompanhando** da `/leitura`
  (`lib/reading/pace-bands.ts`, ≥85% lido + leitura recente, desempate por capítulo mais novo),
  faixa de atividade e prateleira "Pra você hoje". ⚠️ `getContinueReading` ordena por última
  LEITURA e corta no limite **antes** de qualquer seleção — pedir poucos itens esconde do
  destaque a obra que acabou de receber capítulo (foi bug real).
- **Sem sessão:** `components/home/public-home.tsx` — raio-X dos 9 critérios de uma obra,
  prateleira por `platform_avg` (com piso de votos), rodapé pra `/sobre` e `/guia`. Nada
  pessoal: sem sessão os leitores per-usuário devolvem vazio, e o que existia ali antes eram os
  dados do dono.

⚠️ **Rótulo depende da publicação:** "quase no fim" só vale pra obra concluída; em `Ongoing` a
mesma banda quer dizer "quase em dia" (você está alcançando os lançamentos, não terminando).

**A navegação é uma BARRA SUPERIOR** (`components/layout/top-nav.tsx`), desde 2026-08-02 — a
sidebar de 13 itens foi removida. A régua: **o topo é sobre obras, o avatar é sobre você, a console
é sobre o catálogo dos outros.** Cinco entradas no topo (Início · Minha lista ▾ · Explorar ▾ ·
Ranking · Recomendações); Preferências/Importar/Painel no menu do avatar; fila e curadoria como
ÍCONE com contador (dentro de dropdown o número não é visto).

⚠️ **Ação lenta na barra tem dono:** o chip e a faixa de tarefas em segundo plano vivem no
`top-nav.tsx` e são desenhados por `components/tasks/top-nav-tasks.tsx`. Ver a seção
**"Ação lenta tem DUAS cores"** — inclusive por que `components/tasks/sidebar-tasks.tsx` foi
apagado (ficou órfão quando a sidebar saiu, e o feedback sumiu sem nada acusar).

**A console `/curadoria`** (`components/curadoria/console-shell.tsx`) é o terceiro braço dessa régua,
desde 2026-08-03 — o 🛠 da barra aponta pra ela. Sidebar PRÓPRIA de dois níveis com Visão geral ·
Curadoria da Obra · Configurações (+ os 4 tópicos) · Uso da API IA · Métricas do modelo. Cada rota
membro entra por um `layout.tsx` de 3 linhas que renderiza a shell — o gate e a sidebar vêm dela.

- ⚠️ **`/settings` PERDEU a `SettingsSubnav`**: os 4 tópicos viraram o ramo "Configurações" da
  sidebar da console. Continuam sendo `?g=` na mesma rota (nenhum deep-link quebrou, inclusive o
  `/settings?g=fontes` do alerta do Comix). `SettingsSubnav` segue viva, para `/preferencias`.
- ⚠️ **"Desatualizados" ficou de FORA**, apesar de constar no plano: virou aba de
  `/fila-recomendacao` e é de qualquer logado. Item de console que joga o usuário pra fora da
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

O preço: as institucionais (`/sobre`, `/guia`, `/login`, `/signup`) perdem prerender. Pra liberar
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
2. **Previsão de Interesse POR OBRA continua sem indicador.** `predictInterestWithToast` tem
   confirmação de custo **recursiva** (a 1ª chamada volta `blocked_cost_confirmation`, abre
   modal e re-chama a si mesma); uma tarefa em volta disso diria "rodando" enquanto um modal
   espera clique. Precisa do helper refatorado antes. O LOTE já está ligado.
3. **Latências medidas** (`ai_api_calls.latency_ms`, p50): perfil de gosto **33,4s** ·
   ranking **14,0s** (p90 47,9s) · digest 13,4s · avaliação IA 17,5s · tags 7,6s · Interesse
   4,9s. Deep dive **sem medição** (zero linhas locais).

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

Guardadas por `tests/unit/ranking/score-rounding.test.ts` e `build-tiers.test.ts`.

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

## AI evaluation flow

Two distinct paths both ultimately call `requestAiEvaluation()` in `lib/ai-evaluation/service.ts`:

**Path A — "✨ Avaliar" (`/ai-evaluation`, "Curadoria da Obra")**

⚠️ A página virou **duas** em 2026-08-02: `/ai-evaluation` ficou só com a fila de **atributos**
(curadoria do catálogo — do dono), e as filas de **Veredito IA / IA-Rk / Interesse / Sinopse**
foram pra **`/fila-recomendacao`** (qualquer logado). O badge da barra também se dividiu:
`curadoria` e `rec-queue`. `/ranking/desatualizados` segue como redirect pra aba nova.
`triggerAiEvaluation(workId)` → `fetchExternalEvaluationContextForWork()` → `requestAiEvaluation()`
- Uses saved work data (**ALL persisted synopses**, genres, grouped tags, cover). The primary synopsis is the prompt's main reference; every other persisted synopsis enters as `[S1]…[Sn]` blocks (`splitSynopsesForEvaluation` in `lib/work-derived.ts`), with `source = "manual"` ones labeled as user-written/high-authority. Fresh external `[C]` blocks that duplicate a persisted synopsis are filtered out (`isSameSynopsis`) — but only when additional synopses exist, so single-synopsis works keep a byte-identical input and preserve the eval cache `input_hash` (the `additionalSynopses` field is omitted from both hash versions when empty). If the work has accepted `work_external_ids`, reviews/context are fetched from those confirmed source IDs; otherwise it falls back to title search.
- Review sources (each only when the candidate has that source's ID): MangaUpdates + AniList + MyAnimeList + Kitsu (reactions) + AnimePlanet + MangaDex (forum comments) + ComicK (curated reviews + comments) + Comix (per-work comment thread, mini-reviews). Comix has no formal reviews API; `fetchComixReviews(hid)` walks detail `id` → `threads/lookup?page_identifier=manga{id}&page_url=/title/{hid}` → `threads/{threadId}/comments` (cursor-paginated). ⚠️ Este caminho é **TOKEN-FREE**: usa `fetchComixDetailRaw`/`fetchComixThreadJson`, **não** o `fetchComixJson` — então o circuito de auth aberto pela busca gateada **não** o bloqueia (medido 2026-08-04: circuito aberto e, na sequência, 52 e 57 reviews normais em ~1,3s). Hoje ele resolve por **plain fetch**, com resultado IDÊNTICO sem bypass, só com sidecar e com sidecar+FlareSolverr. 🔴 Isso é estado ATUAL, não garantia: os dois passos têm fallback de CF (`fetchComixHtml` → `isCfBypassUnavailable()` → `fetchHtmlWithCfFallback`), então se a Comix voltar a desafiar, ~30% do acervo de reviews passa a depender do bypass da noite pro dia.
- Reviews go through `selectReviewsForEvaluation()` before the prompt — stratified per-source sampling with an **adaptive** quota: `perSource = min(maxPerSource, ceil(total / sourcesWithReviews))`, capped by `AI_EVAL_REVIEW_CAPS = { total: 30, maxPerSource: 12 }` (service.ts), then global round-robin in `REVIEW_SOURCE_PRIORITY` order (MangaUpdates first). So few-source works fill the budget (2 sources → up to 24, not 16) instead of being stuck at a fixed 8/source. All sources are always fetched in parallel; the cap is applied at selection time only (no fetch short-circuit). The full pool persists to `work_reviews`. **The prompt selects from the UNION of fresh fetch + persisted `work_reviews` pool** (`mergeFreshWithPersistedReviews`, dedup by source+text, rejected sources filtered): CF-gated sources dropping out (sidecar 503 busy / Cloudflare block) can no longer shrink the evidence to 1–2 reviews when dozens are already persisted. Only the fresh pool is re-persisted (persistence semantics unchanged); when nothing is recovered the input is byte-identical to fresh-only, preserving the eval cache `input_hash`.
- Passes `sourcedReviews: SourcedReview[]` (rich format with source, matchScore, sourceTitle)
- Also passes `externalContext` (synopsis strings from external sources)
- Saves results to `ai_evaluations` + `ai_evaluation_scores` tables
- User reviews and optionally edits scores before they're committed to `category_scores`

**Path B — "✨ Buscar dados" form (`/titles/new`)**
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
  🔴 **A 174 ainda NÃO está aplicada na nuvem** (conferido 08-02); é aditiva, então aplicar ANTES
  do deploy do código. Ver [[project-conferir-migration-na-nuvem]].

🔴 **As migrations 175 e 176 também estão pendentes na nuvem** (03-08), aplicadas e conferidas SÓ
no local. Ambas dão dono a dado pessoal, e **o código depende das duas**:

| # | Tabela | Sem ela | Ordem |
|---|---|---|---|
| 174 | `tags.adult_score_tier` | aditiva, código tolera | qualquer |
| 175 | `recommendation_chats.user_id` | insert do chat FALHA, listagem quebra | antes do deploy |
| 176 | `ai_eval_read_acks.user_id` | "marcar como lido" FALHA (`user_id` NOT NULL) | antes do deploy |

⚠️ A 176 **troca a PRIMARY KEY** de `(work_id, queue)` para `(user_id, work_id, queue)`, e o
`onConflict` do upsert em `server/actions/ai-eval-read.ts` acompanha. Aplicar o código sem a
migration (ou vice-versa) troca "ack de cada um" por "último que clicou vence", em silêncio.
- `enforceR19AdultContentRule`: raises `adult_content` to ≥ 7.0 if R19 marker detected anywhere in input
- `enforceExternalContentRatingRule`: raises `adult_content` to a floor from the accepted external sources' content rating (MangaDex `contentRating` / ComicK `content_rating`) — `suggestive`→5, `erotica`→7, `pornographic`→8. Chained with the R19 rule; both are monotonic so the effective floor is the max of whichever triggered.
- `enforceNeutralCoupleDynamicsWhenNoRomance`: raises `couple_dynamics` to 5.0 when romance ≤ 3 and couple_dynamics < 5
- `enforceAuditableReviewUsage`: **non-fatal since v20 (2026-06-27)** — generic review citation is accepted ("algumas reviews apontam…"), so it no longer requires/validates specific review IDs (`R1`, `R2`…) nor throws. It only records an informational `reviewAudit` (`required` = "havia reviews no prompt"; `usedReviewIds` = whatever IDs the model happened to cite, often empty with generic citation). `review_usage` is now an OPTIONAL tool/schema field. (Earlier behavior: threw + retried when IDs weren't cited — removed because a citation slip discarded otherwise-valid evals.)

The model is `claude-sonnet-4-6`, prompt version `v21` (toggled by `CONCISE_OUTPUT` in `service.ts`: `v21` concise output / `v18` verbose — flipping it falls back to the old caches; `v21` = concise + **consensus** review citation (generic, never a single review/ID), succeeded `v20`), up to 2 attempts (4500 max tokens on **both** attempts; temperature 0.2 then 0). Opus 4.7 and Haiku 4.5 are supported as per-evaluation overrides (the A/B "Reavaliar com…" buttons); Opus 4.7 doesn't accept the `temperature` param. MAE values stored in `formula_config` reflect calibration runs against the current model+prompt; the hardcoded fallbacks in `calibration.ts` (1.27/0.92) are historical defaults from the original spreadsheet — not authoritative.

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
em `/titles/new` **NÃO entra** aqui, mesmo sem avaliação IA — antes entrava e poluía a lista.

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

## Tests

`npm run test` → **~1.780 testes em ~157 arquivos** (Vitest, jsdom, alias `@` → raiz). A
descrição antiga ("só `tests/unit/calculations/`, sem teste de componente") estava desatualizada
havia muito: hoje `calculations` é a 4ª maior pasta, atrás de `synopsis-interest` (36),
`external` (30) e `orchestration` (19), e há `.test.tsx` de componente.

⚠️ **O Vitest NÃO faz checagem completa de tipos do projeto.** Suíte verde não garante que
compila — quem responde isso é `npm run build`. Rode-o antes de abrir PR que mexa em tipos
compartilhados. (E `next build` disputa o `.next` com o `next dev`: pare o dev antes.)

Vale conhecer `tests/unit/orchestration/`: além de unidade, ele guarda **testes de arquitetura**
que varrem o source e falham quando uma invariante é violada — ex.: só o runner da fila pode
importar `recalculateAll`; os leitores per-usuário não podem usar `getCurrentUserId()`. Servem
pra classe de erro que não quebra build nem runtime, só serve o dado errado.
