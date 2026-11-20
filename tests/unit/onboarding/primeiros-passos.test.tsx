import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { buildFirstSteps, FIRST_STEPS_HIDDEN_COOKIE } from "@/lib/onboarding/first-steps"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const { FirstStepsCard } = await import("@/components/dashboard/first-steps-card")

const base = { saidTastes: true, broughtList: false, interestMarked: 2, interestGoal: 5, profileGenerated: false, ratedCount: 4 }

/** O card "Primeiros passos" da home (mockup aprovado em 19/11/2026). */
describe("os 4 passos", () => {
  it("importar é ATALHO do passo das notas, não passo — some quando a lista veio ou com 20 notas", () => {
    const { steps } = buildFirstSteps(base)
    expect(steps.map((s) => s.title)).toEqual([
      "Dizer o que você gosta e evita",
      "Dar nota a 20 obras que você já leu",
      "Marcar 5 obras que te interessam",
      "Gerar seu perfil de gosto",
    ])
    expect(steps[1].importShortcut).toBe(true)
    expect(buildFirstSteps({ ...base, broughtList: true }).steps[1].importShortcut).toBe(false)
    expect(buildFirstSteps({ ...base, ratedCount: 20 }).steps[1].importShortcut).toBe(false)
  })

  it("o passo atual é o primeiro por fazer; o perfil só oferece 'Gerar' a partir de 10 notas", () => {
    expect(buildFirstSteps(base).current).toBe(1)
    expect(buildFirstSteps(base).steps[3].cta).toBeNull()
    expect(buildFirstSteps({ ...base, ratedCount: 12 }).steps[3].cta?.href).toBe("/account/taste-profile")
  })

  it("com 20 notas a Nota Prevista liga", () => {
    expect(buildFirstSteps({ ...base, ratedCount: 20 }).predictionOn).toBe(true)
  })
})

describe("o card", () => {
  const progress = { ...base, complete: false }

  it("'Esconder' grava o cookie e deixa a porta de volta", () => {
    render(<FirstStepsCard progress={progress} />)
    fireEvent.click(screen.getByRole("button", { name: "Esconder" }))
    expect(document.cookie).toContain(`${FIRST_STEPS_HIDDEN_COOKIE}=1`)
    expect(screen.getByText(/Primeiros passos escondidos/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Mostrar de novo" }))
    expect(screen.getByRole("heading", { name: "Primeiros passos" })).toBeTruthy()
    expect(document.cookie).not.toContain(`${FIRST_STEPS_HIDDEN_COOKIE}=1`)
  })

  it("escondido no servidor já abre escondido (sem piscar)", () => {
    render(<FirstStepsCard progress={progress} initiallyHidden />)
    expect(screen.queryByRole("heading", { name: "Primeiros passos" })).toBeNull()
  })

  it("o passo atual leva a 'Dar notas'; com 20 notas o card vira o aviso de uma linha", () => {
    const { unmount } = render(<FirstStepsCard progress={progress} />)
    expect(screen.getByRole("link", { name: /Dar notas/ }).getAttribute("href")).toBe("/rate")
    expect(screen.getByRole("link", { name: /Importar traz as notas/ }).getAttribute("href")).toBe("/import")
    unmount()
    render(<FirstStepsCard progress={{ ...progress, ratedCount: 20 }} />)
    expect(screen.getByText("A Nota Prevista ligou.")).toBeTruthy()
  })
})
