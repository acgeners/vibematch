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

/**
 * 🔴 A forma REAL, MEDIDA em 2026-08-23 contra o Supabase local (supabase-js 2.105.1): o
 * cliente devolve o erro do PostgREST como OBJETO PLANO — `{ code, details, hint, message }`,
 * com `instanceof Error` FALSO e sem `stack`. Nunca é um `Error`.
 *
 * ⚠️ Este mock já esteve "corrigido" para um `Error`, e a correção estava errada: eu havia
 * medido `new PostgrestError(...)` no Node cru — a classe existe e É `Error`, mas o cliente
 * NÃO a usa neste caminho. O runtime probe é que desmentiu, com a suíte verde.
 */
const ERRO = (m = "Expected 3 parts in JWT; got 1"): Resposta => ({
  count: null,
  error: { message: m, code: "PGRST301", details: null, hint: null } as never,
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

async function ler(): Promise<SiteStats> {
  const { getSiteStats } = await import("@/server/queries/auth-hero")
  return getSiteStats()
}

let logs: string[] = []
beforeEach(() => {
  logs = []
  // Serializa cada argumento: com `join(" ")` um objeto vira "[object Object]" e um
  // `console.error(prefixo, error)` — que em produção IMPRIME o conteúdo — passaria batido.
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) =>
    void logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")),
  )
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
    // UMA operação por métrica: é o que permite responder "qual das quatro caiu?".
    expect(operacoes()).toEqual(["site-stats.count.category_scores"])
  })

  it("CASO D — falha TOTAL: nenhuma métrica vira zero factual", async () => {
    RESPOSTAS = { works: ERRO(), category_scores: ERRO(), work_reviews: ERRO(), source: ERRO() }
    const s = await ler()
    expect(Object.values(s)).toEqual([null, null, null, null])
    expect(Object.values(s)).not.toContain(0)
    expect(logs).toHaveLength(4)
    expect(operacoes()).toEqual([
      "site-stats.count.works",
      "site-stats.count.category_scores",
      "site-stats.count.work_reviews",
      "site-stats.count.source",
    ])
    // 🔴 Quatro eventos com o MESMO rótulo seriam indistinguíveis de quatro repetições de uma
    // falha só — a contagem por operação é o que separa "o banco caiu" de "uma tabela sumiu".
    expect(new Set(operacoes()).size).toBe(4)
  })

  /**
   * 🔴 Este caso NASCEU dizendo que `count` nulo sem erro era "respondeu e não sei quantos", e a
   * evidência de runtime inverteu isso. `getSiteStats` pede `count: "exact"`, e nessa condição
   * nenhum cenário legítimo produz `count: null` — medidas 10 variantes contra o PostgREST
   * local: RLS bloqueando dá 0, filtro sem match dá 0, view conta, `planned`/`estimated`
   * contam. Os únicos dois que produzem são relação ausente e RPC ausente, os dois FALHA.
   *
   * ⚠️ Ele não foi apagado: a asserção que já existia (degrada para `null`, nunca 0) continua
   * exatamente igual — o que se acrescenta é o SINAL, que faltava. E o recorte é estreito de
   * propósito: vale para quem PEDE contagem. Consulta sem `count` recebe `null` legitimamente.
   */
  it("count NULO sem erro é FALHA nesta contagem — degrada igual, mas deixa rastro", async () => {
    RESPOSTAS = { works: { count: null, error: null }, category_scores: OK(1), work_reviews: OK(1), source: OK(1) }
    const s = await ler()
    expect(s.works).toBeNull()
    expect(s.works).not.toBe(0)
    // As outras três seguem saudáveis: a falha é POR MÉTRICA.
    expect([s.criteria, s.reviews, s.sources]).toEqual([1, 1, 1])
    expect(operacoes()).toEqual(["site-stats.count.works"])
  })

  /**
   * A matriz do contrato, num lugar só: o que a métrica vira e se houve evento. É ela que
   * separa "zero legítimo" de "não veio contagem", que é a distinção inteira deste gate.
   */
  describe("contrato de `count: exact`", () => {
    const CASOS: Array<[string, { count: number | null; error: { message: string } | null }, number | null, number]> = [
      ["count 12, sem erro", { count: 12, error: null }, 12, 0],
      ["count 0, sem erro (zero LEGÍTIMO)", { count: 0, error: null }, 0, 0],
      ["count null, sem erro (falha mascarada)", { count: null, error: null }, null, 1],
      ["count null, com erro", { count: null, error: { message: "boom" } }, null, 1],
    ]

    it.each(CASOS)("%s", async (_rot, resposta, esperado, eventos_) => {
      RESPOSTAS = { works: resposta, category_scores: OK(1), work_reviews: OK(1), source: OK(1) }
      expect((await ler()).works).toBe(esperado)
      expect(logs).toHaveLength(eventos_)
      if (eventos_ > 0) {
        expect(operacoes()).toEqual(["site-stats.count.works"])
        expect(eventos()[0].event).toBe("handled_server_error")
      }
    })

    it("zero legítimo NUNCA vira evento, em nenhuma das quatro métricas", async () => {
      RESPOSTAS = { works: OK(0), category_scores: OK(0), work_reviews: OK(0), source: OK(0) }
      expect(await ler()).toEqual({ works: 0, criteria: 0, reviews: 0, sources: 0 })
      expect(logs).toEqual([])
    })

    it("nenhuma métrica ausente é convertida para 0 — nem com as quatro sem count", async () => {
      const SEM = { count: null, error: null }
      RESPOSTAS = { works: SEM, category_scores: SEM, work_reviews: SEM, source: SEM }
      const s = await ler()
      expect(Object.values(s)).toEqual([null, null, null, null])
      expect(Object.values(s)).not.toContain(0)
      // Uma operação por métrica, as quatro distinguíveis.
      expect(operacoes().sort()).toEqual([
        "site-stats.count.category_scores",
        "site-stats.count.source",
        "site-stats.count.work_reviews",
        "site-stats.count.works",
      ])
    })

    /**
     * ⚠️ O evento do caso sem `count` não pode afirmar causa que não medimos: ele descreve o
     * FATO (a contagem não veio), e a identidade continua sendo a `operation`.
     */
    it("o evento sem count descreve o fato, sem inventar detalhe de backend", async () => {
      RESPOSTAS = { works: { count: null, error: null }, category_scores: OK(1), work_reviews: OK(1), source: OK(1) }
      await ler()
      const e = eventos()[0]
      expect(e.operation).toBe("site-stats.count.works")
      expect(String(e.errorMessage)).toContain("count")
      const linha = logs.join("\n")
      // Nada de causa fabricada, nem de campos que o A3.5 decidiu não coletar.
      for (const inventado of ["404", "204", "PGRST", "status", "details", "hint", "Not Found"]) {
        expect(linha).not.toContain(inventado)
      }
    })
  })

  /**
   * 🔴 A POLÍTICA mudou aqui, e a mudança é o ponto do gate A3.5. Antes o log carregava só a
   * tabela — não por gosto, mas porque o sanitizador vivia noutra branch, e logar mensagem crua
   * seria abrir o vazamento agora para fechá-lo depois. Com A3.2 e A3.5 convivendo, a mensagem
   * volta SANITIZADA pelos mesmos donos, e o diagnóstico deixa de ser jogado fora.
   *
   * ⚠️ O que NÃO volta: `details`, `hint` e `code`. A defesa deles não é o regex — é a
   * AUSÊNCIA DE COLETA. O evento tem campo para nome, mensagem e stack, e nada mais do erro.
   */
  it("o evento nomeia a operação, redige segredo e NÃO coleta details/hint/code", async () => {
    const VENENOSO = {
      count: null,
      error: {
        message:
          'apikey=OPACA_APIKEY service_role=OPACA_ROLE jwt=eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIG ' +
          'user=leitor@exemplo.test — relation "public.works" does not exist',
        code: "42P01",
        details: "coluna interna",
        hint: "perhaps you meant",
      },
    } as unknown as Resposta
    RESPOSTAS = { works: VENENOSO, category_scores: OK(1), work_reviews: OK(1), source: OK(1) }
    await ler()
    const texto = logs.join("\n")

    // Contexto operacional: precisa dizer QUAL contagem falhou.
    expect(operacoes()).toEqual(["site-stats.count.works"])

    // SEGREDO e PII: redigidos, mesmo vindo de dentro do próprio Error.
    for (const proibido of [
      "OPACA_APIKEY", "OPACA_ROLE", "eyJhbGciOiJIUzI1NiJ9", "PAYLOAD", "leitor@exemplo.test",
    ]) {
      expect(texto).not.toContain(proibido)
    }
    // NÃO COLETADOS: campos do PostgREST que o evento simplesmente não tem.
    for (const ausente of ["coluna interna", "perhaps you meant", "42P01"]) {
      expect(texto).not.toContain(ausente)
    }
    // E o DIAGNÓSTICO sobrevive — é ele que torna o evento acionável.
    expect(texto).toContain("does not exist")
  })

  /**
   * 🔴 A mensagem VAZIA é o caso que a A3.1 mediu com chave de service inválida — `{message:""}`,
   * sem `code`, `details` nem `hint`. Remedido em 2026-08-23: continua sendo o que sai.
   * É ele que torna `operation` obrigatório — sem mensagem, é o único campo que identifica.
   */
  it("mensagem VAZIA não inutiliza o evento — quem identifica é a operação", async () => {
    const VAZIA = { count: null, error: { message: "" } } as unknown as Resposta
    RESPOSTAS = { works: VAZIA, category_scores: OK(1), work_reviews: OK(1), source: OK(1) }
    expect((await ler()).works).toBeNull()
    expect(operacoes()).toEqual(["site-stats.count.works"])
    expect(eventos()[0].errorMessage).toBe("")
  })

  /**
   * 🔴 A regressão que o runtime probe pegou com a suíte VERDE: sobre objeto plano, o evento
   * saía `errorMessage: "[object Object]"` — cego justo na classe que ele existe para cobrir.
   */
  it("a mensagem do objeto plano ENTRA — nada de \"[object Object]\"", async () => {
    RESPOSTAS = { works: ERRO("column works.x does not exist"), category_scores: OK(1), work_reviews: OK(1), source: OK(1) }
    await ler()
    expect(eventos()[0].errorMessage).toBe("column works.x does not exist")
    expect(logs.join("\n")).not.toContain("[object Object]")
  })
})

const VITRINE = { works: [], spotlight: { status: "ok", work: null } } as const
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
