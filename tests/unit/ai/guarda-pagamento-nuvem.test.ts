import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { execFileSync, execSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * GUARDA DE CHAMADA PAGA NA NUVEM A PARTIR DE CÓDIGO NÃO CANÔNICO (lib/ai/code-provenance.ts).
 *
 * O incidente que ela impede (26–27/09/2026): `npm run dev` numa branch experimental não
 * mergeada, com arquivos rastreados modificados, apontado para o banco da nuvem — 25 avaliações
 * pagas gravadas com `prompt_version = v31`. Estes testes provam a REGRA (função pura), a SONDA
 * (git de verdade, em repositórios temporários locais) e o PONTO (a guarda roda antes do provider
 * no `createLoggedMessage` real, com cliente e banco falsos — nenhuma chamada paga).
 */

const estado = vi.hoisted(() => ({
  probe: null as null | (() => unknown),
  probeChamadas: 0,
  inserts: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/ai/code-provenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/code-provenance")>()
  return {
    ...actual,
    probeGit: (cwd?: string) => {
      estado.probeChamadas++
      return estado.probe ? estado.probe() : actual.probeGit(cwd)
    },
  }
})
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        estado.inserts.push(row)
        return { select: () => ({ single: async () => ({ data: { id: "log-1" }, error: null }) }) }
      },
    }),
  }),
}))
vi.mock("@/server/queries/current-user", () => ({ getSessionUserId: async () => null }))

import { decidePaidCloudCall, normalizeOverride, probeGit, type GitProbe } from "@/lib/ai/code-provenance"
import { createLoggedMessage, PaidCallBlockedError } from "@/lib/ai/anthropic-client"

const SHA = "a".repeat(40)
const limpo: GitProbe = { ok: true, sha: SHA, branch: "main", dirtyTracked: false, inOriginMain: true }
const nuvemLocal = { onFly: false, localDb: false }

describe("A · a decisão (pura)", () => {
  it("Fly + nuvem ⇒ permite, sem olhar git", () => {
    const d = decidePaidCloudCall({ onFly: true, localDb: false, git: null, override: null })
    expect(d).toMatchObject({ allow: true, basis: "fly" })
    expect(d.provenance.runtime).toBe("fly")
  })

  it("local + banco local ⇒ permite, sem olhar git", () => {
    expect(decidePaidCloudCall({ onFly: false, localDb: true, git: null, override: null })).toMatchObject({ allow: true, basis: "local_db" })
  })

  it("local + nuvem + limpo + HEAD em origin/main ⇒ permite (canônico)", () => {
    const d = decidePaidCloudCall({ ...nuvemLocal, git: limpo, override: null })
    expect(d).toMatchObject({ allow: true, basis: "canonical" })
    expect(d.provenance).toMatchObject({ runtime: "local", target: "cloud", sha: SHA, dirty: false, in_origin_main: true, canonical: true })
  })

  it("branch ≠ main já mergeada (HEAD dentro de origin/main) ⇒ permite", () => {
    expect(decidePaidCloudCall({ ...nuvemLocal, git: { ...limpo, branch: "fix/x" }, override: null }).allow).toBe(true)
  })

  it("rastreado sujo ⇒ bloqueia", () => {
    const d = decidePaidCloudCall({ ...nuvemLocal, git: { ...limpo, dirtyTracked: true }, override: null })
    expect(d.allow).toBe(false)
    if (!d.allow) expect(d.message).toMatch(/rastreados modificados/)
  })

  it("HEAD fora de origin/main ⇒ bloqueia, e sugere git fetch (a ref é LOCAL)", () => {
    const d = decidePaidCloudCall({ ...nuvemLocal, git: { ...limpo, inOriginMain: false }, override: null })
    expect(d.allow).toBe(false)
    if (!d.allow) expect(d.message).toMatch(/git fetch/)
  })

  it("git indisponível ⇒ bloqueia (fail closed)", () => {
    const d = decidePaidCloudCall({ ...nuvemLocal, git: { ok: false, error: "HEAD indeterminado" }, override: null })
    expect(d.allow).toBe(false)
    expect(d.provenance.git_error).toBe("HEAD indeterminado")
  })

  it("origin/main ausente ⇒ bloqueia", () => {
    const d = decidePaidCloudCall({ ...nuvemLocal, git: { ...limpo, inOriginMain: null }, override: null })
    expect(d.allow).toBe(false)
    if (!d.allow) expect(d.message).toMatch(/origin\/main não existe/)
  })

  it("override: ausente, vazio e só espaço NÃO são override; texto é", () => {
    expect(normalizeOverride(undefined)).toBeNull()
    expect(normalizeOverride("")).toBeNull()
    expect(normalizeOverride("   \n\t")).toBeNull()
    expect(normalizeOverride("  piloto v32 ")).toBe("piloto v32")
  })

  it("override vazio ou só espaço ⇒ continua bloqueado", () => {
    for (const raw of ["", "   "]) {
      expect(decidePaidCloudCall({ ...nuvemLocal, git: { ...limpo, dirtyTracked: true }, override: normalizeOverride(raw) }).allow).toBe(false)
    }
  })

  it("override válido ⇒ permite, SEM esconder que é não canônico", () => {
    const d = decidePaidCloudCall({ ...nuvemLocal, git: { ...limpo, dirtyTracked: true, inOriginMain: false }, override: "piloto deliberado" })
    expect(d).toMatchObject({ allow: true, basis: "override" })
    expect(d.provenance).toMatchObject({ canonical: false, dirty: true, in_origin_main: false, override_reason: "piloto deliberado" })
  })

  it("detached HEAD não quebra — branch fica null e a mensagem diz (detached)", () => {
    const d = decidePaidCloudCall({ ...nuvemLocal, git: { ...limpo, branch: null, inOriginMain: false }, override: null })
    expect(d.allow).toBe(false)
    expect(d.provenance.branch).toBeNull()
    if (!d.allow) expect(d.message).toMatch(/\(detached\)/)
  })

  it("INCIDENTE v31 reconstruído (branch experimental, 1dc9ce2 fora de origin/main, sujo) ⇒ BLOQUEIA; com motivo ⇒ permite e registra", () => {
    const incidente: GitProbe = { ok: true, sha: "1dc9ce2" + "0".repeat(33), branch: "feat/ai-evaluation-art-signal", dirtyTracked: true, inOriginMain: false }
    const semOverride = decidePaidCloudCall({ ...nuvemLocal, git: incidente, override: null })
    expect(semOverride.allow).toBe(false)
    if (!semOverride.allow) expect(semOverride.message).toMatch(/feat\/ai-evaluation-art-signal @ 1dc9ce2/)
    const comOverride = decidePaidCloudCall({ ...nuvemLocal, git: incidente, override: "teste da fronteira v31" })
    expect(comOverride).toMatchObject({ allow: true, basis: "override" })
    expect(comOverride.provenance).toMatchObject({ canonical: false, override_reason: "teste da fronteira v31", branch: "feat/ai-evaluation-art-signal" })
  })
})

describe("A · a sonda de git (repositório temporário REAL, local, sem rede)", () => {
  let dir = ""
  const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" }).trim()
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "guarda-git-"))
    g("init", "-q", "-b", "main")
    g("config", "user.email", "t@t")
    g("config", "user.name", "t")
    writeFileSync(join(dir, "a.txt"), "1")
    g("add", "a.txt")
    g("commit", "-q", "-m", "c1")
    g("update-ref", "refs/remotes/origin/main", "HEAD")
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("limpo e contido ⇒ canônico", () => {
    expect(probeGit(dir)).toMatchObject({ ok: true, branch: "main", dirtyTracked: false, inOriginMain: true })
  })

  it("só arquivo NÃO rastreado ⇒ não conta como sujo", () => {
    writeFileSync(join(dir, "novo.md"), "x")
    expect(probeGit(dir)).toMatchObject({ ok: true, dirtyTracked: false })
  })

  it("arquivo rastreado modificado ⇒ sujo", () => {
    writeFileSync(join(dir, "a.txt"), "2")
    expect(probeGit(dir)).toMatchObject({ ok: true, dirtyTracked: true })
  })

  it("commit novo fora de origin/main ⇒ in_origin_main false; mergeado ⇒ true", () => {
    g("checkout", "-q", "-b", "exp")
    writeFileSync(join(dir, "b.txt"), "1")
    g("add", "b.txt")
    g("commit", "-q", "-m", "c2")
    expect(probeGit(dir)).toMatchObject({ ok: true, branch: "exp", inOriginMain: false })
    g("update-ref", "refs/remotes/origin/main", "HEAD")
    expect(probeGit(dir)).toMatchObject({ ok: true, branch: "exp", inOriginMain: true })
  })

  it("detached HEAD ⇒ branch null, sem quebrar", () => {
    g("checkout", "-q", "--detach")
    expect(probeGit(dir)).toMatchObject({ ok: true, branch: null })
  })

  it("origin/main ausente ⇒ in_origin_main null", () => {
    g("update-ref", "-d", "refs/remotes/origin/main")
    expect(probeGit(dir)).toMatchObject({ ok: true, inOriginMain: null })
  })

  it("fora de um repositório ⇒ ok:false (fail closed)", () => {
    const fora = mkdtempSync(join(tmpdir(), "guarda-sem-git-"))
    try {
      expect(probeGit(fora).ok).toBe(false)
    } finally {
      rmSync(fora, { recursive: true, force: true })
    }
  })
})

describe("B · no createLoggedMessage real (cliente e banco FALSOS — nenhuma chamada paga)", () => {
  const envAntes = { ...process.env }
  let chamadasProvider = 0
  const cliente = {
    messages: {
      stream: () => {
        chamadasProvider++
        return {
          finalMessage: async () => ({
            id: "msg_1", model: "claude-sonnet-5", stop_reason: "end_turn", content: [],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        }
      },
    },
  } as unknown as Parameters<typeof createLoggedMessage>[0]
  const params = { model: "claude-sonnet-5", max_tokens: 10, messages: [{ role: "user" as const, content: "x" }] }
  const meta = {
    operation: "ai_evaluation", workId: "w-1", attempt: 1, logicalRequestId: "lr-1",
    workloadType: "recurring" as const, metadata: { hasReviews: true },
  }

  beforeEach(() => {
    chamadasProvider = 0
    estado.inserts = []
    estado.probeChamadas = 0
    estado.probe = null
    delete process.env.FLY_APP_NAME
    delete process.env.PAID_CLOUD_NONCANONICAL_REASON
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefgh.supabase.co"
  })
  afterEach(() => {
    process.env = { ...envAntes }
  })

  it("não canônico + nuvem ⇒ recusa ANTES do provider: zero chamada, zero linha de log", async () => {
    estado.probe = () => ({ ok: true, sha: SHA, branch: "exp", dirtyTracked: true, inOriginMain: false })
    await expect(createLoggedMessage(cliente, params, meta)).rejects.toBeInstanceOf(PaidCallBlockedError)
    expect(chamadasProvider).toBe(0)
    expect(estado.inserts).toHaveLength(0)
  })

  it("git indisponível ⇒ recusa antes do provider (fail closed)", async () => {
    estado.probe = () => ({ ok: false, error: "HEAD indeterminado" })
    await expect(createLoggedMessage(cliente, params, meta)).rejects.toBeInstanceOf(PaidCallBlockedError)
    expect(chamadasProvider).toBe(0)
  })

  it("canônico ⇒ paga, e metadata.code entra SEM apagar a metadata existente", async () => {
    estado.probe = () => ({ ok: true, sha: SHA, branch: "main", dirtyTracked: false, inOriginMain: true })
    await createLoggedMessage(cliente, params, meta)
    expect(chamadasProvider).toBe(1)
    const md = estado.inserts[0].metadata as Record<string, unknown>
    expect(md).toMatchObject({ hasReviews: true, work_id: "w-1", attempt: 1, logical_request_id: "lr-1", workload_type: "recurring" })
    expect(md.code).toMatchObject({ runtime: "local", target: "cloud", sha: SHA, branch: "main", dirty: false, in_origin_main: true, canonical: true })
  })

  it("override válido ⇒ paga, avisa, e o motivo fica na proveniência", async () => {
    estado.probe = () => ({ ok: true, sha: SHA, branch: "exp", dirtyTracked: true, inOriginMain: false })
    process.env.PAID_CLOUD_NONCANONICAL_REASON = "piloto deliberado"
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await createLoggedMessage(cliente, params, meta)
    expect(chamadasProvider).toBe(1)
    expect(warn.mock.calls.some((c) => String(c[0]).includes("NÃO CANÔNICA"))).toBe(true)
    expect((estado.inserts[0].metadata as Record<string, unknown>).code).toMatchObject({ canonical: false, override_reason: "piloto deliberado" })
    warn.mockRestore()
  })

  it("override só com espaços ⇒ continua recusado", async () => {
    estado.probe = () => ({ ok: true, sha: SHA, branch: "exp", dirtyTracked: true, inOriginMain: false })
    process.env.PAID_CLOUD_NONCANONICAL_REASON = "   "
    await expect(createLoggedMessage(cliente, params, meta)).rejects.toBeInstanceOf(PaidCallBlockedError)
    expect(chamadasProvider).toBe(0)
  })

  it("Fly e banco local ⇒ pagam sem consultar o git", async () => {
    process.env.FLY_APP_NAME = "satoria"
    await createLoggedMessage(cliente, params, meta)
    delete process.env.FLY_APP_NAME
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321"
    await createLoggedMessage(cliente, params, meta)
    expect(chamadasProvider).toBe(2)
    expect(estado.probeChamadas).toBe(0)
    expect((estado.inserts[0].metadata as Record<string, unknown>).code).toMatchObject({ runtime: "fly" })
  })
})

describe("B · arquitetura", () => {
  const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const wrapper = semComentarios(readFileSync("lib/ai/anthropic-client.ts", "utf8"))
  const corpo = wrapper.slice(wrapper.indexOf("export async function createLoggedMessage"))

  it("a guarda roda ANTES do messages.stream e FORA do try (o catch não a alcança)", () => {
    const guarda = corpo.indexOf("assertPaidCallAllowed()")
    expect(guarda).toBeGreaterThan(-1)
    expect(guarda).toBeLessThan(corpo.indexOf("messages.stream("))
    expect(guarda).toBeLessThan(corpo.indexOf("try {"))
  })

  it("a guarda não é engolida por catch/.catch", () => {
    expect(wrapper).not.toMatch(/assertPaidCallAllowed\(\)\s*\.catch|try\s*\{\s*[^}]*assertPaidCallAllowed/)
  })

  it("nenhum .messages.* em lib, server ou app fora do wrapper", () => {
    const hits = execSync("git grep -lE '\\.messages\\.(create|stream|countTokens)\\(' -- lib server app || true", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
    expect(hits).toEqual(["lib/ai/anthropic-client.ts"])
  })
})
