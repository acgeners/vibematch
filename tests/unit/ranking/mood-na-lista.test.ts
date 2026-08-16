import { describe, it, expect } from "vitest"

import { applyMoodToList, moodDimensionCount } from "@/lib/ranking/mood-list"
import { computeMoodAdjusted, type MoodRefine, type MoodWork } from "@/lib/calculations/mood-refine"
import { getPersonalStatusIdByName, getPublicationStatusIdByName } from "@/lib/constants/status-lookups"

/**
 * O refino aplicado a uma LISTA. As três invariantes que o separam do refino de
 * cluster — e cada uma existe por um defeito que ela impede:
 *
 *  1. sem mood, a ordem da lista é a do servidor (o refino não pode "sempre" agir);
 *  2. excluir vem ANTES de normalizar (obra fora não pode esticar a régua);
 *  3. o conjunto de normalização é a LISTA — e é por isso que o comparador precisa
 *     herdar estes valores em vez de recalcular sobre a seleção.
 */

const PUB = (nome: string) => {
  const id = getPublicationStatusIdByName(nome)
  if (id == null) throw new Error(`publication_status "${nome}" não existe`)
  return id
}
const PESSOAL = (nome: string) => {
  const id = getPersonalStatusIdByName(nome)
  if (id == null) throw new Error(`personal_status "${nome}" não existe`)
  return id
}

function obra(id: string, over: Partial<MoodWork> = {}): MoodWork {
  return {
    id,
    decisionScore: 8,
    scores: { romance: 5, drama: 5, tragedy: 5 },
    totalChapters: 50,
    personalFit: 0.5,
    totalVotes: 1000,
    synopsisQuality: "♥♥",
    artPercentile: 0.5,
    publicationStatusId: PUB("Ongoing"),
    platformAvg: 7,
    year: 2020,
    personalStatusId: PESSOAL("Untracked"),
    ...over,
  }
}

describe("mood aplicado à lista", () => {
  it("sem mood ativo, devolve a lista intacta e sem valores ajustados", () => {
    const lista = [obra("a"), obra("b"), obra("c")]
    const vazio: MoodRefine = { attributes: {}, practical: {} }

    for (const mood of [null, undefined, vazio]) {
      const r = applyMoodToList(lista, mood)
      expect(r.active).toBe(false)
      expect(r.works.map((w) => w.id)).toEqual(["a", "b", "c"])
      expect(r.adjusted.size).toBe(0)
    }
  })

  it("reordena pela Prioridade ajustada, e o valor bate com o dono do cálculo", () => {
    const lista = [
      obra("baixa-arte", { artPercentile: 0.1 }),
      obra("alta-arte", { artPercentile: 0.95 }),
      obra("media-arte", { artPercentile: 0.5 }),
    ]
    const mood: MoodRefine = { attributes: {}, practical: { art: 2 } }

    const r = applyMoodToList(lista, mood)

    expect(r.active).toBe(true)
    expect(r.works.map((w) => w.id)).toEqual(["alta-arte", "media-arte", "baixa-arte"])
    // 🔴 Não recalcula: os valores TÊM que ser os de `computeMoodAdjusted`, senão a
    // lista ordena por um número e a célula imprime outro.
    const dono = computeMoodAdjusted(lista, mood)
    for (const w of lista) {
      expect(r.adjusted.get(w.id)).toBe(dono.get(w.id))
    }
  })

  it("EXCLUI antes de normalizar — a obra fora não estica a régua de quem ficou", () => {
    // A cancelada é a única com arte no topo. Se ela participasse do min/max, as
    // duas que sobram seriam comprimidas contra ela e a distância entre elas
    // encolheria; excluída de verdade, a régua passa a ser só delas.
    const lista = [
      obra("fica-1", { artPercentile: 0.2 }),
      obra("fica-2", { artPercentile: 0.4 }),
      obra("sai", { artPercentile: 1, publicationStatusId: PUB("Cancelled") }),
    ]
    const mood: MoodRefine = {
      attributes: {},
      practical: { art: 2 },
      exclude: ["pub:cancelled"],
    }

    const r = applyMoodToList(lista, mood)

    expect(r.works.map((w) => w.id)).toEqual(["fica-2", "fica-1"])
    expect(r.adjusted.has("sai")).toBe(false)

    const soAsQueFicam = [lista[0], lista[1]]
    const dono = computeMoodAdjusted(soAsQueFicam, mood)
    expect(r.adjusted.get("fica-1")).toBe(dono.get("fica-1"))
    expect(r.adjusted.get("fica-2")).toBe(dono.get("fica-2"))

    // A contraprova: normalizar ANTES de excluir daria outro número para as duas
    // que ficaram — é exatamente o erro que a ordem das operações evita.
    const comAExcluida = computeMoodAdjusted(lista, mood)
    expect(comAExcluida.get("fica-1")).not.toBe(dono.get("fica-1"))
  })

  it("o CONJUNTO muda o resultado — por isso o comparador herda em vez de recalcular", () => {
    const lista = [
      obra("x", { artPercentile: 0.5 }),
      obra("y", { artPercentile: 0.6 }),
      obra("z", { artPercentile: 1 }),
    ]
    const mood: MoodRefine = { attributes: {}, practical: { art: 2 } }

    const naLista = applyMoodToList(lista, mood)
    // O mesmo par, sozinho: `computeMoodFit` renormaliza no universo que recebe.
    const noSubconjunto = computeMoodAdjusted([lista[0], lista[1]], mood)

    expect(noSubconjunto.get("x")).not.toBe(naLista.adjusted.get("x"))
  })

  it("conta ajustes e exclusões separadamente", () => {
    expect(moodDimensionCount(null)).toEqual({ weights: 0, exclusions: 0 })
    expect(
      moodDimensionCount({
        attributes: { romance: 2 },
        practical: { art: 1, popularity: -2 },
        chapters: "curto",
        exclude: ["pub:hiatus", "read:finished"],
      }),
    ).toEqual({ weights: 4, exclusions: 2 })
  })
})
