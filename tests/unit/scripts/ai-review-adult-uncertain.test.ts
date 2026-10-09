import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * `ai-review-adult-uncertain.ts`: só `--execute` gasta ou escreve, e a chamada paga passa pelo
 * wrapper central.
 *
 * 🔴 Até 2026-10-09 o padrão era PAGAR: sem `--dry-run`, o script chamava o Sonnet para a fila
 * inteira (228 obras na medição) por SDK direto — fora da guarda de código canônico e sem custo
 * nem proveniência em `ai_api_calls` — e gravava `works.adult_auto/adult_reason` na nuvem.
 *
 * O provider é o MÓDULO do wrapper mockado (não uma função injetada): assim o teste prova que o
 * script real chama `createLoggedMessage`, e não um substituto. O banco é um falso em memória
 * que conta cada escrita.
 */

const m = vi.hoisted(() => ({
  createLoggedMessage: vi.fn(),
  getAnthropicClient: vi.fn(),
  client: { messages: { create: vi.fn(), stream: vi.fn() } },
}))

vi.mock("@/lib/ai/anthropic-client", () => {
  class PaidCallBlockedError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "PaidCallBlockedError"
    }
  }
  return {
    createLoggedMessage: m.createLoggedMessage,
    getAnthropicClient: m.getAnthropicClient,
    PaidCallBlockedError,
  }
})

import { PaidCallBlockedError } from "@/lib/ai/anthropic-client"
import { SONNET_MODEL } from "@/lib/ai/models"
import { OPERATION, lerOpcoes, revisarFila } from "@/scripts/ai-review-adult-uncertain"

const CI = "90edf1bb-a80e-459e-b421-ebca4e493128"
type Linha = Record<string, unknown>

/** 7 obras, 3 elegíveis: w1 e w3 (tag fraca) e w2 (nota ≥ 7). As demais saem por um motivo cada. */
const TABELAS: Record<string, Linha[]> = {
  tags: [
    { id: "t-adult", name: "Adult", adult_indicator: true, tag_group_id: CI },
    { id: "t-rom", name: "Romance", adult_indicator: false, tag_group_id: CI },
  ],
  work_tags: [
    { work_id: "w1", tag_id: "t-adult" },
    { work_id: "w3", tag_id: "t-adult" },
    { work_id: "w4", tag_id: "t-adult" },
    { work_id: "w5", tag_id: "t-adult" },
    { work_id: "w6", tag_id: "t-adult" },
    { work_id: "w7", tag_id: "t-rom" },
  ],
  category_scores: [
    { id: "cs2", work_id: "w2", score: 8, criterion_slug: "adult_content" },
    { id: "cs7", work_id: "w7", score: 3, criterion_slug: "adult_content" },
  ],
  works: [
    { id: "w1", title: "Um", is_adult: false, adult_override: null, adult_reason: null },
    { id: "w2", title: "Dois", is_adult: false, adult_override: null, adult_reason: null },
    { id: "w3", title: "Três", is_adult: false, adult_override: null, adult_reason: null },
    { id: "w4", title: "Já 18+", is_adult: true, adult_override: null, adult_reason: null },
    { id: "w5", title: "Humano decidiu", is_adult: false, adult_override: false, adult_reason: null },
    { id: "w6", title: "Já revisada", is_adult: false, adult_override: null, adult_reason: "ai_review_clean" },
    { id: "w7", title: "Sem sinal", is_adult: false, adult_override: null, adult_reason: null },
  ],
  work_synopses: [{ id: "s1", work_id: "w1", text: "sinopse", is_primary: true }],
  work_reviews: [{ id: "r1", work_id: "w1", text: "review", source: "mal", text_length: 6 }],
}

/** Chave total de cada tabela que o script pagina — as do schema (PK), espelhadas aqui. */
const CHAVE_TOTAL: Record<string, string[]> = {
  tags: ["id"],
  work_tags: ["work_id", "tag_id"],
  category_scores: ["id"],
  works: ["id"],
  work_synopses: ["id"],
  work_reviews: ["id"],
}

interface Escrita {
  tabela: string
  patch: Linha
  filtros: Array<[string, string, unknown]>
}

function rng(semente: number) {
  let a = semente
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface OpcoesDoBanco {
  /** Cada consulta vê as linhas numa permutação nova — o que o Postgres NÃO promete evitar. */
  embaralhar?: boolean
  /** Toda leitura paginada tem de ordenar pela chave total da tabela, senão o falso estoura. */
  exigirOrdemTotal?: boolean
}

function bancoFalso(tabelas: Record<string, Linha[]> = TABELAS, opcoes: OpcoesDoBanco = {}) {
  const escritas: Escrita[] = []
  const sorteio = rng(42)
  const from = (tabela: string) => {
    const filtros: Array<[string, string, unknown]> = []
    const ordem: string[] = []
    let patch: Linha | null = null
    let faixa: [number, number] | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      order: (c: string) => (ordem.push(c), b),
      range: (a: number, z: number) => ((faixa = [a, z]), b),
      eq: (c: string, v: unknown) => (filtros.push(["eq", c, v]), b),
      in: (c: string, v: unknown) => (filtros.push(["in", c, v]), b),
      like: (c: string, v: unknown) => (filtros.push(["like", c, v]), b),
      is: (c: string, v: unknown) => (filtros.push(["is", c, v]), b),
      update: (p: Linha) => ((patch = p), b),
      then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => {
        if (patch) {
          escritas.push({ tabela, patch, filtros: [...filtros] })
          return Promise.resolve({ error: null, count: 0 }).then(ok, falha)
        }
        if (faixa && opcoes.exigirOrdemTotal) {
          const faltam = (CHAVE_TOTAL[tabela] ?? ["?"]).filter((c) => !ordem.includes(c))
          if (faltam.length) throw new Error(`${tabela}: paginou sem a chave total (falta ${faltam.join(", ")})`)
        }
        let linhas = (tabelas[tabela] ?? []).filter((r) =>
          filtros.every(([op, c, v]) =>
            op === "eq" ? r[c] === v : op === "in" ? (v as unknown[]).includes(r[c]) : true,
          ),
        )
        if (opcoes.embaralhar) {
          linhas = [...linhas]
          for (let i = linhas.length - 1; i > 0; i--) {
            const j = Math.floor(sorteio() * (i + 1))
            ;[linhas[i], linhas[j]] = [linhas[j], linhas[i]]
          }
        }
        // `sort` é ESTÁVEL: o que a ordem pedida não separa fica na permutação desta consulta.
        if (ordem.length) {
          linhas = [...linhas].sort((x, y) => {
            for (const c of ordem) if (x[c] !== y[c]) return String(x[c]) < String(y[c]) ? -1 : 1
            return 0
          })
        }
        if (faixa) linhas = linhas.slice(faixa[0], faixa[1] + 1)
        return Promise.resolve({ data: linhas, error: null }).then(ok, falha)
      },
    }
    return b
  }
  return { sb: { from } as unknown as SupabaseClient, escritas }
}

const VEREDITO_18 = {
  message: {
    content: [
      {
        type: "tool_use",
        name: "verdict",
        input: { adult: true, evidence: "reviews_explicit", confidence: "high", reason: "cena explícita" },
      },
    ],
  },
  apiCallId: "call-1",
  usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 },
}

const escritasEmWorks = (e: Escrita[]) => e.filter((x) => x.tabela === "works")

beforeEach(() => {
  vi.clearAllMocks()
  m.getAnthropicClient.mockReturnValue(m.client)
  m.createLoggedMessage.mockResolvedValue(VEREDITO_18)
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co"
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

function semProvider() {
  expect(m.createLoggedMessage).not.toHaveBeenCalled()
  expect(m.getAnthropicClient).not.toHaveBeenCalled()
  expect(m.client.messages.create).not.toHaveBeenCalled()
  expect(m.client.messages.stream).not.toHaveBeenCalled()
}

describe("caso A — sem flag é PRÉVIA", () => {
  it("monta a fila, mas 0 chamadas ao provider e 0 escritas", async () => {
    const { sb, escritas } = bancoFalso()
    const r = await revisarFila([], sb)
    expect(r).toEqual({ fila: 3, processadas: 0, escritas: 0, executou: false })
    semProvider()
    expect(escritas).toEqual([])
  })

  it("`--reset` sem `--execute` também não grava (o reset é escrita)", async () => {
    const { sb, escritas } = bancoFalso()
    await revisarFila(["--reset"], sb)
    semProvider()
    expect(escritas).toEqual([])
  })
})

describe("caso B — `--dry-run` segue compatível", () => {
  it("0 chamadas e 0 escritas", async () => {
    const { sb, escritas } = bancoFalso()
    const r = await revisarFila(["--dry-run"], sb)
    expect(r.executou).toBe(false)
    semProvider()
    expect(escritas).toEqual([])
  })

  it("`--execute` com `--dry-run` falha ANTES de ler ou gastar", async () => {
    const { sb, escritas } = bancoFalso()
    await expect(revisarFila(["--execute", "--dry-run"], sb)).rejects.toThrow(/juntos/)
    semProvider()
    expect(escritas).toEqual([])
  })
})

describe("caso C — `--execute` passa pelo wrapper central", () => {
  it("chama `createLoggedMessage` por obra, nunca o SDK direto, e grava o veredito", async () => {
    const { sb, escritas } = bancoFalso()
    const r = await revisarFila(["--execute"], sb)

    expect(r).toEqual({ fila: 3, processadas: 3, escritas: 3, executou: true })
    expect(m.getAnthropicClient).toHaveBeenCalledTimes(1)
    expect(m.createLoggedMessage).toHaveBeenCalledTimes(3)
    expect(m.client.messages.create).not.toHaveBeenCalled()
    expect(m.client.messages.stream).not.toHaveBeenCalled()

    const [cliente, params, meta] = m.createLoggedMessage.mock.calls[0]
    expect(cliente).toBe(m.client)
    expect(params).toMatchObject({ model: SONNET_MODEL, tool_choice: { type: "tool", name: "verdict" } })
    expect(meta).toEqual({ operation: OPERATION, workloadType: "admin", workId: "w1" })

    const ws = escritasEmWorks(escritas)
    expect(ws.map((w) => w.filtros)).toEqual([[["eq", "id", "w1"]], [["eq", "id", "w2"]], [["eq", "id", "w3"]]])
    expect(ws.every((w) => w.patch.adult_auto === true && w.patch.adult_reason === "ai_review")).toBe(true)
  })

  it("`--execute --reset` limpa os vereditos ai_review* antes de revisar", async () => {
    const { sb, escritas } = bancoFalso()
    await revisarFila(["--execute", "--reset"], sb)
    const ws = escritasEmWorks(escritas)
    expect(ws[0]).toMatchObject({ patch: { adult_auto: false, adult_reason: null } })
    expect(ws[0].filtros).toContainEqual(["like", "adult_reason", "ai_review%"])
    expect(ws).toHaveLength(4)
  })
})

describe("caso D — bloqueio da guarda", () => {
  it("`PaidCallBlockedError` aborta a fila inteira: 1 tentativa, 0 escritas", async () => {
    m.createLoggedMessage.mockRejectedValueOnce(new PaidCallBlockedError("checkout não canônico"))
    const { sb, escritas } = bancoFalso()
    await expect(revisarFila(["--execute"], sb)).rejects.toBeInstanceOf(PaidCallBlockedError)
    expect(m.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(escritas).toEqual([])
  })

  it("erro de PROVIDER numa obra segue pulando só ela (comportamento de antes)", async () => {
    m.createLoggedMessage.mockRejectedValueOnce(new Error("overloaded"))
    const { sb, escritas } = bancoFalso()
    const r = await revisarFila(["--execute"], sb)
    expect(m.createLoggedMessage).toHaveBeenCalledTimes(3)
    expect(r.escritas).toBe(2)
    expect(escritasEmWorks(escritas).map((w) => w.filtros[0][2])).toEqual(["w2", "w3"])
  })
})

describe("caso E — `--limit`", () => {
  it("`--execute --limit 2` processa só 2 das 3 elegíveis", async () => {
    const { sb, escritas } = bancoFalso()
    const r = await revisarFila(["--execute", "--limit", "2"], sb)
    expect(r).toEqual({ fila: 3, processadas: 2, escritas: 2, executou: true })
    expect(m.createLoggedMessage).toHaveBeenCalledTimes(2)
    expect(escritasEmWorks(escritas)).toHaveLength(2)
  })

  it("`--limit` na prévia não gasta", async () => {
    const { sb, escritas } = bancoFalso()
    await revisarFila(["--limit", "2"], sb)
    semProvider()
    expect(escritas).toEqual([])
  })

  it("`--limit` sem número válido FALHA — antes virava NaN e processava a fila inteira", async () => {
    for (const argv of [["--execute", "--limit"], ["--execute", "--limit", "abc"], ["--execute", "--limit", "0"]]) {
      const { sb, escritas } = bancoFalso()
      await expect(revisarFila(argv, sb)).rejects.toThrow(/--limit/)
      expect(escritas).toEqual([])
    }
    semProvider()
    expect(lerOpcoes(["--limit", "5"]).limite).toBe(5)
    expect(lerOpcoes([]).limite).toBe(Infinity)
  })
})

describe("paginação da fila — ordem total antes do `.range()`", () => {
  // 2.500 elegíveis = 3 páginas de 1000. Cada obra tem a tag fraca, então TODAS entram na fila.
  const N = 2500
  const wid = (i: number) => `w${String(i).padStart(4, "0")}`
  const FILA_GRANDE: Record<string, Linha[]> = {
    tags: TABELAS.tags,
    work_tags: Array.from({ length: N }, (_, i) => ({ work_id: wid(i), tag_id: "t-adult" })),
    category_scores: [],
    works: Array.from({ length: N }, (_, i) => ({
      id: wid(i),
      title: `Obra ${i}`,
      is_adult: false,
      adult_override: null,
      adult_reason: null,
    })),
    work_synopses: [],
    work_reviews: [],
  }

  it("SEM ordem, a fonte que embaralha entre páginas repete e pula obras (o defeito)", async () => {
    // O laço de antes, sem `.order()`, contra a mesma fonte.
    const { sb } = bancoFalso(FILA_GRANDE, { embaralhar: true })
    const lidas: string[] = []
    for (let from = 0; ; from += 1000) {
      const { data } = (await sb.from("works").select("id").range(from, from + 999)) as unknown as {
        data: Array<{ id: string }>
      }
      lidas.push(...data.map((r) => r.id))
      if (data.length < 1000) break
    }
    expect(lidas).toHaveLength(N)
    expect(new Set(lidas).size).toBeLessThan(N)
  })

  it("COM ordem: cada obra é chamada e gravada exatamente uma vez — e toda leitura usa a chave total", async () => {
    const { sb, escritas } = bancoFalso(FILA_GRANDE, { embaralhar: true, exigirOrdemTotal: true })
    const r = await revisarFila(["--execute"], sb)

    const chamadas = m.createLoggedMessage.mock.calls.map((c) => (c[2] as { workId: string }).workId)
    expect(r).toEqual({ fila: N, processadas: N, escritas: N, executou: true })
    expect(chamadas).toHaveLength(N)
    expect(new Set(chamadas).size).toBe(N)
    const gravadas = escritasEmWorks(escritas).map((w) => w.filtros[0][2])
    expect(new Set(gravadas).size).toBe(N)
  })

  it("`--limit 3` sobre a mesma fonte: 3 chamadas pagas, 3 obras distintas, sempre as mesmas", async () => {
    const { sb } = bancoFalso(FILA_GRANDE, { embaralhar: true, exigirOrdemTotal: true })
    await revisarFila(["--execute", "--limit", "3"], sb)
    const chamadas = m.createLoggedMessage.mock.calls.map((c) => (c[2] as { workId: string }).workId)
    expect(chamadas).toEqual(["w0000", "w0001", "w0002"])
  })

  it("a fila pequena também passa com a fonte embaralhada e a exigência de chave total", async () => {
    const { sb } = bancoFalso(TABELAS, { embaralhar: true, exigirOrdemTotal: true })
    const r = await revisarFila(["--execute"], sb)
    expect(r.escritas).toBe(3)
    expect(m.createLoggedMessage.mock.calls.map((c) => (c[2] as { workId: string }).workId)).toEqual(["w1", "w2", "w3"])
  })
})

describe("proteção estrutural", () => {
  // Sem comentários: o cabeçalho cita o SDK direto para explicar o defeito.
  const codigo = readFileSync(resolve(process.cwd(), "scripts/ai-review-adult-uncertain.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

  it("o script não fala com o SDK direto — só pelo `createLoggedMessage`", () => {
    expect(codigo).not.toMatch(/new\s+Anthropic\s*\(/)
    expect(codigo).not.toMatch(/\.messages\.(create|stream)\s*\(/)
    expect(codigo).toMatch(/createLoggedMessage\(/)
  })

  it("importar o módulo não executa nada — o `main` só roda chamado direto", () => {
    expect(codigo).toMatch(/process\.argv\[1\]\?\.endsWith\("ai-review-adult-uncertain\.ts"\)/)
  })
})
