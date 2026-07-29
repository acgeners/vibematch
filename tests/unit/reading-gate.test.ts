/**
 * A regra "só avalia quem leu" (`lib/reading-gate.ts`).
 *
 * Ela existia como um `const` local em `post-reading-flow.tsx`, valendo só como gate de
 * VISIBILIDADE no cliente — nenhuma escrita a consultava. Resultado medido no banco: 42 das 219
 * obras com nota estavam sem leitura que a sustentasse (19 "On-hold", 10 "Stalled", 5
 * "Untracked"…). Estes testes travam a regra agora que ela é compartilhada entre a tela e as
 * server actions.
 *
 * 🔴 Nomes de status vêm dos conjuntos gerados do banco — nunca escritos à mão aqui.
 */
import { describe, it, expect } from "vitest"
import {
  canRateReadingState,
  chaptersNeededForRating,
  readProgressPct,
  MIN_READ_PCT_FOR_RATING,
} from "@/lib/reading-gate"
import {
  TERMINAL_PERSONAL_STATUSES,
  UNREAD_PERSONAL_STATUSES,
  FOLLOWING_PERSONAL_STATUSES,
  DEFAULT_PERSONAL_STATUS,
} from "@/lib/constants/criteria"

const [terminal] = TERMINAL_PERSONAL_STATUSES
const [unread] = UNREAD_PERSONAL_STATUSES
const [following] = FOLLOWING_PERSONAL_STATUSES

describe("readProgressPct", () => {
  it("calcula a fração lida", () => {
    expect(readProgressPct({ personalStatus: following, chaptersRead: 25, totalChapters: 100 })).toBe(25)
  })

  it("devolve null quando não dá pra saber — total ausente, zero, ou capítulos não registrados", () => {
    const cases = [
      { chaptersRead: 10, totalChapters: null },
      { chaptersRead: 10, totalChapters: 0 },
      { chaptersRead: null, totalChapters: 100 },
    ]
    for (const c of cases) {
      expect(readProgressPct({ personalStatus: following, ...c })).toBeNull()
    }
  })
})

describe("canRateReadingState", () => {
  it("libera qualquer status terminal, mesmo sem progresso registrado", () => {
    for (const status of TERMINAL_PERSONAL_STATUSES) {
      expect(
        canRateReadingState({ personalStatus: status, chaptersRead: null, totalChapters: 200 }),
      ).toBe(true)
    }
  })

  it("libera não-terminal acima do limiar (estrito: 20% exato NÃO passa)", () => {
    const at = { personalStatus: following, chaptersRead: 20, totalChapters: 100 }
    const above = { personalStatus: following, chaptersRead: 21, totalChapters: 100 }
    expect(canRateReadingState(at)).toBe(false)
    expect(canRateReadingState(above)).toBe(true)
    expect(MIN_READ_PCT_FOR_RATING).toBe(20)
  })

  it("barra os casos reais que vazaram: On-hold/Untracked sem capítulos e leitura baixa", () => {
    // "Lucia": nota 8.1, On-hold, 0/171 lidos.
    expect(
      canRateReadingState({ personalStatus: unread, chaptersRead: null, totalChapters: 171 }),
    ).toBe(false)
    // "The Fantasie of a Stepmother": nota 7.5, Reading, 10/174 = 5.7%.
    expect(
      canRateReadingState({ personalStatus: following, chaptersRead: 10, totalChapters: 174 }),
    ).toBe(false)
  })

  it("total desconhecido NÃO libera: 'não sei' não é prova de leitura", () => {
    expect(
      canRateReadingState({ personalStatus: following, chaptersRead: 300, totalChapters: null }),
    ).toBe(false)
  })

  it("o status default (nunca começou) nunca passa sem progresso", () => {
    expect(
      canRateReadingState({
        personalStatus: DEFAULT_PERSONAL_STATUS,
        chaptersRead: null,
        totalChapters: 100,
      }),
    ).toBe(false)
  })
})

describe("chaptersNeededForRating", () => {
  it("diz quantos capítulos faltam pra passar do limiar", () => {
    // 100 capítulos → precisa de 21 pra passar de 20%; com 5 lidos faltam 16.
    expect(
      chaptersNeededForRating({ personalStatus: following, chaptersRead: 5, totalChapters: 100 }),
    ).toBe(16)
    expect(
      chaptersNeededForRating({ personalStatus: following, chaptersRead: null, totalChapters: 100 }),
    ).toBe(21)
  })

  it("null quando já passa no gate ou quando o total é desconhecido", () => {
    expect(
      chaptersNeededForRating({ personalStatus: terminal, chaptersRead: null, totalChapters: 100 }),
    ).toBeNull()
    expect(
      chaptersNeededForRating({ personalStatus: following, chaptersRead: 50, totalChapters: 100 }),
    ).toBeNull()
    expect(
      chaptersNeededForRating({ personalStatus: following, chaptersRead: 1, totalChapters: null }),
    ).toBeNull()
  })
})
