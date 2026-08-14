import type { PublicationStatus } from "@/types/domain"

// As fontes de capítulo são um registro próprio (checadoras de release),
// desacoplado do `ExternalSourceId` (gerado por DB pro pipeline de metadata/IA).
export type ChapterSourceId = "comix" | "mangago"

/** IDs cross-source salvos da obra, usados pra confirmar o match do comix por igualdade. */
export interface ChapterCrossIds {
  anilist?: string | null
  myanimelist?: string | null
  mangadex?: string | null
  mangaupdates?: string | null
}

/** Entrada da checagem de capítulos de uma obra. */
export interface ChapterCheckInput {
  title: string
  originalTitle?: string | null
  alternativeTitles?: string[]
  /** hid do comix salvo em `work_external_ids` (match exato; pula a busca). */
  comixHid?: string | null
  /** slug do Mangago salvo em `work_external_ids` (match exato; a fonte é slug-only, sem busca). */
  mangagoSlug?: string | null
  /** IDs cross-source pra confirmação de match e fallback de sinônimos (AniList). */
  crossIds?: ChapterCrossIds
}

/** Último capítulo encontrado numa fonte específica (ou `null` se nada confiável). */
export type ChapterLookup = {
  chapter: number
  source: ChapterSourceId
  sourceUrl?: string
  /** hid descoberto via busca (não veio do input) — pra persistir e virar match exato. */
  resolvedHid?: string | null
  /** Data relativa do último capítulo (string pré-formatada da fonte, ex.: "8mos ago"). */
  releasedLabel?: string | null
  /** Data absoluta (ISO) do último capítulo, quando a fonte fornece (hoje só o mangago). */
  releasedAt?: string | null
  /** Datas absolutas (ISO, desc) dos caps recentes — pra cadência (hoje só o mangago). */
  cadenceDates?: string[]
  /** Lista completa de números de capítulo (desc) — pra CONTAR caps de verdade (só o mangago fornece). */
  chapterNumbers?: number[]
  /** Status de publicação declarado pela fonte (só o comix fornece). */
  status?: PublicationStatus | null
} | null
