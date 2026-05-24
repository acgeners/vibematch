// Limites compartilhados entre o server action e a UI do modal de confirmação.
// Mora aqui (e não no arquivo "use server") porque arquivos "use server" só
// podem exportar funções async.

/** Cap absoluto de candidatos por run — protege o gasto de tokens. */
export const MAX_CANDIDATES_HARD_LIMIT = 30
export const ALLOWED_CANDIDATE_COUNTS = [10, 20, 30] as const
export type AllowedCandidateCount = (typeof ALLOWED_CANDIDATE_COUNTS)[number]
