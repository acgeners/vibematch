/**
 * A home não pode afirmar "0 obras" quando o que houve foi o banco falhar.
 *
 * 🔴 O defeito, medido em 2026-08-23 contra o build de produção com uma service key inválida:
 * `getSiteStats` fazia `count ?? 0` e NUNCA lia o campo `error`, então backend fora e catálogo
 * vazio tinham a MESMA representação. A `/` respondia HTTP 200, imprimia "0 OBRAS LIDAS POR
 * CRITÉRIO" como fato do acervo, não emitia uma linha de log — e o smoke aprovava, porque o
 * marcador dele (`data-slot=`) é satisfeito pela casca vazia.
 *
 * A metade de UI é teste de RENDER de propósito: um teste que só lesse o objeto devolvido
 * passaria verde com a manchete continuando a imprimir `0`, que é exatamente o estado anterior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { PublicHome } from "@/components/home/public-home"
import type { SiteStats } from "@/server/queries/auth-hero"

/** Resposta de UMA tabela: contagem ou erro. */
type Resposta = { count: number | null; error: { message: string } | null }
let RESPOSTAS: Record<string, Resposta> = {}

/**
 * Encadeia `.select()`/`.eq()` e resolve na resposta da tabela. O `works` usa `.eq()` e os
 * outros três não — o mock precisa servir as duas formas, senão ele testa só metade.
 */
function encadear(res: Resposta) {
  const alvo: any = {
    select: () => alvo,
    eq: () => alvo,
    then: (ok: (v: Resposta) => unknown) => Promise.resolve(res).then(ok),
  }
  return alvo
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) =>
      encadear(RESPOSTAS[tabela] ?? { count: null, error: { message: `sem mock: ${tabela}` } }),
  }),
}))

const OK = (n: number): Resposta => ({ count: n, error: null })
const ERRO = (m = "Expected 3 parts in JWT; got 1"): Resposta => ({ count: null, error: { message: m } })

async function ler(): Promise<SiteStats> {
  const { getSiteStats } = await import("@/server/queries/auth-hero")
  return getSiteStats()
}

let logs: string[] = []
beforeEach(() => {
  logs = []
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")))
})
afterEach(() => vi.restoreAllMocks())

describe("getSiteStats — vazio legítimo × backend indisponível", () => {
  it("CASO A — todas respondem: devolve os counts", async () => {
    RESPOSTAS = { works: OK(1010), category_scores: OK(8811), work_reviews: OK(47751), source: OK(9) }
    expect(await ler()).toEqual({ works: 1010, criteria: 8811, reviews: 47751, sources: 9 })
    expect(logs).toEqual([])
  })

  it("CASO B — zero LEGÍTIMO: query respondeu com 0, e 0 é dado", async () => {
    RESPOSTAS = { works: OK(0), category_scores: OK(0), work_reviews: OK(0), source: OK(0) }
    const s = await ler()
    // O ponto do caso: zero real NÃO pode virar null. Se virasse, teríamos trocado
    // "erro vira 0" por "0 vira erro" — o mesmo defeito com o sinal invertido.
    expect(s).toEqual({ works: 0, criteria: 0, reviews: 0, sources: 0 })
    expect(logs).toEqual([])
  })

  it("CASO C — falha PARCIAL: a que falhou vira null, as sãs sobrevivem", async () => {
    RESPOSTAS = { works: OK(1010), category_scores: ERRO(), work_reviews: OK(47751), source: OK(9) }
    const s = await ler()
    expect(s.criteria).toBeNull()
    expect(s.criteria).not.toBe(0)
    expect(s).toEqual({ works: 1010, criteria: null, reviews: 47751, sources: 9 })
    expect(logs.join("\n")).toContain("[site-stats] contagem de category_scores falhou")
  })

  it("CASO D — falha TOTAL: nenhuma métrica vira zero factual", async () => {
    RESPOSTAS = { works: ERRO(), category_scores: ERRO(), work_reviews: ERRO(), source: ERRO() }
    const s = await ler()
    expect(Object.values(s)).toEqual([null, null, null, null])
    expect(Object.values(s)).not.toContain(0)
    expect(logs).toHaveLength(4)
  })

  it("count NULO sem erro é 'não sei quantos', não zero", async () => {
    RESPOSTAS = { works: { count: null, error: null }, category_scores: OK(1), work_reviews: OK(1), source: OK(1) }
    expect((await ler()).works).toBeNull()
  })

  it("o log não carrega segredo — só tabela e mensagem do PostgREST", async () => {
    RESPOSTAS = { works: ERRO(), category_scores: OK(1), work_reviews: OK(1), source: OK(1) }
    await ler()
    const texto = logs.join("\n")
    expect(texto).toContain("works")
    for (const proibido of ["service_role", "eyJ", "@gmail", "apikey", "Bearer", "password"]) {
      expect(texto).not.toContain(proibido)
    }
  })
})

const VITRINE = { works: [], spotlight: null } as const
const desenhar = (stats: SiteStats) =>
  render(<PublicHome works={[...VITRINE.works]} stats={stats} spotlight={VITRINE.spotlight} />)

describe("a home DIZ que não carregou, em vez de afirmar zero", () => {
  it("CASO D na tela — estado degradado explícito, e nenhum '0 obras'", () => {
    desenhar({ works: null, criteria: null, reviews: null, sources: null })
    expect(screen.getByText(/não foi possível carregar os números do acervo/i)).toBeTruthy()
    // A contraprova do defeito: era ESTA frase que a tela imprimia com o banco fora.
    expect(screen.queryByText(/0 obras lidas por critério/i)).toBeNull()
  })

  it("CASO A na tela — com dado, imprime o número e NÃO o aviso", () => {
    desenhar({ works: 1010, criteria: 8811, reviews: 47751, sources: 9 })
    expect(screen.getByText(/1\.010 obras lidas por critério/i)).toBeTruthy()
    expect(screen.queryByText(/não foi possível carregar/i)).toBeNull()
  })

  it("CASO B na tela — zero REAL é impresso como número, não vira aviso", () => {
    desenhar({ works: 0, criteria: 0, reviews: 0, sources: 0 })
    expect(screen.getByText(/^0 obras lidas por critério$/i)).toBeTruthy()
    expect(screen.queryByText(/não foi possível carregar/i)).toBeNull()
    // 🔴 Sem estas três linhas o teste NÃO alcançava o `Stat`, e a sonda que restaura
    // `if (!value)` passava verde — o mesmo achatamento de 0 com null, dois arquivos adiante.
    for (const rotulo of ["notas por critério", "reviews lidas", "fontes cruzadas"]) {
      expect(screen.getAllByText(rotulo).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText("0").length).toBe(3)
  })

  it("CASO C na tela — métrica nula some, as sãs continuam visíveis", () => {
    desenhar({ works: 1010, criteria: null, reviews: 47751, sources: 9 })
    expect(screen.getByText(/1\.010 obras lidas por critério/i)).toBeTruthy()
    // `Stat` imprime o rótulo DUAS vezes (um `<dt class="sr-only">` e um `<span>`),
    // então `getByText` estoura por ambiguidade — o que importa aqui é presença × ausência.
    expect(screen.getAllByText("reviews lidas").length).toBeGreaterThan(0)
    expect(screen.queryAllByText("notas por critério")).toHaveLength(0)
    // Falha de UMA contagem não pode derrubar a home inteira.
    expect(screen.queryByText(/não foi possível carregar/i)).toBeNull()
  })
})
