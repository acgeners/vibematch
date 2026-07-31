"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { ensureReadingStateWriter, writeReadingState } from "@/server/queries/user-work-state"
import { getHideAdultContent } from "@/server/queries/current-user"
import { getOnboardingDeck } from "@/server/queries/onboarding-deck"
import type { OnboardingDeckWork } from "@/server/queries/onboarding-deck"
import { getPersonalStatusIdByName, personalStatusNameBySlugOrThrow } from "@/lib/constants/status-lookups"
import { LOVED_CHIPS, VETO_CHIPS } from "@/lib/onboarding/chips"
import { saveTagPreferences } from "./tag-preferences"
import type { TagStanceItem } from "./tag-preferences"

/**
 * Grava gostos e vetos da tela 3 do onboarding em `user_tag_preferences`.
 *
 * Recebe RÓTULOS dos chips (não ids): a lista válida mora em `lib/onboarding/chips.ts`
 * — rótulo desconhecido é ignorado, e a resolução nome→tag_id acontece AQUI, no
 * servidor. Delega em `saveTagPreferences` (replace-all, cliente de sessão): pra conta
 * recém-criada é o primeiro conjunto; refazer o fluxo substitui — "dá para refazer em
 * Preferências", como a tela 1 promete.
 */
export async function saveOnboardingTastes(
  lovedLabels: string[],
  vetoLabels: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }

  const loved = new Set(lovedLabels)
  const vetos = new Set(vetoLabels)

  const tagNames = new Set<string>()
  for (const c of LOVED_CHIPS) if (loved.has(c.label) && c.tag) tagNames.add(c.tag)
  for (const v of VETO_CHIPS) if (vetos.has(v.label)) for (const t of v.tags) tagNames.add(t)

  const supabase = createAdminClient()
  const { data: tagRows, error } = await supabase
    .from("tags")
    .select("id, name")
    .in("name", Array.from(tagNames))
  if (error) return { ok: false, error: error.message }
  const idByName = new Map((tagRows ?? []).map((t) => [t.name as string, t.id as string]))

  const items: TagStanceItem[] = []
  for (const c of LOVED_CHIPS) {
    const id = c.tag ? idByName.get(c.tag) : undefined
    if (loved.has(c.label) && id) items.push({ level: "tag", targetId: id, stance: "love" })
  }
  for (const v of VETO_CHIPS) {
    if (!vetos.has(v.label)) continue
    for (const t of v.tags) {
      const id = idByName.get(t)
      if (id) items.push({ level: "tag", targetId: id, stance: "avoid" })
    }
  }

  return saveTagPreferences(items)
}

/** Deck da tela 4 — amostra por gênero do usuário logado (regra no sampler). */
export async function getOnboardingDeckAction(
  lovedLabels: string[],
): Promise<{ ok: true; works: OnboardingDeckWork[] } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }

  const loved = new Set(lovedLabels)
  const genres = LOVED_CHIPS.filter((c) => loved.has(c.label)).map((c) => c.genre)
  try {
    const works = await getOnboardingDeck({
      userId: gate.userId,
      lovedGenres: genres,
      hideAdult: await getHideAdultContent(),
    })
    return { ok: true, works }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Um swipe do deck. A pergunta é de INTERESSE (decisão de 30/07):
 * - quero ler → interesse ♥♥♥ + status "Want to Read";
 * - dispensar → interesse ♥ (o "não" que evita a mesma oferta dez vezes) + "Not Interested";
 * - já li → status "Finished" (terminal → passa no gate de leitura; a NOTA vem na tela 6).
 */
export async function deckSwipeAction(
  workId: string,
  kind: "love" | "dismiss" | "read",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }
  if (!workId) return { ok: false, error: "workId ausente" }

  const patch =
    kind === "love"
      ? {
          synopsis_quality: "♥♥♥",
          synopsis_quality_source: "human_manual",
          personal_status_id: getPersonalStatusIdByName(personalStatusNameBySlugOrThrow("want-to-read")),
        }
      : kind === "dismiss"
        ? {
            synopsis_quality: "♥",
            synopsis_quality_source: "human_manual",
            personal_status_id: getPersonalStatusIdByName(personalStatusNameBySlugOrThrow("not_interested")),
          }
        : { personal_status_id: getPersonalStatusIdByName(personalStatusNameBySlugOrThrow("finished")) }

  const write = await writeReadingState(gate.userId, [workId], patch)
  if (write.error) return { ok: false, error: write.error }
  return { ok: true }
}

/** Medidor do ensō (telas 6/7): quantas obras COM nota o usuário já tem. */
export async function getOnboardingProgressAction(): Promise<
  { ok: true; ratedCount: number } | { ok: false; error: string }
> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from("user_work_state")
    .select("*", { count: "exact", head: true })
    .eq("user_id", gate.userId)
    .not("user_score", "is", null)
  if (error) return { ok: false, error: error.message }
  return { ok: true, ratedCount: count ?? 0 }
}
