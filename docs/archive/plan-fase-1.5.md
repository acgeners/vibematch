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
| 6 | Exposição do bias | Card em `/curation/settings/calibration` |
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
| /curation/settings/calibration | "Critérios" | "Atributos" no contexto da IA |

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
  user_id                  UUID NOT NULL,
  work_id                  UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  attribute_slug           TEXT NOT NULL,
  user_value               NUMERIC(3,1) NOT NULL CHECK (user_value BETWEEN 0 AND 10),
  source                   TEXT NOT NULL CHECK (source IN ('ai_accepted_post_read','user_edited_post_read')),
  ia_value_at_assessment   NUMERIC(3,1) NOT NULL,
  ia_model_at_assessment   TEXT NOT NULL,           -- guard 1
  ia_prompt_version        TEXT NOT NULL,           -- guard 1
  ia_evaluation_id         UUID REFERENCES ai_evaluations(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_id, attribute_slug)
);

CREATE INDEX idx_user_attr_work ON user_attribute_assessment(work_id);
CREATE INDEX idx_user_attr_slug_user ON user_attribute_assessment(attribute_slug, user_id);

ALTER TABLE user_attribute_assessment ENABLE ROW LEVEL SECURITY;
```

### Nova tabela: `attribute_bias`

Estado computado do bias por (user, atributo).

```sql
CREATE TABLE attribute_bias (
  user_id          UUID NOT NULL,
  attribute_slug   TEXT NOT NULL,
  n_samples        INTEGER NOT NULL DEFAULT 0,
  mean_bias_raw    NUMERIC(4,2) NOT NULL DEFAULT 0,
  bias_applied     NUMERIC(4,2) NOT NULL DEFAULT 0,
  stddev_bias      NUMERIC(4,2),
  last_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, attribute_slug)
);

ALTER TABLE attribute_bias ENABLE ROW LEVEL SECURITY;
```

### Backfill do `user_id`

Como `user_id` é NOT NULL, precisa de UUID fixo no estado single-user.

```sql
ALTER TABLE user_settings 
  ADD COLUMN current_user_id UUID NOT NULL DEFAULT gen_random_uuid();
```

Server actions usam esse UUID. Quando multi-user chegar: troca fonte (auth session) sem migration.

---

## Helper centralizado (aplica em 5 consumidores)

Toda leitura de `category_scores` pra uso em pipeline/predição deve passar por:

```ts
// lib/ai-recommendation/calibrated-scores.ts (novo)

export type AttributeBiasMap = Record<string, number>

export interface CategoryScoreWithSource {
  value: number
  source: CategoryScoreSource  // 'ai_only' | 'ai_accepted' | 'ai_edited' | 'manual' | 'imported'
}

export async function loadBiasMap(userId: string): Promise<AttributeBiasMap>

export function applyBiasToCategoryScores(
  rawScores: Partial<Record<CriterionSlug, CategoryScoreWithSource>>,
  biasMap: AttributeBiasMap,
): Record<CriterionSlug, number | null> {
  const result = {} as Record<CriterionSlug, number | null>
  for (const slug of CRITERION_SLUGS) {
    const entry = rawScores[slug]
    if (entry == null) { result[slug] = null; continue }
    
    // Source-aware: pula valores que o user já corrigiu
    if (entry.source === 'ai_edited' || entry.source === 'manual') {
      result[slug] = entry.value
      continue
    }
    
    const bias = biasMap[slug] ?? 0
    result[slug] = entry.value - bias
  }
  return result
}
```

**Não materializar** valores corrigidos no DB — calcula on-read pra:
- Permitir toggle on/off da correção sem migration
- Refletir bias atual sempre (não cache stale)
- Manter histórico bruto pra auditoria

---

## Implementação em fases

**Ordem reorganizada**: UI antes de pipeline (sem dado, pipeline não roda).

---

### Fase 1.5.0 — Naming refactor (~1.5h)

**Pré-requisitos**: nada.

#### Migration

**`supabase/migrations/073_rename_manual_score_to_user_score.sql`**:
```sql
ALTER TABLE works RENAME COLUMN manual_score TO user_score;
-- Verificar índices/views/RPCs dependentes
```

#### Find/replace de código

Ordem importa — do mais específico pro genérico:

```bash
# 1. Strings óbvias primeiro (mais raras, sem ambiguidade)
grep -rln "Manual Score\|Nota Manual\|manualScore\|manual_score" --include="*.ts" --include="*.tsx" --include="*.sql"

# 2. camelCase
sed -i '' 's/manualScore/userScore/g' <files>

# 3. snake_case (cuidado: NÃO confundir com personal_score, final_score, expected_score)
sed -i '' 's/manual_score/user_score/g' <files>
```

#### UI labels

Atualizar 8 arquivos centrais com substituições contextuais:
- "Critérios" → "Atributos da obra" quando refere aos 9 da IA
- "Critérios pós-leitura" → "Critérios de avaliação"
- "Calculada pela média dos ratings" → "Calculada pela média dos critérios"

#### Verificação

```bash
npm run build && npm run test
grep -r "manual_score\|manualScore" --exclude-dir=node_modules --exclude-dir=.next
# Esperado: zero resultados fora de migrations
```

#### Commit

```
refactor: rename manual_score → user_score + clarifica naming (Atributos vs Critérios)
```

---

### Fase 1.5.1 — Schema + backend (~3h)

**Pré-requisitos**: 1.5.0 mergeado.

#### Migrations (4 novas)

**`074_user_settings_current_user_id.sql`**:
```sql
ALTER TABLE user_settings 
  ADD COLUMN current_user_id UUID NOT NULL DEFAULT gen_random_uuid();
```

**`075_user_attribute_assessment.sql`**: tabela completa (ver "Modelo de dados" acima).

**`076_attribute_bias.sql`**: tabela completa (ver "Modelo de dados" acima).

**`077_calculated_scores_alignment_stale.sql`**:
```sql
ALTER TABLE calculated_scores
  ADD COLUMN alignment_stale BOOLEAN NOT NULL DEFAULT false;
```

#### Arquivos novos

**`lib/calculations/attribute-bias.ts`** — cálculo do bias:

```ts
export const BIAS_SHRINKAGE_K = 10

export interface BiasComputation {
  attributeSlug: string
  nSamples: number
  meanBiasRaw: number
  biasApplied: number   // = meanBiasRaw × n / (n + K)
  stddev: number | null // null se n < 2
}

export async function computeBiasForSlug(
  slug: string,
  userId: string,
  admin: SupabaseClient,
): Promise<BiasComputation>

export async function recomputeAttributeBias(
  userId: string,
  admin: SupabaseClient,
): Promise<BiasComputation[]>  // 9 entries

export async function getBiasMap(
  userId: string,
  admin: SupabaseClient,
): Promise<AttributeBiasMap>
```

**`lib/ai-recommendation/calibrated-scores.ts`** — aplicação source-aware (ver helper acima).

**`server/queries/current-user.ts`**:
```ts
export async function getCurrentUserId(admin: SupabaseClient): Promise<string>
  // Lê user_settings.current_user_id, cache em memória pra reduzir queries
```

**`server/actions/post-reading-attributes.ts`**:
```ts
"use server"

export async function submitPostReadingAttributes(
  workId: string,
  values: Record<CriterionSlug, {
    userValue: number
    source: 'ai_accepted_post_read' | 'user_edited_post_read'
  }>,
): Promise<{ ok: true } | { ok: false; error: string }>
  // 1. Carrega latest ai_evaluations pra snapshotar ia_value + model + prompt
  // 2. UPSERT 9 rows em user_attribute_assessment
  // 3. recomputeAttributeBias(currentUserId)
  // 4. recalculateWork(workId)
  // 5. revalidatePath(`/catalog/${workId}`)
```

#### Testes (`tests/unit/calculations/attribute-bias.test.ts`)

- `computeBiasForSlug` com 0 amostras → `meanBiasRaw=0`, `biasApplied=0`
- Com n=10, mean=2 → `biasApplied=2×10/20=1.0` (50%)
- Com n=50, mean=2 → `biasApplied=2×50/60≈1.67` (83%)
- `stddev` null com 1 amostra
- `applyBiasToCategoryScores` pula `ai_edited` (testa com 4 sources distintas no mesmo input)
- `applyBiasToCategoryScores` retorna null pra slugs ausentes

#### Critério de fim

- INSERT manual em `user_attribute_assessment` (1 obra, 9 rows com `user=6, ia=8` em drama): chamar `recomputeAttributeBias` popula `attribute_bias` corretamente — `drama` tem `n=1, mean=-2, applied≈-0.18`.
- `getBiasMap(userId)` retorna 9 valores (zeros pra slugs sem amostra).
- `applyBiasToCategoryScores` com source `ai_only` aplica; com `ai_edited` não.
- Testes verde.

#### Commit

```
feat: schema + backend de bias calibration (Fase 1.5.1)
```

---

### Fase 1.5.2 — UI do questionário (~2.5h)

**Pré-requisitos**: 1.5.1.

#### Componente novo: `components/titles/post-attribute-assessment-form.tsx`

```tsx
interface PostAttributeAssessmentFormProps {
  workId: string
  latestAiEvaluation: {
    evaluationId: string
    modelName: string
    promptVersion: string
    attributes: Record<CriterionSlug, number>
  } | null
  existingAssessment: Record<CriterionSlug, number> | null
}

export function PostAttributeAssessmentForm(props): JSX.Element
```

**Estado interno**:
- Form (react-hook-form): 9 valores 0-10 com Zod
- Inicialização: `existingAssessment` se houver, senão `latestAiEvaluation.attributes`
- Source derivado no submit: se `userValue === ia_value` → `ai_accepted_post_read`, senão `user_edited_post_read`

**Layout**:
```
┌─ Atributos da obra (pós-leitura) ──────────────────────┐
│  Como você viu a obra após ler                         │
│                                                         │
│  romance        [slider ▰▰▰▰▰▰▰▰░░] 8.0   IA: 7.5      │
│  drama          [slider ▰▰▰▰▰▰▰░░░] 7.0   IA: 8.5      │
│  tragédia       [slider ▰▰▰▰▰░░░░░] 5.0   IA: 4.0      │
│  ...            ...                                    │
│                                                         │
│  [ Aceitar valores da IA ]  [ Salvar avaliação ]      │
└─────────────────────────────────────────────────────────┘
```

**Estado disabled** (sem AI evaluation):
```
"Esta obra ainda não foi avaliada pela IA.
 Rode a avaliação primeiro pra poder calibrar."
[ Avaliar com IA → ]  → link pra /curation/works?work={workId}
```

#### Integração: `components/titles/work-status-form.tsx`

Após bloco dos 8 critérios de avaliação (~linha 480), adicionar collapsible:

```tsx
{(['Completed', 'Dropped', 'On-hold', 'Stalled', 'Hiatus'] as const).includes(personalStatus) && (
  <Collapsible>
    <CollapsibleTrigger>Atributos da obra (pós-leitura)</CollapsibleTrigger>
    <CollapsibleContent>
      <PostAttributeAssessmentForm
        workId={workId}
        latestAiEvaluation={latestAiEvaluation}
        existingAssessment={existingAssessment}
      />
    </CollapsibleContent>
  </Collapsible>
)}
```

#### Server queries novas: `server/queries/post-attribute-assessment.ts`

```ts
export async function getLatestAiEvaluationAttributes(workId: string): Promise<{
  evaluationId, modelName, promptVersion, attributes: Record<CriterionSlug, number>
} | null>

export async function getExistingPostReadingAssessment(
  workId: string,
  userId: string,
): Promise<Record<CriterionSlug, number> | null>
```

Carregadas em paralelo em [app/catalog/[id]/page.tsx](app/catalog/[id]/page.tsx) e passadas pro work-status-form via props.

#### Validações

- Zod: cada valor `z.number().min(0).max(10)`
- Server action valida `workId` existe e tem `ai_evaluations` aceita — senão retorna erro "Sem IA pra comparar"
- Quando salvar com `source='ai_accepted_post_read'`: verificar que `userValue` realmente é igual ao `ia_value` (proteção contra source inconsistente do client)

#### Critério de fim

- Marcar uma obra como Completed → ver collapsible "Atributos da obra (pós-leitura)" aparecer
- Ajustar drama 8 → 6, clicar Salvar
- Row em `user_attribute_assessment`: `user_value=6, ia_value_at_assessment=8, source='user_edited_post_read'`
- `attribute_bias` para drama: `n=1, mean_bias_raw=-2, bias_applied≈-0.18`
- Re-abrir form: mostra valor salvo (6) como pre-fill

#### Commit

```
feat: questionário pós-leitura de atributos (Fase 1.5.2)
```

---

### Fase 1.5.3 — Pipeline (propagação em 5 pontos) (~3h)

**Pré-requisitos**: 1.5.1. **Recomendado após 1.5.2** pra haver dado real coletado.

#### Carregamento centralizado do biasMap

Em `recalculateAll` ([server/actions/calculations.ts](server/actions/calculations.ts)):

```ts
const userId = await getCurrentUserId(admin)
const biasMap = await getBiasMap(userId, admin)
// passa biasMap como parâmetro pra cada estágio
```

#### Ponto 1 — Ridge ([expected.ts:156-175](lib/calculations/expected.ts#L156))

**Antes**:
```ts
function buildNumericRow(input: ExpectedScoreInput): NumericRow {
  const row: (number | null)[] = []
  for (const slug of CRITERION_SLUGS) {
    const v = input.categoryScores[slug as CriterionSlug]
    row.push(v == null || !Number.isFinite(v) ? null : v)
  }
  row.push(input.iaEvalNormalized ?? null)
  // ...
  row.push(input.criterionFitScore ?? null)
}
```

**Depois**:
```ts
function buildNumericRow(
  input: ExpectedScoreInput,
  biasMap: AttributeBiasMap,
): NumericRow {
  const calibrated = applyBiasToCategoryScores(input.categoryScoresWithSource, biasMap)
  const row: (number | null)[] = []
  for (const slug of CRITERION_SLUGS) {
    const v = calibrated[slug as CriterionSlug]
    row.push(v == null || !Number.isFinite(v) ? null : v)
  }
  // IMPORTANTE: iaEvalNormalized e criterionFitScore precisam ser pre-calculados em cima do calibrated
  // Isso significa modificar a função que monta ExpectedScoreInput pra usar calibrated
  row.push(input.iaEvalNormalized ?? null)
  row.push(input.criterionFitScore ?? null)
}
```

**Mudanças adjacentes**:
- `ExpectedScoreInput` ganha `categoryScoresWithSource: Record<CriterionSlug, CategoryScoreWithSource>` em vez (ou junto) de `categoryScores`.
- Quem monta `iaEvalNormalized` e `criterionFitScore` precisa receber `calibrated` antes de chamar.
- Atualizar callers em `server/actions/calculations.ts` (`buildExpectedScoreInput`).

#### Ponto 2 — Personal Fit ([personal-fit.ts:97-130](lib/ai-recommendation/personal-fit.ts#L97))

```ts
// Antes
export function computePersonalFit(
  work: { categoryScores: Record<CriterionSlug, number>, tags: string[] },
  profile: TasteProfile,
): PersonalFit

// Depois
export function computePersonalFit(
  work: {
    categoryScores: Record<CriterionSlug, CategoryScoreWithSource>,
    tags: string[],
  },
  profile: TasteProfile,
  biasMap: AttributeBiasMap,
): PersonalFit {
  const calibrated = applyBiasToCategoryScores(work.categoryScores, biasMap)
  return criterionAlignment(calibrated, profile.criterion_preferences)
  // ...
}
```

#### Ponto 3 — Smart Shortlist prompt ([prompts.ts:84,177](lib/ai-recommendation/prompts.ts#L84))

```ts
// Antes — formatCategoryScores(work.categoryScores)
// Depois — formatCategoryScores(applyBiasToCategoryScores(work.categoryScoresWithSource, biasMap))
```

[server/queries/recommendations.ts:35,46](server/queries/recommendations.ts#L35) precisa carregar `source` junto:

```ts
// SELECT category_scores.value, category_scores.source FROM ...
```

#### Ponto 4 — Deep Dive prompt ([deep-dive-prompts.ts:146,177](lib/ai-recommendation/deep-dive-prompts.ts#L146))

Mesmo padrão. `buildDeepDiveUserPrompt(bundle, biasMap)` recebe biasMap; aplica antes de formatar atributos.

[server/queries/deep-dive.ts](server/queries/deep-dive.ts) carrega source e propaga no `bundle`.

#### Ponto 5 — TasteProfile prompt ([prompts.ts:119,132](lib/ai-recommendation/prompts.ts#L119))

Relevante quando modo LLM TasteProfile estiver ativo (futuro). Mesma propagação. Pode deixar com TODO inline com `applyBiasToCategoryScores` já wrapped, mas testar quando modo LLM ativar.

#### Tooltip de UI display

Em [components/titles/calculation-breakdown.tsx](components/titles/calculation-breakdown.tsx), nos valores brutos dos atributos:

```tsx
{biasMap[slug] !== 0 && (
  <Tooltip content={`IA: ${rawValue}. Corrigido para ${calibratedValue.toFixed(1)} no cálculo (bias: ${biasMap[slug] > 0 ? '+' : ''}${biasMap[slug]}).`}>
    <span className="text-muted-foreground italic">{rawValue}</span>
  </Tooltip>
)}
```

#### Testes (`tests/unit/calculations/expected.test.ts` + `personal-fit.test.ts`)

- Regressão: com `biasMap` vazio, output idêntico ao pré-1.5.3
- Com bias `drama=-1` e categoryScores.drama=8 source=ai_only: feature row carrega 9 pro drama
- Com bias `drama=-1` e source=ai_edited: feature row carrega 8 (sem correção)
- Personal Fit com bias muda fit_score conforme esperado

#### Critério de fim

- Após popular bias > 0 via 1.5.2, rodar `recalculateAll`: `expected_score` muda em ≥1 obra na direção esperada
- Inspeção manual do prompt do Smart Shortlist (via log): atributos enviados são calibrados
- Inspeção manual do prompt do Deep Dive: idem

#### Commit

```
feat: aplica bias em pipeline (Ridge + Personal Fit + 3 LLM prompts) — Fase 1.5.3
```

---

### Fase 1.5.4 — UI de calibração (~1.5h)

**Pré-requisitos**: 1.5.1.

#### Componente novo: `components/settings/calibration/attribute-bias-table.tsx`

```tsx
interface AttributeBiasTableProps {
  rows: Array<{
    attributeSlug: string
    attributeLabel: string
    nSamples: number
    meanBiasRaw: number
    biasApplied: number
    shrinkagePct: number
    stddev: number | null
  }>
}
```

Layout:
```
┌─ Bias dos Atributos (correção da IA) ──────────────────┐
│  Total de obras com pós-leitura: 12                    │
│                                                         │
│  ┌─────────────┬──────────┬───────────┬───────────┐   │
│  │ Atributo    │ IA vs Vc │ Aplicação │ Amostras  │   │
│  ├─────────────┼──────────┼───────────┼───────────┤   │
│  │ drama       │ +1.7     │ 55%       │ 12  ⓘ     │   │
│  │ romance     │ −0.3     │ 50%       │ 10        │   │
│  │ tragédia    │ +0.8     │ 54%       │ 11        │   │
│  │ ...         │ ...      │ ...       │ ...       │   │
│  └─────────────┴──────────┴───────────┴───────────┘   │
│                                                         │
│  💡 IA tende a superestimar drama em 1.7. Aplicando    │
│     55% da correção observada (com 12 amostras).        │
└─────────────────────────────────────────────────────────┘
```

#### Server query: `server/queries/attribute-bias.ts`

```ts
export async function getAttributeBiasOverview(userId: string): Promise<{
  totalAssessments: number
  rows: AttributeBiasTableProps['rows']
}>
  // Lê attribute_bias do user atual + labels de criteria table
  // Calcula shrinkagePct = (n / (n + BIAS_SHRINKAGE_K)) × 100
```

#### Integração em `/curation/settings/calibration`

Card adicional após o card do MAE existente em [app/curation/settings/calibration/page.tsx](app/curation/settings/calibration/page.tsx).

**Empty state** (todos `nSamples == 0`):
> "Bias ainda não calibrado. Marque obras como Completed/Dropped e preencha o questionário pós-leitura pra começar a coletar dados."

#### Tooltips

- Por linha: "Com {n} amostras, aplicamos {pct}% da correção observada (Bayesian shrinkage k=10)"
- No header "IA vs Vc": "Diferença média entre o que a IA avaliou e o que você respondeu pós-leitura"
- No header "Aplicação": "Percentual da correção sendo aplicada pelas previsões. Aumenta com mais amostras."

#### Critério de fim

- Card aparece em `/curation/settings/calibration` com estado correto (empty inicialmente)
- Após 1.5.2 popular dados: linhas refletem `attribute_bias`
- Coluna "Aplicação" matematicamente correta: `n / (n+10) × 100` arredondado

#### Commit

```
feat: card de bias dos atributos em /curation/settings/calibration (Fase 1.5.4)
```

---

### Fase 1.5.5 — Regeneração de artefatos derivados (~1.5h)

**Pré-requisitos**: 1.5.3.

Bias muda → artefatos pré-computados ficam stale.

#### Server action: `server/actions/calibration.ts` (estende existente)

```ts
export async function regenerateCalibratedArtifacts(): Promise<{
  ok: true
  tasteProfileRegenerated: boolean
  alignmentRowsMarkedStale: number
  worksRecalculated: number
} | { ok: false; error: string }>
```

Passos:
1. `rebuildTasteProfile(userId)` — função existente, agora usa `applyBiasToCategoryScores` internamente
2. `UPDATE calculated_scores SET alignment_stale = true WHERE alignment_score IS NOT NULL`
3. `recalculateAll()` — re-treina Ridge com bias atual

#### Componente: `components/settings/calibration/regenerate-calibrated-artifacts-button.tsx`

```tsx
export function RegenerateCalibratedArtifactsButton() {
  const [isPending, startTransition] = useTransition()
  
  return (
    <Button
      disabled={isPending}
      onClick={() => startTransition(async () => {
        const result = await regenerateCalibratedArtifacts()
        // toast com summary
      })}
    >
      {isPending ? "Regenerando…" : "Regenerar artefatos calibrados"}
    </Button>
  )
}
```

Coloca em `/curation/settings/calibration` próximo ao card de bias.

#### Auto-detection de stale em Smart Shortlist

Em [lib/ai-recommendation/llm-reranker.ts](lib/ai-recommendation/llm-reranker.ts):
- Se `calculated_scores.alignment_stale = true` pra uma obra: ignora `alignment_payload` cacheado, re-roda LLM
- Após salvar novo payload: marca `alignment_stale = false`

#### Critério de fim

- Botão funciona sem erro
- Após click: TasteProfile reflete categoryScores corrigidos
- Toast mostra summary correto
- `alignment_stale=true` se propaga: próximo Smart Shortlist pra uma obra stale re-roda

#### Commit

```
feat: regeneração de TasteProfile + stale flag em alignment após bias change (Fase 1.5.5)
```

---

### Fase 1.5.6 — `ai_edited` como fonte secundária de bias (opcional)

**Pré-requisitos**: 1.5.3, dados coletados, decisão futura.

**Quando ativar**: se após 3-6 meses cobertura de pós-leitura < 10 amostras por atributo.

#### Implementação curta

Em `lib/calculations/attribute-bias.ts`, parametrizar `computeBiasForSlug`:

```ts
export interface BiasComputeOptions {
  includeAiEdited: boolean  // default: false
  aiEditedWeight: number    // default: 0.3
}
```

Quando `includeAiEdited=true`:
- Buscar também rows de `category_scores WHERE source='ai_edited'` (precisa da `ai_evaluations.criterion_scores` pra ter o `ia_value` original)
- Contribuição com peso `aiEditedWeight`

Feature flag em `user_settings.bias_include_ai_edited` (default false).

UI label: "Bias inclui sinal pré-leitura com peso 30%".

Esforço: 1h se ativar.

#### Commit (se ativar)

```
feat: opção de incluir ai_edited como fonte secundária de bias (Fase 1.5.6)
```

---

### Fase 1.5.7 — Guards e alertas de degradação (~3h)

**Pré-requisitos**: 1.5.4.

Sistema avisa quando bias/Ridge não estão aptos a performar bem.

#### Guard 1 — Mismatch modelo/prompt

**Server query** (`server/queries/calibration-guards.ts`):

```ts
export async function checkGuard1ModelPromptMismatch(userId: string): Promise<{
  status: 'ok' | 'warn'
  biasCalibrationProfile: { model: string; promptVersion: string; pct: number }
  recentEvaluationsProfile: { model: string; promptVersion: string; pct: number }
  message: string | null
}>
```

**Lógica**:
```sql
-- Query 1: profile dominante do dado de bias
SELECT ia_model_at_assessment, ia_prompt_version, COUNT(*) AS n
FROM user_attribute_assessment
WHERE user_id = ?
GROUP BY 1, 2
ORDER BY n DESC LIMIT 1;

-- Query 2: profile recente
SELECT model_name, prompt_version, COUNT(*) AS n
FROM ai_evaluations
WHERE created_at > now() - interval '30 days'
GROUP BY 1, 2
ORDER BY n DESC LIMIT 1;
```

Se profiles diferentes (model OU promptVersion): `status='warn'`.

**Mensagem**: "Bias atual foi calibrado contra {oldModel}/{oldPrompt}. Avaliações recentes usam {newModel}/{newPrompt}. Considere re-coletar pós-leitura em obras representativas."

#### Guard 2 — Cobertura de gênero

**Server query**:

```ts
export async function checkGuard2GenreCoverage(): Promise<{
  totalWorksUnread: number
  worksWithLowCoverage: number
  pctLowCoverage: number
  examples: Array<{ workId: string; title: string; lowCoverageTags: string[] }>
  status: 'ok' | 'warn'
}>
```

**Lógica**:
- Pra cada obra com `user_score IS NULL`: top-3 tags em `tag_group='genre'`
- Pra cada tag: contar `works.user_score IS NOT NULL` que têm essa tag
- Se `min(coverage_count) < 5`: obra entra em low_coverage
- Threshold do guard: `status='warn'` se `pctLowCoverage > 15`

**Mensagem**: "{N} obras ({pct}%) com cobertura baixa de gênero. Predições nessas obras têm confiança reduzida."

#### Indicador no ranking: `components/ranking/low-coverage-indicator.tsx`

Badge ⚠ sutil ao lado de `expected_score`:

```tsx
<Tooltip content={
  `Predição com baixa confiança.\n\nTags da obra: ${tags.join(', ')}.\n` +
  lowCoverageTags.map(t => `Obras lidas com '${t}': ${count[t]} ⚠`).join('\n')
}>
  <AlertTriangle className="h-3 w-3 text-amber-500" />
</Tooltip>
```

Server query auxiliar `getLowCoverageWorks(): Promise<Set<workId>>` (cache 5min).

#### Guard 3 — Sample size baixo

Já implícito no shrinkage; tornar visível.

Em `attribute-bias-table.tsx`:
- Ícone ⚠ ao lado de atributos com `n < 10`
- Tooltip: "Apenas {n} amostras. Adicione mais avaliações pós-leitura pra aumentar confiança da correção."

Server query (computada inline):
```ts
const attrsLowConfidence = rows.filter(r => r.nSamples < 10).length
const status = attrsLowConfidence > 3 ? 'warn' : 'ok'
```

#### Guard 4 — MAE degradado

**Server query**:

```ts
export async function checkGuard4MaeDegradation(): Promise<{
  recentMae: number      // média últimas 5 medições em calibration_history
  baselineMae: number    // média 30 anteriores
  pctIncrease: number
  status: 'ok' | 'warn'
}>
```

**Lógica**: usa tabela `calibration_history` (migration 061). Pega últimas 35 linhas, divide em recent (top 5) e baseline (próximas 30). Calcula increase.

Threshold: `status='warn'` se `pctIncrease > 20`.

**Mensagem**: "MAE recente {recent.toFixed(2)} é {pct}% maior que baseline {baseline.toFixed(2)}. Possíveis causas: bias drift, mudança de modelo, perfil de obras avaliadas mudou."

Botão "Investigar causas" → expande Guards 1 e 2 inline.

#### Card centralizador: `components/settings/calibration/prediction-health-card.tsx`

```tsx
interface PredictionHealthCardProps {
  guard1: Awaited<ReturnType<typeof checkGuard1ModelPromptMismatch>>
  guard2: Awaited<ReturnType<typeof checkGuard2GenreCoverage>>
  guard3: { status: 'ok' | 'warn'; attributesWithLowConfidence: number }
  guard4: Awaited<ReturnType<typeof checkGuard4MaeDegradation>>
}
```

Layout:
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

"Geral" = `🟢` se todos `ok`, `🟡` se 1 warn, `🔴` se 2+.

Click em cada guard expande detalhes inline (sem modal).

#### Notificações sutis fora do card

- Ranking: badge ⚠ próximo a `expected_score` pra obras low-coverage (Guard 2 ativo)
- Página da obra: ícone ⚠ próximo ao botão "Avaliar IA" se Guard 1 ativo

#### Critério de fim

- Forçar cada guard manualmente:
  - Guard 1: UPDATE ai_evaluations recentes pra outro prompt_version → ver warn
  - Guard 2: criar obra com tags sem representação no training → ver badge ⚠ no ranking
  - Guard 3: ter <10 amostras em algum atributo → ver ⚠ na tabela de bias
  - Guard 4: forçar MAE alto em calibration_history → ver warn no card
- Sem regressão visual no ranking quando nenhum guard ativo

#### Commit

```
feat: guards de degradação do sistema de previsão (Fase 1.5.7)
```

---

## Estado final atualizado

| Fase | Pré-req | Esforço | Bloqueador? |
|---|---|---|---|
| 1.5.0 Naming refactor | — | 1.5h | — |
| 1.5.1 Schema + backend | 1.5.0 | **3h** | precisa pra 1.5.2 |
| 1.5.2 UI questionário | 1.5.1 | **2.5h** | precisa pra coletar dado |
| 1.5.3 Pipeline 5 pontos | 1.5.1+dado | **3h** | usa bias coletado |
| 1.5.4 UI de calibração | 1.5.1 | **1.5h** | — |
| 1.5.5 Regeneração | 1.5.3 | **1.5h** | bias ativo |
| 1.5.6 ai_edited (opc) | dados baixos | 0-1h | futuro |
| 1.5.7 Guards | 1.5.4 | **3h** | — |
| **Total** | | **15-16h** | |

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
| `ExpectedScoreInput` mudança quebra callers | Atualizar todos em commit atômico; tipos do TS pegam |
| Stale flag em `alignment_payload` cresce sem limite | Setado true→false na próxima execução do Smart Shortlist; não acumula |

---

## Verificação end-to-end

```bash
# 1. Aplicar migrations
psql ... -f supabase/migrations/073_rename_manual_score_to_user_score.sql
psql ... -f supabase/migrations/074_user_settings_current_user_id.sql
psql ... -f supabase/migrations/075_user_attribute_assessment.sql
psql ... -f supabase/migrations/076_attribute_bias.sql
psql ... -f supabase/migrations/077_calculated_scores_alignment_stale.sql

# 2. Build + tests
npm run build && npm run test

# 3. Smoke 1 — questionário e bias
# - Marcar obra como Completed
# - Abrir collapsible "Atributos da obra (pós-leitura)"
# - Ajustar drama 8 → 6, salvar
# - Verificar row em user_attribute_assessment
# - Verificar attribute_bias: drama com n=1, mean_bias_raw=-2, bias_applied≈-0.18

# 4. Smoke 2 — pipeline aplicado
# - Rodar recalculateAll
# - Verificar expected_score muda nas obras com drama alto
# - Logs do Smart Shortlist mostrando atributos corrigidos
# - Logs do Deep Dive idem

# 5. Smoke 3 — UI calibração
# - /curation/settings/calibration → card "Bias dos Atributos" com dados
# - Tooltip mostra "Aplicando 9% (1 amostra)"

# 6. Smoke 4 — regeneração
# - Click em "Regenerar artefatos calibrados"
# - Toast confirma sucesso
# - TasteProfile mudou (verificar via query)

# 7. Smoke 5 — guards
# - Guard 1: alterar prompt_version em ai_evaluations recentes → ver warn
# - Guard 2: criar obra com tags sem representação → ver badge ⚠ no ranking
# - Guard 3: forçar n<10 em algum atributo → ver ⚠ na tabela
# - Guard 4: simular MAE alto recente → ver warn no card

# 8. Validação refactor
# - grep -r "manual_score" — só em migrations
# - grep -r "manualScore" — vazio
# - UI mostra "Atributos da obra" e "Critérios de avaliação" coerentemente
```
