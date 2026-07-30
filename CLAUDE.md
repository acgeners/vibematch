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
Refazer depois de cada `db:pull`.

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
`/login`, `/signup` e **logout no menu do chip da sidebar** (`components/layout/account-chip.tsx` →
`signOutAction`). O `middleware.ts` só **refresca a sessão**; ele **não protege rota** — visitante
anônimo carrega qualquer página e vê o catálogo (que é compartilhado por design). Quem autoriza é o
**papel** (`user_settings.role` → `lib/plans/roles.ts`, `ensureAdmin`/`roleAllows`), verificado
dentro das actions, não na borda.

**Toda rota é dinâmica (`ƒ`).** `app/layout.tsx` lê `cookies()` pra saber se a sidebar está
recolhida, e isso desliga o prerender do app inteiro. Foi uma troca consciente (ver a armadilha de
hidratação abaixo): nenhuma das 7 rotas que ainda prerenderizavam fazia trabalho de banco. Se um dia
uma página pública precisar de prerender, é este `cookies()` que estará no caminho.

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

**Path A — "✨ Avaliar" page (`/ai-evaluation`)**
`triggerAiEvaluation(workId)` → `fetchExternalEvaluationContextForWork()` → `requestAiEvaluation()`
- Uses saved work data (primary synopsis, genres, grouped tags, cover). If the work has accepted `work_external_ids`, reviews/context are fetched from those confirmed source IDs; otherwise it falls back to title search.
- Review sources (each only when the candidate has that source's ID): MangaUpdates + AniList + MyAnimeList + Kitsu (reactions) + AnimePlanet + MangaDex (forum comments) + ComicK (curated reviews + comments) + Comix (per-work comment thread, mini-reviews). Comix has no formal reviews API; `fetchComixReviews(hid)` walks detail `id` → `threads/lookup?page_identifier=manga{id}&page_url=/title/{hid}` → `threads/{threadId}/comments` (cursor-paginated, via `fetchComixJson`/FlareSolverr).
- Reviews go through `selectReviewsForEvaluation()` before the prompt — stratified per-source sampling with an **adaptive** quota: `perSource = min(maxPerSource, ceil(total / sourcesWithReviews))`, capped by `AI_EVAL_REVIEW_CAPS = { total: 30, maxPerSource: 12 }` (service.ts), then global round-robin in `REVIEW_SOURCE_PRIORITY` order (MangaUpdates first). So few-source works fill the budget (2 sources → up to 24, not 16) instead of being stuck at a fixed 8/source. All sources are always fetched in parallel; the cap is applied at selection time only (no fetch short-circuit). The full pool persists to `work_reviews`.
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

### ⚠️ Postergado — depende do import multi-user (hoje é `ensureAdmin`-only, curador único)

Enquanto o import for admin-only, estes **não têm efeito prático** e foram deixados de fora **de
propósito** (não é bug, é escopo):

- **Per-user** ("só as obras que ESTE usuário importou"): a tabela `imports` **NÃO tem `user_id`** →
  precisa migration + setar no create + escopar `imports → import_rows → work_id` em
  `getPendingReviewWorks`. Hoje, curador único, todo import é do dono.
- **Gate por plano**: esconder a aba "Revisar pendentes" para `leitor` (free, sem autonomia de IA);
  o plano vem de `getCurrentUserProfile().plan` (`leitor→free`, resto `→paid`).
- **Fluxo do usuário free**: abrir o import para não-admin + aviso "obra criada, não enriquecida" (as
  etapas que chamam IA ficam pendentes; a aba de pendências nem aparece para quem não pode gerar nada).

Só reabrir estes quando/se o import deixar de ser `ensureAdmin`-only.

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
> 2. **FlareSolverr** (Docker `:8191`) — rede de segurança. Sem o sidecar, a busca perde ComicK,
>    AnimePlanet e Mangago quando o container pisca (medido: 5/9 fontes vs 8/9).
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
- `searchAllSources(query)` — parallel search across AniList, MangaUpdates, ComicK, Kitsu, MyAnimeList, MangaDex, AnimePlanet, Mangago (a Comix **não** entra: a busca dela é gateada por token → resolvida por cross-ID via sidecar); merges by title similarity (threshold 0.65 for grouping, 0.72 for accepted)
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

Tests live in `tests/unit/calculations/` and cover the deterministic scoring functions only. No integration or component tests. Vitest with jsdom environment; path alias `@` → project root.
