import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

/**
 * A fiação da versão da avaliação (mig 216): a regra só vale se cada CAMINHO entrega o contexto
 * certo ao escritor. Lido do source (o que regride é um caminho deixar de passar o contexto) + a
 * action da troca explícita exercitada com mocks.
 */
vi.mock("server-only", () => ({}))

const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "")
const corpoDe = (src: string, assinatura: string) => {
  const i = src.indexOf(assinatura)
  expect(i, assinatura).toBeGreaterThanOrEqual(0)
  return src.slice(i, src.indexOf("\n}\n", i))
}

describe("só os dois escritores centrais gravam user_work_state no app", () => {
  it("nenhum upsert/update/insert/delete em user_work_state fora de server/queries/user-work-state.ts", () => {
    const arquivos = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "app", "components", "lib", "server"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f))
    const culpados: string[] = []
    for (const f of arquivos) {
      if (f === "server/queries/user-work-state.ts") continue
      let src: string
      try {
        src = semComentarios(ler(f))
      } catch {
        continue
      }
      const re = /from\("user_work_state"\)([\s\S]{0,400})/g
      for (const m of src.matchAll(re)) {
        const cadeia = m[1].split(/\.from\(/)[0]
        if (/\.(upsert|update|insert|delete)\(/.test(cadeia)) culpados.push(f)
      }
    }
    expect(culpados).toEqual([])
  })
})

describe("cada caminho entrega o contexto de versão", () => {
  it("importação de lista: versão DESCONHECIDA nas duas escritas", () => {
    const src = semComentarios(ler("server/actions/external-list-import.ts"))
    const chamadas = src.match(/writeReadingState\([^)]*\)/g) ?? []
    expect(chamadas.length).toBe(2)
    for (const c of chamadas) expect(c).toMatch(/\{ kind: "unknown" \}/)
  })
  it("updateWorkStatus: as DUAS escritas (dona e leitora) usam a versão ATIVA validada", () => {
    const corpo = corpoDe(semComentarios(ler("server/actions/works.ts")), "export async function updateWorkStatus(")
    expect(corpo).toMatch(/activeEdition\?: string \| null/)
    expect(corpo).toMatch(/const editionContext = editionContextFrom\(activeEdition\)/)
    const escritas = corpo.match(/writeReadingState\([^)]*\)/g) ?? []
    expect(escritas).toHaveLength(2)
    for (const e of escritas) expect(e).toMatch(/editionContext\)$/)
  })
  it("savePilotTaste: a nota de gosto usa a versão ativa", () => {
    const src = semComentarios(ler("server/actions/pilot-taste.ts"))
    expect(src).toMatch(/editionContextFrom\(activeEdition\)/)
    expect(src).toMatch(/writeReadingState\(userId, \[workId\], \{ user_score: label \}, editionContext\)/)
  })
  it("a página passa a versão ativa e a da avaliação ao fluxo de Meu Status", () => {
    const page = semComentarios(ler("app/catalog/[id]/page.tsx"))
    expect(page).toMatch(/edition=\{\s*isMixedWork && activeEdition\s*\? \{ active: activeEdition, evaluation: work\.read_edition \?\? null \}/)
    const flow = semComentarios(ler("components/titles/post-reading-flow.tsx"))
    expect(flow.match(/activeEdition=\{edition\?\.active \?\? null\}/g)).toHaveLength(2)
    expect(semComentarios(ler("components/titles/work-status-form.tsx"))).toMatch(/updateWorkStatus\(workId, normalized, activeEdition\)/)
    expect(semComentarios(ler("components/pilot/post-taste-assessment.tsx"))).toMatch(/savePilotTaste\(workId, payload, !s\.endingApplicable, s\.activeEdition\)/)
  })
  it("o viés da pós-leitura recebe o cliente de CATÁLOGO (estado e notas por versão não têm policy)", () => {
    const src = semComentarios(ler("server/actions/post-reading-attributes.ts"))
    expect(src).toMatch(/const supabase = createAdminClient\(\)/)
    expect(src).toMatch(/recomputeAttributeBias\(userId, userDb, supabase\)/)
  })
  it("o overlay pessoal da página carrega read_edition do leitor (nunca de works)", () => {
    expect(semComentarios(ler("server/queries/works.ts"))).toMatch(/read_edition: state\.readEdition/)
    expect(semComentarios(ler("server/queries/user-work-state.ts"))).toMatch(/readEdition: parseMixedEdition\(row\.read_edition\)/)
  })
})

describe("setEvaluationEdition — troca explícita", () => {
  const writeReadingState = vi.fn()
  const markRecalcPending = vi.fn()
  const recalculateForUser = vi.fn()
  const afters: Array<() => Promise<void>> = []
  let gate: { ok: true; userId: string; isOwner: boolean } = { ok: true, userId: "dona", isOwner: true }

  beforeEach(() => {
    vi.resetModules()
    writeReadingState.mockReset()
    markRecalcPending.mockReset()
    recalculateForUser.mockReset()
    afters.length = 0
    gate = { ok: true, userId: "dona", isOwner: true }
    vi.doMock("@/server/queries/user-work-state", () => ({
      ensureReadingStateWriter: async () => gate,
      writeReadingState: (...a: unknown[]) => writeReadingState(...a),
    }))
    vi.doMock("@/server/recalc/queue", () => ({ markRecalcPending: (...a: unknown[]) => markRecalcPending(...a) }))
    vi.doMock("@/server/recalc/user-recalc", () => ({ recalculateForUser: (...a: unknown[]) => recalculateForUser(...a) }))
    vi.doMock("next/server", () => ({ after: (fn: () => Promise<void>) => afters.push(fn) }))
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }))
  })

  it("dona: grava como explícita, sem tocar a nota, e marca `read_edition`", async () => {
    writeReadingState.mockResolvedValue({ error: null, readEditionsWritten: 1 })
    const { setEvaluationEdition } = await import("@/server/actions/read-edition")
    expect(await setEvaluationEdition("w1", "normal")).toEqual({ ok: true, changed: true })
    expect(writeReadingState).toHaveBeenCalledWith("dona", ["w1"], {}, { kind: "explicit", edition: "normal" })
    expect(markRecalcPending).toHaveBeenCalledWith("setEvaluationEdition", { changed: ["read_edition"], actorId: "dona" })
  })
  it("leitora: recalcula só a DELA em after()", async () => {
    gate = { ok: true, userId: "leitora", isOwner: false }
    writeReadingState.mockResolvedValue({ error: null, readEditionsWritten: 1 })
    const { setEvaluationEdition } = await import("@/server/actions/read-edition")
    await setEvaluationEdition("w1", "r18")
    expect(markRecalcPending).not.toHaveBeenCalled()
    expect(afters).toHaveLength(1)
    await afters[0]()
    expect(recalculateForUser).toHaveBeenCalledWith("leitora")
  })
  it("nada mudou (mesma versão, sem avaliação, não-mixed) ⇒ não marca recálculo", async () => {
    writeReadingState.mockResolvedValue({ error: null, readEditionsWritten: 0 })
    const { setEvaluationEdition } = await import("@/server/actions/read-edition")
    expect(await setEvaluationEdition("w1", "r18")).toEqual({ ok: true, changed: false })
    expect(markRecalcPending).not.toHaveBeenCalled()
    expect(afters).toHaveLength(0)
  })
  it("valor inválido é recusado antes de gravar", async () => {
    const { setEvaluationEdition } = await import("@/server/actions/read-edition")
    expect(await setEvaluationEdition("w1", "ambas")).toEqual({ ok: false, error: "versão inválida: ambas" })
    expect(writeReadingState).not.toHaveBeenCalled()
  })
  it("erro do escritor é devolvido e nada é marcado", async () => {
    writeReadingState.mockResolvedValue({ error: "Falha lendo a versão da sua avaliação: x" })
    const { setEvaluationEdition } = await import("@/server/actions/read-edition")
    expect(await setEvaluationEdition("w1", "r18")).toEqual({ ok: false, error: "Falha lendo a versão da sua avaliação: x" })
    expect(markRecalcPending).not.toHaveBeenCalled()
  })
})
