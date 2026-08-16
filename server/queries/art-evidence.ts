import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { extractArtEvidence, extractArtSignal, type ArtEvidence, type ArtSignal } from "@/lib/art/signal"
import { artBandFromPercentile, type ArtBand } from "@/lib/art/model"

/**
 * TUDO que entrou na estimativa de arte de UMA obra — para o piloto na página da obra.
 *
 * 🔴 As tags exibidas são DERIVADAS do banco (`tag_subgroup_assignment`), não da lista fixa
 * de `ART_TAG_SLUGS`. A regra da curadora é de PROCEDÊNCIA — "Format › Presentation inteiro,
 * Status › as duas de colorização, Structure › webtoon" —, então uma tag nova nesses
 * sub-grupos precisa APARECER na tela mesmo antes de alguém decidir se ela entra no modelo.
 * Derivar da lista fixa esconderia exatamente o caso que este piloto existe para descobrir.
 *
 * ⚠️ Por isso a tela pode mostrar tag que o modelo não usou. Isso é INFORMAÇÃO, não
 * inconsistência — e o card marca quais das exibidas entraram no vetor.
 */

/** Format › Status: só estas duas falam de arte; o resto do sub-grupo é sobre publicação. */
const STATUS_TAGS_DE_ARTE = ["colorized-version-available", "discontinued-colorized-version"]
/** Format › Structure: só esta descreve a apresentação visual. */
const STRUCTURE_TAGS_DE_ARTE = ["webtoon-webcomic"]

export interface ArtTagHit {
  slug: string
  name: string
  subgroup: string
  /** Quantas obras do catálogo têm esta tag — o que diz se ela pode ou não ser aprendida. */
  catalogCount: number
}

export interface ArtEvidenceForWork {
  /** `calculated_scores.art_estimate` — null quando a semente/recalc ainda não rodaram. */
  estimate: number | null
  percentile: number | null
  band: ArtBand | null
  /** A nota que a curadora deu à arte, quando existe. */
  ownerLabel: number | null
  /** Os 6 números persistidos em `works.art_signal`; null quando nunca extraído. */
  signal: ArtSignal | null
  /** Recomputado na hora a partir do digest e das reviews — é o texto por trás dos números. */
  evidence: ArtEvidence
  /** Tags de arte DESTA obra, derivadas dos sub-grupos. */
  tags: ArtTagHit[]
  /** Quantas reviews a obra tem no total (o denominador das menções). */
  reviewCount: number
}

export async function getArtEvidenceForWork(
  workId: string,
  ownerId: string,
): Promise<ArtEvidenceForWork | null> {
  const sb = createAdminClient()

  const { data: work, error } = await sb
    .from("works")
    .select("id, review_digest, art_signal")
    .eq("id", workId)
    .maybeSingle()
  if (error) throw new Error(`getArtEvidenceForWork: ${error.message}`)
  if (!work) return null

  // Paginado: obra popular passa de 1000 reviews e o select corta sem avisar.
  const reviewTexts: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await sb
      .from("work_reviews")
      .select("text")
      .eq("work_id", workId)
      .range(from, from + 999)
    if (!data?.length) break
    for (const r of data) reviewTexts.push(String((r as { text?: unknown }).text ?? ""))
    if (data.length < 1000) break
  }

  const [scores, label, tags] = await Promise.all([
    sb.from("calculated_scores").select("art_estimate, art_percentile").eq("work_id", workId).maybeSingle(),
    sb
      .from("pilot_taste_scores")
      .select("like_art_score")
      .eq("work_id", workId)
      .eq("user_id", ownerId)
      .maybeSingle(),
    loadArtTagsForWork(sb, workId),
  ])

  const percentile = scores.data?.art_percentile != null ? Number(scores.data.art_percentile) : null
  const digest = (work as { review_digest?: unknown }).review_digest

  return {
    estimate: scores.data?.art_estimate != null ? Number(scores.data.art_estimate) : null,
    percentile,
    band: artBandFromPercentile(percentile),
    ownerLabel: label.data?.like_art_score != null ? Number(label.data.like_art_score) : null,
    signal: (work as { art_signal?: ArtSignal | null }).art_signal ?? null,
    // Recomputa em vez de ler do `art_signal`: o sinal guarda contagens, e o que a tela
    // precisa é o TEXTO. Custa uma passada de regex sobre as reviews já carregadas.
    evidence: extractArtEvidence({ reviewDigest: digest, reviewTexts }),
    tags,
    reviewCount: reviewTexts.length,
  }
}

/** Tags de arte da obra, pelos sub-grupos — derivado do banco, ver o 🔴 no topo. */
async function loadArtTagsForWork(
  sb: ReturnType<typeof createAdminClient>,
  workId: string,
): Promise<ArtTagHit[]> {
  const { data: wt } = await sb.from("work_tags").select("tags(id, slug, name)").eq("work_id", workId)
  const daObra = new Map<string, { slug: string; name: string }>()
  for (const row of wt ?? []) {
    const t = (row as { tags?: { id?: string; slug?: string; name?: string } }).tags
    if (t?.id && t.slug) daObra.set(t.id, { slug: t.slug, name: t.name ?? t.slug })
  }
  if (daObra.size === 0) return []

  const { data: atrib } = await sb
    .from("tag_subgroup_assignment")
    .select("tag_id, tag_subgroup(name, slug, tag_group(group))")
    .in("tag_id", [...daObra.keys()])

  const hits: ArtTagHit[] = []
  for (const row of atrib ?? []) {
    const r = row as {
      tag_id: string
      tag_subgroup?: { name?: string; slug?: string; tag_group?: { group?: string } }
    }
    if (r.tag_subgroup?.tag_group?.group !== "Format") continue
    const sub = r.tag_subgroup?.name ?? ""
    const t = daObra.get(r.tag_id)
    if (!t) continue
    const entra =
      sub === "Presentation" ||
      (sub === "Status" && STATUS_TAGS_DE_ARTE.includes(t.slug)) ||
      (sub === "Structure" && STRUCTURE_TAGS_DE_ARTE.includes(t.slug))
    if (!entra) continue
    hits.push({ slug: t.slug, name: t.name, subgroup: sub, catalogCount: 0 })
  }
  if (hits.length === 0) return []

  // Quantas obras têm cada uma — é o número que diz se a tag PODE ser aprendida por um
  // modelo de 200 rótulos, ou se ela só serve como evidência para o olho humano.
  const { data: contagem } = await sb
    .from("work_tags")
    .select("tags!inner(slug)")
    .in(
      "tags.slug",
      hits.map((h) => h.slug),
    )
  const porSlug = new Map<string, number>()
  for (const row of contagem ?? []) {
    const slug = (row as { tags?: { slug?: string } }).tags?.slug
    if (slug) porSlug.set(slug, (porSlug.get(slug) ?? 0) + 1)
  }
  for (const h of hits) h.catalogCount = porSlug.get(h.slug) ?? 0

  return hits.sort((a, b) => b.catalogCount - a.catalogCount)
}

/** Recalcula o sinal na hora — usado só pelo card quando `works.art_signal` ainda é null. */
export function signalFromEvidence(digest: unknown, reviewTexts: string[]): ArtSignal {
  return extractArtSignal({ reviewDigest: digest, reviewTexts })
}
