/**
 * A semântica dos status pessoais vem do BANCO (`personal_status`, migration 155), gerada por
 * `sync-constants`. Estes testes travam o contrato — e existem por uma razão concreta:
 *
 * Renomear "Completed" → "Finished" no Supabase quebrou 10 lugares do código, e o TypeScript só
 * pegou 6. Os outros quatro eram strings soltas dentro de `new Set([...])` / arrays — o TS não
 * tipa isso, então elas simplesmente PARARAM DE CASAR, em silêncio. As 74 obras terminadas
 * deixariam de disparar o formulário das 8 notas pós-leitura, de sumir do ranking e de sair da
 * fila de Interesse. Nenhum erro, nenhum log: só telas em branco e uma nota que nunca é pedida.
 *
 * 🔴 NÃO escreva o nome de um status à mão. Pergunte o conceito.
 */
import { describe, it, expect } from "vitest"
import {
  isTerminalPersonalStatus,
  isFullyReadPersonalStatus,
  tracksProgressPersonalStatus,
  isInterestHiddenPersonalStatus,
  FULLY_READ_STATUS,
} from "@/lib/constants/status-lookups"
import {
  PERSONAL_STATUSES_BY_ID,
  TERMINAL_PERSONAL_STATUSES,
  FULLY_READ_PERSONAL_STATUSES,
  PROGRESS_PERSONAL_STATUSES,
  INTEREST_HIDDEN_PERSONAL_STATUSES,
} from "@/lib/constants/criteria"
import { PERSONAL_STATUSES } from "@/types/domain"

describe("semântica de personal_status — vem do banco, não do código", () => {
  it("os 4 conjuntos gerados não estão vazios (sinal de sync-constants desatualizado)", () => {
    expect(TERMINAL_PERSONAL_STATUSES.length).toBeGreaterThan(0)
    expect(FULLY_READ_PERSONAL_STATUSES.length).toBe(1)
    expect(PROGRESS_PERSONAL_STATUSES.length).toBeGreaterThan(0)
    expect(INTEREST_HIDDEN_PERSONAL_STATUSES.length).toBeGreaterThan(0)
  })

  it("todo status dos conjuntos existe em PERSONAL_STATUSES (nenhum nome órfão)", () => {
    const conhecidos = new Set<string>(PERSONAL_STATUSES)
    for (const set of [
      TERMINAL_PERSONAL_STATUSES,
      FULLY_READ_PERSONAL_STATUSES,
      PROGRESS_PERSONAL_STATUSES,
      INTEREST_HIDDEN_PERSONAL_STATUSES,
    ]) {
      for (const s of set) expect(conhecidos.has(s)).toBe(true)
    }
  })

  it("os helpers aceitam nome E id, e concordam entre si", () => {
    for (const info of Object.values(PERSONAL_STATUSES_BY_ID)) {
      expect(isTerminalPersonalStatus(info.status)).toBe(info.isTerminal)
      expect(isTerminalPersonalStatus(info.id)).toBe(info.isTerminal)
      expect(isFullyReadPersonalStatus(info.status)).toBe(info.isFullyRead)
      expect(tracksProgressPersonalStatus(info.status)).toBe(info.tracksProgress)
      expect(isInterestHiddenPersonalStatus(info.status)).toBe(info.hideFromInterest)
    }
  })

  it("status desconhecido/nulo é falso em tudo (nunca 'terminal' por engano)", () => {
    for (const v of [null, undefined, "", "Completed", "Xablau", 999]) {
      expect(isTerminalPersonalStatus(v)).toBe(false)
      expect(isFullyReadPersonalStatus(v)).toBe(false)
    }
  })

  it("🔴 o REGRESSO: 'Completed' não é mais um status — e o app não pode depender do nome", () => {
    // Este é o teste que teria ficado vermelho no dia do rename, em vez das 74 obras
    // silenciosamente pararem de pedir as notas pós-leitura.
    expect((PERSONAL_STATUSES as readonly string[]).includes("Completed")).toBe(false)
    expect(isFullyReadPersonalStatus("Completed")).toBe(false)

    // O conceito, porém, continua existindo — só que ancorado no banco.
    expect(FULLY_READ_STATUS).toBeTruthy()
    expect(isFullyReadPersonalStatus(FULLY_READ_STATUS)).toBe(true)
    expect(isTerminalPersonalStatus(FULLY_READ_STATUS)).toBe(true)
  })

  it("quem 'leu tudo' é necessariamente terminal e tem progresso (invariante de coerência)", () => {
    for (const info of Object.values(PERSONAL_STATUSES_BY_ID)) {
      if (info.isFullyRead) {
        expect(info.isTerminal).toBe(true)
        expect(info.tracksProgress).toBe(true)
      }
    }
  })
})
