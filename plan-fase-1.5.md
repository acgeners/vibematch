# Plano — Fase 1.5: Bias Calibration + Refatoração Conceitual de Notas

> Decisões finalizadas após investigação de pipeline. Pronto pra execução.

---

## Contexto

A Fase 1 (re-arquitetura 4 camadas) está operacional. O Ridge (`expected_score`) treina contra `manual_score` usando as 9 notas que a IA dá pra cada obra como features, mais 5 features derivadas/contextuais.

**Problema diagnosticado**: a IA tem viés sistemático em alguns atributos (ex: tende a superestimar drama em ~1.7 pontos vs percepção real do user). Sem correção, todo `expected_score` herda esse viés silenciosamente. As recomendações ficam tortas.

**Estado atual do dado** (importante):
- **Hoje nenhuma obra tem nota dos 9 atributos preenchida pelo user pós-leitura** — só pela IA.
- O sinal de bias da Fase 1.5 vem **exclusivamente** do questionário pós-leitura que esta fase introduz.
- Portanto, a UI do questionário (1.5.2) precisa existir **antes** da aplicação do bias (1.5.3) — caso contrário não há dado pra calibrar.

**Junto com a feature**, esta fase faz uma **refatoração conceitual** de naming pra deixar o sistema mais claro:
- `manual_score` → `user_score`
- **"Atributos da obra"** (9 da IA, descritivos): indicam preferência
- **"Critérios de avaliação"** (8 do user, qualitativos): indicam execução, geram `user_score`

---

## Decisões finalizadas

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | UX timing | Sub-aba opcional em `work-status-form`, status terminais |
| 2 | Granularidade | Todos os 9 atributos sempre, pré-preenchidos com IA (igual fluxo `ai_evaluation_review_form`) |
| 3 | Threshold de aplicação | Bayesian shrinkage `bias_applied = bias_raw × n / (n+10)` |
| 4 | Storage | Nova tabela `attribute_bias` com `user_id` fixo (vindo de `user_settings`) — **Opção B** |
| 5 | Naming | `manual_score → user_score`, labels "Atributos da obra" / "Critérios de avaliação" |
| 6 | Exposição do bias | Card em `/settings/calibration` |
| 7 | Multi-tenant | `user_id` é coluna desde já, single-user usa um UUID fixo. Migração trivial pra multi-user. |
| 8 | Fonte do bias signal | **Opção 1**: só pós-leitura conta. `ai_edited` (pré-leitura) NÃO entra no cálculo. Pode revisitar se cobertura for baixa. |
| 9 | Aplicação do bias | **Source-aware**: bias só corrige `category_scores` com `source IN ('ai_only', 'ai_accepted')`. Pula `ai_edited` e `manual` (user já corrigiu). |

---

## Refatoração conceitual de naming

Modelo mental alvo:

```
┌─────────────────────────────────────────────────────┐
│ ATRIBUTOS DA OBRA (9)                               │
│ romance, drama, tragédia, ação, humor,              │
│ adult_content, couple_dynamics, complexidade,       │
│ qualidade técnica                                   │
│                                                     │
│ → DESCRITIVOS: "essa obra tem quanto disso?"        │
│ → Avaliados pela IA (sempre)                        │
│ → Avaliados pelo user pós-leitura (Fase 1.5, novo)  │
│ → Indicam preferência: features do Ridge            │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ CRITÉRIOS DE AVALIAÇÃO (8)                          │
│ história, originalidade, arte, personagens, ritmo,  │
│ mundo, emoção, releitura                            │
│                                                     │
│ → AVALIATIVOS: "quão bem executada foi a obra?"     │
│ → Avaliados só pelo user pós-leitura                │
│ → Geram a `user_score` (era manual_score)           │
│ → Target do Ridge                                   │
└─────────────────────────────────────────────────────┘
```

### Renomeações DB

| Antes | Depois |
|---|---|
| `works.manual_score` | `works.user_score` |

A tabela `criteria` mantém `eval_type='IA' | 'User'` — naming interno não muda.

### Renomeações de código

Find/replace cuidadoso:

| Padrão | Substituir por |
|---|---|
| `manual_score` (snake) | `user_score` |
| `manualScore` (camel) | `userScore` |
| `Manual Score`, `Nota Manual` (strings) | `User Score`, `Nota do Usuário` |

Mantidos sem renomeação:
- `CRITERION_SLUGS` — refere os 9 atributos. Renomear cascataria por centenas de pontos. Naming interno permanece.
- `category_scores` table — naming DB consolidado.

### Renomeações UI

| Onde | Antes | Depois |
|---|---|---|
| Headers da página da obra | "Critérios" / "Critérios da IA" | **"Atributos da obra"** |
| Tabela heatmap | "Critérios" | **"Atributos"** |
| Form pós-leitura | "Critérios pós-leitura" | **"Critérios de avaliação"** |
| /preferences | mistura | distinguir "Pesos dos atributos" vs "Pesos dos critérios" |
| /settings/calibration | "Critérios" | "Atributos" no contexto da IA |

Arquivos a atualizar:
- [components/titles/calculation-breakdown.tsx](components/titles/calculation-breakdown.tsx)
- [components/titles/work-status-form.tsx](components/titles/work-status-form.tsx)
- [components/titles/work-form.tsx](components/titles/work-form.tsx) — label "Calculada pela média dos ratings preenchidos"
- [components/settings/score-weights-form.tsx](components/settings/score-weights-form.tsx)
- [components/settings/post-reading-weights-form.tsx](components/settings/post-reading-weights-form.tsx)
- [components/settings/calibration-panel.tsx](components/settings/calibration-panel.tsx)
- [components/ranking/ranking-table-config.ts](components/ranking/ranking-table-config.ts)
- [components/titles/work-table-config.ts](components/titles/work-table-config.ts)
- [components/ai-evaluation/ai-evaluation-review-form.tsx](components/ai-evaluation/ai-evaluation-review-form.tsx)

### Confirmação importante (já validada)

`manual_score` JÁ É derivada dos 8 critérios — confirmado em [work-status-form.tsx:212-225](components/titles/work-status-form.tsx#L212): `computedManualScore` calcula como média ponderada e sincroniza via `useEffect`. O rename é puramente semântico.

---

## Modelo de dados

### Nova tabela: `user_attribute_assessment`

Captura a avaliação do user pós-leitura sobre os 9 atributos, com snapshot do que a IA disse no momento.

```sql
CREATE TABLE user_attribute_assessment (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL,                 -- single hoje, multi depois
  work_id                  UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  attribute_slug           TEXT NOT NULL,                 -- referencia criteria.slug (eval_type='IA')
  user_value               NUMERIC(3,1) NOT NULL CHECK (user_value BETWEEN 0 AND 10),
  source                   TEXT NOT NULL CHECK (source IN ('ai_accepted_post_read','user_edited_post_read')),
  ia_value_at_assessment   NUMERIC(3,1) NOT NULL,         -- snapshot pra auditoria
  ia_model_at_assessment   TEXT NOT NULL,                 -- guard 1: detectar mudança de modelo
  ia_prompt_version        TEXT NOT NULL,                 -- guard 1: detectar mudança de prompt
  ia_evaluation_id         UUID REFERENCES ai_evaluations(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_id, attribute_slug)
);

CREATE INDEX idx_user_attr_work ON user_attribute_assessment(work_id);
CREATE INDEX idx_user_attr_slug_user ON user_attribute_assessment(attribute_slug, user_id);

ALTER TABLE user_attribute_assessment ENABLE ROW LEVEL SECURITY;
```

`ia_model_at_assessment` e `ia_prompt_version` são essenciais pra Fase 1.5.7 (guards).

### Nova tabela: `attribute_bias`

Estado computado do bias por (user, atributo).

```sql
CREATE TABLE attribute_bias (
  user_id          UUID NOT NULL,
  attribute_slug   TEXT NOT NULL,
  n_samples        INTEGER NOT NULL DEFAULT 0,
  mean_bias_raw    NUMERIC(4,2) NOT NULL DEFAULT 0,   -- avg(user_value - ia_value_at_assessment)
  bias_applied     NUMERIC(4,2) NOT NULL DEFAULT 0,   -- mean_bias_raw × n/(n+10)
  stddev_bias      NUMERIC(4,2),                       -- pra detectar inconsistência futura
  last_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, attribute_slug)
);
```

### Backfill do `user_id`

Como `user_id` é NOT NULL, precisa de UUID fixo no estado single-user. Sugestão:

1. Adicionar coluna `current_user_id` em `user_settings` (default `gen_random_uuid()`).
2. Migration popula uma vez. Server actions usam esse valor.
3. Quando multi-user chegar: troca da fonte do `user_id` (auth session) sem migration.

---

## Helper centralizado (aplica em 5 consumidores)

Toda leitura de `category_scores` pra uso em pipeline/predição deve passar por:

```ts
// lib/ai-recommendation/calibrated-scores.ts (novo)

export interface AttributeBiasMap {
  [slug: string]: number  // bias_applied
}

export async function loadBiasMap(userId: string): Promise<AttributeBiasMap> { ... }

export function applyBiasToCategoryScores(
  rawScores: Record<CriterionSlug, number>,
  sources: Record<CriterionSlug, string>,  // 'ai_only', 'ai_accepted', 'ai_edited', 'manual'
  biasMap: AttributeBiasMap,
): Record<CriterionSlug, number> {
  const result = { ...rawScores }
  for (const slug of CRITERION_SLUGS) {
    // Source-aware: pula valores já corrigidos pelo user
    if (sources[slug] === 'ai_edited' || sources[slug] === 'manual') continue
    if (rawScores[slug] == null) continue
    result[slug] = rawScores[slug] - (biasMap[slug] ?? 0)
  }
  return result
}
```

**Não materializar** valores corrigidos no DB — calcula on-read pra:
- Permitir toggle on/off da correção sem migration
- Refletir bias atual sempre (não cache stale)
- Manter histórico bruto pra auditoria

---

## UX do questionário pós-leitura

### Quando aparece

Sub-aba opcional no [work-status-form.tsx](components/titles/work-status-form.tsx) — visível quando `personal_status ∈ {Completed, Dropped, On-hold, Stalled, Hiatus}`.

Não força. Se user não preencher, sistema funciona como hoje.

### Como preencher

UI espelhando [ai-evaluation-review-form.tsx](components/ai-evaluation/ai-evaluation-review-form.tsx):

```
┌─ Atributos da obra (pós-leitura) ─────────────────────┐
│  IA sugeriu / Você ajusta após ler                    │
│                                                        │
│  romance        [ 8.0 ]  ← editável                   │
│  drama          [ 7.5 ]                               │
│  tragédia       [ 5.0 ]                               │
│  ...                                                  │
│  qual. técnica  [ 8.0 ]                               │
│                                                        │
│  [ Aceitar tudo ]  [ Salvar ]                         │
└────────────────────────────────────────────────────────┘
```

- Pré-preenchido com `ia_value` da última `ai_evaluations` aceita
- User edita individualmente ou aceita tudo
- `source = "ai_accepted_post_read"` se valor final == ia_value, senão `"user_edited_post_read"`
- Se a obra **não tem AI evaluation ainda**: aba aparece disabled com tooltip "Rode a avaliação IA primeiro"

### Save

Server action `submitPostReadingAttributes(workId, values)`:
1. UPSERT 9 rows em `user_attribute_assessment` (idempotente)
2. Trigger `recomputeAttributeBias(userId)` (inline, leve)
3. Trigger `recalculateWork(workId)` (reflete novo bias)

---

## UI de calibração de bias (`/settings/calibration`)

Novo card "Bias dos Atributos":

```
┌─ Bias dos Atributos (correção da IA) ──────────────────┐
│                                                         │
│  Total de obras com pós-leitura: 12                    │
│                                                         │
│  Atributo         IA vs User   Aplicação   n samples    │
│  ──────────────   ──────────   ─────────   ─────────    │
│  drama            +1.7         55%         12   ⚠       │
│  romance          -0.3         50%         10           │
│  tragédia         +0.8         54%         11           │
│  ...                                                    │
│                                                         │
│  💡 IA tende a superestimar drama em 1.7. Aplicando    │
│     55% da correção observada (com 12 amostras).        │
└─────────────────────────────────────────────────────────┘
```

Tooltip por linha: "Com N amostras, aplicamos X% da correção observada (Bayesian shrinkage k=10)".

---

## Implementação em fases

**Ordem reorganizada**: UI antes de pipeline (sem dado, pipeline não roda).

### Fase 1.5.0 — Naming refactor (~1.5h)

**Pré-requisitos**: nada.

1. Migration `073_rename_manual_score_to_user_score.sql`: `ALTER TABLE works RENAME COLUMN manual_score TO user_score;`
2. Find/replace `manual_score → user_score`, `manualScore → userScore` em todo código.
3. Atualizar labels UI conforme tabela acima.
4. `npm run build` + `npm run test`.
5. Commit: `refactor: rename manual_score → user_score + clarifica naming (Atributos vs Critérios)`

**Critério de fim**: build ok, testes passam, UI mostra novos labels.

### Fase 1.5.1 — Schema + backend (~2h)

**Pré-requisitos**: 1.5.0.

1. Migrations:
   - `074_user_attribute_assessment.sql`
   - `075_attribute_bias.sql`
   - `076_user_settings_current_user_id.sql` (popula `current_user_id`)
2. `lib/calculations/attribute-bias.ts`:
   - `computeBiasForSlug(slug, userId)` — query + shrinkage + stddev
   - `recomputeAttributeBias(userId)` — recalc 9 slugs
   - `getBiasMap(userId)` — retorna `{slug: bias_applied}`
3. `lib/ai-recommendation/calibrated-scores.ts`:
   - `loadBiasMap(userId)`, `applyBiasToCategoryScores()` source-aware
4. `server/actions/post-reading-attributes.ts`:
   - `submitPostReadingAttributes(workId, values)` — UPSERT + recompute + recalculate
5. Testes unitários do shrinkage e da aplicação source-aware.
6. Commit: `feat: schema e backend de bias calibration (Fase 1.5)`

**Critério de fim**: posso popular `user_attribute_assessment` via SQL e ver `attribute_bias` recalculado corretamente.

### Fase 1.5.2 — UI do questionário (~2h) ⚡ **antes de 1.5.3**

**Pré-requisitos**: 1.5.1.

1. Componente `components/titles/post-attribute-assessment-form.tsx`:
   - Pre-fill com `ia_value` da última `ai_evaluations` aceita
   - 9 sliders/inputs 0-10
   - "Aceitar tudo" + "Salvar"
2. Integrar como sub-aba opcional em `work-status-form.tsx`.
3. Estado disabled quando obra não tem AI evaluation.
4. Commit: `feat: questionário pós-leitura de atributos (Fase 1.5)`

**Critério de fim**: consigo marcar uma obra como Completed, abrir a aba, ajustar drama 8→6, salvar, e ver row em `user_attribute_assessment`. `attribute_bias` atualizado.

### Fase 1.5.3 — Pipeline (propagação em 5 pontos) (~2.5h)

**Pré-requisitos**: 1.5.1. **Recomendado executar após 1.5.2** pra haver dado coletado e ver efeito real.

Aplicar `applyBiasToCategoryScores()` em 5 consumidores:

1. **Ridge** [expected.ts:158](lib/calculations/expected.ts#L158):
   - Carregar `biasMap` no início de `recalculateAll`
   - Aplicar nos `categoryScores` ANTES de calcular `iaEvalNormalized` e `criterionFitScore` (isso resolve os 3 caminhos do Ridge de uma vez)

2. **Personal Fit** [personal-fit.ts:97](lib/ai-recommendation/personal-fit.ts#L97):
   - Aplicar bias nos `categoryScores` antes de `criterionAlignment`

3. **Smart Shortlist prompt** [prompts.ts:84,177](lib/ai-recommendation/prompts.ts#L84):
   - Enviar valores corrigidos pro LLM reranker

4. **Deep Dive prompt** [deep-dive-prompts.ts:146,177](lib/ai-recommendation/deep-dive-prompts.ts#L146):
   - Enviar valores corrigidos no bundle de obra

5. **TasteProfile LLM prompt** [prompts.ts:119,132](lib/ai-recommendation/prompts.ts#L119):
   - Enviar valores corrigidos quando gerar preferences (relevante quando modo LLM ativar)

UI display permanece com valor cru + tooltip "Valor da IA antes de correção de bias".

6. Commit: `feat: aplica bias dos atributos em pipeline + LLM prompts (Fase 1.5)`

**Critério de fim**: após popular bias > 0 via 1.5.2, rodar `recalculateAll` muda `expected_score` na direção esperada. Smart Shortlist e Deep Dive recebem valores corrigidos.

### Fase 1.5.4 — UI de calibração (~1h)

**Pré-requisitos**: 1.5.1 (sem necessidade de dado pra mostrar estrutura).

1. Componente `components/settings/calibration/attribute-bias-table.tsx`.
2. Server query `getAttributeBias(userId)` — `n_samples`, `mean_bias_raw`, `bias_applied`, `shrinkage_pct`, `stddev`.
3. Card em `/settings/calibration`.
4. Tooltips explicando shrinkage.
5. Estado vazio: "Bias ainda não calibrado. Preencha o questionário pós-leitura em obras já lidas pra começar."
6. Commit: `feat: tabela de bias em /settings/calibration (Fase 1.5)`

**Critério de fim**: card mostra dados reais. Valor "Aplicação" bate com formula.

### Fase 1.5.5 — Regeneração de artefatos derivados (~1h)

**Pré-requisitos**: 1.5.3.

Após primeira ativação do bias com ≥5 amostras por atributo, artefatos pré-existentes ficam desatualizados:

1. **TasteProfile**: gerado a partir de category_scores brutos. Botão "Regenerar TasteProfile" em `/settings/calibration` que aciona `rebuildTasteProfile(userId)` com bias aplicado.

2. **`alignment_payload`** em `calculated_scores` (migration 070): foi populado pelo Smart Shortlist com prompt em valores brutos. Marcar `alignment_stale = true` quando bias muda > 0.3 em qualquer atributo.

3. **`expected_score` e `personal_fit`**: recalculados automaticamente pelo próximo `recalculateAll`. Botão "Recompute all" como atalho.

4. Commit: `feat: regeneração de TasteProfile e marcação stale de alignment após bias change (Fase 1.5)`

**Critério de fim**: botão "Regenerar artefatos calibrados" funciona sem erro. Pós-execução, ranking reflete novo TasteProfile.

### Fase 1.5.6 — `ai_edited` como fonte secundária de bias (opcional)

**Pré-requisitos**: 1.5.3, dados coletados.

**Quando ativar**: se após 3-6 meses a cobertura de pós-leitura ficar baixa (<10 amostras por atributo). Sinal mais confiável dispensa.

Implementação:
- Adicionar contribuição de `ai_edited` no compute de bias com peso reduzido (ex: 0.3).
- UI alerta clara: "Bias inclui sinal de pré-leitura com confiança parcial".

Esforço estimado: 0-1h se for ativar.

### Fase 1.5.7 — Guards e alertas de degradação (~2.5h)

**Pré-requisitos**: 1.5.4.

Sistema avisa quando bias/Ridge não estão aptos a performar bem.

#### Guard 1 — Mismatch de modelo/prompt

**O que detecta**: quando `model_name` ou `prompt_version` das `ai_evaluations` recentes são diferentes do que foi usado pra coletar o bias.

**Implementação**:
- Query: agregação de `ia_model_at_assessment` e `ia_prompt_version` em `user_attribute_assessment` → distribuição dominante.
- Query: distribuição de `model_name` e `prompt_version` das `ai_evaluations` dos últimos 30 dias.
- Se >50% das avaliações recentes usam modelo/prompt diferente do que populou o bias: alerta em `/settings/calibration`.

**Mensagem**: "Bias atual foi calibrado contra Claude Sonnet 4.6 / prompt v16. Avaliações recentes usam Opus 4.7 / v17. Considere re-coletar questionário pós-leitura em obras representativas."

#### Guard 2 — Drift de gênero/tags (cobertura insuficiente)

**O que detecta**: quando uma obra sendo predita tem gêneros/tags com pouca representação no training pool (obras lidas).

**Implementação simples** (versão inicial):
- Pra cada obra com `expected_score`, pegar suas top-3 tags do `tag_group='genre'`.
- Pra cada tag, contar quantas obras lidas (`user_score IS NOT NULL`) compartilham essa tag.
- Se `min(coverage_count) < 5`: marcar obra como "baixa cobertura".

**Mensagem**: badge sutil na coluna `expected_score` no ranking quando baixa cobertura — "Predição com baixa confiança: sem obras lidas suficientes com gênero similar".

Tooltip detalhado: "Tags da obra: drama, school, romance. Obras lidas com 'drama': 8 ✓. Obras lidas com 'school': 2 ⚠. Obras lidas com 'romance': 12 ✓."

#### Guard 3 — Sample size baixo + correção sendo aplicada

**O que detecta**: bias sendo aplicado em atributos com poucas amostras (correção parcial pode estar errada).

**Implementação**: já implícito no shrinkage (n=2 aplica 17% só). Tornar visível:
- Badge "Baixa confiança" na tabela de `/settings/calibration` quando `n < 10` por atributo.
- Tooltip: "Adicione mais avaliações pós-leitura pra aumentar confiança da correção."

#### Guard 4 — MAE degradado

**O que detecta**: predição perdendo precisão ao longo do tempo. Pode indicar bias drift, mudança de prompt, ou outro problema.

**Implementação**: já existe parcialmente em [components/settings/calibration/mae-history-chart.tsx](components/settings/calibration/mae-history-chart.tsx).
- Adicionar regra: se MAE recente (últimas 5 medições) está > 20% acima do baseline (média dos 30 anteriores): alerta.
- Mensagem: "Predições estão piorando comparado a períodos anteriores. Possíveis causas: mudança de modelo da IA, viés acumulado em correções, ou mudança brusca no perfil de obras avaliadas."
- Linkar pra Guards 1 e 2 com botão "Investigar causas".

#### Centralização

Tudo no card "Saúde do Sistema de Previsão" em `/settings/calibration`:

```
┌─ Saúde do Sistema de Previsão ────────────────────────┐
│  Geral: 🟢 Operacional                                │
│                                                        │
│  ✓ Guard 1 — Modelo/prompt consistentes              │
│  ⚠ Guard 2 — 18% das obras com baixa cobertura       │
│  ⚠ Guard 3 — 4 atributos com confiança parcial       │
│  ✓ Guard 4 — MAE estável                              │
│                                                        │
│  [ Ver detalhes ]                                     │
└────────────────────────────────────────────────────────┘
```

Notificações sutis fora desse card:
- Coluna `expected_score` no ranking: ícone ⚠ sutil pra obras com Guard 2 disparado.
- Próxima ao botão "Avaliar IA" na obra: aviso se Guard 1 disparado.

Commit: `feat: guards de degradação do sistema de previsão (Fase 1.5)`

**Critério de fim**: posso forçar cada guard manualmente (alterando dados de teste) e ver o alerta aparecer corretamente.

---

## Estado final proposto da Fase 1.5

| Fase | Pré-req | Esforço | Bloqueador? |
|---|---|---|---|
| 1.5.0 Naming refactor | — | 1.5h | — |
| 1.5.1 Schema + backend | 1.5.0 | 2h | precisa pra 1.5.2 |
| **1.5.2 UI questionário** | 1.5.1 | 2h | **precisa pra coletar dado** |
| 1.5.3 Pipeline propagação 5 pontos | 1.5.1 + dado | 2.5h | usa bias coletado |
| 1.5.4 UI de calibração | 1.5.1 | 1h | mostra dado |
| 1.5.5 Regeneração derivados | 1.5.3 | 1h | só faz sentido após bias ativo |
| 1.5.6 `ai_edited` (opcional) | dados baixos | 0-1h | futuro |
| 1.5.7 Guards e alertas | 1.5.4 | 2.5h | usa estrutura existente |
| **Total** | | **12-13h** | |

Pode parar após 1.5.4 (UI + dado coletado, sem aplicação) ou após 1.5.7 (sistema completo).

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Refactor `manual_score → user_score` quebra refs ocultas | `npm run build` + `npm run test` + grep raw `manual_score` |
| Bias degenera previsões com poucas amostras | Shrinkage k=10 + Guard 3 visual |
| User preenche 1-2 questionários e abandona | Sem ele, bias fica em 0. Sistema funciona como antes |
| Mudança de modelo/prompt invalida bias | Guard 1 detecta + snapshot `ia_model_at_assessment` |
| Avaliações em gênero novo (sem coverage) | Guard 2 alerta antes de o user confiar na predição |
| Bias drift silencioso | Guard 4 monitora MAE |

---

## Verificação end-to-end

```bash
# 1. Migrations
psql ... -f supabase/migrations/073_rename_manual_score_to_user_score.sql
psql ... -f supabase/migrations/074_user_attribute_assessment.sql
psql ... -f supabase/migrations/075_attribute_bias.sql
psql ... -f supabase/migrations/076_user_settings_current_user_id.sql

# 2. Build + tests
npm run build && npm run test

# 3. Smoke 1 — questionário e bias
# - Marcar uma obra Completed
# - Abrir aba "Atributos da obra (pós-leitura)"
# - Ajustar drama 8 → 6, salvar
# - Verificar row em user_attribute_assessment
# - Verificar attribute_bias: drama deve ter mean_bias_raw=-2, bias_applied=-2/(1+10)≈-0.18

# 4. Smoke 2 — pipeline aplicado
# - Rodar recalculateAll
# - Conferir que expected_score muda nas obras com drama alto
# - Conferir Smart Shortlist e Deep Dive recebem valores corrigidos no prompt

# 5. Smoke 3 — UI calibração
# - Abrir /settings/calibration → card "Bias dos Atributos" com dados
# - Tooltip mostra "Aplicando 9% da correção observada (1 amostra)"

# 6. Smoke 4 — guards
# - Guard 1: forçar prompt_version diferente nos ai_evaluations recentes → ver alerta
# - Guard 2: obra com tags sem representação → ver badge "baixa cobertura"
# - Guard 3: atributo com n=1 → ver "baixa confiança"
# - Guard 4: simular MAE alto recente → ver "predições piorando"

# 7. Validação refator
# - grep -r "manual_score" — só em migrations
# - grep -r "manualScore" — vazio
# - UI mostra "Atributos" e "Critérios de avaliação" coerente
```
