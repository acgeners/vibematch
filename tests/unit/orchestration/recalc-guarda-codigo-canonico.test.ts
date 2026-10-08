import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * GUARDA DE CÓDIGO CANÔNICO DO RECÁLCULO (server/recalc/code-guard.ts).
 *
 * O que ela impede: um `npm run dev` numa branch NÃO mergeada, apontado para a nuvem, regravar os
 * scores do catálogo inteiro — sem ninguém pedir, porque o recálculo dispara sozinho ao abrir uma
 * página com pendência. Precedente real: 02–03/10/2026.
 *
 * Tudo aqui é falso por construção: a sonda de git devolve o estado que cada caso pede, e o banco é
 * um cliente que REGISTRA cada tabela tocada — "recusou antes de ler" é provado por ele não ter
 * visto nada, não suposto. Nenhuma chamada de rede, nenhum recálculo real.
 */

const h = vi.hoisted(() => ({
  probe: null as null | (() => unknown),
  probeCalls: 0,
  tabelas: [] as string[],
  rpcs: [] as string[],
  pendingRow: null as Record<string, unknown> | null,
  afters: [] as Array<() => Promise<unknown>>,
  ownerCalls: 0,
  jobStoreCalls: 0,
}))

vi.mock("@/lib/ai/code-provenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/code-provenance")>()
  return {
    ...actual,
    probeGit: (cwd?: string) => {
      h.probeCalls++
      return h.probe ? h.probe() : actual.probeGit(cwd)
    },
  }
})

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      h.tabelas.push(t)
      if (t === "formula_config") {
        const q = { select: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: h.pendingRow, error: null }) }
        return q
      }
      if (t === "canonical_contract") {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) }
        return q
      }
      // Qualquer outra leitura/escrita é um builder que REJEITA ao ser aguardado: passou do guard.
      const erro = () => Promise.reject(new Error(`PASSOU_DO_GUARD: tocou ${t}`))
      const cadeia: Record<string, unknown> = new Proxy({}, {
        get: (_alvo, prop) => (prop === "then" ? (ok: never, falha: (e: unknown) => unknown) => erro().then(ok, falha) : () => cadeia),
      })
      return cadeia
    },
    rpc: (nome: string) => {
      h.rpcs.push(nome)
      throw new Error(`PASSOU_DO_GUARD: rpc ${nome}`)
    },
  }),
}))

vi.mock("@/server/queries/current-user", () => ({
  getCurrentUserId: async () => {
    throw new Error("PASSOU_DO_GUARD: getCurrentUserId")
  },
  getOwnerUserId: async () => {
    h.ownerCalls++
    return "dono"
  },
  getSessionUserId: async () => null,
  ensureAdmin: async () => ({ ok: true }),
  ensurePermission: async () => ({ ok: false }),
}))

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (cb: () => unknown) => {
    h.afters.push(async () => cb())
  },
}))

vi.mock("@/lib/orchestration/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orchestration/jobs")>()
  return {
    ...actual,
    getJobStore: async () => {
      h.jobStoreCalls++
      return new actual.InMemoryJobStore()
    },
  }
})

import { decideRecalcCloudRun, OVERRIDE_ENV, type GitProbe } from "@/lib/ai/code-provenance"
import { assertPaidCallAllowed, PaidCallBlockedError } from "@/lib/ai/anthropic-client"
import { checkRecalcCode, RecalcBlockedError, RECALC_OVERRIDE_ENV } from "@/server/recalc/code-guard"
import { ensureRecalculateScores } from "@/lib/orchestration/integrations/recalculate-scores"
import { InMemoryJobStore } from "@/lib/orchestration/jobs"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"
import { recalculateAll } from "@/server/actions/calculations"
import { recalculateForUser } from "@/server/recalc/user-recalc"
import { maybeTriggerStaleRecalc, recalculateScoresNowResult, triggerRecalcNow } from "@/server/recalc/queue"

const SHA = "b".repeat(40)
const canonico: GitProbe = { ok: true, sha: SHA, branch: "main", dirtyTracked: false, inOriginMain: true }
const mergeada: GitProbe = { ...canonico, branch: "fix/ja-mergeada" }
const naoMergeada: GitProbe = { ...canonico, branch: "fix/experimento", inOriginMain: false }
const suja: GitProbe = { ...canonico, dirtyTracked: true }
const NUVEM = "https://abcdefgh.supabase.co"

const envAntes = { ...process.env }
beforeEach(() => {
  h.probe = null
  h.probeCalls = 0
  h.tabelas.length = 0
  h.rpcs.length = 0
  h.afters.length = 0
  h.ownerCalls = 0
  h.jobStoreCalls = 0
  h.pendingRow = null
  delete process.env.FLY_APP_NAME
  delete process.env[OVERRIDE_ENV]
  delete process.env[RECALC_OVERRIDE_ENV]
  process.env.NEXT_PUBLIC_SUPABASE_URL = NUVEM
})
afterEach(() => {
  process.env = { ...envAntes }
  __resetSingleFlight()
  vi.restoreAllMocks()
})

const sonda = (g: GitProbe) => {
  h.probe = () => g
}

describe("1 · a matriz (checkRecalcCode: env + sonda)", () => {
  it("1) Fly + nuvem ⇒ permite, sem ler o git", () => {
    process.env.FLY_APP_NAME = "satoria"
    h.probe = () => {
      throw new Error("não devia ler o git no Fly")
    }
    const c = checkRecalcCode()
    expect(c).toMatchObject({ allow: true, provenance: { runtime: "fly", basis: "fly", sha: null, canonical: null } })
    expect(h.probeCalls).toBe(0)
  })

  it("2) local + banco local ⇒ permite — e registra o git (a decisão não muda)", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321"
    sonda(naoMergeada)
    expect(checkRecalcCode()).toMatchObject({
      allow: true,
      provenance: { runtime: "local", target: "local", basis: "local_db", branch: "fix/experimento", canonical: false },
    })
  })

  it("3) local + nuvem + código canônico ⇒ permite", () => {
    sonda(canonico)
    expect(checkRecalcCode()).toMatchObject({ allow: true, provenance: { basis: "canonical", canonical: true } })
  })

  it("3b) branch já mergeada (HEAD dentro de origin/main) ⇒ permite", () => {
    sonda(mergeada)
    expect(checkRecalcCode()).toMatchObject({ allow: true, provenance: { basis: "canonical", branch: "fix/ja-mergeada" } })
  })

  it("4) local + nuvem + branch NÃO mergeada ⇒ bloqueia", () => {
    sonda(naoMergeada)
    expect(checkRecalcCode()).toMatchObject({ allow: false, provenance: { basis: "blocked", canonical: false } })
  })

  it("4b) rastreado sujo ⇒ bloqueia; git indeterminado ⇒ bloqueia (fail closed)", () => {
    sonda(suja)
    expect(checkRecalcCode().allow).toBe(false)
    sonda({ ok: false, error: "HEAD indeterminado" } as GitProbe)
    const c = checkRecalcCode()
    expect(c.allow).toBe(false)
    expect(c.provenance.git_error).toBe("HEAD indeterminado")
  })

  it(`5) não canônico + ${RECALC_OVERRIDE_ENV} ⇒ permite, e o motivo vai para a proveniência`, () => {
    sonda(naoMergeada)
    process.env[RECALC_OVERRIDE_ENV] = "  teste deliberado do scoring  "
    expect(checkRecalcCode()).toMatchObject({
      allow: true,
      provenance: { basis: "override", canonical: false, override_used: true, override_reason: "teste deliberado do scoring" },
    })
  })

  it("5b) override vazio ou só espaço ⇒ continua bloqueado", () => {
    sonda(naoMergeada)
    for (const raw of ["", "   \n"]) {
      process.env[RECALC_OVERRIDE_ENV] = raw
      expect(checkRecalcCode().allow).toBe(false)
    }
  })

  it(`6) SÓ ${OVERRIDE_ENV} (o das chamadas pagas) ⇒ NÃO libera o recálculo`, () => {
    sonda(naoMergeada)
    process.env[OVERRIDE_ENV] = "piloto pago deliberado"
    expect(checkRecalcCode().allow).toBe(false)
  })
})

describe("2 · os dois overrides não se substituem", () => {
  it(`7) SÓ ${RECALC_OVERRIDE_ENV} ⇒ a chamada paga continua recusada`, () => {
    sonda(naoMergeada)
    process.env[RECALC_OVERRIDE_ENV] = "teste do scoring"
    expect(() => assertPaidCallAllowed()).toThrow(PaidCallBlockedError)
  })

  it(`e ${OVERRIDE_ENV} segue liberando a chamada paga (comportamento intacto)`, () => {
    sonda(naoMergeada)
    process.env[OVERRIDE_ENV] = "piloto pago"
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(assertPaidCallAllowed()).toMatchObject({ canonical: false, override_reason: "piloto pago" })
  })
})

describe("3 · a mensagem de recusa", () => {
  it("diz o que fazer (origin/main), nomeia o checkout e NÃO oferece override", () => {
    const d = decideRecalcCloudRun({ onFly: false, localDb: false, git: naoMergeada, override: null })
    expect(d.allow).toBe(false)
    if (d.allow) return
    expect(d.message).toMatch(/Recálculo da nuvem BLOQUEADO/)
    expect(d.message).toMatch(/origin\/main/)
    expect(d.message).toMatch(/fix\/experimento @ bbbbbbb/)
    expect(d.message).toMatch(/Nada foi calculado nem gravado/)
    expect(d.message).not.toContain(RECALC_OVERRIDE_ENV)
    expect(d.message).not.toContain(OVERRIDE_ENV)
  })
})

describe("4 · ordem: o guard vem ANTES de ler, calcular ou gravar", () => {
  describe.each([
    ["recalculateAll", () => recalculateAll("headless")],
    ["recalculateForUser", () => recalculateForUser("outra-pessoa")],
  ])("%s", (_nome, rodar) => {
    it("não canônico + nuvem ⇒ RecalcBlockedError sem tocar banco nenhum", async () => {
      sonda(naoMergeada)
      await expect(rodar()).rejects.toBeInstanceOf(RecalcBlockedError)
      expect(h.tabelas).toEqual([]) // nem o contrato, nem o catálogo, nem formula_config
      expect(h.rpcs).toEqual([])
      expect(h.ownerCalls).toBe(0)
    })

    it("canônico ⇒ passa do guard e chega ao preflight do contrato (o guard vem antes dele)", async () => {
      sonda(canonico)
      await expect(rodar()).rejects.toThrow(/PASSOU_DO_GUARD/)
      expect(h.tabelas[0]).toBe("canonical_contract")
    })
  })
})

describe("5 · runner: recusado não cria job, não calcula e não toca a pendência", () => {
  it("blocked ⇒ nenhum job, recalc nunca roda, e recalc_pending fica true", async () => {
    sonda(naoMergeada)
    const estado = { pending: true }
    const js = new InMemoryJobStore()
    let rodou = 0
    const out = await ensureRecalculateScores({
      // O recálculo de verdade é quem zera a pendência — aqui, simulado.
      recalc: async () => {
        rodou++
        estado.pending = false
        return { recalculated: 1 }
      },
      readPending: async () => ({ pending: estado.pending, lastEditAt: "2026-10-08T06:24:27Z" }),
      codeGuard: checkRecalcCode,
      jobStore: js,
    })
    expect(out.status).toBe("blocked")
    if (out.status === "blocked") expect(out.error).toMatch(/BLOQUEADO/)
    expect(rodou).toBe(0)
    expect(js.records).toHaveLength(0)
    expect(estado.pending).toBe(true)
  })

  it("force (botão) também é recusado", async () => {
    sonda(naoMergeada)
    const js = new InMemoryJobStore()
    const out = await ensureRecalculateScores({
      force: true,
      recalc: async () => ({ recalculated: 1 }),
      readPending: async () => ({ pending: false, lastEditAt: null }),
      codeGuard: checkRecalcCode,
      jobStore: js,
    })
    expect(out.status).toBe("blocked")
    expect(js.records).toHaveLength(0)
  })

  it("nada pendente ⇒ fresh, sem nem consultar o git", async () => {
    sonda(naoMergeada)
    const out = await ensureRecalculateScores({
      recalc: async () => ({ recalculated: 1 }),
      readPending: async () => ({ pending: false, lastEditAt: null }),
      codeGuard: checkRecalcCode,
      jobStore: new InMemoryJobStore(),
    })
    expect(out.status).toBe("fresh")
    expect(h.probeCalls).toBe(0)
  })
})

describe("6 · disparo AUTOMÁTICO (página carregada com pendência ≥1h)", () => {
  it("recusado: a página não explode, nada recalcula, nenhum job, e o log é claro — uma vez", async () => {
    sonda(naoMergeada)
    h.pendingRow = { recalc_pending: true, recalc_last_edit_at: new Date(Date.now() - 2 * 3600_000).toISOString() }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(maybeTriggerStaleRecalc()).resolves.toMatchObject({ pending: true })
    expect(h.afters).toHaveLength(1)
    await expect(h.afters[0]()).resolves.toBeUndefined()

    const avisos = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[recalc-guard]"))
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/recálculo automático NÃO executado \(stale-auto\): Recálculo da nuvem BLOQUEADO/)
    expect(h.jobStoreCalls).toBe(0)
    // Só a leitura do estado pendente: nenhuma tabela do catálogo, nenhum contrato, nenhum rpc.
    expect(new Set(h.tabelas)).toEqual(new Set(["formula_config"]))
    expect(h.rpcs).toEqual([])

    // A página seguinte NÃO repete o mesmo aviso.
    await maybeTriggerStaleRecalc()
    await h.afters[1]()
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("[recalc-guard]"))).toHaveLength(1)
  })
})

describe("7 · disparo MANUAL", () => {
  it("o botão recebe `blocked` com mensagem compreensível — e nenhum job", async () => {
    sonda(naoMergeada)
    const out = await triggerRecalcNow()
    expect(out.status).toBe("blocked")
    if (out.status === "blocked") {
      expect(out.error).toMatch(/Recálculo da nuvem BLOQUEADO: este checkout local não está no código canônico/)
      expect(out.error).toMatch(/origin\/main/)
    }
    expect(h.jobStoreCalls).toBe(0)
  })

  it("quem precisa do resultado (calibração, settings) recebe a mesma mensagem como erro", async () => {
    sonda(naoMergeada)
    await expect(recalculateScoresNowResult()).rejects.toThrow(/Recálculo da nuvem BLOQUEADO/)
  })
})

describe("8 · proveniência no payload do job `recalculate_scores`", () => {
  const rodar = async () => {
    const js = new InMemoryJobStore()
    const out = await ensureRecalculateScores({
      recalc: async () => ({ recalculated: 3 }),
      readPending: async () => ({ pending: true, lastEditAt: "2026-10-08T06:24:27Z" }),
      codeGuard: checkRecalcCode,
      jobStore: js,
    })
    expect(out.status).toBe("succeeded")
    return js.records[0].payload as Record<string, unknown>
  }

  it("canônico ⇒ formato completo, sem override_reason", async () => {
    sonda(canonico)
    const payload = await rodar()
    expect(payload.code).toEqual({
      runtime: "local",
      target: "cloud",
      basis: "canonical",
      sha: SHA,
      branch: "main",
      dirty: false,
      in_origin_main: true,
      canonical: true,
      override_used: false,
    })
  })

  it("override ⇒ marcado como usado, com o motivo e canonical:false", async () => {
    sonda(naoMergeada)
    process.env[RECALC_OVERRIDE_ENV] = "teste do scoring"
    const payload = await rodar()
    expect(payload.code).toMatchObject({ basis: "override", canonical: false, override_used: true, override_reason: "teste do scoring" })
  })

  it("Fly ⇒ estado explícito (null), sem inventar SHA", async () => {
    process.env.FLY_APP_NAME = "satoria"
    const payload = await rodar()
    expect(payload.code).toEqual({
      runtime: "fly",
      target: "cloud",
      basis: "fly",
      sha: null,
      branch: null,
      dirty: null,
      in_origin_main: null,
      canonical: null,
      override_used: false,
    })
  })

  it("nada de env ou segredo no payload", async () => {
    sonda(canonico)
    process.env.SUPABASE_SERVICE_ROLE_KEY = "segredo-que-nao-pode-vazar"
    process.env[OVERRIDE_ENV] = "motivo pago que não é deste guard"
    const json = JSON.stringify(await rodar())
    expect(json).not.toContain("segredo-que-nao-pode-vazar")
    expect(json).not.toContain("motivo pago")
    expect(json).not.toContain(NUVEM)
  })
})
