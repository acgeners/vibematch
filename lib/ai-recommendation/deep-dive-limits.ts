// Constantes do Deep Dive — separadas do server action porque
// "use server" files só podem exportar async functions.

/** Cap diário compartilhado entre todos os usuários (rate-limit global). */
export const MAX_DEEP_DIVES_PER_DAY = 10

/** Cap de itens listados no histórico do drawer. */
export const DEEP_DIVE_HISTORY_LIMIT = 10
