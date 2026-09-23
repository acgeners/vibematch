/**
 * A CONTA da deriva de `fantasy`, separada da leitura do banco para poder ser testada sozinha.
 * Ver `server/queries/fantasy-drift.ts` para o porquê da medição existir.
 */

/** O `source` que marca a cópia do legado (seed da migration 197), e não uma avaliação. */
export const LEGACY_SPLIT_COPY_SOURCE = "legacy_split_copy"

export interface FantasyDrift {
  /** Obras ativas cujo `fantasy` veio de avaliação/edição real. */
  real: number
  /** Obras ativas cujo `fantasy` ainda é o seed `legacy_split_copy`. */
  legacy: number
  /** `real / (real + legacy)`, ou `null` quando não há nenhuma das duas. */
  ratio: number | null
}

export function fantasyDriftFrom({ real, legacy }: { real: number; legacy: number }): FantasyDrift {
  const total = real + legacy
  // 🔴 `null`, nunca 0: sem obra nenhuma a razão não é "0% migrado", é "não há o que medir".
  // Zero aqui entraria na série como se a migração não tivesse andado.
  return { real, legacy, ratio: total === 0 ? null : real / total }
}
