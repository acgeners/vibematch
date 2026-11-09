import { describe, it, expect } from "vitest"
import { decidePublicationStatus, statusBySource } from "@/lib/external/publication-status-sync"
import { getPublicationStatusIdByName } from "@/lib/constants/status-lookups"
import { CATALOG_SYNC_STATUSES } from "@/server/queries/catalog-sync"

// A regra ÚNICA de status (2026-11-09): vale para a /reading, o lote do catálogo e o
// "Atualizar automático". O que cada caso guarda está no nome dele.

describe("decidePublicationStatus — quem decide", () => {
  it("o MangaUpdates vence o Comix", () => {
    expect(decidePublicationStatus("Ongoing", { mangaupdates: "Completed", comix: "Hiatus" })).toEqual({
      status: "Completed",
      source: "mangaupdates",
    })
  })

  it("sem MangaUpdates, o Comix decide", () => {
    expect(decidePublicationStatus("Ongoing", { mangaupdates: null, comix: "Hiatus" })).toEqual({
      status: "Hiatus",
      source: "comix",
    })
  })

  it("'Unknown' não é opinião: o Comix dizendo 'releasing' não muda nada", () => {
    expect(decidePublicationStatus("Ongoing", { mangaupdates: null, comix: "Unknown" })).toBeNull()
    expect(decidePublicationStatus("Ongoing", { mangaupdates: "Unknown", comix: "Completed" })).toEqual({
      status: "Completed",
      source: "comix",
    })
  })

  it("mesmo status que o gravado: nada a gravar", () => {
    expect(decidePublicationStatus("Hiatus", { mangaupdates: "Hiatus" })).toBeNull()
  })
})

describe("decidePublicationStatus — o que nunca acontece", () => {
  it("nunca tira uma obra de Completed ou Cancelled", () => {
    for (const current of ["Completed", "Cancelled"]) {
      for (const status of ["Ongoing", "Hiatus", "Cancelled", "Completed"]) {
        expect(decidePublicationStatus(current, { mangaupdates: status })).toBeNull()
      }
    }
  })

  it("'Ongoing' nunca vem do Comix", () => {
    expect(decidePublicationStatus("Hiatus", { mangaupdates: null, comix: "Ongoing" })).toBeNull()
  })

  it("'Ongoing' não troca um status que não seja de hiato ou desconhecido", () => {
    // Hoje só sobra Ongoing → Ongoing (nada) e os terminais (bloqueados acima); o caso
    // guarda a forma da regra para quando um status novo aparecer.
    expect(decidePublicationStatus("Novo Status", { mangaupdates: "Ongoing" })).toBeNull()
  })
})

describe("decidePublicationStatus — fim do hiato e status desconhecido", () => {
  it("Hiatus → Ongoing quando o MangaUpdates diz que voltou", () => {
    expect(decidePublicationStatus("Hiatus", { mangaupdates: "Ongoing", comix: "Hiatus" })).toEqual({
      status: "Ongoing",
      source: "mangaupdates",
    })
  })

  it("obra sem status conhecido recebe o do MangaUpdates, inclusive Ongoing", () => {
    expect(decidePublicationStatus("Unknown", { mangaupdates: "Ongoing" })?.status).toBe("Ongoing")
    expect(decidePublicationStatus(null, { mangaupdates: "Ongoing" })?.status).toBe("Ongoing")
  })

  it("em andamento → concluída ou em hiato", () => {
    expect(decidePublicationStatus("Ongoing", { mangaupdates: "Completed" })?.status).toBe("Completed")
    expect(decidePublicationStatus("Ongoing", { mangaupdates: "Hiatus" })?.status).toBe("Hiatus")
  })
})

describe("statusBySource", () => {
  it("lê o status de cada fonte na procedência do merge", () => {
    expect(
      statusBySource([
        { value: "Completed", sources: ["mangaupdates", "kitsu"] },
        { value: "Unknown", sources: ["comix"] },
        { value: "Ongoing", sources: ["anilist"] },
      ]),
    ).toEqual({ mangaupdates: "Completed", comix: "Unknown" })
  })

  it("sem procedência, nenhuma fonte opina", () => {
    expect(statusBySource(undefined)).toEqual({ mangaupdates: null, comix: null })
  })
})

describe("o universo do lote do catálogo", () => {
  it("são as obras em andamento, em hiato ou sem status — nunca concluídas ou canceladas", () => {
    expect([...CATALOG_SYNC_STATUSES].sort()).toEqual(["Hiatus", "Ongoing", "Unknown"])
  })

  it("todo status do lote existe no banco (renomear um no Supabase reprova aqui)", () => {
    for (const status of CATALOG_SYNC_STATUSES) {
      expect(getPublicationStatusIdByName(status), status).not.toBeNull()
    }
  })
})
