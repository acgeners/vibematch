/**
 * Os chips da tela de gostos do onboarding — decisão travada em 2026-07-31, medida no
 * catálogo (ver mockup "Onboarding & Guia", painel Estado). Constantes compartilhadas
 * entre a UI (renderiza os rótulos) e a action (resolve tag ids e grava).
 *
 * - `genre`: nome na tabela `genres` — alimenta o AMOSTRADOR do deck (work_genres).
 * - `tag`: nome na tabela `tags` — vira `user_tag_preferences` (stance love). Quatro
 *   gêneros NÃO têm tag equivalente (Ação, Mistério, Tragédia, Slice of Life): entram
 *   no deck normalmente e ficam de fora das preferências de tag — sem inventar tag.
 * - Vetos: cada chip mapeia pra um CONJUNTO de tags reais (stance avoid).
 *   "Obra inacabada" (decidido como filtro de status de publicação) fica FORA desta
 *   leva: persistir sem nada que consuma seria dado morto — entra junto com o filtro.
 */

export interface LovedChip {
  label: string
  genre: string
  tag: string | null
}

export const LOVED_CHIPS: LovedChip[] = [
  { label: "Romance", genre: "Romance", tag: "Romance" },
  { label: "Fantasia", genre: "Fantasy", tag: "Fantasy" },
  { label: "Drama", genre: "Drama", tag: "Drama" },
  { label: "Josei", genre: "Josei", tag: "Josei" },
  { label: "Shoujo", genre: "Shoujo", tag: "Shoujo" },
  { label: "Comédia", genre: "Comedy", tag: "Comedy" },
  { label: "Ação", genre: "Action", tag: null },
  { label: "Mistério", genre: "Mystery", tag: null },
  { label: "Aventura", genre: "Adventure", tag: "Adventure" },
  { label: "Tragédia", genre: "Tragedy", tag: null },
  { label: "Slice of Life", genre: "Slice Of Life", tag: null },
  { label: "Sci-Fi", genre: "Sci-Fi", tag: "Sci-Fi" },
]

export interface VetoChip {
  label: string
  tags: string[]
}

export const VETO_CHIPS: VetoChip[] = [
  { label: "Isekai", tags: ["Isekai"] },
  { label: "Abuso", tags: ["Physical Abuse", "Psychological Abuse", "Sexual Abuse"] },
  { label: "Harém", tags: ["Harem", "Reverse Harem"] },
  { label: "Triângulo amoroso", tags: ["Love Triangle/s"] },
  { label: "Final trágico", tags: ["Tragic Fate"] },
  { label: "Violência gráfica", tags: ["Violence", "Gore"] },
  { label: "Traição", tags: ["Cheating/Infidelity"] },
]

/** Mínimo de gêneros amados pra seguir (igual ao mockup). */
export const MIN_LOVED = 3
