import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react"

/**
 * Fila "Tags novas": uma tag cuja classificação automática NÃO terminou não pode aparecer como
 * "Não é 18+" nem sob um cabeçalho dizendo que a IA já classificou tudo (auditoria 2026-10-13: as 4
 * tags de 08/10 eram as 4 primeiras linhas da fila, exatamente assim).
 *
 * 🔴 RENDER de propósito: a regra pode estar certa em `enrichment-view.ts` e o painel seguir
 * desenhando o seletor pela flag crua. E o botão de reprocessar é PAGO: aqui se prova que sem o
 * "sim" do popup de custo nada é chamado.
 */

const h = vi.hoisted(() => ({
  confirmCost: vi.fn(),
  runTask: vi.fn(),
  reprocess: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => () => {} }))
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => h.confirmCost }))
vi.mock("@/lib/tasks-store", () => ({ runTask: h.runTask }))
vi.mock("@/server/actions/tag-review", () => ({
  changeTagGroup: vi.fn(),
  confirmNewTags: vi.fn(),
  setTagAdult: vi.fn(),
  reprocessTagEnrichment: h.reprocess,
}))

import { NewTagsPanel } from "@/components/settings/tag-consolidation/new-tags-panel"
import type { NewTagRow } from "@/server/actions/tag-review"

const base: Omit<NewTagRow, "id" | "name" | "slug" | "enrichmentStatus"> = {
  groupSlug: "",
  groupLabel: "",
  adultLevel: "none",
  origin: "external",
  createdAt: "2026-10-08T06:15:15Z",
  workCount: 1,
  enrichmentDetail: null,
  humanDecisions: {},
}
const FALHOU: NewTagRow = {
  ...base,
  id: "t1",
  name: "Mouse Girl/s",
  slug: "mouse-girl-s",
  enrichmentStatus: "provider_not_called",
  enrichmentDetail: "mig 210: nenhuma chamada de IA no log",
}
const OK: NewTagRow = { ...base, id: "t2", name: "Shy Male Lead", slug: "shy-male-lead", groupSlug: "male_lead", groupLabel: "Male Lead", enrichmentStatus: "done" }
const HUMANO_MARCOU: NewTagRow = { ...base, id: "t3", name: "Lewd Ritual", slug: "lewd-ritual", adultLevel: "explicit", enrichmentStatus: "provider_failed", enrichmentDetail: "grupo: Error: 529" }

const linha = (slug: string) => screen.getByTestId(`tag-nova-${slug}`)
const seletor18 = (slug: string) => within(linha(slug)).getByRole("combobox", { name: "Sinal 18+" })

beforeEach(() => {
  h.confirmCost.mockReset()
  h.runTask.mockReset()
  h.reprocess.mockReset()
})

describe("17 · a tela distingue falha de 'Não é 18+'", () => {
  it("tag que não foi classificada: estado nomeado, motivo, 18+ NÃO avaliado, botão pago no lugar de Confirmar", () => {
    render(<NewTagsPanel tags={[FALHOU, OK]} groups={[{ slug: "male_lead", label: "Male Lead" }]} />)
    const l = within(linha("mouse-girl-s"))
    expect(l.getByText("IA não chamada")).toBeTruthy()
    expect(l.getByText(/Motivo: mig 210: nenhuma chamada de IA no log/)).toBeTruthy()
    expect(seletor18("mouse-girl-s").textContent).toContain("18+ não avaliado")
    expect(seletor18("mouse-girl-s").textContent).not.toContain("Não é 18+")
    expect(l.getByRole("button", { name: /Reprocessar com IA/ })).toBeTruthy()
    expect(l.getByText(/chamada paga/)).toBeTruthy()
    expect(l.queryByRole("button", { name: /Confirmar/ })).toBeNull()
  })

  it("tag classificada (done): sem aviso, 'Não é 18+' é a decisão gravada, e Confirmar continua", () => {
    render(<NewTagsPanel tags={[FALHOU, OK]} groups={[{ slug: "male_lead", label: "Male Lead" }]} />)
    const l = within(linha("shy-male-lead"))
    expect(seletor18("shy-male-lead").textContent).toContain("Não é 18+")
    expect(l.getByRole("button", { name: /Confirmar/ })).toBeTruthy()
    expect(l.queryByRole("button", { name: /Reprocessar/ })).toBeNull()
    expect(l.queryByText("IA não chamada")).toBeNull()
  })

  it("flag gravada numa tag que não terminou aparece como é (é dado, não ausência)", () => {
    render(<NewTagsPanel tags={[HUMANO_MARCOU]} groups={[]} />)
    expect(seletor18("lewd-ritual").textContent).toContain("18+ · explícito")
    expect(within(linha("lewd-ritual")).getByText("Classificação falhou")).toBeTruthy()
  })

  it("o cabeçalho não afirma mais que a IA classificou todas as linhas", () => {
    render(<NewTagsPanel tags={[FALHOU]} groups={[]} />)
    expect(document.body.textContent).not.toMatch(/A IA já atribuiu grupo, subgrupo e sinal 18\+/)
    expect(document.body.textContent).toMatch(/não\s+foram decididos pela IA/)
  })
})

describe("16 · reprocessar: pago, só por clique, depois do popup", () => {
  it("popup recusado → nenhuma tarefa, nenhuma chamada à action", async () => {
    h.confirmCost.mockResolvedValue(false)
    render(<NewTagsPanel tags={[FALHOU]} groups={[]} />)
    fireEvent.click(within(linha("mouse-girl-s")).getByRole("button", { name: /Reprocessar com IA/ }))
    await waitFor(() => expect(h.confirmCost).toHaveBeenCalledWith({ action: "enrich_tag" }))
    expect(h.runTask).not.toHaveBeenCalled()
    expect(h.reprocess).not.toHaveBeenCalled()
  })

  it("popup aceito → tarefa durável; se a action devolve outro estado que não done, a tarefa FALHA (não anuncia 'pronto')", async () => {
    h.confirmCost.mockResolvedValue(true)
    h.reprocess.mockResolvedValue({ ok: true, status: "provider_failed", detail: "529 overloaded" })
    render(<NewTagsPanel tags={[FALHOU]} groups={[]} />)
    fireEvent.click(within(linha("mouse-girl-s")).getByRole("button", { name: /Reprocessar com IA/ }))
    await waitFor(() => expect(h.runTask).toHaveBeenCalledTimes(1))
    const spec = h.runTask.mock.calls[0][0] as { run: () => Promise<unknown> }
    await expect(spec.run()).rejects.toThrow(/não concluiu — Classificação falhou: 529 overloaded/)
    expect(h.reprocess).toHaveBeenCalledWith("t1")
  })

  it("action devolve done → a tarefa conclui", async () => {
    h.confirmCost.mockResolvedValue(true)
    h.reprocess.mockResolvedValue({ ok: true, status: "done", detail: null })
    render(<NewTagsPanel tags={[FALHOU]} groups={[]} />)
    fireEvent.click(within(linha("mouse-girl-s")).getByRole("button", { name: /Reprocessar com IA/ }))
    await waitFor(() => expect(h.runTask).toHaveBeenCalledTimes(1))
    const spec = h.runTask.mock.calls[0][0] as { run: () => Promise<unknown> }
    await expect(spec.run()).resolves.toMatchObject({ status: "done" })
  })
})

describe("proveniência humana na linha (migration 219)", () => {
  const AT = { at: "2026-10-13T12:00:00Z", by: "curadora" }

  it("F. parcial: a falha original continua visível, o 18+ aparece como decidido por você e o grupo como pendente", () => {
    const t: NewTagRow = { ...FALHOU, adultLevel: "explicit", humanDecisions: { adult: AT } }
    render(<NewTagsPanel tags={[t]} groups={[]} />)
    const l = within(linha("mouse-girl-s"))
    expect(l.getByText("IA não chamada")).toBeTruthy()
    expect(screen.getByTestId("campos-mouse-girl-s").textContent).toBe("Grupo: pendente · 18+: decidido por você · Piso: na fila Piso adulto")
    expect(l.queryByText("Recuperada manualmente")).toBeNull()
    expect(l.getByRole("button", { name: /Reprocessar com IA/ })).toBeTruthy()
  })

  it("\"Não é 18+\" decidido por um humano aparece como decisão (não mais como \"não avaliado\")", () => {
    const t: NewTagRow = { ...FALHOU, humanDecisions: { adult: AT } }
    render(<NewTagsPanel tags={[t]} groups={[]} />)
    expect(seletor18("mouse-girl-s").textContent).toContain("Não é 18+")
  })

  it("E. recuperada à mão: mostra a falha E a recuperação; sai do reprocessar pago e volta a ter Confirmar", () => {
    const t: NewTagRow = { ...FALHOU, groupSlug: "male_lead", groupLabel: "Male Lead", humanDecisions: { group: AT, adult: AT } }
    render(<NewTagsPanel tags={[t]} groups={[{ slug: "male_lead", label: "Male Lead" }]} />)
    const l = within(linha("mouse-girl-s"))
    expect(l.getByText("IA não chamada")).toBeTruthy()
    expect(l.getByText("Recuperada manualmente")).toBeTruthy()
    expect(screen.getByTestId("campos-mouse-girl-s").textContent).toBe("Grupo: decidido por você · 18+: decidido por você")
    expect(l.queryByRole("button", { name: /Reprocessar/ })).toBeNull()
    expect(l.getByRole("button", { name: /Confirmar/ })).toBeTruthy()
  })

  it("grupo dado pelo classificador (IA respondeu o grupo, o enriquecimento falhou) não é cobrado do humano", () => {
    const t: NewTagRow = { ...FALHOU, groupSlug: "male_lead", groupLabel: "Male Lead" }
    render(<NewTagsPanel tags={[t]} groups={[]} />)
    expect(screen.getByTestId("campos-mouse-girl-s").textContent).toBe("Grupo: definido automaticamente · 18+: pendente")
  })

  it("G. tag que a IA concluiu, sem decisão humana: nenhuma linha de campos", () => {
    render(<NewTagsPanel tags={[OK]} groups={[]} />)
    expect(screen.queryByTestId("campos-shy-male-lead")).toBeNull()
  })
})
