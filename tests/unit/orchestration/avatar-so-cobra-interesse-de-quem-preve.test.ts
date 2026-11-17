import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Role } from "@/lib/plans/roles"

// O número do avatar ("Suas notas de IA") soma Veredito desatualizado + Interesse não previsto.
// Prever o Interesse exige a permissão de IA de consumo; para quem não a tem, "não previsto" é o
// catálogo inteiro e nunca esvazia. Medido em 17/11/2026: conta leitora nova abria com "99+"
// (1.077 obras) no avatar, sem nada que ela pudesse fazer.

let role: Role = "leitor"
const getSynopsisQueueWorks = vi.fn(async () => [{ id: "b" }, { id: "c" }])

vi.mock("@/server/queries/current-user", () => ({
  getCurrentRole: async () => role,
  getSessionUserId: async () => "u1",
  ensurePermission: async () => ({ ok: true }),
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))
vi.mock("@/lib/supabase/paginate", () => ({ fetchAllRows: async () => [] }))
vi.mock("@/server/queries/recommendations", () => ({
  getAlignmentQueueWorks: async () => [{ id: "a" }],
  getSynopsisQueueWorks: (...args: unknown[]) => getSynopsisQueueWorks(...(args as [])),
  getUntrackedWorks: async () => [],
}))
vi.mock("@/server/queries/works-without-reviews", () => ({ getWorksWithoutReviews: async () => ({ ids: [] }) }))
vi.mock("@/server/queries/works-without-tags", () => ({ getWorksWithoutTags: async () => ({ ids: [] }) }))

const { getRecommendationBadgeUnreadCount } = await import("@/server/queries/ai-eval-read")

beforeEach(() => getSynopsisQueueWorks.mockClear())

describe("o avatar só cobra Interesse não previsto de quem pode prever", () => {
  it("leitor: só o Veredito conta, e a fila de Interesse nem é lida", async () => {
    role = "leitor"
    expect(await getRecommendationBadgeUnreadCount()).toBe(1)
    expect(getSynopsisQueueWorks).not.toHaveBeenCalled()
  })

  it.each<Role>(["assinante", "curador"])("%s: as duas filas contam", async (r) => {
    role = r
    expect(await getRecommendationBadgeUnreadCount()).toBe(3)
  })

  it("a régua é a mesma das ações de prever: elas exigem ensureAiConsumption, que usa a permissão exportada", () => {
    const quota = readFileSync(join(process.cwd(), "server/queries/ai-quota.ts"), "utf8")
    expect(quota).toMatch(/ensurePermission\(AI_CONSUMPTION_PERMISSION\)/)
    const actions = readFileSync(join(process.cwd(), "server/actions/synopsis-quality.ts"), "utf8")
    for (const name of ["predictSynopsisQualityForWorkAction", "runSynopsisInterestBatchAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}(`)).slice(0, 600)
      expect(body, name).toMatch(/await ensureAiConsumption\(\)/)
    }
  })
})
