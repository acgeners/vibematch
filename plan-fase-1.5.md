# Plano — Fase 1.5: Bias Calibration + Refatoração Conceitual de Notas

> Aprovação prévia pendente. Não implementar nada antes de alinhamento final.

---

## Contexto

A Fase 1 (re-arquitetura 4 camadas) está operacional. O Ridge limpo (`expected_score`) treina contra `manual_score` usando as 9 notas que a IA dá pra cada obra (romance, drama, tragédia, etc.) como features.

Problema diagnosticado: a IA tem viés sistemático em alguns atributos. Sem correção, todo `expected_score` herda esse viés silenciosamente.

A Fase 1.5 introduz **bias calibration**: o usuário valida/edita as 9 notas que a IA deu pra cada obra após leitura. A diferença média (IA − user) por atributo vira a correção aplicada nas features do Ridge.

Junto com a feature, esta fase também faz uma **refatoração conceitual** de nomenclatura pra deixar o sistema mais claro e sustentável a longo prazo.

---

## Sumário das decisões alinhadas

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | UX timing | Sub-aba opcional em `work-status-form` |
| 2 | Granularidade | Todos os 9 atributos sempre, pré-preenchidos com sugestão da IA (mesmo padrão do fluxo "aceitar avaliação IA") |
| 3 | Threshold de aplicação | Bayesian shrinkage `bias × n/(n+10)` |
| 4 | Storage | Nova tabela `attribute_bias` (single ou multi-user), aplicada pre-Ridge |
| 5 | Renomeações conceituais | `manual_score → user_score`, "9 da IA" → **"Atributos da obra"**, "8 do user" → **"Critérios de avaliação"** |
| 6 | Exposição do bias | Visível em `/settings/calibration` |
| 7 | Multi-tenant | Estrutura preparada (single hoje, multi sem refactor depois) |

---

## Refatoração conceitual de naming

Modelo mental alvo (compartilhar com qualquer feature futura):

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
                │ → Geram a `user_score` (formerly manual_score)      │
                │ → Target do Ridge                                   │
                └─────────────────────────────────────────────────────┘
```

### Renomeações DB

| Antes | Depois | Observação |
|---|---|---|
| `works.manual_score` | `works.user_score` | Migration `ALTER COLUMN` |

A tabela `criteria` mantém `eval_type='IA' | 'User'` — naming interno não muda. Só labels de UI mudam.

### Renomeações de código

Find/replace cuidadoso (ordem importa — rodar do mais específico pro genérico):

| Padrão | Substituir por | Atenção |
|---|---|---|
| `manual_score` | `user_score` | DB column + ~30 referências; **NÃO** confundir com `personal_score`/`user_settings` |
| `manualScore` | `userScore` | camelCase em TS |
| `Manual Score`, `Nota Manual` | `Nota do Usuário`, `User Score` | Strings/labels |

Internal nomenclatura (mantém):
- `CRITERION_SLUGS` (que hoje representa os 9 atributos da IA) **fica como está** — refletindo a coluna `criteria.eval_type='IA'` no DB. Renomear cascataria pra centenas de pontos.
- `category_scores` table fica.

### Renomeações UI

| Onde aparece | Texto antes | Texto depois |
|---|---|---|
| Headers de seção da página da obra | "Critérios" / "Critérios da IA" | **"Atributos da obra"** |
| Tabela de notas (heatmap, columns) | "Critérios" | **"Atributos"** |
| Form pós-leitura (work-status-form) | "Critérios pós-leitura" | **"Critérios de avaliação"** |
| /preferences | mistura | distinguir "Pesos dos atributos" vs "Pesos dos critérios" |
| /settings/calibration | "Critérios" | "Atributos" (no contexto da IA) |

Arquivos centrais com strings a atualizar:
- [components/titles/calculation-breakdown.tsx](components/titles/calculation-breakdown.tsx)
- [components/titles/work-status-form.tsx](components/titles/work-status-form.tsx)
- [components/settings/score-weights-form.tsx](components/settings/score-weights-form.tsx)
- [components/settings/post-reading-weights-form.tsx](components/settings/post-reading-weights-form.tsx)
- [components/settings/calibration-panel.tsx](components/settings/calibration-panel.tsx)
- [components/ranking/ranking-table-config.ts](components/ranking/ranking-table-config.ts)
- [components/titles/work-table-config.ts](components/titles/work-table-config.ts)
- [components/ai-evaluation/ai-evaluation-review-form.tsx](components/ai-evaluation/ai-evaluation-review-form.tsx)

### Verificação pré-refatoração (a investigar)

**Pergunta aberta**: hoje `manual_score` é setada **independentemente** pelo usuário ou já é **derivada** dos 8 critérios de avaliação?

- Se **independente**: o rename é só nomenclatura. Pode haver dessincronia entre `manual_score` e a soma ponderada dos critérios.
- Se **derivada**: o rename é coerente com a frase "a nota pessoal é calculada com base nos critérios".
- Se **independente E queremos mudar pra derivada**: requer migration de dados (backfill `user_score` a partir dos critérios existentes) e remover input direto.

**Ação primeira**: grep + leitura de `server/actions/works.ts` e `work-status-form.tsx` pra confirmar o comportamento atual antes de prosseguir.

---

## Modelo de dados — questionário + bias

### Nova tabela: `user_attribute_assessment`

Captura a avaliação do usuário pós-leitura sobre os 9 atributos da obra, junto com o snapshot do que a IA disse no momento da avaliação.

```sql
CREATE TABLE user_attribute_assessment (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID,                          -- NULL = single-user/global
  work_id                 UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  attribute_slug          TEXT NOT NULL,                 -- referencia criteria.slug onde eval_type='IA'
  user_value              NUMERIC(3,1) NOT NULL CHECK (user_value BETWEEN 0 AND 10),
  source                  TEXT NOT NULL CHECK (source IN ('ai_accepted_post_read','user_edited_post_read')),
  ia_value_at_assessment  NUMERIC(3,1) NOT NULL,         -- snapshot da IA no momento da avaliação
  ia_evaluation_id        UUID REFERENCES ai_evaluations(id), -- pra auditoria
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_id, attribute_slug)
);

CREATE INDEX idx_user_attr_work ON user_attribute_assessment(work_id);
CREATE INDEX idx_user_attr_slug ON user_attribute_assessment(attribute_slug);

ALTER TABLE user_attribute_assessment ENABLE ROW LEVEL SECURITY;
```

Por que `ia_value_at_assessment`:
- Se a IA reavaliar a obra futuramente (mudar de prompt/modelo), o bias coletado **não regride**. Fica representando a diferença real percebida pelo usuário no momento.
- Permite auditoria: "essa amostra de bias compara user=8 vs IA=6 — IA estava na v15 do prompt".

### Nova tabela: `attribute_bias`

Estado computado do bias por atributo (recalculado a cada novo assessment).

```sql
CREATE TABLE attribute_bias (
  user_id          UUID,                       -- NULL = global
  attribute_slug   TEXT NOT NULL,
  n_samples        INTEGER NOT NULL DEFAULT 0,
  mean_bias_raw    NUMERIC(4,2) NOT NULL DEFAULT 0,  -- avg(user_value - ia_value_at_assessment)
  bias_applied     NUMERIC(4,2) NOT NULL DEFAULT 0,  -- mean_bias_raw × n/(n+10)
  last_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, attribute_slug)
);

-- Note: PK composta com user_id NULL precisa de tratamento. Postgres trata NULL como
-- não-igual; sugiro usar COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
-- ou simplesmente uma constraint UNIQUE parcial. Avaliar na migration.
```

### Pipeline de bias

```
1. User completa post-questionário pra obra X
   └─→ INSERT/UPDATE em user_attribute_assessment (9 rows, uma por atributo)

2. Trigger ou server action recompute_attribute_bias(user_id?)
   ├─→ Para cada attribute_slug:
   │     SELECT
   │       count(*) as n,
   │       avg(user_value - ia_value_at_assessment) as mean_raw
   │     FROM user_attribute_assessment
   │     WHERE attribute_slug = ? AND (user_id IS NOT DISTINCT FROM ?)
   │
   ├─→ Computa bias_applied = mean_raw × n / (n + 10)
   │
   └─→ UPSERT em attribute_bias

3. Próximo recalculateAll():
   └─→ expected.ts: pra cada feature de atributo, corrected = ia_value - bias_applied[slug]
       Ridge treina e prediz em cima do sinal corrigido
```

### Onde aplicar — pre-Ridge vs post-Ridge

**Decisão: pre-Ridge** (modificar `lib/calculations/expected.ts`).

```ts
// Antes
const features = [
  scores.romance ?? 0,
  scores.drama ?? 0,
  // ...
]

// Depois
const features = [
  (scores.romance ?? 0) - (bias.romance ?? 0),
  (scores.drama ?? 0) - (bias.drama ?? 0),
  // ...
]
```

Vantagens vs post-Ridge:
- Ridge re-aprende coeficientes em cima do sinal corrigido (mais "real"). Post-Ridge seria patch numérico em cima de coeficientes treinados em sinal viesado.
- Snapshot persistido em `calculated_scores.expected_baseline` reflete fielmente o cálculo final.

---

## UX do questionário pós-leitura

### Quando aparece

Aba opcional em [work-status-form.tsx](components/titles/work-status-form.tsx) — visível quando `personal_status ∈ {Completed, Dropped, On-hold, Stalled, Hiatus}` (qualquer status terminal ou pausa longa).

Não força — visível mas opt-in. Se o user não preencher, nada quebra; o bias só não recebe input dessa obra.

### Como preencher

UI espelhando o fluxo de **aceitação de avaliação IA** existente ([ai-evaluation-review-form.tsx](components/ai-evaluation/ai-evaluation-review-form.tsx)):

```
┌─ Atributos da obra (pós-leitura) ────────────────────┐
│                                                       │
│  IA sugeriu / Você ajusta                             │
│                                                       │
│  romance        [ 8.0 ]  ← editável                   │
│  drama          [ 7.5 ]                               │
│  tragédia       [ 5.0 ]                               │
│  ação           [ 3.0 ]                               │
│  humor          [ 6.0 ]                               │
│  adult content  [ 2.0 ]                               │
│  couple dyn.    [ 7.0 ]                               │
│  complexidade   [ 6.5 ]                               │
│  qual. técnica  [ 8.0 ]                               │
│                                                       │
│  [ Aceitar tudo ]  [ Salvar ]                         │
└───────────────────────────────────────────────────────┘
```

Por atributo:
- Pré-preenchido com `ia_value` da última avaliação aceita (`ai_accepted` ou `ai_edited` em `category_scores`).
- User pode editar individualmente (slider/number 0-10).
- `source = "ai_accepted_post_read"` se valor final == ia_value, senão `"user_edited_post_read"`.

### Tratamento de fontes existentes

Se a obra **nunca foi avaliada pela IA**, o questionário não aparece (ou aparece em branco e disabled com tooltip "Rode a avaliação IA primeiro"). Sem `ia_value`, não há como computar bias.

### Salvar

Server action `submitPostReadingAttributes(workId, values)`:
1. UPSERT 9 rows em `user_attribute_assessment` (idempotente).
2. Trigger background: `recomputeAttributeBias()` (pode rodar inline; é leve).
3. Trigger background: `recalculateWork(workId)` pra refletir o bias atualizado no `expected_score` da obra.

---

## UI de calibração de bias

Em [`/settings/calibration`](app/settings/calibration/page.tsx), novo card "Bias dos Atributos":

```
┌─ Bias dos Atributos (correção da IA) ─────────────────┐
│                                                        │
│  N total de obras avaliadas: 12                        │
│                                                        │
│  Atributo         IA vs User    Aplicação    n samples │
│  ────────────    ──────────    ──────────   ───────── │
│  romance          +0.5          55%          12        │
│  drama            +1.2          55%          12        │
│  tragédia         -0.8          54%          11        │
│  ação             +0.1          55%          12        │
│  humor            -0.3          50%          10        │
│  adult content    +2.1          54%          11        │
│  couple dyn.      +0.4          50%          10        │
│  complexidade     -0.2          55%          12        │
│  qual. técnica    +0.1          55%          12        │
│                                                        │
│  [gráfico de barras com bias signed]                   │
│                                                        │
│  💡 IA tende a superestimar 'adult content' em +2.1.   │
│     Aplicando 54% da correção observada.               │
└────────────────────────────────────────────────────────┘
```

Tooltip por linha explicando shrinkage: "Com 12 amostras, aplicamos 55% da correção observada (~Bayesian)".

Componente novo: `components/settings/calibration/attribute-bias-table.tsx`.

---

## Implementação em fases

Cada fase é commitável separadamente. Pode parar entre fases sem regressão.

### Fase 1.5.0 — Investigação e refatoração de naming (~2-3h)

**Pré-requisitos**: nada.

1. Grep `manual_score` em todo o repo, listar todos os pontos (esperado: ~30 refs).
2. Investigar: `manual_score` é derivada dos 8 critérios ou independente?
   - Ler `work-status-form.tsx`, `server/actions/works.ts`, `lib/calculations/score.ts`.
   - Decidir se Fase 1.5.0 já promove derivação ou só rename.
3. Migration: `ALTER TABLE works RENAME COLUMN manual_score TO user_score;` + atualizar views/RPCs dependentes.
4. Find/replace `manual_score → user_score`, `manualScore → userScore` no código.
5. Atualizar labels de UI nos componentes listados acima.
6. `npm run build` + `npm run test` — sem erros.
7. Commit: `refactor: rename manual_score → user_score + clarifica naming (Atributos / Critérios)`

**Critério de fim**: build ok, testes passam, UI mostra novos labels coerentes.

### Fase 1.5.1 — Schema + backend de assessment (~2h)

**Pré-requisitos**: Fase 1.5.0.

1. Migration `073_user_attribute_assessment.sql` + `074_attribute_bias.sql`.
2. `lib/calculations/attribute-bias.ts`:
   - `computeBiasForSlug(slug, userId?)` — query + shrinkage.
   - `recomputeAttributeBias(userId?)` — recalc all 9 slugs.
   - `getBiasMap(userId?)` — retorna `{slug: bias_applied}` pra uso no expected.ts.
3. `server/actions/post-reading-attributes.ts`:
   - `submitPostReadingAttributes(workId, values)` — UPSERT + recompute + recalculateWork.
4. Testes unitários da função de shrinkage.
5. Commit: `feat: schema e backend de bias calibration (Fase 1.5)`

**Critério de fim**: posso popular `user_attribute_assessment` via SQL manual e ver `attribute_bias` recalculado.

### Fase 1.5.2 — UI do questionário (~2h)

**Pré-requisitos**: Fase 1.5.1.

1. Novo componente `components/titles/post-attribute-assessment-form.tsx`:
   - Pre-fill com `ia_value` da última `ai_evaluations` aceita.
   - Sliders/inputs 0-10 por atributo.
   - Detecta `source` (`ai_accepted_post_read` se intocado, `user_edited_post_read` se mudou).
   - "Aceitar tudo" pulando edição.
2. Integrar como sub-aba opcional em `work-status-form.tsx` (visível em status terminais).
3. Mensagem amigável quando obra não tem AI evaluation ainda.
4. Commit: `feat: questionário pós-leitura de atributos (Fase 1.5)`

**Critério de fim**: consigo marcar uma obra como Completed, abrir a aba, ajustar drama de 8→6, salvar, e ver row em `user_attribute_assessment`.

### Fase 1.5.3 — Aplicação do bias no pipeline (~1h)

**Pré-requisitos**: Fase 1.5.1 (não precisa de UI).

1. Modificar `lib/calculations/expected.ts`:
   - Carregar `bias_map` no início do `recalculateAll`.
   - Aplicar `corrected_attribute = ia_value - bias_applied[slug]` nas features do Ridge.
2. Snapshot do bias usado em cada predição? Opcional — pode salvar `bias_snapshot` em `calculated_scores` pra auditoria.
3. Testes: validar shrinkage formula com mocks.
4. Commit: `feat: aplica bias dos atributos pre-Ridge no expected_score (Fase 1.5)`

**Critério de fim**: após popular bias > 0, rodar `recalculateAll` muda `expected_score` na direção esperada.

### Fase 1.5.4 — UI de calibração (~1h)

**Pré-requisitos**: Fase 1.5.1 (precisa de dados pra mostrar).

1. Componente `components/settings/calibration/attribute-bias-table.tsx`.
2. Server query `getAttributeBias(userId?)` retornando linhas com `n_samples`, `mean_bias_raw`, `bias_applied`, `shrinkage_pct`.
3. Adicionar card em `/settings/calibration` page.
4. Tooltip explicando shrinkage.
5. Commit: `feat: tabela de bias dos atributos em /settings/calibration (Fase 1.5)`

**Critério de fim**: card mostra dados reais, valor "Aplicação" bate com formula.

---

## Decisões abertas restantes

1. **`manual_score` é derivada ou independente?** Investigação na Fase 1.5.0 vai responder. Mudança de comportamento (independente→derivada) precisa decisão extra.
2. **Trigger de recompute do bias**: inline na server action ou job background? Por enquanto: inline (é leve, ~9 queries simples).
3. **Versionamento do bias**: o `mean_bias_raw` muda a cada submit. Devemos guardar histórico (snapshot diário) pra ver evolução? Sugestão: começar sem, adicionar se precisar.
4. **Critérios de avaliação no escopo**: por hora, Fase 1.5 toca SÓ os 9 atributos. Os 8 critérios de avaliação ficam intocados (já são user-only, não precisam de bias). Validar.
5. **Treatment de `user_value` no shrinkage**: se user editou manualmente (`source='user_edited_post_read'`), peso maior? Hoje conta igual `ai_accepted_post_read`. Aceito por simplicidade — pode revisitar.

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Refactor `manual_score → user_score` quebra refs ocultas (RPCs, views) | Rodar `npm run build` + `npm run test` + grep raw `manual_score` antes de commitar |
| Bias degenera previsões se houver poucas amostras | Shrinkage k=10 atenua. Hard floor: zero amostras = zero correção |
| Usuário preenche 1-2 questionários e abandona | Sem ele, bias fica em 0. Sistema funciona como antes da Fase 1.5 |
| `ia_value_at_assessment` divergente do `ia_value` atual confunde análise | Snapshot é por design — protege bias histórico de mudanças de prompt |
| Re-rename de variáveis em volume causa typo | Find/replace em 2-3 passes com diff review |

---

## Verificação end-to-end

```bash
# 1. Aplicar migrations
psql ... -f supabase/migrations/073_user_attribute_assessment.sql
psql ... -f supabase/migrations/074_attribute_bias.sql

# 2. Build + tests
npm run build && npm run test

# 3. Smoke manual
# - Abrir uma obra com Completed
# - Ir pra aba "Atributos da obra (pós-leitura)" no work-status-form
# - Ajustar drama de 8 → 6, salvar
# - Verificar row em user_attribute_assessment
# - Recompute manual: rodar recomputeAttributeBias
# - Conferir attribute_bias: drama deve ter mean_bias_raw = -2, bias_applied = -2/(1+10) ≈ -0.18
# - Rodar recalculateAll
# - Conferir que expected_score de obras com drama alto muda (geralmente sobe se bias for negativo)
# - Abrir /settings/calibration → card de Bias dos Atributos mostra dados

# 4. Validar refatoração
# - grep -r "manual_score" — não deve achar nada em código não-migration
# - grep -r "manualScore" — não deve achar nada
# - UI: labels mostram "Atributos da obra" e "Critérios de avaliação" coerentemente
```

---

## Estimativa total

| Fase | Esforço | Bloqueador? |
|---|---|---|
| 1.5.0 — Naming refactor | 2-3h | — |
| 1.5.1 — Schema + backend bias | 2h | 1.5.0 |
| 1.5.2 — UI questionário | 2h | 1.5.1 |
| 1.5.3 — Pipeline aplicado | 1h | 1.5.1 |
| 1.5.4 — UI de calibração | 1h | 1.5.1 |
| **Total** | **8-9h** | |

Distribuído em 3-4 sessões. Pode parar após 1.5.0 + 1.5.1 + 1.5.3 (sem UI) e ainda ter bias funcional via SQL manual.
