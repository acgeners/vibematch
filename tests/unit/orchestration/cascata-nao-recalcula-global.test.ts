import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * E2 — "Gerar tudo" não pode disparar um recálculo GLOBAL por obra.
 *
 * O defeito medido em 22/08/2026: `generateAllWorkData` tinha um passo
 * `recalculateScoresNow()` (force=true), que lê o catálogo inteiro e retreina o Ridge.
 * A cascata roda UMA VEZ POR OBRA e não existe caller de lote, então N obras produziam
 * N recálculos globais — conferido empiricamente: 3 obras → 3 recalcs de 1000 obras cada.
 *
 * 🔴 O single-flight NÃO protege: `ensureRecalculateScores` deduplica por
 * `generation: state.lastEditAt`, e cada obra produz um `lastEditAt` novo. A dedup existe,
 * funciona, e nunca alcança o caso real.
 *
 * ⚠️ Este teste guarda a DIREÇÃO, não a grafia: o que ele proíbe é a cascata FORÇAR o
 * recálculo. Deferir (marcar pendência) é o comportamento correto, e é o mesmo que
 * `createWork`, `createWorksBatch` e `updateWork` já fazem.
 */

const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const CASCATA = join(process.cwd(), "server/actions/generate-all.ts")
const fonte = semComentarios(readFileSync(CASCATA, "utf8"))

describe("a cascata de 'Gerar tudo' defere o recálculo global", () => {
  it("NÃO chama recalculateScoresNow (o recalc forçado do catálogo inteiro)", () => {
    expect(
      fonte.includes("recalculateScoresNow"),
      "generate-all.ts voltou a forçar o recálculo global. Como a cascata roda uma vez por " +
        "OBRA e não há caller de lote, isso é 1 recálculo do catálogo inteiro por obra " +
        "(medido: 7,14 MB crus / 1,78 MB gzip · 216 queries cada). Marque a pendência e deixe " +
        "os donos existentes rodarem: finalizePendingBatch, maybeTriggerStaleRecalc ou o botão.",
    ).toBe(false)
  })

  it("marca a pendência, declarando o input que mudou", () => {
    expect(fonte).toContain("markRecalcPending(")
    // `changed` declarado ⇒ o gate de materialidade decide; omitir significa "não sei" e
    // marcaria sempre. A cascata SABE o que mexeu: as 9 notas de atributo.
    expect(fonte).toMatch(/markRecalcPending\([^)]*changed:\s*\["category_scores"\]/)
  })

  it("nenhum passo POSTERIOR ao recalc lê `calculated_scores`", () => {
    // É isto que autoriza deferir. Conferido em 22/08 nos três:
    //   embedding  → lê `category_scores` (atributos), não `calculated_scores`
    //   alignment  → ESCREVE com upsert onConflict work_id (cria a linha)
    //   interesse  → tabela própria
    const emb = readFileSync(join(process.cwd(), "server/embeddings/refresh.ts"), "utf8")
    const colunas = emb.match(/const WORK_COLS = `([\s\S]*?)`/)?.[1] ?? ""
    expect(colunas, "WORK_COLS do embedding não casou — releia antes de confiar neste teste").toContain(
      "category_scores",
    )
    expect(
      colunas.includes("calculated_scores"),
      "o embedding passou a depender de `calculated_scores` — o recalc deixou de ser deferível " +
        "e este teste precisa ser reavaliado JUNTO com a cascata.",
    ).toBe(false)
  })

  it("o dono do recalc deferido continua existindo", () => {
    // Se estes três sumirem, deferir vira PERDER o recálculo — o "N → 0" que o fix não pode causar.
    const queue = readFileSync(join(process.cwd(), "server/recalc/queue.ts"), "utf8")
    expect(queue).toContain("maybeTriggerStaleRecalc")
    const works = readFileSync(join(process.cwd(), "server/actions/works.ts"), "utf8")
    expect(works).toContain("export async function finalizePendingBatch")
  })
})
