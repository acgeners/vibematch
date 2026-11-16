import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("server-only", () => ({}))

const ordem = vi.hoisted(() => [] as string[])
const acquire = vi.hoisted(() => ({ pool: 40 }))
const saveWorkReviews = vi.hoisted(() =>
  vi.fn(async (_id: string, _r: unknown[], opts: { skipPaidEnrichment?: boolean }) => {
    ordem.push(opts.skipPaidEnrichment ? "grava recorte sem pago" : "gera pago sobre o recorte")
  }),
)
const acquireAndPersistWorkReviews = vi.hoisted(() =>
  vi.fn(async (_id: string, opts: { skipPaidEnrichment?: boolean }) => {
    ordem.push(opts.skipPaidEnrichment ? "busca completa sem pago" : "busca completa + pago")
    return acquire.pool
  }),
)
vi.mock("@/lib/external/persist-reviews", () => ({ saveWorkReviews }))
vi.mock("@/lib/external/acquire-reviews", () => ({ acquireAndPersistWorkReviews }))

import { acquireReviewsForNewWork } from "@/server/works/new-work-reviews"
import type { SourcedReview } from "@/lib/external/types"

/**
 * "Na hora de salvar a obra, pergunta se quer enriquecer, mas não espera buscar as reviews"
 * (16/11/2026). A obra avaliada no "Buscar dados" gerava resumo, digest e tags só sobre o
 * recorte da busca rápida — a busca completa nunca acontecia, e a Comix (hid descoberto depois)
 * ficava de fora. Este teste fixa a ORDEM.
 */

const recorte = [{ source: "mangaupdates", text: "review" }] as unknown as SourcedReview[]
const passos = {
  comixHidReady: async () => void ordem.push("hid da Comix"),
  inferTags: async () => void ordem.push("tags"),
}

describe("reviews da obra nova", () => {
  beforeEach(() => {
    ordem.length = 0
    acquire.pool = 40
  })

  it("avaliada: recorte sem pago → Comix → busca completa com o pago → tags", async () => {
    await acquireReviewsForNewWork("w1", recorte, { skipPaidEnrichment: false }, passos)
    expect(ordem).toEqual(["grava recorte sem pago", "hid da Comix", "busca completa + pago", "tags"])
  })

  it("sem avaliação: Comix → busca completa com o pago → tags", async () => {
    await acquireReviewsForNewWork("w1", null, { skipPaidEnrichment: false }, passos)
    expect(ordem).toEqual(["hid da Comix", "busca completa + pago", "tags"])
  })

  it("busca completa vazia: o pago sai sobre o recorte, para a obra não ficar sem resumo e digest", async () => {
    acquire.pool = 0
    await acquireReviewsForNewWork("w1", recorte, { skipPaidEnrichment: false }, passos)
    expect(ordem).toEqual(["grava recorte sem pago", "hid da Comix", "busca completa + pago", "gera pago sobre o recorte", "tags"])
  })

  it("'Salvar sem IA': nada pago em nenhum passo", async () => {
    acquire.pool = 0
    await acquireReviewsForNewWork("w1", recorte, { skipPaidEnrichment: true }, passos)
    expect(ordem).not.toContain("busca completa + pago")
    expect(ordem).not.toContain("gera pago sobre o recorte")
  })
})

describe("as duas criações passam pelo dono da ordem", () => {
  // O teste acima passaria verde com `createWork` chamando a busca por fora dele.
  const fonte = readFileSync(join(process.cwd(), "server/actions/works.ts"), "utf8")
  const corpo = (nome: string) => {
    const ini = fonte.indexOf(`export async function ${nome}(`)
    const fim = fonte.indexOf("\nexport async function ", ini + 1)
    return fonte.slice(ini, fim === -1 ? undefined : fim)
  }
  const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

  it.each(["createWork", "createWorksBatch"])("%s usa acquireReviewsForNewWork e não chama a busca direto", (nome) => {
    const c = semComentarios(corpo(nome))
    expect(c.length).toBeGreaterThan(200)
    expect(c).toContain("acquireReviewsForNewWork(")
    expect(c).not.toContain("acquireAndPersistWorkReviews")
  })
})
