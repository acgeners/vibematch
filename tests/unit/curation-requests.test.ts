import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * O que este arquivo prende é a propriedade que a RLS NÃO protege aqui.
 *
 * As actions de pedido usam a SERVICE ROLE, que ignora políticas. Então as policies da
 * migration 177 valem para o cliente de sessão e não para este caminho — quem impede alguém de
 * cancelar o pedido de outra pessoa é, literalmente, o `.eq("user_id", …)` no código. É o mesmo
 * buraco do PR #127, e ele não dá erro quando some: apaga a linha da outra pessoa e responde
 * "ok".
 */

/** Registra cada `.eq(coluna, valor)` da cadeia para o teste poder afirmar sobre os filtros. */
let eqs: Array<[string, unknown]> = []
/**
 * ⚠️ Lido pelo getter `linhaInserida()`, não direto. Quem grava é o Proxy do mock, por closure —
 * o TypeScript não enxerga essa escrita, então depois de um `inserido = null` explícito ele
 * ESTREITA a variável para `null` e `inserido?.work_id` vira erro de tipo em `never`.
 */
let inserido: Record<string, unknown> | null = null
const linhaInserida = (): Record<string, unknown> | null => inserido
let sessao: { ok: boolean; userId?: string; error?: string } = { ok: true, userId: "quem-pediu" }

const chain = (result: unknown): unknown =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void) => Promise.resolve(result).then(res)
        return (a: unknown, b: unknown) => {
          if (prop === "eq") eqs.push([String(a), b])
          if (prop === "insert") inserido = a as Record<string, unknown>
          return chain(result)
        }
      },
    },
  )

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => chain({ data: [{ work_id: "w1" }], error: null }) }),
}))
vi.mock("@/server/queries/current-user", () => ({
  ensureSignedIn: async () => sessao,
  ensureAdmin: async () => ({ ok: true }),
}))

beforeEach(() => {
  eqs = []
  inserido = null
  sessao = { ok: true, userId: "quem-pediu" }
})

describe("pedidos de curadoria", () => {
  it("cancelar filtra pelo DONO da sessão, não só pelo id do pedido", async () => {
    const { cancelCurationRequest } = await import("@/server/actions/curation-requests")
    const r = await cancelCurationRequest("pedido-de-outra-pessoa")

    expect(r.ok).toBe(true)
    expect(eqs, "sem .eq('user_id') qualquer um apaga o pedido de qualquer um").toContainEqual([
      "user_id",
      "quem-pediu",
    ])
    expect(eqs).toContainEqual(["id", "pedido-de-outra-pessoa"])
  })

  it("o dono do pedido vem da SESSÃO, nunca do argumento", async () => {
    const { createCurationRequest } = await import("@/server/actions/curation-requests")
    await createCurationRequest({
      kind: "update_data",
      workId: "w1",
      // Um cliente malicioso mandaria isto junto; a action tem de ignorar. O duplo cast é
      // porque o tipo do parâmetro não tem `userId` — que é exatamente o ponto do teste.
      ...({ userId: "vitima" } as unknown as Record<string, never>),
    })

    expect(inserido?.user_id, "user_id tem de vir de ensureSignedIn").toBe("quem-pediu")
  })

  it("sem sessão não registra nada", async () => {
    sessao = { ok: false, error: "Entre na sua conta para fazer isso." }
    const { createCurationRequest } = await import("@/server/actions/curation-requests")
    const r = await createCurationRequest({ kind: "update_data", workId: "w1" })

    expect(r.ok).toBe(false)
    expect(inserido, "nada pode ser inserido sem sessão").toBeNull()
  })

  it("pedido repetido responde ok, não erro", async () => {
    // A constraint parcial da 177 devolve 23505 quando já existe um pedido igual em aberto.
    // Isso não é falha: o estado desejado JÁ vale. Dizer "erro" faria a pessoa clicar de novo.
    const { createCurationRequest } = await import("@/server/actions/curation-requests")
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: () => chain({ data: null, error: { code: "23505" } }) }),
    }))
    vi.resetModules()
    const { createCurationRequest: recarregada } = await import(
      "@/server/actions/curation-requests"
    )
    const r = await recarregada({ kind: "update_data", workId: "w1" })
    expect(r.ok).toBe(true)
    expect(r.error).toBeUndefined()
    expect(createCurationRequest).toBeTypeOf("function")
  })

  it("create_by_name exige nome e recusa obra", async () => {
    const { createCurationRequest } = await import("@/server/actions/curation-requests")
    const vazio = await createCurationRequest({ kind: "create_by_name", query: "   " })
    expect(vazio.ok).toBe(false)

    inserido = null
    await createCurationRequest({ kind: "create_by_name", query: "  Berserk  ", workId: "w1" })
    // Espelha a constraint do banco: pedido por nome NUNCA carrega work_id, mesmo que o
    // cliente mande um — senão vira um `update_data` disfarçado.
    expect(linhaInserida()?.work_id).toBeNull()
    expect(linhaInserida()?.query).toBe("Berserk")
  })
})

/**
 * ⚠️ Este bloco vem ANTES do `getMyOpenRequestsByWork` de propósito. Aquele chama
 * `vi.resetModules()` + `vi.doMock("@/server/queries/current-user", …)` com um mock PARCIAL
 * (só `getSessionUserId`), e o registro resetado faz esse mock valer para tudo que importar
 * depois — `ensureSignedIn` viraria `undefined` e as actions morreriam com "não é função".
 * Ordem de `describe` é dependência real aqui, não estilo.
 */

/**
 * A NOTA — o que o leitor escreveu (migration 195).
 *
 * Três propriedades aqui não dão erro quando somem, e é por isso que elas têm caso próprio:
 * o excesso truncado grava uma linha PLAUSÍVEL com texto comido, o surrogate solto derruba o
 * corpo INTEIRO com um caractere invisível, e a string vazia vira uma citação sem citação.
 */
describe("a nota do pedido", () => {
  it("report_error sem texto é recusado, e NADA é inserido", async () => {
    const { createCurationRequest } = await import("@/server/actions/curation-requests")

    const r = await createCurationRequest({ kind: "report_error", workId: "w1", note: "   " })

    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/errado/i)
    expect(linhaInserida(), "sem o texto o pedido é ininteligível — não pode virar linha").toBe(
      null,
    )
  })

  it("report_error com texto grava a nota", async () => {
    const { createCurationRequest } = await import("@/server/actions/curation-requests")

    const r = await createCurationRequest({
      kind: "report_error",
      workId: "w1",
      note: "  A capa é do spin-off.  ",
    })

    expect(r.ok).toBe(true)
    expect(linhaInserida()).toMatchObject({
      kind: "report_error",
      work_id: "w1",
      note: "A capa é do spin-off.",
    })
  })

  it("🔴 texto acima do teto é RECUSADO, nunca truncado", async () => {
    const { createCurationRequest } = await import("@/server/actions/curation-requests")
    const { CURATION_NOTE_MAX } = await import("@/server/queries/curation-requests")

    const r = await createCurationRequest({
      kind: "report_error",
      workId: "w1",
      note: "a".repeat(CURATION_NOTE_MAX + 1),
    })

    expect(r.ok).toBe(false)
    // Cortar por unidade UTF-16 parte emoji ao meio e FABRICA o surrogate solto que derrubou
    // duas escritas em 18/08/2026. Uma linha gravada aqui é a prova de que alguém truncou.
    expect(linhaInserida(), "truncar reintroduz o bug de 18/08 — o certo é recusar").toBe(null)
  })

  it("exatamente no teto passa (o corte é `>`, não `>=`)", async () => {
    const { createCurationRequest } = await import("@/server/actions/curation-requests")
    const { CURATION_NOTE_MAX } = await import("@/server/queries/curation-requests")

    const r = await createCurationRequest({
      kind: "report_error",
      workId: "w1",
      note: "a".repeat(CURATION_NOTE_MAX),
    })

    expect(r.ok).toBe(true)
    expect((linhaInserida()?.note as string).length).toBe(CURATION_NOTE_MAX)
  })

  it("surrogate desemparelhado sai; emoji INTEIRO fica", async () => {
    const { createCurationRequest } = await import("@/server/actions/curation-requests")

    await createCurationRequest({
      kind: "report_error",
      workId: "w1",
      // \uD83D sozinho é metade de um par — o PostgREST recusa o corpo inteiro com 400.
      note: "capa errada \uD83D e o ano \u{1F600}",
    })

    const note = linhaInserida()?.note as string
    expect(note).not.toContain("\uD83D\uD83D")
    expect(note, "emoji válido não é censura — só o que o Postgres não guarda é que sai").toContain(
      "\u{1F600}",
    )
    // O que sobra tem de ser um texto que o `JSON.stringify` do PostgREST aceita: nenhum
    // code unit solto na faixa de surrogate.
    for (let i = 0; i < note.length; i++) {
      const c = note.charCodeAt(i)
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = note.charCodeAt(i + 1)
        expect(next >= 0xdc00 && next <= 0xdfff, `high surrogate solto em ${i}`).toBe(true)
        i++
      } else {
        expect(c >= 0xdc00 && c <= 0xdfff, `low surrogate solto em ${i}`).toBe(false)
      }
    }
  })

  it("nota em branco vira null, nunca string vazia", async () => {
    const { createCurationRequest } = await import("@/server/actions/curation-requests")

    await createCurationRequest({ kind: "update_data", workId: "w1", note: "   \n  " })

    // A UI decide "tem nota?" por `is not null`; um '' desenharia balão de citação vazio, e o
    // check `curation_requests_note_tamanho` da 195 recusaria a linha.
    expect(linhaInserida()?.note).toBe(null)
  })

  it("a nota é OPCIONAL nos dois pedidos antigos", async () => {
    const { createCurationRequest } = await import("@/server/actions/curation-requests")

    const semNota = await createCurationRequest({ kind: "update_data", workId: "w1" })
    expect(semNota.ok).toBe(true)
    expect(linhaInserida()?.note).toBe(null)

    inserido = null
    const comNota = await createCurationRequest({
      kind: "review_eval",
      workId: "w1",
      note: "o humor não é 8",
    })
    expect(comNota.ok).toBe(true)
    expect(linhaInserida()?.note).toBe("o humor não é 8")
  })

  it("kind desconhecido é recusado antes de tocar o banco", async () => {
    const { createCurationRequest } = await import("@/server/actions/curation-requests")

    // O tipo some em runtime: isto é o que um POST à mão manda para um endpoint `"use server"`.
    const r = await createCurationRequest({
      kind: "drop_table" as never,
      workId: "w1",
    })

    expect(r.ok).toBe(false)
    expect(linhaInserida()).toBe(null)
  })
})

describe("getMyOpenRequestsByWork — dois pedidos na mesma obra", () => {
  /**
   * REGRESSÃO. A constraint da 177 é `(user_id, work_id, kind)`: a mesma pessoa pode ter
   * "atualizar dados" E "revisar avaliação" abertos na MESMA obra. A 1ª versão indexava
   * `new Map(linhas.map(r => [r.work_id, pedido]))`, e chave repetida em `Map` faz o último
   * vencer — um dos dois sumia.
   *
   * O estrago não aparecia como erro: a UI mostraria só um pedido e ofereceria de novo o botão
   * do outro; o insert bateria na constraint, devolveria 23505, e a action trata 23505 como
   * SUCESSO (corretamente — o estado desejado já vale). Resultado: botão que responde "pedido
   * enviado" e não muda nada, para sempre.
   */
  it("devolve os DOIS pedidos, não o último", async () => {
    vi.resetModules()
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () =>
          chain({
            data: [
              { id: "p1", kind: "update_data", work_id: "w1", query: null, created_at: "2026-08-01" },
              { id: "p2", kind: "review_eval", work_id: "w1", query: null, created_at: "2026-08-02" },
            ],
            error: null,
          }),
      }),
    }))
    vi.doMock("@/server/queries/current-user", () => ({ getSessionUserId: async () => "quem-pediu" }))

    const { getMyOpenRequestsByWork } = await import("@/server/queries/curation-requests")
    const porObra = await getMyOpenRequestsByWork()

    expect(porObra.get("w1")).toHaveLength(2)
    expect(porObra.get("w1")?.map((p) => p.kind).sort()).toEqual(["review_eval", "update_data"])
  })

  it("sem sessão devolve vazio, sem consultar", async () => {
    vi.resetModules()
    vi.doMock("@/server/queries/current-user", () => ({ getSessionUserId: async () => null }))
    const { getMyOpenRequestsForWork } = await import("@/server/queries/curation-requests")
    // Anônimo não tem pedido — e `getSessionUserId` (não `getCurrentUserId`) é o que garante
    // que ele não receba os do DONO ([[gotcha-anonimo-vira-dono]]).
    expect(await getMyOpenRequestsForWork("w1")).toEqual([])
  })
})
