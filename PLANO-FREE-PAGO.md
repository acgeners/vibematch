# PLANO — Mapa canônico Free / Pago / Admin

> **Criado:** 2026-07-11 · **Revisado contra o código:** 2026-07-12 (PR #115)
> **Objetivo:** fonte única do que separa **free × pago** e **usuário × admin/curadoria**, com a opção de cada lado definida e o **estado do gate** (feito / falta / onde). Pré-requisito do deploy multi-user.
> **Marcação:** ✅ verificado no código hoje · ⚠️ inconsistência · 🔴 buraco de segurança/custo.
> Substitui a spec parcial de `PLANO-MULTIUSER.md §1` e reconcilia `lib/plans/capabilities.ts`.

> ### ⚠️ Aviso de manutenção — leia antes de agir sobre este doc
> A revisão de 2026-07-12 encontrou este documento **apontando para o lado errado**: o §4 listava
> ~40 buracos, dos quais a maioria já estava fechada, e o §3 declarava `account.ts` e `settings.ts`
> como *"corretamente sem gate"* quando eram justamente **os dois piores buracos** (self-upgrade de
> plano + escrita na fórmula global). Um doc de segurança desatualizado não é neutro — ele autoriza
> o erro. **Se for mexer em gate, RECONTE no código primeiro** (o comando está no §9), não confie
> nesta lista.

---

## 0. TL;DR — estado em 2026-07-12

1. **O eixo free/pago está fechado.** 6 capabilities declaradas, **4 gateiam de verdade**
   (`llm_taste_profile`, `smart_shortlist`, `deep_dive`, `chat_recommend`). 2 são chaves mortas (§5).
   **Não há mais decisão de plano pendente.**
2. **O eixo ADMIN era o bloqueador — e foi fechado no PR #115.** Todas as mutações de catálogo e
   gastos de LLM passam por `ensureAdmin()`. Sobrou um resíduo pequeno e nomeado no §4.
3. **A classe de buraco que este doc não enxergava: `"use server"` = endpoint HTTP público.** Toda
   função exportada de um arquivo com essa diretiva é chamável por POST, tenha ou não botão na tela.
   Corrigido estruturalmente no PR #115 (§7).
4. **O que falta pro deploy é rate-limit por usuário** (§6) — hoje o único limite é **global** e um
   usuário esgota a cota de todos.
5. **Quota/limite de produto** (nº de obras, listas, export) só faz sentido depois da **Fase 2
   (partição per-user)**, adiada. Até lá o free é "vitrine de leitura do catálogo do dono".

---

## 1. Modelo de acesso — 3 eixos ortogonais

| Eixo | Coluna DB | Gate (server) | Gate (UI) | Pergunta que responde |
|------|-----------|---------------|-----------|------------------------|
| **Plano** free/pago | `user_settings.user_plan` (default `free`, fail-closed) | `ensureCapability(cap)` / `planAllows` | `isPaid` esconde botões IA | "Esse usuário paga pela versão rica?" |
| **Admin/curadoria** | `user_settings.is_admin` (mig 139) | `ensureAdmin()` | `useIsAdmin()` esconde "Gerenciar" | "Pode editar o catálogo COMPARTILHADO?" |
| **Anon/deslogado** | sem sessão | `isCurrentUserAdmin→false` | só nav "Principal" | "Visitante — só leitura da vitrine" |

**Regra de ouro:** curadoria do catálogo = **admin**, nunca plano (um pago **não** edita o catálogo
compartilhado). Valor de IA por-usuário = **plano**. São eixos independentes.

**Corolário que este doc já errou uma vez:** "mora em `user_settings`" **não** quer dizer "é
pessoal". `formula_config` e `score_weights` são **globais** — e metade da tela `/preferencias`
escreve neles. Antes de classificar uma action como pessoal, olhe **a tabela que ela grava**, não o
nome dela.

---

## 2. Mapa canônico A — Eixo PLANO (free × pago)

Fonte: `lib/plans/capabilities.ts`. Regra: **capability não-listada = Free**; só o que custa LLM é restrito.

| Feature | Free (determinístico) | Pago (IA) | Gate | Onde é aplicado |
|---|---|---|---|---|
| **Perfil de gosto** | heurística `buildTasteProfileHeuristic` | `generateTasteProfile()` LLM | ✅ | `llm_taste_profile` @ `recommendations.ts:220` |
| **Ordenação do ranking** | `expected × personal_fit` | `expected × alignment` (Veredito IA) | ✅ | `smart_shortlist` @ `ranking/page.tsx`, `ranking.ts` |
| **Recomendar / re-rank** | bloqueado → usa `/ranking` | `match_score` por IA | ✅ | `smart_shortlist` @ `recommendations.ts` (6 sites) |
| **Prever Interesse ♥** | bloqueado → usa Nota Prevista | Interesse ♥ por IA | ✅ (dentro de `smart_shortlist`) | `synopsis-quality.ts` |
| **Mood livre no ranking** | não tem | contexto livre ("algo leve hoje") | ⚠️ **chave morta** — efetivo via `smart_shortlist` | `mood_input` nunca é checada |
| **Deep Dive** | não tem | análise 1 obra (extended thinking) | ✅ | `deep_dive` @ `deep-dive.ts:31` |
| **Chat de recomendação** | Free usa o `/ranking` determinístico | chat conversacional | ✅ | `chat_recommend` @ `recommendation-chat.ts:244` |
| **Previsão rica (8 critérios qualidade)** | — | — | ⚫ **morto** (`L0_QUALITY_ENABLED=false`) | `l0_quality_eval` @ `calculations.ts:482` |

**Decisões de plano: TRAVADAS.** As 5 features vivas têm as duas opções definidas e gateiam.

> ⚠️ `includeQuality` é **sempre false, inclusive no Pago** — `L0_QUALITY_ENABLED` é uma const local
> hardcoded `false` (o estimador media ruído: MAE CV 0.63 vs 0.54). O `CLAUDE.md` descreve a
> intenção, não o comportamento.

---

## 3. Mapa canônico B — Eixo ADMIN (curadoria do catálogo)

### ✅ Gated (`ensureAdmin`) — mutação de catálogo, gasto de LLM, config global

Obras e notas · avaliação IA (`triggerAiEvaluation`, `submitAiReview`, `skipAiEvaluation`) ·
`generateAllWorkData` · reviews (aquisição, digest, resumo, manuais) · sinopse canônica ·
tags (inferência, consolidação, sub-grupos, `upsertExternalTags`) · embeddings · calibração
(auditoria, viés, aplicar/reverter, `regenerateCalibratedArtifacts`) · listas/grupos (inclusive
`deleteWorkList`) · import · pesos (**suggest E apply**) · `refreshWorkExternalData` ·
`refetchWorkReviews` · fontes externas (`saveWorkSourceSelections`, `revalidateWorkSources`) ·
resolver da Comix · **`setPlan`** · **`setAnthropicBalance`** · **as 12 configs globais de
`settings.ts`** (pesos, cores, preferências de ranking, `syncConstantsNow`, as 3 consolidações).

### ✅ Corretamente SEM gate — dado PESSOAL (tabela com `user_id` / linha própria de `user_settings`)

`pilot-taste` · `tag-preferences` · `preference-rules` · `filter-presets` ·
`post-reading-attributes` · `ai-eval-read` · `settings-read` · `badges` · `compare` ·
`account.updateProfile`/`uploadAvatar` · **os 7 toggles on-create de `settings.ts`**
(`setAiEvalOnCreate`, `setSynopsisCanonicalOnCreate`, `setReviewSummaryEnabled`,
`setReviewDigestEnabled`, `setTagInferenceOnCreate`, `setInterestShadowOnCreate`,
`setGenerateAllOnCreate`) — estes gravam na **linha própria** e não vazam entre usuários.

> 🔴 **Erro histórico deste doc:** a versão de 11/07 listava `account.ts` e `settings.ts` INTEIROS
> nesta seção. Estavam errados: `reactivatePlan()` dava plano **pago de graça** (gastando a chave
> Anthropic do dono) e `updateScoreWeights` reescrevia a **fórmula de nota de todo mundo**.
> Corrigido no PR #115. A lição está no corolário do §1.

---

## 4. Resíduo aberto (verificado 2026-07-12)

Pequeno e nomeado. Nenhum destes corrompe nota/obra; são custo e higiene.

| Ação | arquivo | O que dá pra fazer sem gate | Gravidade |
|---|---|---|---|
| `searchExternalTitles` · `fetchExternalData` | `external.ts:88,193` | Scraping das 9 fontes (FlareSolverr/sidecar) na infra do dono. Sem LLM, mas é custo de rede e risco de bloqueio das fontes | média |
| `deleteRecommendationRunAction` | `recommendations.ts:447` | Apagar histórico de recomendação. `recommendation_runs` **não tem `user_id`** ⇒ é histórico de todos | baixa |
| `analyzeExternalListImport` | `external-list-import.ts:80` | Analisar um import (o *commit* é gated). Só leitura + matching | baixa |

Coberto transitivamente (não precisa de gate próprio): `rerunRecommendationFromExistingAction`
delega pra `runRecommendationAction`, que tem `ensureCapability("smart_shortlist")`.

---

## 5. Reconciliação do `lib/plans/capabilities.ts`

| Item | Estado | Ação recomendada |
|---|---|---|
| `mood_input` | ⚠️ chave morta (0 call-sites) | **Remover** de `PAID_CAPABILITIES` (o gate real é `smart_shortlist`) |
| `l0_quality_eval` | ⚫ morto (`L0_QUALITY_ENABLED=false`) | **Remover** ou comentar como dormente; não é decisão de plano hoje |
| `planAllows(_cap)` | stub binário (`plan === "paid"`, ignora a capability) | Manter — mas é tudo-ou-nada; a capability só serve pro `paidOnlyMessage` |
| Ref quebrada "espelha plan-arquitetura-notas.md §4" | ⚠️ aquele §4 não tem tabela free/pago | Apontar pra **este** doc |

---

## 6. 🔴 O bloqueador do deploy agora: rate-limit é GLOBAL

`MAX_RUNS_PER_DAY = 20` (`recommendations.ts:44`) é aplicado por `getRunsToday()`
(`server/queries/recommendations.ts:1058`), que conta **todas** as linhas de `recommendation_runs`
das últimas 24h — **sem filtrar por usuário**. Consequências opostas, ambas ruins:

- **Um usuário derruba os outros:** quem gastar as 20 bloqueia todo mundo (inclusive o dono) até o dia seguinte.
- **Não limita ninguém individualmente:** dentro do teto global, uma conta paga gasta à vontade.

E as ações que o PR #115 gateou (avaliar, digest, consolidar) **não têm limite diário nenhum** —
"exige admin" é uma porta, não um medidor.

**Decisão de produto pendente:** cota por plano (ex.: free 0/dia, pago 20/dia?) e se o teto passa a
ser por usuário. **Sem isso, não expor o app.**

Limites existentes hoje, todos **universais** (plano-agnósticos): `MAX_RUNS_PER_DAY = 20` ·
`MAX_COMPARE_WORKS = 10` (`lib/compare-config.ts`) · `MAX_CANDIDATES_HARD_LIMIT`
(`lib/ai-recommendation/limits.ts`). **Não existe primitiva de quota** (0 hits de
quota/credits/allowance nas migrations).

---

## 7. GOTCHA estrutural — `"use server"` publica TODA função exportada

Um arquivo com `"use server"` transforma **cada função exportada** num endpoint HTTP: o Next gera um
id de action e qualquer um pode fazer POST nela. **"Ninguém chama isso da UI" não protege nada.**

Por isso `resolveComixDataResilient(workId)`, `recalculateScoresNow()` e `refreshEmbeddingForWork()`
eram scraping, CPU sobre o catálogo inteiro e gasto de API de embeddings **abertos a qualquer um**.

**E gate NÃO resolve:** `ensureAdmin()` retorna `false` sem sessão, e essas funções rodam em
background (`after()`, cascatas fire-and-forget) onde `cookies()` lança. Gateá-las **mataria os jobs
do próprio dono** — trocaria um buraco por uma regressão silenciosa, que é pior.

**A correção é estrutural** (feita no PR #115): a implementação sai do `"use server"` e vira módulo
server-only; em `server/actions/` fica só uma fachada com o que a UI chama.

| De | Para | Saíram do endpoint |
|---|---|---|
| `server/actions/comix-resolver.ts` | `server/comix/resolver.ts` | 4 de 12 |
| `server/actions/recalc-queue.ts` | `server/recalc/queue.ts` | 6 de 8 |
| `server/actions/embeddings.ts` | `server/embeddings/refresh.ts` | 2 de 3 |

**Como verificar:** depois de `npm run build`, o registro de actions fica em
`.next/server/server-reference-manifest.json`. Se o nome da função aparece lá, **ela é um endpoint
público**. Foi assim que se confirmou que as 10 funções de background sumiram e as 5 da UI ficaram.

---

## 8. Sequência pro deploy

| # | Passo | Eixo | Estado |
|---|-------|------|--------|
| 1 | `ensureAdmin` nas mutações de catálogo / gastos de IA / config global | Admin | ✅ **PR #115** |
| 2 | Tirar do `"use server"` o que a UI não chama | Infra | ✅ **PR #115** |
| 3 | Esconder na UI o que o não-admin não pode salvar (`/preferencias`) | Admin | ✅ **PR #115** |
| 4 | **Rate-limit por usuário/IP** (§6) — precisa da decisão de cotas | Infra/Produto | 🔴 **P0 — falta** |
| 5 | Fechar o resíduo do §4 (scraping externo sem gate) | Admin | P1 |
| 6 | Limpar `capabilities.ts` (§5: chaves mortas) | Plano | P2 |
| 7 | (Deploy) — só depois do 4 | — | — |
| 8 | Quotas de produto (nº de obras/listas/export) | Produto | P3 — **depende da Fase 2** |

---

## 9. Como recontar (não confie nesta lista sem rodar)

```bash
# exports de server action com e sem gate, por arquivo
python3 - <<'EOF'
import re, glob, os
for p in sorted(glob.glob("server/actions/*.ts")):
    src = open(p).read()
    if '"use server"' not in src.split("\n")[0]: continue   # fachada/módulo comum
    for b in re.split(r'(?=^export async function )', src, flags=re.M):
        m = re.match(r'export async function (\w+)', b)
        if not m: continue
        gated = any(g in b for g in ('ensureAdmin()', 'ensureCapability(', 'planAllows('))
        if not gated: print(f"SEM GATE  {os.path.basename(p):40} {m.group(1)}")
EOF
```

Duas ressalvas ao ler o resultado:
1. **Fachada mente:** `comix-resolver.ts`, `recalc-queue.ts` e `embeddings.ts` em `server/actions/`
   são fachadas — o gate mora na implementação (`server/comix/`, `server/recalc/`, `server/embeddings/`).
   Idem `cancelPlan`/`reactivatePlan`, que delegam pro `setPlan` gateado.
2. **Leitura sem gate é OK.** O que importa é: **muta o catálogo?** **gasta LLM/rede?** **escreve
   config global?** Se não, pode ficar aberto.
