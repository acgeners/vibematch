import { vi, describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/components/ranking/use-rerank-single-work", () => ({
  useRerankSingleWork: () => ({ isPending: false, run: vi.fn() }),
}))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/lib/tasks-store", () => ({ runTask: vi.fn() }))
vi.mock("@/components/tasks/use-app-tasks", () => ({ useAppTasks: () => [] }))
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => ({ confirm: vi.fn(), dialog: null }) }))
vi.mock("@/server/actions/ai-eval-maintenance", () => ({
  inferTagsForWork: vi.fn(),
  inferTagsForWorks: vi.fn(),
  regenerateCanonicalSynopsis: vi.fn(),
}))

import { RerankAiRkButton } from "@/components/titles/rerank-ai-rk-button"
import { TagRowAction } from "@/components/ai-evaluation/tag-actions"
import { RegenerateSynopsisAction } from "@/components/works/regenerate-actions"
import { describeGenerateAll } from "@/lib/generate-all/work-pieces"

const PIECES = {
  synopsis: false,
  summary: true,
  digest: true,
  tags: false,
  scores: true,
  interest: true,
  verdict: false,
  embedding: true,
}

function actionOf(key: string): string {
  const v = describeGenerateAll({ pieces: PIECES, reviewPending: false, usefulReviews: 20, estimatedUsd: 0.13 })
  if (v.advice.kind !== "missing") throw new Error(v.advice.kind)
  const m = v.advice.missing.find((x) => x.key === key)
  if (!m) throw new Error(`sem ${key}`)
  return m.action
}

/**
 * O cartão do "Gerar tudo" manda a pessoa clicar num botão PELO NOME. Este teste desenha
 * esses botões e confere que o nome na tela é o que o cartão cita: renomear o botão sem
 * passar pelo rótulo compartilhado (`lib/ui/work-action-labels.ts`) faria o cartão apontar
 * um botão que não existe mais.
 */
describe("botões citados pelo cartão do Gerar tudo", () => {
  it("🔴 Veredito sem nota: o botão diz o que o cartão cita", () => {
    render(<RerankAiRkButton workId="w1" hasScore={false} />)
    expect(screen.getByRole("button", { name: actionOf("verdict") })).toBeTruthy()
  })

  it("🔴 tags nunca inferidas: o botão diz o que o cartão cita", () => {
    render(<TagRowAction workId="w1" />)
    expect(screen.getByRole("button", { name: new RegExp(actionOf("tags")) })).toBeTruthy()
  })

  it("🔴 sinopse: o botão diz o que o cartão cita", () => {
    render(<RegenerateSynopsisAction workId="w1" />)
    expect(screen.getByRole("button", { name: new RegExp(actionOf("synopsis")) })).toBeTruthy()
  })
})
