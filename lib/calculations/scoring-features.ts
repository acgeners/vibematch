import { CRITERION_SLUGS, type CriterionSlug } from "@/types/domain"

/**
 * As features de CRITÉRIO que entram no cálculo — Ridge/Nota Prevista, Bússola, embeddings e a
 * guarda de `expected_score`. **CONGELADA nos 9 de hoje, por decisão de produto (21/09/2026).**
 *
 * 🔴 POR QUE ELA EXISTE. `CRITERION_SLUGS` é GERADO por `sync-constants` a partir de `criteria`
 * (eval_type='IA'), e servia a dois propósitos que passaram a divergir:
 *
 *   - "o que a IA avalia e o produto mostra"  → `CRITERION_SLUGS` (11: os 9 + fantasy + nobility)
 *   - "o que entra no cálculo"                → ESTA lista (9, imutável sem decisão explícita)
 *
 * Sem essa separação, inserir uma linha em `criteria` mudaria sozinho a Nota Prevista, a Bússola,
 * os embeddings e os pesos inferidos — e, no caso de `fantasy`/`nobility`, com duas colunas que
 * durante a transição são CÓPIAS EXATAS de `fantasy_nobility` (seed `legacy_split_copy`).
 * Colinearidade perfeita num Ridge não é neutra: a penalização L2 favorece espalhar o peso entre
 * colunas idênticas, então a predição MUDA sem ninguém ter decidido nada.
 *
 * 🔴 E o pior dos efeitos é o da guarda: `server/actions/calculations.ts` exige TODOS os slugs
 * desta lista preenchidos para a obra ter `expected_score`. Se ela crescesse antes de as notas
 * existirem, as ~1.010 obras perderiam a Nota Prevista de uma vez — sem erro e sem log.
 *
 * ⚠️ NÃO derive esta lista de `CRITERION_SLUGS` por filtro: o ponto é justamente ela NÃO acompanhar
 * o banco. A conferência de coerência (todo slug daqui existe lá) é feita por teste, não aqui.
 *
 * ⚠️ Integrar `fantasy`/`nobility` ao cálculo é OUTRA decisão, fora desta fase — e a etapa 51 da
 * auditoria mediu que mexer no vetor de features não demonstrou ganho.
 */
export const SCORING_CRITERION_SLUGS = [
  "romance",
  "couple_dynamics",
  "fantasy_nobility",
  "action_adventure",
  "adult_content",
  "protagonist",
  "humor",
  "drama",
  "tragedy",
] as const satisfies readonly CriterionSlug[]

export type ScoringCriterionSlug = (typeof SCORING_CRITERION_SLUGS)[number]

/** Os critérios que a IA avalia mas que NÃO entram no cálculo (hoje: fantasy, nobility). */
export const NON_SCORING_CRITERION_SLUGS = CRITERION_SLUGS.filter(
  (slug): slug is Exclude<CriterionSlug, ScoringCriterionSlug> =>
    !(SCORING_CRITERION_SLUGS as readonly string[]).includes(slug),
)
