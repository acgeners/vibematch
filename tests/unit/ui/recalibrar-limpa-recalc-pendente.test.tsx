import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/curation/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// O recálculo em si é o que já existe — aqui só interessa o DESFECHO no chrome.
const recalculateNow = vi.fn(async () => ({ recalculated: 971, calibration: null }))
vi.mock("@/server/actions/settings", () => ({ recalculateNow: () => recalculateNow() }))

// O provider busca isto na montagem: já começa com o recálculo pendente, que é o
// estado em que a barra superior desenha o botão "Recalcular notas".
vi.mock("@/server/actions/badges", () => ({
  getSidebarBadgeCounts: async () => ({
    curadoria: 0,
    recQueue: 0,
    settings: 0,
    requests: 0,
    settingsByGroup: {},
    recalcPending: true,
    comixHealth: "unknown" as const,
  }),
}))

import { CalibrationPanel } from "@/components/settings/calibration-panel"
import { ChromeBadgesProvider, useChromeBadges } from "@/components/layout/chrome-badges"
import type { FormulaConfig } from "@/types/domain"

/** Sonda: é o que a barra superior consulta pra decidir se desenha o botão. */
function RecalcProbe() {
  const { recalcPending } = useChromeBadges()
  return <span data-testid="probe">{recalcPending ? "pendente" : "em dia"}</span>
}

const CONFIG = {
  formula_version: "v15",
  last_recalculated_at: null,
  expected_ridge_coefficients: null,
} as unknown as FormulaConfig

const SNAPSHOT = {
  totalWorks: 971,
  trainSize: 207,
  baselineMae: 0.96,
  maeExpected: 0.68,
  pseudoVotesNotaM: null,
  pseudoVotesBlend: null,
  worstDiffs: [],
  expectedPredictorIsStub: false,
  expectedCoveredCount: 971,
  distanceBuckets: [],
  worksWithDistance: 0,
  buckets: { total: 0, buckets: [] } as never,
  history: [],
}

const METRICS = {
  cvMaeExpected: 0.68,
  baselineMae: 0.96,
  inSampleMaeExpected: null,
  prospective: null,
} as never

/**
 * Recalibrar pela "Calibração automática" tem que APAGAR o botão "Recalcular notas"
 * da barra superior.
 *
 * As duas ações são o MESMO recálculo (ambas descem em `recalculateScoresNow`, que
 * zera `recalc_pending` no banco), mas o chrome é client-side: sem aviso, o botão
 * continuava lá até a próxima navegação ou o TTL de 30s — convidando a repetir uma
 * rodada de ~1 min que acabou de terminar, sem erro e sem log.
 *
 * Teste de RENDER com o provider REAL de propósito: o elo que quebrou não é a action
 * nem o estado, é o TRANSPORTE entre eles (`refreshChrome` → `onPatch` do provider).
 * Espiar o spy do `refreshChrome` passaria mesmo se o provider ignorasse o patch.
 */
describe("recalibrar limpa o recálculo pendente do chrome", () => {
  afterEach(() => {
    cleanup()
    recalculateNow.mockClear()
  })

  it("o botão da barra some sem esperar navegação nem TTL", async () => {
    render(
      <ChromeBadgesProvider>
        <RecalcProbe />
        <CalibrationPanel accent="violet" config={CONFIG} metrics={METRICS} snapshot={SNAPSHOT} />
      </ChromeBadgesProvider>,
    )

    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("pendente"))

    fireEvent.click(screen.getByRole("button", { name: /Recalibrar agora/ }))

    await waitFor(() => expect(recalculateNow).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("em dia"))
  })
})
