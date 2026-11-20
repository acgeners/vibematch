"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createUserClient } from "@/lib/supabase/user"
import { deleteReadingState, ensureReadingStateWriter, writeReadingState } from "@/server/queries/user-work-state"
import type { PersonalStatePatch } from "@/server/queries/user-work-state"
import { getImportedUnrated } from "@/server/queries/onboarding-imported"
import { saveQuickScore } from "@/server/actions/quick-score"
import { canRateReadingState } from "@/lib/reading-gate"
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
  extraTags: OnboardingExtraTag[] = [],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }
  if (!Array.isArray(lovedLabels) || !Array.isArray(vetoLabels)) return { ok: false, error: "Payload inválido." }
  // As tags achadas na busca ("Procurar outras tags"): endpoint público, então só id bem formado,
  // stance conhecida e com teto.
  const extras = Array.isArray(extraTags)
    ? extraTags
        .filter((e) => e && typeof e.tagId === "string" && UUID.test(e.tagId) && (e.stance === "love" || e.stance === "avoid"))
        .slice(0, 50)
    : []

  let state: ChipTasteState
  try {
    state = await loadChipTasteState(gate.userId)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const plan = planChipTastes(state.rows, lovedLabels.map(String), vetoLabels.map(String))
  if (plan.remove.length === 0 && plan.insert.length === 0 && extras.length === 0) return { ok: true }

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

  if (extras.length > 0) {
    // Só ACRESCENTA (ou troca a stance): tirar uma tag que não veio da busca desta visita é em Preferências.
    const ids = extras.map((e) => e.tagId)
    const { error: clearError } = await supabase
      .from("user_tag_preferences")
      .delete()
      .eq("user_id", gate.userId)
      .in("tag_id", ids)
    if (clearError) return { ok: false, error: clearError.message }
    const { error } = await supabase
      .from("user_tag_preferences")
      .insert(extras.map((e) => ({ user_id: gate.userId, tag_id: e.tagId, stance: e.stance, weight: 1 })))
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

export interface OnboardingExtraTag {
  tagId: string
  stance: ChipStance
}

export interface OnboardingTagHit {
  id: string
  name: string
  group: string | null
}

/**
 * "Procurar outras tags" da tela de gostos: as tags do catálogo cujo nome contém o termo (os nomes
 * são em inglês), as que COMEÇAM com ele primeiro. Quem oculta conteúdo adulto não vê tag adulta.
 */
export async function searchOnboardingTagsAction(
  query: string,
): Promise<{ ok: true; tags: OnboardingTagHit[] } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }
  const q = typeof query === "string" ? query.trim().slice(0, 40) : ""
  if (q.length < 2) return { ok: true, tags: [] }
  // `%` e `_` são curingas no ILIKE: escapados, valem como texto.
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  let req = createAdminClient()
    .from("tags")
    .select("id, name, tag_group(group)")
    .ilike("name", pattern)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(20)
  if (await getHideAdultContent()) req = req.eq("adult_indicator", false)
  const { data, error } = await req
  if (error) return { ok: false, error: error.message }
  const lower = q.toLowerCase()
  const tags = ((data ?? []) as { id: string; name: string; tag_group: { group?: string } | { group?: string }[] | null }[])
    .map((t) => ({
      id: t.id,
      name: t.name,
      group: (Array.isArray(t.tag_group) ? t.tag_group[0]?.group : t.tag_group?.group) ?? null,
    }))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(lower)) - Number(!b.name.toLowerCase().startsWith(lower)))
    .slice(0, 8)
  return { ok: true, tags }
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

/**
 * O que a lista importada nas boas-vindas trouxe (chamado ao sair da tela da lista, ANTES do deck):
 * quantas obras com nota a pessoa já tem e quais chegaram LIDAS e SEM nota — essas vão para a tela
 * de notas, e o placar do deck já as conta.
 */
export async function getWelcomeImportStateAction(
  sinceIso: string,
): Promise<
  | {
      ok: true
      /** Todas as obras com nota da pessoa (as de antes e as que a lista trouxe). */
      ratedCount: number
      /** Quantas dessas a lista importada agora trouxe com nota. */
      importedRatedCount: number
      unrated: OnboardingDeckWork[]
      sourceLabel: string | null
    }
  | { ok: false; error: string }
> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }
  const t = typeof sinceIso === "string" ? Date.parse(sinceIso) : Number.NaN
  if (!Number.isFinite(t)) return { ok: false, error: "Data inválida." }
  try {
    const [ratedCount, imported] = await Promise.all([
      countRatedWorks(gate.userId),
      getImportedUnrated(gate.userId, new Date(t).toISOString()),
    ])
    return {
      ok: true,
      ratedCount,
      importedRatedCount: imported.ratedCount,
      unrated: imported.works,
      sourceLabel: imported.sourceLabel,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export type OnboardingReadingKind = "terminei" | "larguei" | "lendo"
const READING_SLUG: Record<OnboardingReadingKind, string> = {
  terminei: "finished",
  larguei: "dropped",
  lendo: "reading",
}

/**
 * "Como foi a leitura" de uma obra da tela de notas (Terminei · Larguei · Estou lendo).
 *
 * Reaplica a nota DEPOIS de trocar o status, e não é enfeite: a nota rápida só passa pela régua
 * "só avalia quem leu" na hora em que é gravada. Sem isto, dar 8 com "Terminei" e depois trocar
 * para "Estou lendo, cap. 30 de 247" deixava o 8 contando no banco com a escala travada na tela.
 * Travada, a nota sai (`saveQuickScore(…, null)`); liberada de novo, a tela a manda de volta.
 *
 * Não carimba `last_read_at`: as boas-vindas não sabem QUANDO foi lido (a mesma régua da importação).
 */
export async function setOnboardingReadingAction(
  workId: string,
  kind: OnboardingReadingKind,
  chapters: number | null,
  score: number | null,
): Promise<{ ok: true; canRate: boolean } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }
  if (typeof workId !== "string" || !UUID.test(workId)) return { ok: false, error: "Obra inválida." }
  if (!(kind in READING_SLUG)) return { ok: false, error: "Status inválido." }
  const chaptersRead =
    chapters == null ? null : Number.isInteger(chapters) && chapters >= 0 && chapters <= 100000 ? chapters : NaN
  if (Number.isNaN(chaptersRead)) return { ok: false, error: "Capítulo inválido." }
  if (score != null && !(Number.isFinite(score) && score >= 0 && score <= 10)) {
    return { ok: false, error: "Nota inválida." }
  }

  const { data: work, error: workError } = await createAdminClient()
    .from("works")
    .select("total_chapters")
    .eq("id", workId)
    .maybeSingle()
  if (workError) return { ok: false, error: workError.message }
  const total = (work?.total_chapters as number | null | undefined) ?? null

  const statusName = personalStatusNameBySlugOrThrow(READING_SLUG[kind])
  const patch: PersonalStatePatch = { personal_status_id: getPersonalStatusIdByName(statusName) }
  // "Terminei" = leu a obra inteira: os capítulos acompanham (a régua de `setReadingStatusForWorks`).
  if (kind === "terminei" && total != null && total > 0) patch.chapters_read = total
  if (kind === "lendo") patch.chapters_read = chaptersRead
  const write = await writeReadingState(gate.userId, [workId], patch)
  if (write.error) return { ok: false, error: write.error }

  const canRate = canRateReadingState({
    personalStatus: statusName,
    chaptersRead: kind === "lendo" ? chaptersRead : (patch.chapters_read ?? null),
    totalChapters: total,
  })
  if (score != null) {
    const res = await saveQuickScore(workId, canRate ? score : null)
    if (!res.ok) return res
  }
  revalidatePath("/reading")
  revalidatePath("/my-list")
  return { ok: true, canRate }
}

/**
 * "Desfazer última" do deck e "Remover" da tela de notas: a obra volta a não ter estado nenhum
 * (a regra e o porquê moram em `deleteReadingState`).
 */
export async function removeOnboardingWorkAction(
  workId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }
  if (typeof workId !== "string" || !UUID.test(workId)) return { ok: false, error: "Obra inválida." }

  const removed = await deleteReadingState(gate.userId, [workId])
  if (removed.error) return { ok: false, error: removed.error }
  const hadLabel = removed.hadLabel

  // A nota é o rótulo; o ♥ do swipe é entrada da Nota Prevista. Mesma régua do `deckSwipeAction`.
  if (hadLabel || removed.hadInterest) {
    if (gate.isOwner) {
      await markRecalcPending("removeOnboardingWork")
    } else if (hadLabel || (await countRatedWorks(gate.userId)) >= MIN_TRAIN_EXPECTED) {
      after(() => scheduleUserRecalc(gate.userId, "removeOnboardingWork"))
    }
  }
  revalidatePath("/my-list")
  return { ok: true }
}
