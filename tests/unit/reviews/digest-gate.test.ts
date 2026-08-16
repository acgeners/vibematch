import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  MIN_USEFUL_REVIEWS_FOR_DIGEST,
  hasEnoughReviewsForDigest,
} from "@/lib/reviews/digest-gate"
import { classifyDigestReadiness, classifySummaryReadiness } from "@/lib/orchestration/integrations/reviews"

const digestArgs = (reviewCount: number, over: Partial<Parameters<typeof classifyDigestReadiness>[0]> = {}) => ({
  reviewCount,
  nowN: reviewCount,
  storedDigest: null,
  storedVersion: null,
  storedN: null,
  ...over,
})

/**
 * O piso de reviews do digest.
 *
 * Existe porque com 1-2 reviews o modelo não tem consenso pra destilar e produz um
 * digest que PARECE um digest — e o consultor IA o consome como sinal. Medição e
 * amostras estão em `lib/reviews/digest-gate.ts`.
 */
describe("piso de reviews do digest", () => {
  it("bloqueia abaixo do piso e libera a partir dele", () => {
    for (let n = 0; n < MIN_USEFUL_REVIEWS_FOR_DIGEST; n++) {
      expect(hasEnoughReviewsForDigest(n), `${n} reviews deveria bloquear`).toBe(false)
    }
    expect(hasEnoughReviewsForDigest(MIN_USEFUL_REVIEWS_FOR_DIGEST)).toBe(true)
  })

  it("o gate por obra recusa, e distingue 'poucas' de 'nenhuma'", () => {
    // Duas causas, duas mensagens: dizer "sem reviews" a uma obra que tem 3 manda
    // procurar o que já está lá.
    expect(classifyDigestReadiness(digestArgs(0))).toEqual({
      state: "not_applicable",
      reason: "no_reviews",
    })
    expect(classifyDigestReadiness(digestArgs(MIN_USEFUL_REVIEWS_FOR_DIGEST - 1))).toEqual({
      state: "not_applicable",
      reason: "few_reviews",
    })
    expect(classifyDigestReadiness(digestArgs(MIN_USEFUL_REVIEWS_FOR_DIGEST))).toEqual({
      state: "absent",
    })
  })

  it("`force` NÃO fura o piso", () => {
    // 🔴 A regressão mais provável: alguém precisa regerar uma obra específica,
    // passa `force` e o piso some. Forçar não cria consenso que as reviews não têm
    // — por isso o piso vem ANTES do force na função.
    expect(classifyDigestReadiness(digestArgs(1, { force: true }))).toEqual({
      state: "not_applicable",
      reason: "few_reviews",
    })
    // Com reviews suficientes, `force` volta a valer normalmente.
    expect(
      classifyDigestReadiness(
        digestArgs(MIN_USEFUL_REVIEWS_FOR_DIGEST, {
          force: true,
          storedDigest: { consensus: "x" },
          storedVersion: "digest-v1",
          storedN: MIN_USEFUL_REVIEWS_FOR_DIGEST,
        }),
      ),
    ).toEqual({ state: "stale", reason: "forced" })
  })

  it("o RESUMO não herda o piso — é outro artefato", () => {
    // O resumo é Haiku (~0,2¢) e é texto pra LER, não consenso destilado: uma
    // review só já vale um parágrafo. Se o piso vazasse pro summary, 25 obras
    // perderiam o resumo que hoje têm, sem ninguém decidir isso.
    const summary = classifySummaryReadiness({
      reviewCount: 1,
      currentHash: "h",
      nowN: 1,
      storedSummary: null,
      storedMeta: null,
    })
    expect(summary).toEqual({ state: "absent" })
  })
})

/**
 * 🔴 Teste de ARQUITETURA: a régua tem que ter um dono só.
 *
 * São três consumidores que precisam concordar — o gate por obra, o lote e a fila
 * da aba. Uma comparação reescrita em qualquer um deles é como a aba mostra 107
 * obras elegíveis e o botão recusa uma delas.
 *
 * ⚠️ O padrão casa o FATO (comparar contagem de review contra um número), não a
 * grafia de uma constante: escrever `>= 4` de outro jeito não escapa.
 */
describe("o piso tem dono único", () => {
  /** Quem DECIDE elegibilidade por conta própria — tem que importar a régua. */
  const DECIDEM = [
    "lib/orchestration/integrations/reviews.ts",
    "server/queries/review-digest-queue.ts",
    "components/ai-evaluation/digests-tab.tsx",
  ]

  const semComentarios = (arquivo: string): string =>
    readFileSync(join(process.cwd(), arquivo), "utf8")
      // Comentários citam os números da medição ("25-75%", "≥4 é limpo") — o que
      // se procura é comparação em CÓDIGO.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")

  it("ninguém reescreve a comparação de contagem de review", () => {
    const ofensores: string[] = []
    for (const arquivo of [...DECIDEM, "server/actions/review-digest-batch.ts"]) {
      // ⚠️ Contra literal NÃO-ZERO. `=== 0` é outro fato — "nenhuma review" contra
      // "poucas reviews" —, e as duas causas têm mensagens distintas de propósito.
      // Incluir o zero fazia este teste reprovar o código correto.
      const comparacoes = semComentarios(arquivo).match(
        /(review|useful)\w*\s*(>=|<=|>|<|===|!==)\s*[1-9]\d*|[1-9]\d*\s*(>=|<=|>|<)\s*\w*(review|useful)\w*/gi,
      )
      if (comparacoes) ofensores.push(`${arquivo}: ${comparacoes.join(", ")}`)
    }
    expect(ofensores, "use hasEnoughReviewsForDigest / MIN_USEFUL_REVIEWS_FOR_DIGEST").toEqual([])
  })

  it("quem decide elegibilidade importa a régua", () => {
    for (const arquivo of DECIDEM) {
      expect(semComentarios(arquivo), `${arquivo} deveria importar de digest-gate`).toContain(
        "@/lib/reviews/digest-gate",
      )
    }
  })

  it("o LOTE não decide nada — delega pro caminho gateado", () => {
    // 🔴 É por isso que ele NÃO importa a régua: aplicar o piso ali seria uma
    // segunda opinião sobre o mesmo fato. O lote anterior (no /curation/settings) chamava o
    // consolidador direto, com corpus próprio e sem gate nenhum — e foi por isso
    // que ele foi aposentado em vez de corrigido.
    const src = semComentarios("server/actions/review-digest-batch.ts")
    expect(src).toContain("ensureReviewDigest")
    expect(src, "o lote não pode voltar a chamar o consolidador direto").not.toContain(
      "consolidateReviewsDigestDetailed",
    )
  })
})
