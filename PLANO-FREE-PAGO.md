# PLANO — Acesso: papéis, permissões e o que falta pro deploy

> **Criado:** 2026-07-11 (como mapa free/pago) · **Reescrito:** 2026-07-13 — o eixo "plano" virou
> **PAPEL** (migration 140). O nome do arquivo ficou por histórico; o assunto é o modelo de acesso.
> **Marcação:** ✅ verificado no código · ⚠️ inconsistência · 🔴 buraco de segurança/custo.

> ### ⚠️ Aviso de manutenção — leia antes de agir sobre este doc
> Este documento já esteve **ativamente errado** uma vez: declarava `account.ts` e `settings.ts`
> como *"corretamente sem gate"* quando eram os **dois piores buracos** (self-upgrade de plano +
> escrita na fórmula global). Um doc de segurança desatualizado não é neutro — ele **autoriza o
> erro**. **Se for mexer em gate, RECONTE no código primeiro** (§9); não confie nesta lista.

---

## 0. TL;DR — estado em 2026-07-13

1. **O acesso agora é uma ESCADA de papéis** (§1): **Curador ⊃ Assinante ⊃ Leitor**, em
   `user_settings.role` (mig 140, aplicada). Substituiu as duas flags ortogonais
   (`user_plan` × `is_admin`), que eram a fonte estrutural dos buracos.
2. **Todos os gates estão fechados** — mutação de catálogo, gasto de LLM e config global exigem
   Curador (PRs #115/#117). Nenhum buraco conhecido no eixo de escrita.
3. **`"use server"` publica TODA função exportada como endpoint HTTP** (§7). Foi a classe de buraco
   que este doc não enxergava; corrigida estruturalmente no #116.
4. 🔴 **O ÚNICO item entre o app e o deploy é o rate-limit por usuário** (§6). Hoje o limite é
   **global**: um usuário esgota a cota de todos, e ninguém é limitado individualmente.
5. **Não existe billing.** Papel se atribui no banco. Quando houver cobrança, o caminho é uma action
   gated chamada pelo **webhook do provedor** — nunca um botão de auto-serviço (foi exatamente esse
   botão que dava plano pago de graça).

---

## 1. Modelo de acesso — a ESCADA (migration 140)

| Papel | Coluna | Pode | Não pode |
|---|---|---|---|
| **Curador** | `role='curador'` | Tudo: cria/edita/apaga obra, escolhe capa/sinopse, IA de curadoria, config global | — |
| **Assinante** | `role='assinante'` | IA de consumo (recomendar/chat/deep dive) + **atualiza** obras (automático) | Criar, editar, apagar, config global |
| **Leitor** | `role='leitor'` (default) | Lê o catálogo inteiro | Qualquer escrita; LLM (virá por crédito) |
| **Anônimo** | sem sessão | Lê a vitrine | Tudo o mais (`getCurrentRole` → `leitor`, fail-closed) |

Fonte: `lib/plans/roles.ts` · gates em `server/queries/current-user.ts`
(`ensurePermission(verbo)` ← **preferir** · `ensureRole(min)` · `ensureAdmin()` = alias de curador,
mantido pelos ~130 call sites). Client: `useCan(verbo)` / `useRole()` / `useIsAdmin()`.

> **Por que escada, e não as duas flags de antes.** Modelar uma escada com flags ortogonais produz
> estados sem sentido — e não é teoria: foi essa modelagem que deixou `reactivatePlan()` virar
> self-upgrade de plano pago e fez este doc classificar a fórmula GLOBAL como "dado pessoal".

### As permissões são VERBOS, não papéis

`refresh_work` · `consume_ai` · `curate_work` · `curate_ai` · `global_config`.

A distinção que não existia no código, e que sustenta o Assinante:

- **atualizar** → re-hidrata a obra das fontes **sem escolha humana** (merge automático). É o que o
  Assinante paga: dado fresco.
- **editar** → decide o conteúdo (capa, sinopse, conflito). E como `works` é **compartilhada** (sem
  `user_id`), decidir é **decidir pelos outros**, sem reversão por usuário.

Sem separar os verbos, "deixar o Assinante atualizar" significaria deixá-lo trocar a capa boa por
uma ruim na obra que o Curador curou.

**Como o Assinante escreve sem poder forjar conteúdo:** `autoRefreshWorkData(workId)` — o cliente
manda **só o workId**; quem busca, funde e grava é o **servidor**. `updateWorkExternalData` (que
recebe o payload **escolhido pelo cliente**) segue exclusiva do Curador. O que o automático grava
está em `buildAutoRefreshPlan` (pura, testada): só o que **envelhece**; **nunca** título, sinopse ou
capa; e **campo em conflito é pulado**.

### Regras de ouro

1. **Curadoria do catálogo = Curador, nunca plano.** Um Assinante **não** edita o catálogo.
2. **"Mora em `user_settings`" NÃO quer dizer "é pessoal".** `formula_config` e `score_weights` são
   **globais** — e metade de `/preferencias` escreve neles. Antes de classificar uma action como
   pessoal, olhe **a tabela que ela grava**, não o nome dela.
3. **Sem billing, ninguém troca o próprio papel.** `setPlan`/`cancelPlan`/`reactivatePlan` foram
   **removidas** (pós-mig 140 viraram no-op: gravavam `user_plan`, que ninguém mais lê).
   Hoje: `update user_settings set role='assinante' where email='...';`

---

## 2. Mapa das capabilities de IA (Leitor × Assinante)

Fonte: `lib/plans/capabilities.ts`. Regra: **capability não-listada é livre**; só o que custa LLM é
restrito. `getCurrentPlan()` hoje **DERIVA do papel** (curador/assinante → `paid`; leitor → `free`)
— `user_plan` virou legado e **ninguém mais lê**. As capabilities ainda falam "plano"; migrá-las
pra `ensurePermission("consume_ai")` é limpeza pendente (§5).

| Feature | Leitor (determinístico) | Assinante (IA) | Gate | Onde é aplicado |
|---|---|---|---|---|
| **Perfil de gosto** | heurística `buildTasteProfileHeuristic` | `generateTasteProfile()` LLM | ✅ | `llm_taste_profile` @ `recommendations.ts:220` |
| **Ordenação do ranking** | `expected × personal_fit` | `expected × alignment` (Veredito IA) | ✅ | `smart_shortlist` @ `ranking/page.tsx`, `ranking.ts` |
| **Recomendar / re-rank** | bloqueado → usa `/ranking` | `match_score` por IA | ✅ | `smart_shortlist` @ `recommendations.ts` (6 sites) |
| **Prever Interesse ♥** | bloqueado → usa Nota Prevista | Interesse ♥ por IA | ✅ (dentro de `smart_shortlist`) | `synopsis-quality.ts` |
| **Mood livre no ranking** | não tem | contexto livre ("algo leve hoje") | ⚠️ **chave morta** — efetivo via `smart_shortlist` | `mood_input` nunca é checada |
| **Deep Dive** | não tem | análise 1 obra (extended thinking) | ✅ | `deep_dive` @ `deep-dive.ts:31` |
| **Chat de recomendação** | Free usa o `/ranking` determinístico | chat conversacional | ✅ | `chat_recommend` @ `recommendation-chat.ts:244` |
| **Previsão rica (8 critérios qualidade)** | — | — | ⚫ **morto** (`L0_QUALITY_ENABLED=false`) | `l0_quality_eval` @ `calculations.ts:482` |

**Decisões travadas.** As 5 features vivas têm as duas opções definidas e gateiam.

> O **Leitor** destravará essas capabilities **comprando crédito** — mas crédito e **débito**
> nascem juntos: sem débito, "saldo > 0" viraria LLM infinito de graça. Ver §6.

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

## 4. Resíduo — ✅ FECHADO (2026-07-13)

O eixo admin não tem mais buraco conhecido. Os 3 que restavam foram gateados:

| Ação | arquivo | Por quê |
|---|---|---|
| `searchExternalTitles` · `fetchExternalData` | `external.ts` | Scraping das 9 fontes na infra do dono — sem gate, é um **proxy de scraping grátis**, e o tráfego extra derruba as fontes pra todo mundo |
| `deleteRecommendationRunAction` | `recommendations.ts` | `recommendation_runs` **não tem `user_id`** ⇒ o histórico é compartilhado; sem gate um usuário apaga a execução de outro. Vira gate de plano quando a Fase 2 particionar a tabela |
| `analyzeExternalListImport` | `external-list-import.ts` | O *commit* já era gated; deixar a análise aberta era inconsistência |

Coberto transitivamente (não precisa de gate próprio): `rerunRecommendationFromExistingAction`
delega pra `runRecommendationAction`, que tem `ensureCapability("smart_shortlist")`.

> As demais actions sem `ensureAdmin` são **leitura** ou **dado pessoal** (§3) — rode o §9 e aplique
> os três critérios: muta o catálogo? gasta LLM/rede? escreve config global?

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

### Crédito do Leitor — só COM débito

O Leitor compra crédito pra usar IA de consumo. **Crédito e débito nascem juntos**: enquanto não
houver mecanismo de débito, "saldo > 0" liberaria **LLM infinito de graça**. Por isso a coluna de
saldo ainda **não existe** — criá-la dormente só convidaria alguém a ligá-la sozinha.

IA de **curadoria** (avaliar obra, digest, consolidar sinopse) **nunca** entra em crédito: ela
ESCREVE no catálogo compartilhado, e escrita é papel, não saldo.

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

| # | Passo | Estado |
|---|-------|--------|
| 1 | `ensureAdmin` nas mutações de catálogo / gastos de IA / config global | ✅ #115 |
| 2 | Tirar do `"use server"` o que a UI não chama | ✅ #116 |
| 3 | Esconder na UI o que o não-curador não pode salvar (`/preferencias`) | ✅ #115 |
| 4 | Fechar o resíduo (scraping externo, histórico compartilhado) | ✅ #117 |
| 5 | **Papéis** — escada `role` + permissões por verbo (mig 140) | ✅ #118 |
| 6 | Assinante atualiza obras (automático, sem escolher conteúdo) | ✅ #119 |
| 7 | Badge do papel + card da escada no `/conta` | ✅ #121 |
| 8 | 🔴 **Rate-limit por usuário/IP** (§6) — precisa da decisão de cotas | **P0 — o ÚNICO que falta** |
| 9 | Crédito + débito (Leitor consome IA pagando por uso) | falta |
| 10 | Limpar `capabilities.ts` (§5: chaves mortas) + migrar pra `consume_ai` | P2 |
| 11 | (Deploy) — só depois do 8 | — |
| 12 | Quotas de produto (nº de obras/listas/export) | P3 — **depende da Fase 2** |

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
