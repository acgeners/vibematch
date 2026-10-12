import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Os DOIS escritores centrais de `user_work_state` (`writeReadingState`, `mirrorOwnerState`) gravam a
 * versão da avaliação (mig 216) pela regra de `lib/editions/read-edition.ts`, contra um banco falso
 * COM ESTADO que imita o upsert em lote do supabase-js: a coluna que falta em parte das linhas vira
 * NULL (`defaultToNull`). É essa semântica que faz o agrupamento por plano ser necessário — sem ele,
 * a versão de uma linha que não devia mudar seria apagada no mesmo upsert de outra que muda.
 */
vi.mock("server-only", () => ({}))

type Row = Record<string, unknown>
const db = {
  work_edition_state: [] as Row[],
  user_work_state: [] as Row[],
  user_settings: [] as Row[],
}
const leituras: Record<string, number> = {}
const upserts: Array<{ table: string; rows: Row[] }> = []
let falhaEm: string | null = null

function fakeClient() {
  return {
    from(table: keyof typeof db) {
      const filtros: Array<(r: Row) => boolean> = []
      let modo: "select" | "upsert" = "select"
      let lote: Row[] = []
      const exec = () => {
        if (modo === "upsert") {
          upserts.push({ table, rows: lote })
          const colunas = new Set(lote.flatMap((r) => Object.keys(r)))
          for (const r of lote) {
            const cheio: Row = {}
            for (const c of colunas) cheio[c] = c in r ? r[c] : null // defaultToNull
            const i = db[table].findIndex((x) => x.user_id === cheio.user_id && x.work_id === cheio.work_id)
            if (i >= 0) db[table][i] = { ...db[table][i], ...cheio }
            else db[table].push(cheio)
          }
          return { data: null, error: null }
        }
        leituras[table] = (leituras[table] ?? 0) + 1
        if (falhaEm === table) return { data: null, error: { message: `falha simulada em ${table}` } }
        return { data: db[table].filter((r) => filtros.every((f) => f(r))), error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), chain),
        in: (c: string, vs: unknown[]) => (filtros.push((r) => vs.includes(r[c])), chain),
        limit: () => chain,
        maybeSingle: async () => {
          const r = exec()
          return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }
        },
        upsert: (rows: Row | Row[]) => {
          modo = "upsert"
          lote = Array.isArray(rows) ? rows : [rows]
          return chain
        },
        then: (ok: (v: unknown) => void, ko?: (e: unknown) => void) => {
          try {
            ok(exec())
          } catch (e) {
            ko?.(e)
          }
        },
      }
      return chain
    },
  }
}

vi.mock("@/lib/supabase/user", () => ({ createUserClient: async () => fakeClient() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeClient() }))
vi.mock("@/lib/server/predictions/label-transition", () => ({
  writeWithLabelTransitions: async ({ write }: { write: () => Promise<unknown> }) => ({ result: await write() }),
}))
vi.mock("@/lib/server/predictions/label-transition-io", () => ({ createLabelTransitionDeps: () => ({}) }))
vi.mock("@/server/queries/current-user", () => ({
  getSessionUserId: async () => "u1",
  getOwnerUserId: async () => "dona",
  ensureSignedIn: async () => ({ ok: true, userId: "u1" }),
  ensurePermission: async () => ({ ok: true }),
  getHideAdultContent: async () => false,
}))

const U = "u1"
const linha = (work_id: string, extra: Row = {}): Row => ({ user_id: U, work_id, ...extra })
const de = (work_id: string) => db.user_work_state.find((r) => r.user_id === U && r.work_id === work_id)

beforeEach(() => {
  db.work_edition_state = [
    { work_id: "mixA", state: "mixed", r18_extra_chapters: false },
    { work_id: "mixB", state: "mixed", r18_extra_chapters: false },
    { work_id: "mixExtras", state: "mixed", r18_extra_chapters: true },
    { work_id: "single", state: "single", r18_extra_chapters: false },
  ]
  db.user_work_state = []
  db.user_settings = [{ current_user_id: U, hide_adult_content: false }]
  for (const k of Object.keys(leituras)) delete leituras[k]
  upserts.length = 0
  falhaEm = null
})

describe("writeReadingState grava a versão de uma avaliação nova", () => {
  it("vista na R18 ⇒ r18/active_version; obra não-mixed fica sem versão", async () => {
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    expect((await writeReadingState(U, ["mixA", "single"], { user_score: 8 }, { kind: "active", edition: "r18" })).error).toBeNull()
    expect(de("mixA")).toMatchObject({ user_score: 8, read_edition: "r18", read_edition_source: "active_version" })
    expect(de("single")?.read_edition ?? null).toBeNull()
  })

  it("vista na normal ⇒ normal", async () => {
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    await writeReadingState(U, ["mixA"], { user_score: 8 }, { kind: "active", edition: "normal" })
    expect(de("mixA")).toMatchObject({ read_edition: "normal", read_edition_source: "active_version" })
  })

  it("sem tela (padrão da conta): vê 18+ ⇒ r18; oculta 18+ ⇒ normal; R18 só nos extras ⇒ normal", async () => {
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    await writeReadingState(U, ["mixA", "mixExtras"], { quick_score: 7 })
    expect(de("mixA")?.read_edition).toBe("r18")
    expect(de("mixExtras")?.read_edition).toBe("normal")
    db.user_settings = [{ current_user_id: U, hide_adult_content: true }]
    await writeReadingState(U, ["mixB"], { quick_score: 7 })
    expect(de("mixB")?.read_edition).toBe("normal")
  })
})

describe("o upsert em lote NÃO apaga a versão de quem não muda (defaultToNull)", () => {
  it("lote com avaliação existente (preserva) + avaliação nova (grava) + não-mixed", async () => {
    db.user_work_state = [linha("mixA", { user_score: 6, read_edition: "normal", read_edition_source: "active_version" })]
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    await writeReadingState(U, ["mixA", "mixB", "single"], { user_score: 9 }, { kind: "active", edition: "r18" })
    expect(de("mixA")).toMatchObject({ user_score: 9, read_edition: "normal", read_edition_source: "active_version" })
    expect(de("mixB")).toMatchObject({ user_score: 9, read_edition: "r18" })
    // Cada upsert tem chaves uniformes: as linhas sem plano não carregam `read_edition`.
    for (const u of upserts) {
      const comVersao = u.rows.filter((r) => "read_edition" in r).length
      expect([0, u.rows.length]).toContain(comVersao)
    }
  })

  it("mirrorOwnerState (dona, service role) segue a mesma regra", async () => {
    db.user_work_state = [{ user_id: "dona", work_id: "mixA", user_score: 6, read_edition: "r18", read_edition_source: "explicit_user_decision" }]
    const { mirrorOwnerState } = await import("@/server/queries/user-work-state")
    expect((await mirrorOwnerState("dona", ["mixA", "mixB"], { user_score: 7 })).error).toBeNull()
    const a = db.user_work_state.find((r) => r.user_id === "dona" && r.work_id === "mixA")
    const b = db.user_work_state.find((r) => r.user_id === "dona" && r.work_id === "mixB")
    expect(a).toMatchObject({ user_score: 7, read_edition: "r18", read_edition_source: "explicit_user_decision" })
    expect(b).toMatchObject({ user_score: 7, read_edition: "r18", read_edition_source: "active_version" })
  })
})

describe("edição e escritores secundários", () => {
  it("editar a nota preserva a versão, mesmo vendo a outra", async () => {
    db.user_work_state = [linha("mixA", { user_score: 6, read_edition: "r18", read_edition_source: "active_version" })]
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    await writeReadingState(U, ["mixA"], { user_score: 7 }, { kind: "active", edition: "normal" })
    expect(de("mixA")).toMatchObject({ user_score: 7, read_edition: "r18" })
  })

  it("status/favorito/♥ não leem o estado de edição nem tocam a versão (zero consulta a mais)", async () => {
    db.user_work_state = [linha("mixA", { user_score: 6, read_edition: "r18", read_edition_source: "active_version" })]
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    await writeReadingState(U, ["mixA"], { personal_status_id: 3, is_favorite: true, synopsis_quality: "♥♥" })
    expect(leituras.work_edition_state ?? 0).toBe(0)
    expect(de("mixA")).toMatchObject({ read_edition: "r18", personal_status_id: 3 })
    expect(upserts[0].rows[0]).not.toHaveProperty("read_edition")
  })

  it("apagar a avaliação inteira (clearUserRating) apaga a versão", async () => {
    db.user_work_state = [linha("mixA", { user_score: 6, quick_score: 6, read_edition: "r18", read_edition_source: "active_version" })]
    const { writeReadingState, POST_READING_COLUMNS } = await import("@/server/queries/user-work-state")
    const tudo = Object.fromEntries(["user_score", "quick_score", ...POST_READING_COLUMNS].map((c) => [c, null]))
    await writeReadingState(U, ["mixA"], tudo)
    expect(de("mixA")).toMatchObject({ user_score: null, read_edition: null, read_edition_source: null })
  })

  it("importação sobre avaliação com versão: nota nova ⇒ versão desconhecida", async () => {
    db.user_work_state = [linha("mixA", { user_score: 6, read_edition: "r18", read_edition_source: "active_version" })]
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    await writeReadingState(U, ["mixA"], { user_score: 8 }, { kind: "unknown" })
    expect(de("mixA")).toMatchObject({ user_score: 8, read_edition: null, read_edition_source: null })
  })
})

describe("troca explícita", () => {
  it("muda só a versão (user_choice) e conta a linha gravada", async () => {
    db.user_work_state = [linha("mixA", { user_score: 6, read_edition: "r18", read_edition_source: "active_version" })]
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    const r = await writeReadingState(U, ["mixA"], {}, { kind: "explicit", edition: "normal" })
    expect(r).toEqual({ error: null, readEditionsWritten: 1 })
    expect(de("mixA")).toMatchObject({ user_score: 6, read_edition: "normal", read_edition_source: "user_choice" })
  })

  it("sem avaliação não cria linha nem versão", async () => {
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    const r = await writeReadingState(U, ["mixA"], {}, { kind: "explicit", edition: "r18" })
    expect(r.error).toBeNull()
    expect(r.readEditionsWritten ?? 0).toBe(0)
    expect(upserts).toHaveLength(0)
    expect(db.user_work_state).toHaveLength(0)
  })
})

describe("falha FECHADA", () => {
  it.each(["work_edition_state", "user_work_state"])("leitura de %s falhou ⇒ erro e NENHUM upsert", async (tabela) => {
    falhaEm = tabela
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    const r = await writeReadingState(U, ["mixA"], { user_score: 8 }, { kind: "active", edition: "r18" })
    expect(r.error).toMatch(/Falha lendo/)
    expect(upserts).toHaveLength(0)
  })
  it("preferência de 18+ ilegível (avaliação nova sem tela) ⇒ erro e nenhum upsert", async () => {
    falhaEm = "user_settings"
    const { writeReadingState } = await import("@/server/queries/user-work-state")
    const r = await writeReadingState(U, ["mixA"], { user_score: 8 })
    expect(r.error).toMatch(/preferência de 18\+/)
    expect(upserts).toHaveLength(0)
  })
})
