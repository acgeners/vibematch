# Integração do Mangago (fonte externa) — Referência

> Documento de referência da adição do **mangago.me** como fonte externa
> (metadados + rating + reviews) no fluxo de criar/atualizar obras.
> Branch `feat/mangago` · PR #61 · implementado 2026-07-05/06.

---

## 1. Contexto e decisão de abordagem

- **mangago.me NÃO tem API JSON** e fica atrás de um **Cloudflare *challenge***
  (headers reais: `cf-mitigated: challenge`, `server: cloudflare`). Fetch direto
  volta **403**.
- Por isso a extração reusa a máquina do **Comix/AnimePlanet**:
  `fetchHtmlWithCfFallback` tenta o fetch direto e, ao detectar o desafio
  (regex `isCloudflareChallenge` já casa `cf-mitigated`), roteia pelo
  **FlareSolverr** (Chrome headless). Usamos uma **sessão nomeada `"mangago"`**
  pra amortizar o solve frio (~11s na 1ª call, <1s nas seguintes) e `abortMs`
  alto (o default de 5s cortaria o solve frio no meio).
- **Escopo:** metadados (título, títulos alt, sinopse, capa, gêneros, status,
  ano) **+ rating + reviews**. mangago é forte em **BL/GL/manhwa de nicho**, onde
  as fontes mainstream (AniList/MU/MAL) costumam ser vazias.

Arquivo principal: [`lib/external/mangago.ts`](../lib/external/mangago.ts)
(modelado em `animeplanet.ts`).

---

## 2. Estrutura de URL (fonte: extensão Tachiyomi/Mihon + inspeção do HTML real)

| O quê | URL |
|---|---|
| Busca | `/r/l_search/?name={query}&page={n}` |
| Detalhe | `/read-manga/{slug}/` |
| Discussão (reviews) | `/home/manga/discussion/{slug}/?page={n}&sort=date` |
| Tópico (corpo da review) | `/home/mangatopic/{id}/` |

---

## 3. Quirks do HTML real (descobertos e corrigidos na validação ao vivo)

> ⚠️ Regex escritos contra o HTML renderizado (via FlareSolverr). O CF bloqueia
> ver sem FlareSolverr no ar. Todos validados ao vivo.

### Busca
- Os links de detalhe são **URLs ABSOLUTAS** (`https://www.mangago.me/read-manga/
  {slug}/`, âncora `class="thm-effect"` com `title=`). Os links **relativos** que
  aparecem são de **capítulo** ("Latest Chapters"). O **slug canônico é o 1º
  segmento** após `/read-manga/`. (O regex inicial exigia relativo → 0 resultados.)

### Detalhe
- **Gêneros reais** ficam **após o rótulo `Genre(s):</label>`** (separados por
  " / "). ⚠️ A página tem uma **navegação global de gêneros** (`class="track"`,
  dropdown "All Genres") que **NÃO é da obra** — extrair todo `/genre/` pega
  Yaoi/Yuri/Shoujo errados. Por isso o `extractGenres` escopa ao trecho do rótulo.
- **Status é um ÍCONE**, não texto: `manga_closed.png` = Completed,
  `manga_active.png`/`manga_open.png` = Ongoing.
- **Sinopse de obra adulta** vem prefixada com o boilerplate *"The following
  content is intended for mature audiences… Discretion is advised."* → removido
  por `stripMatureDisclaimer`.
- **Capas** ficam em `*.mangapicgallery.com`.
- `og:title` costuma ter sufixo SEO (" manga", " - Mangago") → `cleanTitle` tira.

### Rating
- `<span class="rating_num">9.8</span>` (escala **0-10**, já compatível com as
  outras fontes) + link `"#### voted"` (nº de votos). Widget `rel="v:rating"`.

### Reviews (os "topics")
- Os **tópicos de discussão do mangago são posts de OPINIÃO** (mini-reviews:
  *"great beginning, bad ending"*, *"the fight scenes still get me hype"*), a
  maioria com **0 replies** (post avulso).
- A página de discussão só tem **títulos** (11/página). O **texto completo da
  opinião** está no **`<meta name="description">`** da página do tópico (não há
  corpo inline confiável).
- ⚠️ O meta description **escapa aspas** como `\"` e `\&quot;` — o `[^"]*` cortava
  a review na 1ª aspa embutida. `metaContent` virou **escape-tolerant** e
  `decodeAttr` desfaz os backslashes.
- Filtros aplicados: `minLength` (40 no orquestrador), **boilerplate do site** e
  **links soltos** (uma "review" que é só uma URL).

---

## 4. Rating + reviews: como fluem no pipeline

### Rating
`fetchMangagoById` → `mg.rating`/`mg.votes` → push no `hydrateCandidate` como
`score`/`votes` → `mergeData` → `externalPlatformRatings` → pooling Bayesiano da
**Nota.Calc** + sinal de recepção no prompt.

### Reviews (multi-hop)
`fetchMangagoReviews(slug, limit=20)`:
1. Pagina a lista de discussão (`?page=N&sort=date`, `MANGAGO_REVIEW_LIST_PAGES=3`)
   juntando ids de tópico até `limit`.
2. Busca o corpo de cada tópico (`<meta description>`). **1 fetch FlareSolverr por
   review** — parte cara.
Wired em `collectReviewsFromCandidate` (timeout 35s, minLength 40).

### Os 3 consumidores de reviews (caps DIFERENTES — importante)

| Consumidor | Cap | Lê de |
|---|---|---|
| **Digest** (`ensureReviewDigest`→`sampleStratifiedBySource`) | 40 total / **8 por fonte** | pool completo `work_reviews` |
| **Prompt de avaliação** (`selectReviewsForEvaluation`/`AI_EVAL_REVIEW_CAPS`) | 30 / **12 por fonte** | seleção capada |
| **Resumo** (`review_summary`/`consolidateReviewsDetailed`) | **40 total, SEM cap por fonte** (40 mais longas) | pool completo `work_reviews` |

**Cap de fetch do mangago = 40 (o TETO ÚTIL):** o maior consumidor é o **resumo**
(40 total, sem cap/fonte), então 40 satura todos (prompt 12, digest 8, resumo 40)
e deixa os seletores por comprimento escolherem as melhores. Buscar **>40 é
desperdício** (nenhum consumidor usa mais) **e falharia**: cada corpo é 1 fetch
FlareSolverr (~1s), então 100 reviews ≈ ~110 calls ≈ ~110s → estoura o timeout →
0 reviews. 40 ≈ ~44 calls, ~35s quente / ~55s frio (timeout 60s). mangago vira o
gargalo da fase de reviews. Um título popular tem ~100 páginas × 11 = ~1100
tópicos — buscar tudo é inútil.

### Nota por review (sentiment diversity)

O prompt de avaliação diversifica reviews por **nota do usuário** (buckets
alta ≥7 / baixa ≤4 / média / sem-nota). Fontes de plataforma (MU, AniList, MAL,
ComicK, AnimePlanet) trazem essa nota; **o mangago (e outras fontes de fórum) não
têm nota por review**. Pra recuperar isso, `extractInlineRating`
([`lib/external/inline-rating.ts`](../lib/external/inline-rating.ts)) raspa a nota
que o autor escreve no TEXTO ("I'd say 8/10", "80/100", "4/5", "8 out of 10"),
normaliza pra 0-10 e é usada como fallback no `extractUserRating` (só quando não há
o prefixo oficial "Nota do usuário:"). Anti-falso-positivo: rejeita datas
("8/10/2024") e "X/10 chapters". `work_reviews.user_rating` persiste o resultado.
Testes em [`tests/unit/inline-rating.test.ts`](../tests/unit/inline-rating.test.ts).

---

## 5. Correções de confiabilidade (achadas só no E2E concorrente)

> **Gotcha metodológico:** as funções isoladas passavam, mas o fluxo real
> concorrente (`searchAllSources` → `fetchMultiSourceDetails` →
> `fetchExternalEvaluationContextForCandidate`) expôs 3 bugs. Teste de função
> isolada **não pega** problemas de concorrência.

### 5.1 Circuit breaker do FlareSolverr abria por timeout
- **Sintoma:** um solve frio de outra fonte (AnimePlanet, sem sessão, re-consultado
  por N títulos alt no `refineWithAlternativeTitles`) estourava seu `abortMs`
  curto → o circuito **abria 60s** → derrubava rating+reviews do mangago/comix
  **na mesma avaliação**.
- **Fix** ([`lib/external/flaresolverr.ts`](../lib/external/flaresolverr.ts)): o
  circuito só abre em **erro de conexão** (`ECONNREFUSED` = container caído, que é
  imediato). Um **timeout** (container vivo, só solvando) **só falha aquele call**.
  Melhora Comix/AnimePlanet também.
- **Tradeoff:** container "pendurado" (aceita conexão e nunca responde — raro) não
  é mais atalhado; cada call paga o próprio `abortMs` (limitado).
- Detectar timeout: `err.name === "TimeoutError"` (o `DOMException` do
  `AbortSignal.timeout` **é** `instanceof Error` no Node ✓).

### 5.2 Hydrate do mangago com timeout curto
- O hydrate usava o default de **8s**, curto pro scrape de detalhe num solve frio
  (~11s) → perdia rating **+ sinopse + gêneros** (a mesma página traz tudo),
  sobrando só o resultado de busca pobre.
- **Fix:** `TIMEOUT_HYDRATE_MANGAGO_MS = 15000`.

### 5.3 Detalhe barrado por "sinopse divergente"
- O resultado de **busca** do mangago não tem sinopse → passa o filtro com score
  neutro 0.50. O **detalhe** (com sinopse própria) diverge do primário (synScore
  < 0.18, mesmo sendo a MESMA obra — igual ComicK/MangaDex 0.11) e era
  **rejeitado**, sobrando o base sem rating.
- **Fix** (`hydrateAndFilterCandidate`): quando o **título casa quase-exato
  (≥0.9)**, aceita o detalhe do mangago apesar da divergência de sinopse
  (`titleExactScrape`). Restrito pra não afrouxar o filtro geral. As reviews
  (buscadas por slug) confirmam que é a obra certa.

---

## 6. Touchpoints da fiação (mapa de manutenção)

### `lib/external/mangago.ts` (novo)
`searchMangago`, `fetchMangagoById`, `fetchMangagoReviews` + `MangagoDetail`.

### `lib/external/index.ts` (~14 pontos)
`import` · `SEARCH_CONNECTORS` · `SUPPORTED_SOURCES` · builder do candidato em
`mergeSearchResults` (`mangagoSlug`) · `buildCandidateFromExternalIds` ·
`fillCandidateIdFromResult` · `REVIEW_SOURCE_PRIORITY` · `METADATA_SOURCE_PRIORITY`
· `hydrateCandidate` (array `Promise.allSettled` + `HYDRATE_SOURCES` +
destructure + push com `score`/`votes`) · `restrictCandidateToSources` ·
`reviewContextCacheKey` · `candidateIds` em `fetchMultiSourceDetails` ·
`collectReviewsFromCandidate` (fetcher + array de labels do debug + `minLength`) ·
`titleExactScrape` em `hydrateAndFilterCandidate` · timeouts
(`TIMEOUT_HYDRATE_MANGAGO_MS`, `TIMEOUT_REVIEWS_MANGAGO_MS`).

> ⚠️ Os 2 `Record<ExternalSourceId, number>` (REVIEW_/METADATA_SOURCE_PRIORITY)
> são **exaustivos** — o `tsc` quebra até adicionar a chave. Bom forçador.
> ⚠️ No `collectReviewsFromCandidate`, o array de fetchers e o array de labels do
> debug precisam ficar **alinhados por índice** (mangago no fim dos dois).

### `lib/external/types.ts`
`ExternalSourceId` += `"mangago"` (add à mão; o gerador reproduz — ver §7).
`MergedCandidate.mangagoSlug`.

### `components/titles/external-search.tsx`
`case "mangago"` no switch exaustivo `getCandidateExternalId`.

---

## 7. DB + constantes geradas

- **Migration** [`131_add_mangago_source.sql`](../supabase/migrations/131_add_mangago_source.sql):
  insere a linha `source` (slug `mangago`, name `Mangago`, order). Idempotente.
- **`scripts/sync-constants.js`**: `mangago` em `IMPLEMENTED_CONNECTOR_SLUGS` +
  `CODE_ONLY_SOURCES`. Rodar `npm run sync-constants` (precisa
  `SUPABASE_SERVICE_ROLE_KEY`) regenera `ExternalSourceId` (`types.ts`),
  `PLATFORMS` (`types/domain.ts`) e `PLATFORM_LABELS` (`criteria.ts`) do DB.
- **`work_external_ids.source`** só tem CHECK de formato (`^[a-z0-9-]`), **sem FK**
  → persistir `mangago` funciona antes/independente da migration.
- **`platform_ratings.platform`** TEM FK pra `source.slug` — mas o rating do
  mangago flui por `externalPlatformRatings`, não escreve `platform_ratings`
  direto no fluxo de busca.

---

## 8. Como re-validar (ao vivo)

Requer **FlareSolverr no ar** (`FLARESOLVERR_URL`, ex.: `http://localhost:8191/v1`).
Teste vitest temporário com **`// @vitest-environment node`** (o env não carrega
`.env.local` sozinho — passar a var na linha) e **`--disable-console-intercept`**
(senão o vitest engole o `console.log`):

```bash
FLARESOLVERR_URL=http://localhost:8191/v1 \
  npx vitest run tests/tmp-x.test.ts --disable-console-intercept
```

- Fluxo real E2E: `searchAllSources("Solo Leveling")` → achar candidato com
  `sources.includes("mangago")` → `fetchMultiSourceDetails` (rating em
  `externalPlatformRatings`) → `fetchExternalEvaluationContextForCandidate`
  (reviews em `sourcedReviews.filter(r => r.source === "mangago")`).
- **Notas:** a sessão `"mangago"` do FlareSolverr **persiste entre processos** (no
  container). O container pode **crashar/reiniciar sob hammering pesado** (sessions
  viram `[]`). Canários usados: `solo_leveling`, `yahwacheop` (Painter of the
  Night, R18), `jinx`, `jujutsu_kaisen_modulo`.

---

## 9. Resultados validados

| Obra | Rating | Reviews (fetch) |
|---|---|---|
| Solo Leveling (`solo_leveling`) | 9.8 / 1047 votos | 20 (~18.5s quente) |
| Painter of the Night (`yahwacheop`, R18) | 9.5 / 1642 | 19 (~16.7s) |
| Jinx | 8.6 / 1326 | ~8+ |

**Custo/perf:** o mangago é a fonte **mais pesada de FlareSolverr por avaliação**
(~22 calls, ~18s quente / ~30s frio). Roda em paralelo com as outras fontes, mas é
o gargalo da fase de reviews. Se incomodar, baixar o `limit` de `fetchMangagoReviews`.

---

## 10. Faxina relacionada (Supabase Ohio → São Paulo)

Durante uma verificação de "qual projeto Supabase o código usa", achamos refs ao
projeto **antigo (Ohio, morto)** `djbreiyzwoevbmoscqiq` — o certo é
`obwlwukwovetgjqdpizd` (São Paulo). Corrigido no mesmo PR:

- **`fly.toml`**: `NEXT_PUBLIC_SUPABASE_URL` + anon key → projeto novo;
  `primary_region` `iad` → **`gru`** (co-localizar com o DB em SP). ⚠️ Era o caso
  sério: `NEXT_PUBLIC_*` em `build.args` fica **assado no bundle** → qualquer
  deploy mandaria o prod pro DB morto.
- 6 scripts de manutenção: fallback `|| "<ohio>"` → projeto novo.
- `DEPLOY-FLY.md`: exemplo do runbook → projeto novo.
- Removido `scripts/sync-constants 4.js` (cópia stray).

---

## 11. Commits (PR #61 → main)

| Commit | |
|---|---|
| `e20d69b` | feat: Mangago como fonte de metadados |
| `56cc9b7` | fix: scrub refs Supabase Ohio → SP |
| `788058f` | fix: region iad → gru |
| `4b96181` | chore: regenera constantes com Mangago |
| `1dc97f2` | feat: rating + reviews (Fase 2) |
| `32e5712` | fix: confiabilidade rating/reviews no fluxo real (circuito/hydrate/aceitação) |
| `b02ec11` | feat: pagina reviews (8→12) |
| `a1e7eb0` | feat: cap de reviews 12→20 (alimenta o resumo) |
