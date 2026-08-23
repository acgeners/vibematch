/**
 * Uma fonte INDIVIDUAL da home pode falhar enquanto as outras estão saudáveis — e o defeito
 * que este arquivo guarda é a falha virar "não existe conteúdo".
 *
 * 🔴 Não é o caso do A3.1 (banco inteiro fora → "0 obras"). Aqui os números carregam
 * normalmente e só a vitrine, ou só o raio-X, quebra: a página fica plausível, saudável na
 * maior parte, e afirma ausência de conteúdo numa área onde houve erro.
 *
 * A metade de UI é RENDER de propósito: um teste que lesse só o retorno das funções passaria
 * verde com a tela continuando a esconder a prateleira.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { PublicHome } from "@/components/home/public-home"
import type { PublicShowcaseWork, SpotlightResult } from "@/server/queries/public-showcase"
import type { SiteStats } from "@/server/queries/auth-hero"

type Resposta = { data: unknown[] | null; error: { message: string } | null }
let RESPOSTAS: Record<string, Resposta> = {}

function encadear(res: Resposta) {
  const alvo: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: Resposta) => unknown) => Promise.resolve(res).then(ok)
        return () => alvo
      },
    },
  )
  return alvo
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) =>
      encadear(RESPOSTAS[tabela] ?? { data: null, error: { message: `sem mock: ${tabela}` } }),
  }),
}))

/**
 * 🔴 A forma REAL, MEDIDA em 2026-08-23 contra o Supabase local (supabase-js 2.105.1): o
 * cliente devolve o erro do PostgREST como OBJETO PLANO — `{ code, details, hint, message }`,
 * com `instanceof Error` FALSO e sem `stack`. Nunca é um `Error`.
 *
 * ⚠️ Este mock já esteve "corrigido" para um `Error`, e a correção estava errada: eu havia
 * medido `new PostgrestError(...)` no Node cru — a classe existe e É `Error`, mas o cliente
 * NÃO a usa neste caminho. O runtime probe é que desmentiu, com a suíte verde.
 */
const ERRO = {
  data: null,
  error: { message: "Expected 3 parts in JWT; got 1", code: "PGRST301", details: null, hint: null },
}
const VAZIO = { data: [], error: null }

/** Uma linha de `calculated_scores` completa o bastante para virar obra da vitrine. */
function linha(id: string, comCriterios = false) {
  return {
    platform_avg: 8.5,
    total_votes: 5000,
    works: {
      id,
      title: `Obra ${id}`,
      is_archived: false,
      is_adult: false,
      publication_status_id: 1,
      total_chapters: 50,
      work_covers: [{ url: `https://x/${id}.jpg`, is_primary: true, position: 0 }],
      ...(comCriterios
        ? {
            category_scores: [
              "romance", "protagonist", "drama", "tragedy", "humor",
              "action_adventure", "fantasy_nobility", "couple_dynamics", "adult_content",
            ].map((slug) => ({ criterion_slug: slug, score: 7 })),
          }
        : {}),
    },
  }
}

let logs: string[] = []
beforeEach(() => {
  logs = []
  // 🔴 SERIALIZA o argumento em vez de `join(" ")`: com join, um objeto vira
  // "[object Object]" e um `console.error(prefixo, error)` — que em produção IMPRIME o
  // conteúdo — ficava invisível para a captura. A sonda que reintroduz esse log passou verde
  // até esta linha existir.
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) =>
    void logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")),
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Lê os eventos estruturados emitidos no `console.error`. */
function eventos(): Array<Record<string, unknown>> {
  return logs.map((l) => {
    try {
      return JSON.parse(l) as Record<string, unknown>
    } catch {
      return { event: "NAO_ERA_JSON", raw: l }
    }
  })
}
const operacoes = () => eventos().map((e) => e.operation)

async function showcase() {
  const { getPublicShowcase } = await import("@/server/queries/public-showcase")
  return getPublicShowcase(3)
}
async function spotlight() {
  const { getSpotlightWork } = await import("@/server/queries/public-showcase")
  return getSpotlightWork()
}
async function hero() {
  const { getAuthHeroWorks } = await import("@/server/queries/auth-hero")
  return getAuthHeroWorks(3)
}

describe("getPublicShowcase — vazio × indisponível", () => {
  it("A · sucesso com obras devolve array", async () => {
    RESPOSTAS = { calculated_scores: { data: [linha("a"), linha("b")], error: null } }
    const r = await showcase()
    expect(Array.isArray(r)).toBe(true)
    expect(r!.length).toBeGreaterThan(0)
    expect(logs).toEqual([])
  })

  it("B · sucesso VAZIO devolve [] — vazio legítimo continua vazio", async () => {
    RESPOSTAS = { calculated_scores: VAZIO }
    expect(await showcase()).toEqual([])
    expect(logs).toEqual([])
  })

  it("C · erro devolve null, NUNCA []", async () => {
    RESPOSTAS = { calculated_scores: ERRO }
    const r = await showcase()
    expect(r).toBeNull()
    expect(r).not.toEqual([])
    expect(operacoes()).toEqual(["public-showcase.getPublicShowcase"])
  })
})

describe("getAuthHeroWorks — vazio × indisponível", () => {
  it("A · sucesso com obras devolve array", async () => {
    RESPOSTAS = { calculated_scores: { data: [linha("a")], error: null } }
    expect((await hero())!.length).toBeGreaterThan(0)
  })

  it("B · sucesso vazio devolve []", async () => {
    RESPOSTAS = { calculated_scores: VAZIO }
    expect(await hero()).toEqual([])
    expect(logs).toEqual([])
  })

  it("C · erro devolve null e registra evento", async () => {
    RESPOSTAS = { calculated_scores: ERRO }
    expect(await hero()).toBeNull()
    expect(operacoes()).toEqual(["auth-hero.getAuthHeroWorks"])
  })
})

describe("getSpotlightWork — os TRÊS estados são distinguíveis", () => {
  it("A · obra encontrada", async () => {
    RESPOSTAS = { calculated_scores: { data: [linha("a", true)], error: null } }
    const r = await spotlight()
    expect(r.status).toBe("ok")
    expect(r.status === "ok" && r.work?.id).toBe("a")
  })

  it("B · consulta saudável, nenhum destaque elegível", async () => {
    // Sem os 9 critérios: a consulta respondeu, mas nada satisfaz os requisitos.
    RESPOSTAS = { calculated_scores: { data: [linha("a")], error: null } }
    const r = await spotlight()
    expect(r).toEqual({ status: "ok", work: null })
    expect(logs).toEqual([])
  })

  it("C · consulta indisponível", async () => {
    RESPOSTAS = { calculated_scores: ERRO }
    const r = await spotlight()
    expect(r).toEqual({ status: "unavailable" })
    expect(operacoes()).toEqual(["public-showcase.getSpotlightWork"])
  })

  it("🔴 B e C têm representações DIFERENTES — é o ponto do contrato", async () => {
    RESPOSTAS = { calculated_scores: { data: [linha("a")], error: null } }
    const b = await spotlight()
    RESPOSTAS = { calculated_scores: ERRO }
    const c = await spotlight()
    expect(b).not.toEqual(c)
    expect(b.status).not.toBe(c.status)
  })
})

/* ------------------------------ RENDER ------------------------------ */

const OK: SiteStats = { works: 1010, criteria: 8811, reviews: 47751, sources: 9 }
const OBRA: PublicShowcaseWork = {
  id: "a", title: "Obra A", coverUrls: ["https://x/a.jpg"], platformAvg: 8.5, totalVotes: 5000,
  publicationStatusId: 1, isAdult: false, totalChapters: 50,
} as unknown as PublicShowcaseWork
const SEM_DESTAQUE: SpotlightResult = { status: "ok", work: null }

const desenhar = (works: PublicShowcaseWork[] | null, spot: SpotlightResult, stats: SiteStats = OK) =>
  render(<PublicHome works={works} stats={stats} spotlight={spot} />)

const vitrineIndisponivel = () => screen.queryByText(/prateleira indisponível/i)
const raioXIndisponivel = () => screen.queryByText(/raio-x indisponível/i)

describe("a home degrada por MÓDULO, não por página", () => {
  it("1 · tudo saudável — nenhum aviso, comportamento preservado", () => {
    desenhar([OBRA], SEM_DESTAQUE)
    expect(screen.getByText(/1\.010 obras lidas por critério/i)).toBeTruthy()
    expect(screen.getByText(/mais bem avaliadas nas plataformas/i)).toBeTruthy()
    expect(vitrineIndisponivel()).toBeNull()
    expect(raioXIndisponivel()).toBeNull()
  })

  it("2 · vitrine legitimamente VAZIA — sem aviso de indisponibilidade", () => {
    desenhar([], SEM_DESTAQUE)
    expect(vitrineIndisponivel()).toBeNull()
    // Vazio legítimo segue escondendo a seção, como antes.
    expect(screen.queryByText(/mais bem avaliadas nas plataformas/i)).toBeNull()
  })

  it("3 · vitrine FALHA com stats saudáveis — aviso local, resto intacto", () => {
    desenhar(null, SEM_DESTAQUE)
    expect(vitrineIndisponivel()).toBeTruthy()
    // 🔴 O ponto: não pode parecer catálogo vazio. A seção continua lá.
    expect(screen.getByText(/mais bem avaliadas nas plataformas/i)).toBeTruthy()
    // E o resto da home segue saudável.
    expect(screen.getByText(/1\.010 obras lidas por critério/i)).toBeTruthy()
    expect(raioXIndisponivel()).toBeNull()
  })

  it("4 · spotlight legitimamente inexistente — módulo some, sem aviso", () => {
    desenhar([OBRA], SEM_DESTAQUE)
    expect(raioXIndisponivel()).toBeNull()
  })

  it("5 · spotlight FALHA — UI diferente do caso 4", () => {
    desenhar([OBRA], { status: "unavailable" })
    expect(raioXIndisponivel()).toBeTruthy()
    // Falha do raio-X não contamina a vitrine nem os números.
    expect(vitrineIndisponivel()).toBeNull()
    expect(screen.getByText(/1\.010 obras lidas por critério/i)).toBeTruthy()
  })

  it("nenhum módulo mostra mensagem interna do erro", () => {
    const { container } = desenhar(null, { status: "unavailable" })
    for (const p of ["JWT", "Expected 3 parts", "calculated_scores", "PostgREST", "Error:"]) {
      expect(container.textContent).not.toContain(p)
    }
  })
})

describe("6 · auth hero: a parede falha e a tela de login segue de pé", () => {
  /**
   * ⚠️ A parede de capas é `aria-hidden` e decorativa — fica ATRÁS do formulário. O
   * tratamento proporcional é distinguir no contrato e registrar no log, sem aviso na tela:
   * anunciar "não carreguei o fundo" a quem está tentando entrar seria ruído. O que NÃO pode
   * acontecer é o erro derrubar o painel ou passar calado, e é isso que este caso guarda.
   */
  async function desenharHero() {
    const { AuthHero } = await import("@/components/auth/auth-hero")
    return render(await AuthHero())
  }

  it("com a consulta FALHANDO: painel renderiza, parede some, log existe", async () => {
    RESPOSTAS = { calculated_scores: ERRO, works: ERRO, category_scores: ERRO, work_reviews: ERRO, source: ERRO }
    const { container } = await desenharHero()
    // O conteúdo que importa continua na tela.
    expect(screen.getByText(/tão bem quanto você/i)).toBeTruthy()
    // A parede decorativa não é desenhada.
    expect(container.querySelector(".authhero-wall")).toBeNull()
    // O sinal apropriado para um módulo decorativo é o EVENTO, não um banner.
    expect(operacoes()).toContain("auth-hero.getAuthHeroWorks")
    // E nenhuma mensagem interna vaza para a tela.
    for (const p of ["JWT", "Expected 3 parts", "calculated_scores"]) {
      expect(container.textContent).not.toContain(p)
    }
  })

  it("com obras: a parede aparece — os dois desfechos não são o mesmo desenho", async () => {
    RESPOSTAS = {
      calculated_scores: { data: [linha("a"), linha("b")], error: null },
      works: { data: [], error: null },
      category_scores: { data: [], error: null },
      work_reviews: { data: [], error: null },
      source: { data: [], error: null },
    }
    const { container } = await desenharHero()
    expect(container.querySelector(".authhero-wall")).toBeTruthy()
  })
})

describe("privacidade do LOG — segredo dentro do próprio Error não sai", () => {
  /**
   * 🔴 A POLÍTICA mudou no gate A3.5, e a mudança é o ponto dele. O log carregava só a operação
   * porque o sanitizador vivia noutra branch (A3.2) — logar mensagem crua seria abrir o
   * vazamento agora para fechá-lo depois. Com os dois eventos convivendo, a mensagem volta
   * SANITIZADA pelos mesmos donos, e o diagnóstico deixa de ser jogado fora.
   *
   * ⚠️ `details`, `hint` e `code` NÃO voltam: a defesa deles não é o regex, é a AUSÊNCIA DE
   * COLETA — o evento tem campo para nome, mensagem e stack do erro, e nada mais.
   */
  const ERRO_VENENOSO = {
    data: null,
    error: {
      message:
        'apikey=OPACA_APIKEY service_role=OPACA_ROLE jwt=eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIG ' +
        'user=leitor@exemplo.test — relation "public.calculated_scores" does not exist',
      code: "42703",
      details: "coluna interna do banco",
      hint: "perhaps you meant works.id",
    },
  }
  /** Segredo e PII: redigidos mesmo vindo de dentro do próprio Error. */
  const SEGREDOS = [
    "OPACA_APIKEY", "OPACA_ROLE", "eyJhbGciOiJIUzI1NiJ9", "PAYLOAD", "leitor@exemplo.test",
  ]
  /** Campos do PostgREST que o evento não coleta — ausência por desenho, não por redação. */
  const NAO_COLETADOS = ["coluna interna do banco", "perhaps you meant", "42703"]
  const PROIBIDOS = [...SEGREDOS, ...NAO_COLETADOS]

  it("o evento nomeia a operação, redige segredo e preserva o diagnóstico", async () => {
    RESPOSTAS = { calculated_scores: ERRO_VENENOSO as never }
    await showcase()
    const texto = logs.join("\n")
    // O que precisa estar lá: quem falhou.
    expect(operacoes()).toEqual(["public-showcase.getPublicShowcase"])
    for (const p of PROIBIDOS) expect(texto).not.toContain(p)
    // E o diagnóstico sobrevive — é ele que torna o evento acionável.
    expect(texto).toContain("does not exist")
  })

  it("os outros dois caminhos seguem o MESMO padrão", async () => {
    RESPOSTAS = { calculated_scores: ERRO_VENENOSO as never }
    await spotlight()
    await hero()
    const texto = logs.join("\n")
    expect(operacoes()).toEqual([
      "public-showcase.getSpotlightWork",
      "auth-hero.getAuthHeroWorks",
    ])
    for (const p of PROIBIDOS) expect(texto).not.toContain(p)
  })

  it("e o erro também não chega à TELA por nenhum dos módulos", async () => {
    RESPOSTAS = { calculated_scores: ERRO_VENENOSO as never }
    const { container } = desenhar(await showcase(), await spotlight())
    for (const p of PROIBIDOS) expect(container.textContent).not.toContain(p)
  })
})
