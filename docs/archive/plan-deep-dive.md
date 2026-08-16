# Plano — Sub-fase 2.3.C: Deep Dive

> Próximo capítulo da Fase 2 da re-arquitetura. Adiciona análise profunda
> de UMA obra via Claude com extended thinking — substitui a necessidade
> de re-rank batch quando o user já sabe qual obra está avaliando.

---

## Contexto

Smart Shortlist (2.3.A, entregue) re-rankeia TOP-K candidatos com payload
enriquecido (confidence, risks, similar_loved/avoided, review_quotes,
mood_fit). É útil pra "quais obras devo considerar?".

Deep Dive responde uma pergunta diferente: **"essa obra específica vale meu
tempo agora?"**. Casos:
- User está entre 2-3 obras pra começar — quer análise comparativa profunda.
- User descobriu obra nova fora do ranking e quer parecer detalhado antes de
  investir tempo lendo.
- User quer entender por que uma recomendação tem alignment alto/baixo —
  além da justificativa de 1-2 frases do shortlist.

Por que vale separar do Shortlist:
- Custo: Deep Dive é ~$0.21/call (com extended thinking 8K). Shortlist
  é ~$0.08/call pra 30 candidatos. Não dá pra rodar Deep Dive em massa.
- Profundidade: aceita reviews completas (10× 200 palavras), histórico de
  obras similares com observações pessoais, comparação narrativa.
- Output estruturado mais rico: alignment_breakdown, review_synthesis,
  read_recommendation com alternativa sugerida.

---

## Arquitetura

```
User clica "Deep Dive" em /catalog/[id]
   │
   ▼
[server action] deepDiveWork(workId, userContext?)
   │
   ├─→ Carrega: profile, work completo (synopsis+tags+scores+platform+reviews),
   │           top-5 obras similares na biblioteca (manual_score ≥ 7 ordenado por
   │           similaridade — usa kNN existente), top-3 evitadas (manual_score ≤ 5
   │           com tags overlap), recent activity (últimas 5 mudanças em
   │           manual_score/preferences pra contexto)
   │
   ├─→ rate-limit: MAX_DEEP_DIVES_PER_DAY (configurável, default 10)
   │
   ▼
[LLM] Claude Sonnet 4.6 com extended thinking
   │   budget_tokens: 8000
   │   max_tokens: 5000 (output estruturado + thinking visível)
   │   temperature: 1.0 (obrigatório com thinking)
   │   tool: submit_deep_analysis (structured)
   │   system: DEEP_DIVE_SYSTEM_PROMPT (cached ephemeral)
   │
   ▼
[parse] Zod schema valida payload, valida work_ids referenciados
   │
   ▼
[persistir] tabela `deep_dive_results`:
   - id (uuid)
   - work_id (fk → works)
   - user_context (text | null)
   - payload (jsonb)  # alignment_breakdown, review_synthesis, etc
   - input_tokens, output_tokens, cache_*, thinking_tokens
   - ai_api_call_id
   - created_at
   │
   ▼
[UI] revalidatePath(`/catalog/{workId}`)
     Modal/Drawer renderiza payload
```

---

## Custo de tokens — estimativa detalhada

**Modelo**: `claude-sonnet-4-6` com extended thinking.

| Componente | Tokens | Cache? | Custo unit. |
|---|---|---|---|
| System prompt (DEEP_DIVE_SYSTEM_PROMPT) | ~3.500 | ✓ ephemeral 5min | $0.013/escrita, $0.001/leitura |
| TasteProfile completo + recent activity | ~3.500 | ✓ ephemeral | $0.013/escrita, $0.001/leitura |
| Work bundle (sinopse + tags + scores + 10 reviews + platform) | ~10.000 | ✗ | $0.030 |
| Similar works na biblioteca (5 amadas + 3 evitadas, summary cada) | ~2.000 | ✗ | $0.006 |
| Extended thinking budget | 8.000 | ✗ | $0.120 |
| Output (estruturado + thinking visível) | ~3.000 | ✗ | $0.045 |
| **TOTAL primeira call/dia** | ~30K input + 11K output | | **~$0.235** |
| **TOTAL com cache hit** (mesmo profile do dia) | | | **~$0.208** |

**Cenários de uso mensal**:
- Casual (3 deep dives): **$0.62/mês**
- Ativo (10 deep dives): **$2.08/mês**
- Heavy (30 deep dives): **$6.24/mês**

**Alavancas pra reduzir custo se precisar**:
- Reduzir thinking budget de 8K → 4K (~−$0.06/call)
- Limitar reviews de 10 → 5 (~−$0.015/call)
- Hard cap diário (já planejado: `MAX_DEEP_DIVES_PER_DAY = 10`)

---

## Schema do tool — `submit_deep_analysis`

```ts
{
  // Score absoluto e meta
  match_score: number,           // 0..100
  confidence: number,             // 0..1
  one_liner: string,              // 1 frase resumo (≤ 100 chars)

  // Breakdown estruturado da análise
  alignment_breakdown: {
    tags_pros: Array<{ tag: string, impact: number /* 0..1 */, why: string }>,
    tags_cons: Array<{ tag: string, impact: number, why: string }>,
    criteria_pros: Array<{
      criterion: string,           // 1 dos 9 slugs ou 1 dos 8 post_*
      score: number,
      ideal_range: [number, number],
      why: string
    }>,
    criteria_cons: Array<{
      criterion: string,
      score: number,
      ideal_range: [number, number],
      why: string
    }>,
    narrative_match: Array<{
      pattern: string,             // narrative_pattern do TasteProfile
      evidence: string             // como esta obra encarna o pattern
    }>
  },

  // Comparação com biblioteca
  similar_in_library: Array<{
    work_id: string,
    similarity_reason: string,     // 1 frase: por que é similar
    user_score: number,            // manual_score do user
    alignment_signal: "positive" | "negative" | "neutral"
                                    // se user ama → positivo, evita → negativo
  }>,

  // Síntese das reviews
  review_synthesis: {
    consensus: string,             // o que reviews concordam
    divergence: string,            // onde discordam (qualidade pacing, ending, etc)
    flags: string[]                // 1-3 alertas (pacing ruim, ending fraco...)
  },

  // Mood — opcional, só quando userContext foi enviado
  mood_match: { fit: number /* 0..1 */, why: string } | null,

  // Recomendação acionável
  read_recommendation: {
    when: "agora" | "guardar" | "evitar",
    reasoning: string,             // por que essa decisão
    suggested_alternative_id?: string  // se "evitar", sugere outra
                                       // obra do top-K do shortlist atual
  }
}
```

---

## Arquivos a criar / modificar

### Novos arquivos

| Arquivo | Propósito |
|---|---|
| `lib/ai-recommendation/deep-dive.ts` | Service core (espelha llm-reranker.ts): tool definition, chamada com extended thinking, parse |
| `lib/ai-recommendation/deep-dive-prompts.ts` | DEEP_DIVE_SYSTEM_PROMPT + buildDeepDiveUserPrompt() |
| `lib/ai-recommendation/deep-dive-schema.ts` | Zod schema do payload |
| `server/actions/deep-dive.ts` | Server action `deepDiveWork(workId, userContext?)` |
| `server/queries/deep-dive.ts` | Helpers: `getSimilarLovedInLibrary`, `getSimilarAvoidedInLibrary`, `getRecentActivity` |
| `components/titles/deep-dive-button.tsx` | Botão CTA na página da obra |
| `components/titles/deep-dive-drawer.tsx` | Drawer/Modal renderizando o payload (waterfall + sections) |
| `supabase/migrations/071_deep_dive_results.sql` | Nova tabela |

### Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `app/catalog/[id]/page.tsx` | Adicionar `<DeepDiveButton workId={work.id} />` e carregar último deep dive existente |
| `lib/ai-recommendation/types.ts` | Tipos `DeepDiveResult`, `DeepDivePayload` |
| `types/domain.ts` | (opcional) Re-export do `DeepDiveResult` |

---

## Migração de DB

```sql
-- 071_deep_dive_results.sql
CREATE TABLE deep_dive_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id       UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  user_context  TEXT,
  payload       JSONB NOT NULL,
  match_score   NUMERIC(5,2),         -- duplicado do payload pra index/query
  confidence    NUMERIC(3,2),
  read_when     TEXT CHECK (read_when IN ('agora','guardar','evitar')),
  model_name    TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  thinking_tokens INTEGER,
  ai_api_call_id UUID REFERENCES ai_api_calls(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deep_dive_work_created ON deep_dive_results(work_id, created_at DESC);
CREATE INDEX idx_deep_dive_created ON deep_dive_results(created_at DESC);  -- pra rate-limit por dia

ALTER TABLE deep_dive_results ENABLE ROW LEVEL SECURITY;
```

**Por que tabela nova (vs JSONB em calculated_scores)**:
- Permite múltiplos deep dives por obra (cada um com mood diferente — histórico útil)
- Payload é grande (~5-10KB cada); evita inchar calculated_scores que é hot path
- Permite query "deep dives recentes" pra dashboard

---

## UI — Design

### Botão CTA em `/catalog/[id]`

Posicionamento: header da página, ao lado do botão "Avaliar IA" ou
abaixo do `expected_score`. Visual: secondary button com ícone Sparkles.

```tsx
<DeepDiveButton workId={work.id}>
  <Sparkles className="h-4 w-4" />
  Consultor IA — Deep Dive
  {lastDive && <Badge>última: {timeAgo(lastDive.created_at)}</Badge>}
</DeepDiveButton>
```

Quando clicado: abre drawer com input opcional de mood + botão "Analisar".
Custo estimado (~$0.21) mostrado discretamente em texto pequeno.

### Drawer de resultado

Sections (collapsible, padrão expandido na primeira aberta):

1. **Header** — `match_score` (badge grande) + `confidence` + `one_liner`
2. **Recomendação** — Card destacado com `read_when` (verde/âmbar/vermelho), `reasoning`, e botão "Ver alternativa" quando `suggested_alternative_id`
3. **Por que faz/não faz sentido** — `alignment_breakdown`:
   - Tags pros/cons em duas colunas
   - Critérios pros/cons em duas colunas
   - Narrative patterns: lista com evidence
4. **Comparado a obras suas** — `similar_in_library`:
   - 3-5 cards com cover + título + sua nota + similarity_reason
   - Cor de borda: verde (positive), vermelho (negative), cinza (neutral)
5. **Reviews dizem** — `review_synthesis`:
   - Consensus (parágrafo)
   - Divergence (parágrafo)
   - Flags (badges vermelhas)
6. **Mood fit** — só se houver `mood_match`: barra + why
7. **Histórico** — quando houver deep dives anteriores: lista colapsável

Footer: tokens gastos + custo da call (transparência) + botão "Fazer novo"
(re-roda com mesmo workId, mood opcional novo).

---

## Implementação faseada

**Iteração 1** (~2h) — Backend core
- `deep-dive-schema.ts` + `deep-dive-prompts.ts` + `deep-dive.ts`
- Migration 071
- Server action `deepDiveWork` com rate-limit
- Testes unitários do parse (mock LLM response)

**Iteração 2** (~2h) — UI básica
- Botão + drawer simples mostrando JSON formatado
- Loading state + error handling
- Validar end-to-end com 1 obra

**Iteração 3** (~1-2h) — UI rica
- Sections estruturadas (header, breakdown, similars, reviews, recommendation)
- Histórico de deep dives
- Polish visual + animações de loading

**Critério de fim**: feedback positivo em 3-5 deep dives reais (validar que
output cobre os casos esperados — confidence calibrado, similars úteis,
recommendation acionável).

---

## Decisões abertas (resolver antes de implementar)

1. **Onde colocar o botão**: header de `/catalog/[id]` ou inline com `expected_score`?
2. **Modal vs drawer vs página dedicada**: drawer parece melhor (não bloqueia leitura
   do resto da página), mas modal pode ser mais imersivo. Página dedicada (`/catalog/[id]/deep-dive`)
   permite link direto.
3. **Histórico de dives**: cap em quantos guardar? (proposta: últimos 10 por obra)
4. **Re-uso entre Deep Dive e Smart Shortlist**: quando user pede shortlist após
   ter um deep dive recente, podemos sugerir "use o deep dive em vez de re-rankear"?
5. **kNN pra similar_in_library**: usar embeddings (já existe `knn-neighbors` RPC)
   ou só tag overlap (mais barato, menos preciso)?
6. **`suggested_alternative_id`**: como o modelo escolhe? Precisa receber lista de
   candidatos próximos? Ou só sugere obras que aparecem em `similar_loved`?
7. **Extended thinking obrigatório?**: dá pra rodar sem thinking pra economizar
   (~$0.12 a menos)? Vale testar A/B antes de decidir.
8. **Rate-limit por usuário (futuro)**: hoje é global (MAX_RUNS_PER_DAY no
   recommendations.ts). Quando vier plano Pago, isolar por user.

---

## Verificação end-to-end

```bash
# 1. Aplicar migration
psql ... -f supabase/migrations/071_deep_dive_results.sql

# 2. Rodar testes unitários
npx vitest run tests/unit/ai-recommendation/deep-dive.test.ts

# 3. Smoke test manual
# - Abrir /catalog/<id-de-obra-lida>
# - Clicar "Consultor IA — Deep Dive"
# - Preencher mood: "quero algo curto pra fim de semana"
# - Confirmar análise gerada (15-30s)
# - Verificar todos os campos do payload exibidos no drawer

# 4. Validar custo
# - Conferir registro em ai_api_calls (input_tokens + output_tokens + cost)
# - Comparar com estimativa: $0.20-0.25

# 5. Testar rate-limit
# - Rodar 11 deep dives → 11º deve falhar com erro de cap diário
```

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Extended thinking ocupando muito output | Cap `max_tokens=5000`; se cortar, retry sem thinking |
| Schema parse falhar (modelo omite campo obrigatório) | Zod com defaults + retry com `temperature=0` no segundo attempt (igual shortlist) |
| Custo explodir (user clica muitas vezes) | `MAX_DEEP_DIVES_PER_DAY=10` hard cap + warning visual ao 8º/dia |
| Modelo inventar `work_id` em similar_in_library | Filtrar payload contra Set dos IDs enviados; descartar inválidos |
| Latência muito alta (30-60s pode frustrar) | Loading state com fase atual ("Buscando reviews… Analisando…") |

---

## Estimativa total

**Esforço**: ~5h de código + 1-2h de polish/teste = **6-7h totais**.

Distribuído em 2-3 sessões: backend (Iteração 1), UI básica (Iteração 2),
UI rica + polish (Iteração 3).
