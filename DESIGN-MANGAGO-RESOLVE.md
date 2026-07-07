# DESIGN — Resolvedor de URL do Mangago (edge cases + qualidade de matching)

> 2ª rodada de investigação (2026-07-06). Foco: edge cases da busca, qualidade do
> `bestTitleMatch`, threshold, cache, observabilidade e plano de implementação.
> Toda evidência é **ao vivo** (via FlareSolverr local contra `www.mangago.me`).
> Contexto da 1ª rodada (proteção CF, SSR, ausência de cross-IDs, "sem sidecar"):
> ver seções abaixo + `COMIX-ARCHITECTURE.md` / `DESIGN-COMIX-RENDER-SIDECAR.md`.

---

## Resumo (leia primeiro)

O `normalizeText` do `bestTitleMatch` **já lida bem** com o maior quirk do Mangago (ele exibe títulos com espaços ao redor da pontuação: "Kaguya - sama", "Re : Zero" — o normalizador colapsa tudo). Mas **`bestTitleMatch` NÃO é suficiente como está**: encontrei **4 falhas reais e reproduzíveis**. E a descoberta mais importante: **o ranking do backend do Mangago é lixo** — a obra canônica quase nunca vem em 1º. Isso muda o desenho.

| # | Falha (com evidência) | Consequência |
|---|---|---|
| G1 | Backend rankeia spinoff/doujinshi/colorida acima da obra (`"Solo Leveling"`→canônica em **rank 4**; `"Jujutsu Kaisen"`→`jujutsu_kaisen_modulo` em 1º) | Pegar resultado #1 **erra** → obrigatório argmax client-side |
| G2 | Reverse-substring dá 0.9 a título curto genérico (`"Dr. Stone"` casa a obra `stone` com **0.900**) | Falso positivo se a obra exata não estiver na página |
| G3 | Filtro `w.length>2` **zera CJK** (`"나 혼자만 레벨업"` e `"呪術廻戦"` → score **0.000** em todos, mesmo o backend achando) | Matching por título nativo quebrado |
| G4 | Apelido curto não casa título longo do Mangago (`"Kaguya-sama"`→obra real **0.25**; romaji completo `"Kaguya-sama wa Kokurasetai"`→obra real **rank 1**) | Precisa consultar com romaji/native completos, não o apelido |
| G5 | Empate exato em alt-title (`"One Piece"` casa `one_piece` **1.0** E `one_piece_colored` **1.0**) | Ambiguidade não resolvível só por título |

---

## 1. Cobertura do mecanismo de busca (o que o backend normaliza)

Endpoint: `GET /r/l_search/?name={q}&page={n}` (SSR HTML). Testado ao vivo:

| Variação | Query testada | Backend | Veredito |
|---|---|---|---|
| Maiúsc/minúsc | `Solo Leveling` / `solo leveling` / `SOLO LEVELING` | resultados **idênticos** (10/10/10, mesma ordem) | **Normaliza case** |
| Parcial | `solo lev` | n=10, família SL (ordem muda) | **Prefixo/substring** funciona |
| Dois-pontos | `Solo Leveling: Ragnarok` vs `Solo Leveling Ragnarok` | **mesmo slug** `solo_leveling_ragnarok` | **Colapsa `:`** |
| Hífen | `Kaguya-sama` vs `Kaguya sama` | resultados idênticos | **Colapsa `-`** |
| Barra/ponto | `Fate/stay night`, `Dr. Stone` | casam (títulos exibidos vêm "Fate / stay", "Dr . STONE") | **Colapsa `/` `.`** |
| Brackets | `Oshi no Ko` (n=10) vs `【Oshi no Ko】` (n=7) | conjuntos **diferentes**; nenhum traz a obra principal bem | **`【】` atrapalha** (evitar mandar brackets) |
| Acento | (normalizeText faz NFKD + strip) | — | tratado no cliente |
| Native (origem KO) | `나 혼자만 레벨업` → **rank 1 = `solo_leveling`** ✓ | recall ótimo | native da **língua de origem** casa |
| Native (origem JP) | `呪術廻戦`→rank1 `jujutsu_kaisen` ✓ ; `進撃の巨人`→spinoff 1º | recall bom, ranking ruim | idem |
| Native cruzado | `俺だけレベルアップな件` (JP) p/ obra **coreana** | **n=0** | native só casa a língua de origem |

**Regra prática:** mande a query **sem brackets/pontuação decorativa**; case/`:`/`-`/`/`/`.` o backend já cuida. Native ajuda **recall** mas só na língua de origem.

## 2. Casos ambíguos — o que existe para desempatar

Cada resultado da busca traz: **título**, **Other Title** (alt-titles, inclui native), **Author**, **Genres**, **Summary**, capa. **NÃO traz:** ano, contagem de capítulos, nem cross-ID (só na página de detalhe há ano). Exemplos reais de ambiguidade coletados:

- **One Piece**: `one_piece` (Oda) em rank 2; competem `one_piece_strong_world` (filme), `one_piece_colored` (colorida, alt="One Piece"), doujinshis, `one_piece_academy`. Author "ODA Eiichiro" **não** separa original de colorida/filme.
- **Solo Leveling**: original vs `_hunter_origin` (spinoff), `_ragnarok` (sequência), `_arise`, `_brainrot_leveling` (paródia).
- **Kingdom / Monster**: a obra famosa **não aparece na página 1** (soterrada por "Kingdom Hearts", "Monster Musume").

| Sinal | Serve para desempate? |
|---|---|
| **Título exato (normalizado)** | ✅ o mais forte — puxa a canônica pra 1.0 (vs sequência 0.78) |
| **matchedKind** (title vs alt) | ✅ desempata One Piece × Colored (title>alt) |
| **Other Title / native** | ✅ recall + alvo extra de match (mas quebra scoring CJK — ver G3) |
| **Author** | ⚠️ soft — transliteração inconsistente; não separa obras do mesmo autor |
| **Genres** | ⚠️ soft — filtra "novel"/"doujinshi"/"colored" por gênero |
| **Ano (só no detalhe)** | ✅ forte, mas custa 1 fetch extra → usar só na faixa "duvidosa" |

## 3. Qualidade do matching — onde acerta e onde falha (scores reais do `bestTitleMatch` do repo)

```
QUERY "Solo Leveling":   solo_leveling 1.000(exact) | _hunter_origin/_ragnarok/_arise 0.780 | _brainrot 0.667
QUERY "One Piece":       one_piece 1.000(title) | one_piece_colored 1.000(ALT) | _academy 0.780
QUERY "Dr. Stone":       dr_stone 1.000 | stone 0.900(reverse_substring!) | _reboot_byakuya 0.500
QUERY "Kaguya-sama":     obra_real 0.250 | (nenhum ≥0.72) ← apelido curto falha
QUERY "나 혼자만 레벨업":     solo_leveling 0.000 | todos 0.000 ← CJK zerado
QUERY "Kingdom"/"Monster": melhor 0.500 ← obra famosa nem na página (rejeita corretamente)
```

**Acerta** quando: (a) consultamos com o título **completo** que o Mangago indexa, e (b) fazemos **argmax sobre TODOS os resultados** (exato=1.0 vence sequência 0.78). **Falha** nos 4 casos G2–G5 acima.

**Estratégia de ranking recomendada** (substitui "primeiro acima do threshold"):
1. **Argmax global** por `max` de score sobre `{variantes da query} × {título + alt-titles do candidato}`.
2. **Regra de margem:** aceitar auto só se `top − 2º ≥ 0.08` (separa canônica 1.0 de sequência 0.78).
3. **Tie-break:** `matchedKind=title` > `alt`; depois **ano** (se disponível).
4. **Guarda anti-G2:** se o `reason` do top for `reverse_substring_*`, **não** auto-aceitar sem corroboração (ano/autor).
5. **Fix CJK (G3):** pré-normalizar colapsando espaços entre chars CJK (Mangago exibe "呪 術 廻 戦") e comparar string cheia — assim native-AniList casa native-Mangago em 1.0.

## 4. Aproveitamento do AniList (a maior alavanca de precisão)

Hoje recebemos `title.romaji`, `title.english`, `title.native`, `synonyms`, `startYear`. Uso proposto:

| Campo | Papel | Falha se usado sozinho |
|---|---|---|
| `title.english` | query + alvo de score (melhor ponte cross-script) | pode ser apelido curto (Kaguya) |
| `title.romaji` **completo** | **query + alvo principal** — casa o título longo do Mangago | inútil p/ obra coreana (romaji é japonês) |
| `title.native` | **query de recall** (língua de origem) | scoring CJK quebra sem o fix G3 |
| `synonyms[]` | queries + alvos extras (pega variações) | ruído se muito genérico |
| `startYear` | **corroboração/desempate** (vs ano do detalhe) | ausente em algumas obras |

**Score composto:** `score(candidato) = max sobre (variante ∈ {romaji, english, native, ...synonyms}) de bestTitleMatch(variante, {título, alt-titles})`. Consulta o Mangago com **2–3 variantes** (english + romaji + native), **dedupe por slug**, une os result sets, e pontua cada slug contra **todas** as variantes. Isso resolve G1 (recall) e G4 (título completo) de uma vez. `startYear` entra como gate na faixa duvidosa.

## 5. Threshold — por que NÃO herdar 0.72

O 0.72 do Comix é seguro porque lá o **cross-ID confirma** a identidade; o título ≥0.72 é só fallback (e está *desligado*). No Mangago **não há cross-ID nenhum** — é matching por título puro, fuzzy. E o dado mostra que **sequências legítimas pontuam 0.78** (`Solo Leveling: Ragnarok`) e um genérico pontua 0.90 (`stone`). Um auto-accept em 0.72 aceitaria a sequência errada. Faixas propostas:

| Faixa | Score + condições | Ação |
|---|---|---|
| **AUTO** | `≥ 0.90` **E** margem `≥ 0.08` **E** reason ≠ reverse-substring **E** (ano bate, se disponível) | resolve e persiste |
| **DUVIDOSO** | `0.72–0.90`, ou `≥0.90` sem margem/corroboração | confirma: 1 fetch de detalhe (ano/autor) ou fila de revisão do usuário |
| **REJEIÇÃO** | `< 0.72` | retorna "não encontrado" (melhor que errar) |

Justificativa: sem cross-ID, o auto-accept precisa da âncora **exato/quase-exato + margem**, não de um limiar fuzzy baixo. Isso troca alguns "não encontrei" (recall menor, casos Kingdom/Monster) por **quase-zero falso positivo** — o trade-off certo para uma fonte de metadados.

## 6. Cache do resolvedor (dois níveis, ambos no app — igual Comix)

| Nível | Chave | Valor | TTL / invalidação |
|---|---|---|---|
| **Permanente** | `work_external_ids (source=mangago, work_id)` — já existe (mig 131 / `mangagoSlug`) | **slug** | só sai por ação do usuário ("Revalidar fontes"); enquanto existir, **pula o resolvedor** |
| **Em memória (LRU)** | identidade do input: `al:<id>` → `mal:<id>` → `mu:<id>` → `t:<normalizeText(título)>` | `{ slug, url, score, method } \| null` | **hit 24h / miss 6h**; negativo cacheado 6h; máx ~1000 |

**Slug ou busca completa?** → **só o slug** (identidade estável) no permanente; um **registro mínimo resolvido** (`slug+score+method+variante`) no LRU para telemetria/fail-soft. **Nunca** a lista/HTML da busca: é grande, volátil e re-derivável — pura pressão de memória. O **negative cache** é essencial aqui (obras genéricas tipo Kingdom/Monster não estão no Mangago → evita marretar o FlareSolverr a cada tentativa).

## 7. Observabilidade (definir desde já)

Eventos estruturados (espelhando o padrão `event:"result"/"skipped"` do Comix) + contadores:

| Métrica pedida | Como | Fonte |
|---|---|---|
| hit rate | `resolved / total` | evento `result` |
| cache hit / miss | `cache:"perm"\|"lru"\|"miss"` no evento | resolvedor |
| average latency | histograma `resolve_duration_ms` (com/sem FS) | timer |
| timeout | `result:"timeout"` | FlareSolverr abort |
| no results | `result:"no_match"` (backend n=0 ou todos <0.72) | pós-busca |
| ambiguous results | `result:"ambiguous"` (2+ candidatos na mesma faixa/margem<0.08) | ranking |
| low confidence | `result:"review"` (faixa 0.72–0.90) | banding |
| FlareSolverr failures | `result:"fs_unavailable"` + respeitar circuito aberto | `isFlareSolverrCircuitOpen()` |

Extra útil: `method` (`exact`/`forward`/`reverse`/`cjk`/`year_confirmed`), `variantUsed` (qual campo AniList casou), `topScore`/`margin`. Sem Prometheus/sidecar — como é in-process, logo os eventos JSON já bastam (mesmo mecanismo do `ai-observability`).

## 8. Plano de implementação (etapas pequenas e independentes — **não implementado**)

Cada etapa é revisável isoladamente; nada quebra sem `MANGAGO_RESOLVE` ligado (fail-soft total).

| Etapa | Entrega | Depende de | Testável por |
|---|---|---|---|
| **E1** | `extractMangagoSlug(input)` puro (slug cru / URL `/read-manga/{slug}/`) — espelha `comix-hid.ts` | — | unit |
| **E2** | `scoreMangagoCandidate()` — wrapper sobre `bestTitleMatch` com **fix CJK** (colapsa espaço CJK) + **guarda reverse-substring** + retorna `{score, reason, matchedKind}`. Não toca `title-match.ts` compartilhado | — | unit c/ fixtures da bateria (já capturadas) |
| **E3** | `buildResolveVariants(input)` — de `{title?/anilistId?/malId?/mangaUpdatesId?}` produz `{queries[], targets[], year?}` reusando fetchers AniList/MAL/MU existentes | E2 | unit c/ fetchers mockados |
| **E4** | `resolveMangagoUrl(input, opts)` — multi-query `searchMangago`, dedupe por slug, argmax por E2, **banding** (E5) + margem + tie-break, LRU cache. DI (`search`/`cache`/`now`/`onResult`). Fail-soft | E2,E3 | unit c/ `mg_battery_out.json` como fixture |
| **E5** | Banding + threshold (AUTO/DUVIDOSO/REJEIÇÃO) como função pura configurável por env | E4 | unit (tabela de casos) |
| **E6** | Confirmação por **ano** (1 fetch de detalhe) só na faixa DUVIDOSO — atrás de flag | E4 | unit + 1 live |
| **E7** | Observabilidade: eventos `result/skipped` + contadores (Q7) | E4 | unit |
| **E8** | Persistência: `ensureMangagoSlug`+`persistMangagoSlug` (`work_external_ids source=mangago`), gate + fail-soft — espelha `comix-hid.ts` | E4 | unit |
| **E9** | Wire-in no chamador real (isolado, atrás de flag), **por último** | E1–E8 | live |

**Não precisa de sidecar** (reconfirmado pela memória do Comix): o sidecar Playwright existiu porque *"o token do comix assina a query inteira; FlareSolverr devolve DOM em loading"*. No Mangago **provei que o FlareSolverr entrega o HTML SSR completo (200)** — o obstáculo que justificou o sidecar simplesmente não existe aqui.

---

## Apêndice — Fatos-base da 1ª rodda (para o doc ser autossuficiente)

- **Proteção:** Cloudflare Managed Challenge (`cf-mitigated: challenge`, `server: cloudflare`, "Just a moment"). HTTP simples → **403**. Exige navegador real → **FlareSolverr** (sessão `"mangago"`). Já resolvido em `lib/external/mangago.ts`.
- **Busca:** form `GET /r/l_search/?name=` → **SSR HTML** puro (sem JSON/XHR/GraphQL; `search.js` vazio de endpoints).
- **Página da obra:** `/read-manga/{slug}/`, **SSR HTML** (sem `__NEXT_DATA__`/hidratação); 1 fetch traz tudo (título, sinopse, `rating_num`, votos, gêneros, alt-titles, capa).
- **Identificador:** o **slug é o único** (sem ID numérico interno; sub-recursos todos chaveados por slug).
- **Cross-IDs:** **NENHUM** em lugar algum (busca ou detalhe) — grep amplo vazio. Por isso a resolução é **title-only** e os inputs AniList/MAL/MU precisam virar **títulos** antes.
- **Arquitetura recomendada:** `resolveMangagoUrl` **in-process**, reusando `searchMangago` + `title-match.ts` + esqueleto de cache/DI do `comix-resolve.ts`. **Sem sidecar.**
</content>
