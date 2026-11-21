import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * `setOnboardingStatusAction`: o status que a linha da tela de notas grava. É endpoint público, então
 * a lista do que aceita mora no servidor; e a nota é reaplicada pela régua "só avalia quem leu".
 */

const m = vi.hoisted(() => ({
  writeReadingState: vi.fn<(userId: string, ids: string[], patch: Record<string, unknown>) => Promise<{ error: null }>>(
    async () => ({ error: null }),
  ),
  saveQuickScore: vi.fn<(workId: string, score: number | null) => Promise<{ ok: true }>>(async () => ({ ok: true })),
  total: 72 as number | null,
  chaptersRead: 12 as number | null,
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("@/lib/supabase/user", () => ({ createUserClient: vi.fn() }))
vi.mock("@/server/queries/user-work-state", () => ({
  ensureReadingStateWriter: async () => ({ ok: true, userId: "u1", isOwner: false }),
  writeReadingState: m.writeReadingState,
  deleteReadingState: vi.fn(),
}))
vi.mock("@/server/actions/quick-score", () => ({ saveQuickScore: m.saveQuickScore }))
vi.mock("@/server/queries/onboarding-imported", () => ({ getImportedUnrated: vi.fn() }))
vi.mock("@/server/queries/current-user", () => ({ getHideAdultContent: vi.fn() }))
vi.mock("@/server/queries/onboarding-deck", () => ({ getOnboardingDeck: vi.fn() }))
vi.mock("@/server/queries/tag-preferences", () => ({ getDeclaredTagPreferences: vi.fn() }))
vi.mock("@/server/queries/onboarding-tastes", () => ({ loadChipTasteState: vi.fn() }))
vi.mock("@/server/recalc/queue", () => ({ markRecalcPending: vi.fn() }))
vi.mock("@/server/recalc/user-recalc-schedule", () => ({ scheduleUserRecalc: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () =>
          table === "works"
            ? { data: { total_chapters: m.total }, error: null }
            : { data: { chapters_read: m.chaptersRead }, error: null },
      }
      return chain
    },
  }),
}))

const { setOnboardingStatusAction } = await import("@/server/actions/onboarding")
const { getPersonalStatusIdByName } = await import("@/lib/constants/status-lookups")

const OBRA = "00000000-0000-4000-8000-000000000001"
const patchGravado = () => m.writeReadingState.mock.calls.at(-1)?.[2]

beforeEach(() => {
  vi.clearAllMocks()
  m.total = 72
  m.chaptersRead = 12
})

describe("o status que a tela de notas grava", () => {
  it("recusa o que não está no menu (Not Interested, Not Now) e nome inventado", async () => {
    for (const status of ["Not Interested", "Not Now", "Terminei"]) {
      expect(await setOnboardingStatusAction(OBRA, status, null, null)).toEqual({ ok: false, error: "Status inválido." })
    }
    expect(m.writeReadingState).not.toHaveBeenCalled()
  })

  it("Finished: o capítulo vira o total e a nota é reaplicada (agora vale)", async () => {
    expect(await setOnboardingStatusAction(OBRA, "Finished", 5, 8)).toEqual({ ok: true, canRate: true })
    expect(patchGravado()).toEqual({ personal_status_id: getPersonalStatusIdByName("Finished"), chapters_read: 72 })
    expect(m.saveQuickScore).toHaveBeenCalledWith(OBRA, 8)
  })

  it("Started abaixo de 20%: grava o capítulo e TIRA a nota (não vale ainda)", async () => {
    expect(await setOnboardingStatusAction(OBRA, "Started", 5, 8)).toEqual({ ok: true, canRate: false })
    expect(patchGravado()).toEqual({ personal_status_id: getPersonalStatusIdByName("Started"), chapters_read: 5 })
    expect(m.saveQuickScore).toHaveBeenCalledWith(OBRA, null)
  })

  it("a lixeira (Untracked) não toca no capítulo gravado e tira a nota", async () => {
    expect(await setOnboardingStatusAction(OBRA, "Untracked", 40, 8)).toEqual({ ok: true, canRate: false })
    expect(patchGravado()).toEqual({ personal_status_id: getPersonalStatusIdByName("Untracked") })
    expect(m.saveQuickScore).toHaveBeenCalledWith(OBRA, null)
  })

  it("Dropped libera a nota pelo capítulo GRAVADO, sem reescrevê-lo", async () => {
    expect(await setOnboardingStatusAction(OBRA, "Dropped", null, 6)).toEqual({ ok: true, canRate: true })
    expect(patchGravado()).toEqual({ personal_status_id: getPersonalStatusIdByName("Dropped") })
    expect(m.saveQuickScore).toHaveBeenCalledWith(OBRA, 6)
  })

  it("sem nota na tela, não mexe na nota rápida", async () => {
    await setOnboardingStatusAction(OBRA, "Reading", null, null)
    expect(m.saveQuickScore).not.toHaveBeenCalled()
  })
})
