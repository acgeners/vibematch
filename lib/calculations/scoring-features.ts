import { CRITERION_SLUGS, type CriterionSlug } from "@/types/domain"

/**
 * As features de CRITÉRIO que entram no cálculo — Ridge/Nota Prevista, Bússola, embeddings e a
 * guarda de `expected_score`. **CONGELADA em 9, por decisão de produto.**
 *
 * 🔴 POR QUE ELA EXISTE. `CRITERION_SLUGS` é GERADO por `sync-constants` a partir de `criteria`
 * (eval_type='IA'), e servia a dois propósitos que passaram a divergir:
 *
 *   - "o que a IA avalia e o produto mostra"  → `CRITERION_SLUGS` (11)
 *   - "o que entra no cálculo"                → ESTA lista (9, imutável sem decisão explícita)
 *
 * Sem essa separação, inserir uma linha em `criteria` mudaria sozinho a Nota Prevista, a Bússola,
 * os embeddings e os pesos inferidos. E o pior dos efeitos é o da guarda:
 * `server/actions/calculations.ts` exige TODOS os slugs desta lista preenchidos para a obra ter
 * `expected_score`. Se ela crescesse antes de as notas existirem, as ~1.010 obras perderiam a
 * Nota Prevista de uma vez — sem erro e sem log.
 *
 * ⚠️ NÃO derive esta lista de `CRITERION_SLUGS` por filtro: o ponto é justamente ela NÃO
 * acompanhar o banco. A conferência de coerência é feita por teste, não aqui.
 *
 * ── 🔴 O SLOT 3 CARREGA `fantasy`, E NÃO O LEGADO `fantasy_nobility` ────────────────────────
 *
 * A troca foi MEDIDA contra a nuvem (2026-09-22, harness read-only, OOF 5-fold seed 42, n≈230
 * rotuladas), e as três medições que a sustentam:
 *
 *   · **remover o slot inteiro degrada**: cvMAE 0,6812 → 0,7014 (+0,0202), top-10 7/10,
 *     top-50 41/50. O slot importa;
 *   · **trocar o CONTEÚDO do slot não tem dano demonstrável**: com as notas de hoje a troca é
 *     numericamente inerte (1.025 das 1.026 obras têm `fantasy` = cópia `legacy_split_copy` do
 *     legado), e com as 60 obras historicamente avaliadas com `fantasy` REAL o efeito é
 *     +0,008 com **z = 1,24 · p ≈ 0,10** contra o nulo por permutação (sd 0,0071) — ou seja,
 *     não distinguível de atribuir os mesmos valores a obras sorteadas;
 *   · **`setting_era` não paga um 10º slot**: sozinho no slot dá +0,0045 (z = −0,52, p = 0,26);
 *     como coluna extra ao lado de `fantasy` dá −0,0002, mas o braço de CONTROLE com RUÍDO puro
 *     na mesma coluna dá +0,0017 — a distância entre os dois (0,0018) é menor que o piso de
 *     ruído (0,0039). O que ele "recupera" não é atribuível a ele.
 *
 * ⚠️ "Não distinguível" não é "zero": o poder deste teste vê ~0,014 para cima. É por isso que
 * a deriva é INSTRUMENTADA (`fantasy_real_count` em `calibration_history`) em vez de suposta.
 *
 * ⚠️ `setting_era` e `angst` são avaliados e exibidos, mas ficam FORA daqui. `fantasy_nobility`
 * e `nobility` também — os dois deixaram de ser critérios de IA na migration 198 e o histórico
 * deles permanece no banco, intocado.
 */
export const SCORING_CRITERION_SLUGS = [
  "romance",
  "couple_dynamics",
  "fantasy",
  "action_adventure",
  "adult_content",
  "protagonist",
  "humor",
  "drama",
  "tragedy",
] as const satisfies readonly CriterionSlug[]

export type ScoringCriterionSlug = (typeof SCORING_CRITERION_SLUGS)[number]

/** Os critérios que a IA avalia mas que NÃO entram no cálculo (hoje: setting_era, angst). */
export const NON_SCORING_CRITERION_SLUGS = CRITERION_SLUGS.filter(
  (slug): slug is Exclude<CriterionSlug, ScoringCriterionSlug> =>
    !(SCORING_CRITERION_SLUGS as readonly string[]).includes(slug),
)
