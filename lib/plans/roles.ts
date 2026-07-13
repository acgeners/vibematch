// ============================================================
// Papéis de usuário — fonte única de verdade do acesso
// ============================================================
// Substitui o par de flags ortogonais (`user_plan` × `is_admin`) por uma ESCADA.
// Motivo: o produto é uma escada (curador ⊃ assinante ⊃ leitor), e modelar escada
// com flags independentes cria estados sem sentido — foi assim que `reactivatePlan()`
// virou self-upgrade e `updateScoreWeights` (config GLOBAL) passou por "dado pessoal".
//
// Regra de ouro: o papel responde "o que ele pode ESCREVER". O que ele pode LER é o
// catálogo inteiro, em qualquer papel (inclusive anônimo).

export type Role = "curador" | "assinante" | "leitor"

/** Ordem da escada. Comparar por rank, nunca por igualdade de string. */
const ROLE_RANK: Record<Role, number> = {
  leitor: 0,
  assinante: 1,
  curador: 2,
}

export const ROLE_LABELS: Record<Role, string> = {
  curador: "Curador",
  assinante: "Assinante",
  leitor: "Leitor",
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  curador: "Cura o catálogo: cria, edita, apaga, configura e roda a IA de curadoria.",
  assinante: "Assinatura mensal: IA de recomendação inclusa e mantém as obras atualizadas.",
  leitor: "Lê o catálogo inteiro. A IA de recomendação é comprada por crédito.",
}

export function isRole(value: unknown): value is Role {
  return value === "curador" || value === "assinante" || value === "leitor"
}

/** True quando `role` está em `min` ou acima na escada. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

// ── Permissões, nomeadas por VERBO ──────────────────────────────────────────
//
// A distinção que não existia antes: ATUALIZAR ≠ EDITAR.
//   atualizar → re-hidrata a obra das fontes externas, SEM escolha humana (vale o
//               merge automático). É o que o assinante paga: dado fresco.
//   editar    → digita/escolhe o conteúdo (capa, sinopse, conflito, notas). Decide
//               PELOS OUTROS, porque `works` é compartilhada (não tem user_id).
//
// Sem essa separação, "deixar o assinante atualizar" equivaleria a deixá-lo trocar a
// capa boa por uma ruim na obra que o curador curou — e não há como desfazer por
// usuário enquanto a Fase 2 (partição per-user) não existir.

export const PERMISSIONS = {
  /** Re-hidratar obra das fontes externas (merge automático, sem escolha). */
  refresh_work: "assinante",
  /** IA de consumo: recomendar, chat, deep dive, perfil de gosto. */
  consume_ai: "assinante",
  /** Criar/editar/apagar obra, escolher capa/sinopse/conflito. */
  curate_work: "curador",
  /** IA que ESCREVE no catálogo: avaliar, digest, consolidar sinopse, inferir tags. */
  curate_ai: "curador",
  /** Config global: pesos, cores, fórmula, constantes, saldo, planos. */
  global_config: "curador",
} as const satisfies Record<string, Role>

export type Permission = keyof typeof PERMISSIONS

/**
 * True se o papel libera a permissão.
 *
 * NOTA sobre `consume_ai`: o LEITOR também a destrava comprando crédito — mas isso
 * NÃO é papel, é saldo, e mora fora daqui. Enquanto não houver mecanismo de DÉBITO,
 * crédito não libera nada (senão "saldo > 0" viraria LLM infinito de graça).
 */
export function roleAllows(role: Role, permission: Permission): boolean {
  return roleAtLeast(role, PERMISSIONS[permission])
}

/** Mensagem de bloqueio — diz o que falta, não só que negou. */
export function deniedMessage(permission: Permission): string {
  const needed = PERMISSIONS[permission]
  if (needed === "curador") {
    return "Só o Curador do catálogo pode fazer isso."
  }
  return `Recurso do plano ${ROLE_LABELS[needed]}.`
}
