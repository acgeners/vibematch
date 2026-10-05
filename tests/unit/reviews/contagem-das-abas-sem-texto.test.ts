import { beforeEach, describe, expect, it, vi } from "vitest"
import { REVIEW_DIGEST_VERSION } from "@/lib/ai-recommendation/review-summarizer"
import { MIN_USEFUL_REVIEWS_FOR_DIGEST } from "@/lib/reviews/digest-gate"

/**
 * As contagens das abas de /curation/works (`getCuradoriaTabCounts`) recalculam a cada 60 s e
 * a cada action de curadoria que invalida a tag. Medido em 2026-10-05: cada recarga trazia o
 * `review_digest` (JSON) das 1.044 obras — 1.027 KB — só para testar se ele é nulo, e a projeção
 * inteira de `works_owner` (com `canonical_synopsis`) — 755 KB — para usar só o `id`.
 *
 * O que fica preso aqui:
 *   - as contagens são as MESMAS da regra de antes, em todos os casos de digest e de faixa;
 *   - digest ausente = NULL do SQL **ou** JSON `null` (o `== null` de antes tratava os dois);
 *   - versão nula ou diferente da vigente continua pendente;
 *   - nenhuma consulta de contagem pede o JSON do digest nem a projeção larga;
 *   - o caminho normal das filas (os cards) continua trazendo o que desenha.
 *
 * O PostgREST falso separa NULL do SQL de JSON `null` como o banco real: `is.null` só pega o
 * primeiro, `eq.null` só o segundo, e os dois saem `null` na resposta.
 */

type Row = Record<string, unknown>
const JSON_NULL = "__jsonb_null__"

const estado = vi.hoisted(() => ({
  linhas: [] as Row[],
  consultas: [] as Array<{ tabela: string; select: string }>,
  uteis: new Map<string, number>(),
  tags: new Map<string, number>(),
}))

function partes(sel: string) {
  const out: string[] = []
  let nivel = 0
  let atual = ""
  for (const c of sel.replace(/\s+/g, "")) {
    if (c === "(") nivel++
    if (c === ")") nivel--
    if (c === "," && nivel === 0) {
      out.push(atual)
      atual = ""
    } else atual += c
  }
  if (atual) out.push(atual)
  return out
}

function projetar(row: Row, sel: string): Row {
  const out: Row = {}
  for (const p of partes(sel)) {
    const embed = p.match(/^(\w+)\((.*)\)$/)
    const col = embed ? embed[1] : p
    const v = row[col]
    out[col] = v === JSON_NULL ? null : v
  }
  return out
}

/** `col.op.val` de um `.or(...)`. */
function condicao(expr: string): (r: Row) => boolean {
  const [col, op, ...resto] = expr.split(".")
  const val = resto.join(".")
  if (op === "is" && val === "null") return (r) => r[col] == null
  if (op === "eq" && val === "null") return (r) => r[col] === JSON_NULL
  if (op === "eq") return (r) => String(r[col]) === val
  throw new Error(`condição não suportada no mock: ${expr}`)
}

function builder(tabela: string) {
  const preds: Array<(r: Row) => boolean> = []
  let sel = "*"
  let faixa: [number, number] | null = null
  const q = {
    select: (s: string) => ((sel = s), estado.consultas.push({ tabela, select: s }), q),
    eq: (col: string, v: unknown) => (preds.push((r) => r[col] === v), q),
    in: (col: string, vs: unknown[]) => {
      const s = new Set(vs)
      preds.push((r) => s.has(r[col === "work_id" ? "id" : col]))
      return q
    },
    not: (col: string, op: string, v: unknown) => {
      if (op === "is" && v === null) preds.push((r) => r[col] != null) // SQL: JSON null NÃO é NULL
      return q
    },
    or: (expr: string) => {
      const cs = expr.split(",").map(condicao)
      preds.push((r) => cs.some((c) => c(r)))
      return q
    },
    order: () => q,
    range: (a: number, b: number) => ((faixa = [a, b]), q),
    then: (ok: (v: { data: Row[]; error: null }) => unknown) => {
      // Tabelas auxiliares do caminho completo: vazias neste catálogo falso.
      const base = tabela === "works" || tabela === "works_owner" ? estado.linhas : []
      let rows = [...base].sort((a, b) => String(a.id).localeCompare(String(b.id))).filter((r) => preds.every((p) => p(r)))
      if (faixa) rows = rows.slice(faixa[0], faixa[1] + 1)
      return Promise.resolve(ok({ data: rows.map((r) => projetar(r, sel)), error: null }))
    },
  }
  return q
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (t: string) => builder(t), rpc: async () => ({ data: null, error: { message: "sem rpc" } }) }),
}))
vi.mock("@/server/queries/work-card-meta", () => {
  const contagens = (ids: string[] | null) =>
    new Map(
      (ids ?? estado.linhas.map((r) => r.id as string)).map((id) => [
        id,
        { reviewCount: estado.uteis.get(id) ?? 0, tagCount: estado.tags.get(id) ?? 0 },
      ]),
    )
  return {
    workCardCountsRpc: async (_sb: unknown, ids: string[] | null) => contagens(ids),
    getWorkTagReviewCounts: async (ids: string[]) => contagens(ids),
  }
})
vi.mock("@/lib/synopsis-interest/effective-interest", () => ({
  loadEffectiveInterest: async (_sb: unknown, _ids: string[], manual: Map<string, string | null>) => manual,
}))

import { getReviewDigestQueue } from "@/server/queries/review-digest-queue"
import { getWorksWithoutReviews } from "@/server/queries/works-without-reviews"
import { getWorksWithoutTags } from "@/server/queries/works-without-tags"

const V = REVIEW_DIGEST_VERSION
const MIN = MIN_USEFUL_REVIEWS_FOR_DIGEST
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

/** Todas as combinações de digest × versão × reviews úteis em volta do piso, mais arquivadas. */
function semear() {
  estado.consultas = []
  estado.uteis = new Map()
  estado.tags = new Map()
  const digests: Array<[unknown, string | null]> = [
    [null, null], // nunca teve digest
    [null, V], // digest apagado com a versão vigente sobrando
    [JSON_NULL, V], // JSON null — o `== null` de antes o tratava como ausente
    [JSON_NULL, null],
    [{ consenso: "x".repeat(400) }, V], // em dia
    [{ consenso: "x".repeat(400) }, "digest-v0"], // versão antiga
    [{ consenso: "x".repeat(400) }, null], // digest presente, versão nula
  ]
  const reviews = [0, MIN - 1, MIN, MIN + 5]
  const linhas: Row[] = []
  let n = 0
  for (const [digest, versao] of digests) {
    for (const uteis of reviews) {
      for (const arquivada of [false, true]) {
        const i = n++
        linhas.push({
          id: id(i),
          title: `Obra ${i}`,
          is_archived: arquivada,
          is_adult: i % 4 === 0,
          publication_status_id: (i % 3) + 1,
          personal_status_id: i % 2 ? 7 : null,
          ai_eval_status: "done",
          synopsis_quality: null,
          canonical_synopsis: i % 5 === 0 ? "   " : i % 5 === 1 ? null : "sinopse canônica ".repeat(30),
          hiatus_kind: null,
          hiatus_kind_confidence: null,
          publication_status_note: null,
          review_digest: digest,
          review_digest_version: versao,
          review_summary: null,
          work_covers: [{ url: `https://capa/${i}.jpg`, is_primary: true, position: 0 }],
          calculated_scores: { expected_score: 7 },
        })
        estado.uteis.set(id(i), uteis)
        estado.tags.set(id(i), (i * 7) % 6)
      }
    }
  }
  estado.linhas = linhas
}

/** A regra de ANTES, escrita à parte: o `review_digest` como a resposta o trazia, e `== null`. */
function digestDeAntes() {
  const ativas = estado.linhas.filter((r) => !r.is_archived)
  const comoVinha = (r: Row) => (r.review_digest === JSON_NULL ? null : r.review_digest)
  const pendentes = ativas.filter((r) => comoVinha(r) == null || r.review_digest_version !== V)
  const elegiveis = pendentes.filter((r) => (estado.uteis.get(r.id as string) ?? 0) >= MIN)
  return {
    eligibleCount: elegiveis.length,
    blockedCount: pendentes.length - elegiveis.length,
    doneCount: ativas.length - pendentes.length,
    rotulos: Object.fromEntries(pendentes.map((r) => [r.id, comoVinha(r) == null ? "absent" : "version"])),
  }
}

function faixaDeAntes(contagem: Map<string, number>, f: { min?: number; max?: number; pub?: number[]; pers?: number[] }) {
  const max = Math.max(0, Math.floor(f.max ?? 0))
  const min = Math.max(0, Math.floor(f.min ?? 0))
  const naFaixa = (c: number) => c >= min && (max < min ? true : c <= max)
  return estado.linhas
    .filter((r) => !r.is_archived)
    .filter((r) => !f.pub?.length || f.pub.includes(r.publication_status_id as number))
    .filter((r) => !f.pers?.length || f.pers.includes(r.personal_status_id as number))
    .filter((r) => naFaixa(contagem.get(r.id as string) ?? 0))
    .map((r) => r.id as string)
    .sort()
}

const FAIXAS = [
  {},
  { min: 0, max: 0 },
  { min: 1, max: 3 },
  { min: MIN },
  { min: 2, max: 1 }, // máx < mín ⇒ sem teto
  { pub: [1, 2] },
  { pers: [7] },
  { min: 1, pub: [3], pers: [7] },
]

describe("contagens das abas de /curation/works sem texto/JSON", () => {
  beforeEach(semear)

  it("o catálogo falso cobre os casos que importam (senão a igualdade passaria por vacuidade)", () => {
    const antes = digestDeAntes()
    const rotulos = Object.values(antes.rotulos)
    expect(rotulos).toContain("absent")
    expect(rotulos).toContain("version")
    expect(antes.eligibleCount).toBeGreaterThan(0)
    expect(antes.blockedCount).toBeGreaterThan(0)
    expect(antes.doneCount).toBeGreaterThan(0)
  })

  it("digest: as três contagens são as da regra de antes, no countOnly e no caminho completo", async () => {
    const antes = digestDeAntes()
    for (const countOnly of [true, false]) {
      const r = await getReviewDigestQueue({ countOnly })
      expect({ e: r.eligibleCount, b: r.blockedCount, d: r.doneCount }, `countOnly=${countOnly}`).toEqual({
        e: antes.eligibleCount,
        b: antes.blockedCount,
        d: antes.doneCount,
      })
    }
  })

  it("digest: cada obra pendente sai com o mesmo motivo (ausente × versão) de antes", async () => {
    const r = await getReviewDigestQueue()
    expect(Object.fromEntries(r.works.map((w) => [w.id, w.pending]))).toEqual(digestDeAntes().rotulos)
  })

  it("digest: versão antiga e versão nula seguem pendentes; JSON null é ausente; em dia não entra", async () => {
    const r = await getReviewDigestQueue()
    const porId = new Map(r.works.map((w) => [w.id, w.pending]))
    const ativa = (pred: (x: Row) => boolean) => estado.linhas.filter((x) => !x.is_archived && pred(x)).map((x) => x.id as string)
    for (const i of ativa((x) => typeof x.review_digest === "object" && x.review_digest !== null && x.review_digest_version === "digest-v0"))
      expect(porId.get(i)).toBe("version")
    for (const i of ativa((x) => typeof x.review_digest === "object" && x.review_digest !== null && x.review_digest_version === null))
      expect(porId.get(i)).toBe("version")
    for (const i of ativa((x) => x.review_digest === JSON_NULL)) expect(porId.get(i)).toBe("absent")
    for (const i of ativa((x) => x.review_digest === null)) expect(porId.get(i)).toBe("absent")
    for (const i of ativa((x) => typeof x.review_digest === "object" && x.review_digest !== null && x.review_digest_version === V))
      expect(porId.has(i)).toBe(false)
  })

  it("digest: nenhuma consulta pede o JSON; o countOnly lê só id + versão", async () => {
    await getReviewDigestQueue({ countOnly: true })
    const sels = estado.consultas.filter((c) => c.tabela === "works").map((c) => c.select.replace(/\s+/g, ""))
    for (const s of sels) expect(s).not.toMatch(/review_digest(?!_version)/)
    expect(sels).toContain("id,review_digest_version")
    expect(sels.join(" ")).not.toContain("work_covers")
  })

  it("digest: o caminho completo (a aba aberta) continua trazendo título e capas", async () => {
    const r = await getReviewDigestQueue()
    expect(r.works.length).toBeGreaterThan(0)
    for (const w of r.works) {
      expect(w.title).toBe(`Obra ${Number(w.id.slice(-12))}`)
      expect(w.coverUrls).toEqual([`https://capa/${Number(w.id.slice(-12))}.jpg`])
    }
  })

  for (const f of FAIXAS) {
    it(`reviews e tags (countOnly): mesmo universo e mesmo total da regra de antes ${JSON.stringify(f)}`, async () => {
      const filtros = { pubStatusIds: f.pub, personalStatusIds: f.pers }
      const rev = await getWorksWithoutReviews({ ...filtros, minReviews: f.min, maxReviews: f.max }, { countOnly: true })
      const tag = await getWorksWithoutTags({ ...filtros, minTags: f.min, maxTags: f.max }, { countOnly: true })
      const revAntes = faixaDeAntes(estado.uteis, f)
      const tagAntes = faixaDeAntes(estado.tags, f)
      expect([...(rev.ids ?? [])].sort()).toEqual(revAntes)
      expect(rev.totalWithoutReviews).toBe(revAntes.length)
      expect([...(tag.ids ?? [])].sort()).toEqual(tagAntes)
      expect(tag.totalWithoutTags).toBe(tagAntes.length)
    })
  }

  it("reviews e tags (countOnly): a única coluna pedida a `works_owner` é o id", async () => {
    await getWorksWithoutReviews({ minReviews: 1, maxReviews: 9 }, { countOnly: true })
    await getWorksWithoutTags({ minTags: 1, maxTags: 9 }, { countOnly: true })
    const sels = estado.consultas.filter((c) => c.tabela === "works_owner").map((c) => c.select.replace(/\s+/g, ""))
    expect(sels.length).toBe(2)
    for (const s of sels) expect(s).toBe("id")
  })

  it("reviews e tags (caminho completo): mesma contagem do countOnly, e a sinopse canônica só conta com texto", async () => {
    const f = { minReviews: 0, maxReviews: 9 }
    const rev = await getWorksWithoutReviews(f)
    const revConta = await getWorksWithoutReviews(f, { countOnly: true })
    expect(rev.totalWithoutReviews).toBe(revConta.totalWithoutReviews)
    const tag = await getWorksWithoutTags({ minTags: 0, maxTags: 9 })
    for (const lista of [rev.works, tag.works]) {
      expect(lista.length).toBeGreaterThan(0)
      for (const w of lista) {
        const i = Number(w.id.slice(-12))
        expect(w.canonicalPresent, w.id).toBe(i % 5 >= 2) // "   " e null não contam
      }
    }
    const largas = estado.consultas.filter((c) => c.tabela === "works_owner" && c.select.includes("canonical_synopsis"))
    expect(largas.length).toBe(2)
  })
})
