import { describe, it, expect } from "vitest"
import {
  publicationBucketOf,
  readingBucketOf,
  passesMoodExclusions,
  isMoodActive,
  MOOD_EXCLUSION_KEYS,
  type MoodExclusionKey,
  type MoodWork,
} from "@/lib/calculations/mood-refine"
import {
  getPersonalStatusIdByName,
  getPublicationStatusIdByName,
} from "@/lib/constants/status-lookups"
import { PERSONAL_STATUSES_BY_ID, PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"

/**
 * "Não mostrar": tirar categorias inteiras da comparação — a operação que a rampa de
 * peso não faz. O par diz "prefiro concluída" (empurra pro topo); a exclusão diz "não
 * me mostre hiato" (a obra sai da tela). São perguntas diferentes e convivem.
 *
 * 🔴 O risco desta feature é o balde ERRADO: uma obra em curso classificada como
 * "descartada" some da comparação sem a pessoa ter pedido, e some em silêncio. Por
 * isso os testes abaixo varrem os 12 status pessoais e os 5 de publicação — não uma
 * amostra que eu tenha lembrado.
 */

const PUB = (nome: string) => {
  const id = getPublicationStatusIdByName(nome)
  if (id == null) throw new Error(`status de publicação "${nome}" não existe`)
  return id
}
const PER = (nome: string) => {
  const id = getPersonalStatusIdByName(nome)
  if (id == null) throw new Error(`status pessoal "${nome}" não existe`)
  return id
}

const obra = (over: Partial<MoodWork> = {}): MoodWork => ({
  id: "x",
  decisionScore: 8,
  scores: {},
  totalChapters: 100,
  personalFit: 0.5,
  totalVotes: 1000,
  synopsisQuality: "♥♥♥",
  ...over,
})

describe("cada status cai num balde, e no balde CERTO", () => {
  it("publicação: os quatro conhecidos, e o desconhecido em nenhum", () => {
    expect(publicationBucketOf(PUB("Completed"))).toBe("pub:concluded")
    expect(publicationBucketOf(PUB("Ongoing"))).toBe("pub:ongoing")
    expect(publicationBucketOf(PUB("Hiatus"))).toBe("pub:hiatus")
    expect(publicationBucketOf(PUB("Cancelled"))).toBe("pub:cancelled")
    // "não sei" não pode virar "não serve" — mesma régua de `startabilityOf`.
    expect(publicationBucketOf(PUB("Unknown"))).toBeNull()
    expect(publicationBucketOf(null)).toBeNull()
  })

  /**
   * 🔴 O caso que motivou o pedido: "Not Now", "Not Interested" e "Dropped" são
   * descartadas. E o contraexemplo que quase estragou a régua: `hideFromInterest`
   * parecia servir para agrupá-las, mas ela também é true em `Stalled`, `Read Again`
   * e `Finished` — usá-la varreria leitura em curso pro balde de descarte.
   */
  it("leitura: descartadas são exatamente Dropped, Not Now e Not Interested", () => {
    for (const nome of ["Dropped", "Not Now", "Not Interested"]) {
      expect(readingBucketOf(PER(nome)), `${nome} deveria ser descartada`).toBe("read:discarded")
    }
    for (const nome of ["Stalled", "Read Again", "On-hold", "Hiatus", "Reading", "Started"]) {
      expect(readingBucketOf(PER(nome)), `${nome} NÃO é descartada — é leitura em curso`).toBe(
        "read:inProgress",
      )
    }
    expect(readingBucketOf(PER("Finished"))).toBe("read:finished")
    expect(readingBucketOf(PER("Untracked"))).toBe("read:unstarted")
    expect(readingBucketOf(PER("Want to Read"))).toBe("read:unstarted")
  })

  /**
   * Varredura COMPLETA: status novo no Supabase tem que cair em algum balde de
   * propósito, não sumir da UI nem entrar num balde por acidente.
   */
  it("TODO status pessoal do catálogo tem balde", () => {
    const semBalde = Object.values(PERSONAL_STATUSES_BY_ID)
      .filter((info) => readingBucketOf(info.id) == null)
      .map((info) => info.status)
    expect(semBalde, "status pessoal sem balde de exclusão").toEqual([])
  })

  it("todo balde declarado é alcançável por algum status — nenhum é decorativo", () => {
    const alcancados = new Set<MoodExclusionKey>()
    for (const info of Object.values(PERSONAL_STATUSES_BY_ID)) {
      const b = readingBucketOf(info.id)
      if (b) alcancados.add(b)
    }
    for (const info of Object.values(PUBLICATION_STATUSES_BY_ID)) {
      const b = publicationBucketOf(info.id)
      if (b) alcancados.add(b)
    }
    const orfaos = MOOD_EXCLUSION_KEYS.filter((k) => !alcancados.has(k))
    expect(orfaos, "balde que nenhum status alcança — chip que nunca exclui nada").toEqual([])
  })
})

describe("a exclusão tira da comparação", () => {
  it("sem exclusão, tudo passa", () => {
    const w = obra({ publicationStatusId: PUB("Hiatus"), personalStatusId: PER("Dropped") })
    expect(passesMoodExclusions(w, { attributes: {} })).toBe(true)
    expect(passesMoodExclusions(w, { attributes: {}, exclude: [] })).toBe(true)
  })

  it("o cenário pedido: concluídas ou em andamento, sem hiato nem cancelada", () => {
    const mood = { attributes: {}, exclude: ["pub:hiatus", "pub:cancelled"] as MoodExclusionKey[] }
    expect(passesMoodExclusions(obra({ publicationStatusId: PUB("Completed") }), mood)).toBe(true)
    expect(passesMoodExclusions(obra({ publicationStatusId: PUB("Ongoing") }), mood)).toBe(true)
    expect(passesMoodExclusions(obra({ publicationStatusId: PUB("Hiatus") }), mood)).toBe(false)
    expect(passesMoodExclusions(obra({ publicationStatusId: PUB("Cancelled") }), mood)).toBe(false)
  })

  it("o outro cenário: fora Not Now, Not Interested e Dropped", () => {
    const mood = { attributes: {}, exclude: ["read:discarded"] as MoodExclusionKey[] }
    for (const nome of ["Not Now", "Not Interested", "Dropped"]) {
      expect(passesMoodExclusions(obra({ personalStatusId: PER(nome) }), mood), nome).toBe(false)
    }
    for (const nome of ["Reading", "Untracked", "Finished", "Stalled"]) {
      expect(passesMoodExclusions(obra({ personalStatusId: PER(nome) }), mood), nome).toBe(true)
    }
  })

  /**
   * 🔴 Obra sem status não pode ser excluída por um filtro de status: "não sei" não é
   * "não serve", e sumir em silêncio é o pior desfecho possível aqui.
   */
  it("obra sem status sobrevive a qualquer exclusão", () => {
    const w = obra({ publicationStatusId: null, personalStatusId: null })
    expect(passesMoodExclusions(w, { attributes: {}, exclude: [...MOOD_EXCLUSION_KEYS] })).toBe(true)
  })

  it("excluir alguma coisa já torna o mood ATIVO — senão o botão diria 'Comparar' sem refletir", () => {
    expect(isMoodActive({ attributes: {} })).toBe(false)
    expect(isMoodActive({ attributes: {}, exclude: ["pub:hiatus"] })).toBe(true)
  })
})
