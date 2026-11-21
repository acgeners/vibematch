import { describe, it, expect } from "vitest"
import { PERSONAL_STATUSES } from "@/types/domain"
import {
  isTerminalPersonalStatus,
  personalStatusNameBySlugOrThrow,
  tracksProgressPersonalStatus,
} from "@/lib/constants/status-lookups"
import {
  asksChapter,
  chaptersAfterStatus,
  isRateListStatus,
  RATE_MENU_STATUSES,
  rateLock,
} from "@/lib/onboarding/rate-status"
import type { PersonalStatus } from "@/types/domain"

const st = (slug: string) => personalStatusNameBySlugOrThrow(slug) as PersonalStatus

/**
 * A tela de notas usa o status GRAVADO e a mesma trava do servidor. Até 20/11/2026 ela tinha um
 * vocabulário próprio e mostrava "Terminei" em toda obra: a escala liberava e o servidor, que lê o
 * status real, guardava a nota sem virar rótulo.
 */
describe("o menu de status da tela de notas", () => {
  it("são os status de leitura e o Want to Read, na ordem do site — sem Not Now, Untracked e Not Interested", () => {
    // Enumera a TABELA: status novo no Supabase entra (ou não) pela régua das flags, sem lista de nomes.
    const esperado = PERSONAL_STATUSES.filter(
      (s) => tracksProgressPersonalStatus(s) || isTerminalPersonalStatus(s) || s === st("want-to-read"),
    )
    expect(RATE_MENU_STATUSES).toEqual(esperado)
    for (const fora of ["not_now", "untracked", "not_interested"]) {
      expect(RATE_MENU_STATUSES).not.toContain(st(fora))
    }
    expect(RATE_MENU_STATUSES).toContain(st("finished"))
    expect(RATE_MENU_STATUSES).toContain(st("dropped"))
  })

  it("Want to Read está no menu mas não na lista: escolhê-lo tira a obra", () => {
    expect(isRateListStatus(st("want-to-read"))).toBe(false)
    expect(isRateListStatus(st("started"))).toBe(true)
    expect(isRateListStatus(st("finished"))).toBe(true)
  })

  it("o capítulo aparece nos que acompanham progresso e não encerraram", () => {
    for (const slug of ["started", "reading", "stalled", "on-hold", "read_again"]) expect(asksChapter(st(slug))).toBe(true)
    for (const slug of ["finished", "dropped", "want-to-read"]) expect(asksChapter(st(slug))).toBe(false)
  })

  it("Finished = a obra inteira; os outros mantêm o capítulo", () => {
    expect(chaptersAfterStatus(st("finished"), 12, 80)).toBe(80)
    expect(chaptersAfterStatus(st("finished"), 12, null)).toBe(12)
    expect(chaptersAfterStatus(st("started"), 12, 80)).toBe(12)
  })
})

describe("a trava da escala", () => {
  it("Finished e Dropped nunca travam", () => {
    expect(rateLock(st("finished"), null, 247).locked).toBe(false)
    expect(rateLock(st("dropped"), 3, 247).locked).toBe(false)
  })

  it("Reading com o capítulo em branco libera; Started em branco trava e pede o capítulo", () => {
    expect(rateLock(st("reading"), null, 247)).toEqual({ locked: false, text: null })
    expect(rateLock(st("started"), null, 247)).toEqual({
      locked: true,
      text: "Diga em que capítulo parou: a nota vale a partir do cap. 50.",
    })
  })

  it("abaixo de 20% trava e diz a partir de qual capítulo libera", () => {
    expect(rateLock(st("started"), 30, 247)).toEqual({ locked: true, text: "Nota a partir do cap. 50 (20%)." })
    // 20% exato não passa (o limiar é estrito): 49 de 245 é 20%.
    expect(rateLock(st("on-hold"), 49, 245).locked).toBe(true)
    expect(rateLock(st("stalled"), 60, 247).locked).toBe(false)
  })

  it("sem o total, o texto não inventa um número", () => {
    expect(rateLock(st("reading"), 300, null)).toEqual({
      locked: true,
      text: "Sem o total de capítulos da obra, a nota só vale com o capítulo em branco.",
    })
    expect(rateLock(st("started"), 30, null)).toEqual({
      locked: true,
      text: "Sem o total de capítulos da obra, a nota só vale com Finished ou Dropped.",
    })
  })
})
