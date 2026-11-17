"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createUserClient } from "@/lib/supabase/user"
import { ensureReadingStateWriter, writeReadingState } from "@/server/queries/user-work-state"
import { getHideAdultContent } from "@/server/queries/current-user"
import { getOnboardingDeck } from "@/server/queries/onboarding-deck"
import type { OnboardingDeckWork } from "@/server/queries/onboarding-deck"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { loadChipTasteState } from "@/server/queries/onboarding-tastes"
import type { ChipTasteState } from "@/server/queries/onboarding-tastes"
import { markRecalcPending } from "@/server/recalc/queue"
import { scheduleUserRecalc } from "@/server/recalc/user-recalc-schedule"
import { getPersonalStatusIdByName, personalStatusNameBySlugOrThrow } from "@/lib/constants/status-lookups"
import { LOVED_CHIPS } from "@/lib/onboarding/chips"
import { planChipTastes } from "@/lib/onboarding/chip-tastes"
import type { ChipStance } from "@/lib/onboarding/chip-tastes"
import { MIN_TRAIN_EXPECTED } from "@/lib/calculations/expected"

/**
 * Grava gostos e vetos da tela 3 do onboarding em `user_tag_preferences`.
 *
 * Recebe RÓTULOS dos chips (não ids): a lista válida mora em `lib/onboarding/chips.ts` — rótulo
 * desconhecido é ignorado, e a resolução nome→tag_id acontece AQUI, no servidor.
 *
 * Só mexe nos chips que MUDARAM desde o que está gravado (regra em `lib/onboarding/chip-tastes.ts`).
 * Até 2026-11 delegava em `saveTagPreferences`, que substitui TUDO: refazer as boas-vindas apagava
 * as tags ajustadas em Preferências que nenhum chip cobre.
 */
export async function saveOnboardingTastes(
  lovedLabels: string[],
  vetoLabels: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }
  if (!Array.isArray(lovedLabels) || !Array.isArray(vetoLabels)) return { ok: false, error: "Payload inválido." }

  let state: ChipTasteState
  try {
    state = await loadChipTasteState(gate.userId)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const plan = planChipTastes(state.rows, lovedLabels.map(String), vetoLabels.map(String))
  if (plan.remove.length === 0 && plan.insert.length === 0) return { ok: true }

  const idsOf = (names: string[]) =>
    names.map((n) => state.idByName.get(n)).filter((id): id is string => id != null)

  // Cliente do USUÁRIO: a RLS (migration 142) garante no banco que as linhas são as dele.
  const supabase = await createUserClient()
  for (const stance of ["love", "avoid"] as ChipStance[]) {
    const ids = idsOf(plan.remove.filter((r) => r.stance === stance).map((r) => r.tagName))
    if (ids.length === 0) continue
    const { error } = await supabase
      .from("user_tag_preferences")
      .delete()
      .eq("user_id", gate.userId)
      .eq("stance", stance)
      .in("tag_id", ids)
    if (error) return { ok: false, error: error.message }
  }

  const inserts = plan.insert
    .map((r) => ({ tagId: state.idByName.get(r.tagName), stance: r.stance }))
    .filter((r): r is { tagId: string; stance: ChipStance } => r.tagId != null)
  if (inserts.length > 0) {
    // Uma stance por tag (índice único `utp_user_tag_uniq`): a linha antiga da mesma tag sai antes.
    const { error: clearError } = await supabase
      .from("user_tag_preferences")
      .delete()
      .eq("user_id", gate.userId)
      .in("tag_id", inserts.map((r) => r.tagId))
    if (clearError) return { ok: false, error: clearError.message }
    const { error } = await supabase
      .from("user_tag_preferences")
      .insert(inserts.map((r) => ({ user_id: gate.userId, tag_id: r.tagId, stance: r.stance, weight: 1 })))
    if (error) return { ok: false, error: error.message }
  }

  // Mesmo pós-processamento de `saveTagPreferences`: dono marca o recálculo global; os demais
  // recalculam já — é o que faz o ranking dela sair pelo Alinhamento antes das 20 notas.
  await markRecalcPending("saveOnboardingTastes", { changed: ["tag_preferences"], actorId: gate.userId })
  if (!gate.isOwner) after(() => scheduleUserRecalc(gate.userId, "saveOnboardingTastes"))
  revalidatePath("/preferences")
  revalidatePath("/ranking")
  return { ok: true }
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
    // As evitadas saem do banco, não da tela: valem as escolhidas agora E as de Preferências.
    const declared = await getDeclaredTagPreferences(undefined, { userId: gate.userId })
    const works = await getOnboardingDeck({
      userId: gate.userId,
      lovedGenres: genres,
      hideAdult: await getHideAdultContent(),
      avoidedTagSlugs: declared.filter((d) => d.stance === "avoid").map((d) => d.slug),
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

  // O Interesse (♥) é entrada da Nota Prevista — e só dela: o Alinhamento sai das tags. Sem as 20
  // notas não há Nota Prevista, então recalcular a cada toque do deck seria ler o catálogo 30
  // vezes para nada. Quem já tem modelo (refez as boas-vindas) recalcula, agrupado.
  if (kind !== "read") {
    if (gate.isOwner) {
      await markRecalcPending("deckSwipe")
    } else if ((await countRatedWorks(gate.userId)) >= MIN_TRAIN_EXPECTED) {
      after(() => scheduleUserRecalc(gate.userId, "deckSwipe"))
    }
  }
  return { ok: true }
}

/**
 * Obras com nota da pessoa, fora `excludeWorkIds`. A exclusão é por SUBTRAÇÃO (o total menos as
 * excluídas que têm nota), nunca `not work_id in (…)`: lista de ids na query string é a forma que
 * já derrubou o /catalog com URL gigante (`exclusao-sem-url-gigante.test.ts`).
 */
async function countRatedWorks(userId: string, excludeWorkIds: string[] = []): Promise<number> {
  const supabase = createAdminClient()
  const rated = () =>
    supabase
      .from("user_work_state")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("user_score", "is", null)
  const [all, excluded] = await Promise.all([
    rated(),
    excludeWorkIds.length > 0 ? rated().in("work_id", excludeWorkIds) : Promise.resolve({ count: 0, error: null }),
  ])
  if (all.error) throw new Error(all.error.message)
  if (excluded.error) throw new Error(excluded.error.message)
  return Math.max(0, (all.count ?? 0) - (excluded.count ?? 0))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Medidor do ensō (telas 6/7): quantas obras COM nota o usuário já tem, FORA as de
 * `excludeWorkIds` — as que a tela de notas está contando sozinha. Sem a exclusão, voltar à tela
 * (ou "Rever o fluxo") somava duas vezes as notas já dadas ali.
 */
export async function getOnboardingProgressAction(
  excludeWorkIds: string[] = [],
): Promise<{ ok: true; ratedCount: number } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }
  // Endpoint público: só ids bem formados entram no filtro, e com teto (o deck tem 30).
  const exclude = Array.isArray(excludeWorkIds)
    ? excludeWorkIds.filter((id) => typeof id === "string" && UUID.test(id)).slice(0, 100)
    : []
  try {
    return { ok: true, ratedCount: await countRatedWorks(gate.userId, exclude) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
