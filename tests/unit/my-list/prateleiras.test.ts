import { describe, it, expect } from "vitest"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import {
  SHELVES,
  belongsToMyList,
  shelfOfStatus,
  shelfOfStatusId,
} from "@/lib/my-list/shelves"
import {
  getPersonalStatusIdByName,
  personalStatusNameBySlugOrThrow,
  UNTRACKED_PERSONAL_STATUS,
} from "@/lib/constants/status-lookups"

const idPorSlug = (slug: string) =>
  getPersonalStatusIdByName(personalStatusNameBySlugOrThrow(slug))!

describe("prateleiras da /my-list: a partição é TOTAL", () => {
  /**
   * O risco que isto pega não é o rename — é o status NOVO. Um status criado no Supabase que
   * não casasse com prateleira nenhuma faria as obras dele sumirem da página em silêncio:
   * presentes no total, ausentes de toda prateleira. Por isso o teste ENUMERA a tabela, em vez
   * de listar os 12 status de hoje.
   */
  it("todo status pessoal tem prateleira, menos Untracked", () => {
    const chaves = new Set(SHELVES.map((s) => s.key))
    const orfaos: string[] = []
    for (const info of Object.values(PERSONAL_STATUSES_BY_ID)) {
      const shelf = shelfOfStatus(info)
      if (info.status === UNTRACKED_PERSONAL_STATUS) {
        expect(shelf, "Untracked não pode ter prateleira — ele é o 'fora da lista'").toBeNull()
        continue
      }
      if (shelf == null || !chaves.has(shelf)) orfaos.push(`${info.status} → ${shelf}`)
    }
    expect(orfaos, `status sem prateleira (sumiriam da página): ${orfaos.join(", ")}`).toEqual([])
  })

  it("cada status cai em UMA prateleira, e nas esperadas", () => {
    expect(shelfOfStatusId(idPorSlug("reading"))).toBe("lendo")
    expect(shelfOfStatusId(idPorSlug("started"))).toBe("lendo")
    expect(shelfOfStatusId(idPorSlug("hiatus"))).toBe("lendo")
    expect(shelfOfStatusId(idPorSlug("on-hold"))).toBe("pausadas")
    expect(shelfOfStatusId(idPorSlug("stalled"))).toBe("pausadas")
    expect(shelfOfStatusId(idPorSlug("finished"))).toBe("terminadas")
    expect(shelfOfStatusId(idPorSlug("dropped"))).toBe("terminadas")
    expect(shelfOfStatusId(idPorSlug("want-to-read"))).toBe("quero")
    expect(shelfOfStatusId(idPorSlug("not_now"))).toBe("descartadas")
    expect(shelfOfStatusId(idPorSlug("not_interested"))).toBe("descartadas")
    // `Read Again` é `tracks_progress` e cairia em "lendo" se a ordem dos ramos mudasse.
    expect(shelfOfStatusId(idPorSlug("read_again"))).toBe("reler")
  })
})

describe("pertencimento: a régua NÃO pode olhar o rótulo resolvido", () => {
  /**
   * 🔴 O caso que decide a feature. `is_default_unset` está em "Want to Read", então obra sem
   * linha no espelho APARENTA "Want to Read". Medido em 2026-08-16: o curador tem 988 linhas e
   * a conta leitora tem 0 — uma régua sobre o rótulo daria à conta nova o catálogo INTEIRO como
   * "Quero ler". Aqui: sem linha ⇒ `personalStatusId` null ⇒ fora.
   */
  it("conta nova (sem linha nenhuma) tem lista VAZIA", () => {
    expect(belongsToMyList({ personalStatusId: null, userScore: null })).toBe(false)
  })

  it("Untracked sem nota fica de fora", () => {
    expect(
      belongsToMyList({ personalStatusId: idPorSlug("untracked"), userScore: null }),
    ).toBe(false)
  })

  // Medido: 4 obras estão em Untracked COM nota. A pessoa se pronunciou.
  it("Untracked COM nota entra — e sem prateleira", () => {
    const id = idPorSlug("untracked")
    expect(belongsToMyList({ personalStatusId: id, userScore: 8.5 })).toBe(true)
    expect(shelfOfStatusId(id)).toBeNull()
  })

  it("qualquer status de leitura entra, mesmo sem nota", () => {
    for (const slug of ["reading", "want-to-read", "finished", "not_interested"]) {
      expect(
        belongsToMyList({ personalStatusId: idPorSlug(slug), userScore: null }),
        `${slug} deveria entrar na lista`,
      ).toBe(true)
    }
  })
})
