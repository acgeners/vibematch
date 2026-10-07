import { describe, it, expect, vi, beforeEach } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Contrato canônico de SCORING (migration 202) no recalc — os dois caminhos que gravam resultado.
 *
 * 🔴 O que regride calado: o preflight sair do topo (o recalc lê o catálogo inteiro e só o banco
 * recusa no fim), ou uma linha de scoring parar de carregar `scoring_contract` (o banco passaria a
 * recusar o recalc LEGÍTIMO assim que `enforce` ligasse — o mesmo apagão, do lado oposto).
 *
 * O cliente admin é falso e registra cada tabela tocada: abortar "antes de ler o catálogo" é
 * provado por ele não ter visto nenhuma tabela além de `canonical_contract`.
 */

vi.mock("server-only", () => ({}))

const db = vi.hoisted(() => ({
  contrato: { data: null as unknown, error: null as { code?: string; message: string } | null },
  tabelas: [] as string[],
  upserts: [] as Array<{ tabela: string; linhas: Array<Record<string, unknown>> }>,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      db.tabelas.push(t)
      if (t === "canonical_contract") {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => db.contrato }
        return q
      }
      return {
        upsert: async (linhas: Array<Record<string, unknown>>) => {
          db.upserts.push({ tabela: t, linhas })
          return { error: null }
        },
        // Qualquer leitura além do contrato é um query builder que REJEITA ao ser aguardado —
        // estourar síncrono vazaria como "unhandled rejection" nas leituras paralelas do recalc.
        select: () => {
          const erro = () => Promise.reject(new Error(`PASSOU_DO_PREFLIGHT: leu ${t}`))
          const cadeia: Record<string, unknown> = new Proxy({}, {
            get: (_alvo, prop) => (prop === "then" ? (ok: never, falha: (e: unknown) => unknown) => erro().then(ok, falha) : () => cadeia),
          })
          return cadeia
        },
      }
    },
    rpc: () => {
      throw new Error("PASSOU_DO_PREFLIGHT: rpc")
    },
  }),
}))
vi.mock("@/server/queries/current-user", () => ({
  getCurrentUserId: async () => {
    throw new Error("PASSOU_DO_PREFLIGHT: getCurrentUserId")
  },
  getOwnerUserId: async () => "dono",
  ensureAdmin: async () => ({ ok: true }),
  ensurePermission: async () => ({ ok: false }),
}))

import { recalculateAll, buildWork, computeRecalc, type RawWork } from "@/server/actions/calculations"
import { recalculateForUser } from "@/server/recalc/user-recalc"
import { mirrorOwnerScores } from "@/server/queries/owner-labels"
import { SCORING_CONTRACT } from "@/lib/calculations/scoring-contract"
import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"
import type { FormulaConfig, ScoreWeight } from "@/types/domain"

const linha = (contratos: string[], enforce: boolean) => ({
  data: { eval_prompt_versions: ["v32"], scoring_contracts: contratos, enforce },
  error: null,
})

beforeEach(() => {
  db.tabelas.length = 0
  db.upserts.length = 0
})

describe.each([
  ["recalculateAll", () => recalculateAll("headless")],
  ["recalculateForUser", () => recalculateForUser("outra-pessoa")],
])("%s — preflight do contrato de scoring", (_nome, rodar) => {
  it("enforce ligado + contrato incompatível: aborta ANTES de ler o catálogo", async () => {
    db.contrato = linha(["s10-outro"], true)
    await expect(rodar()).rejects.toThrow(/INCOMPATÍVEL[\s\S]*s9-fantasy-b-v1[\s\S]*s10-outro/)
    expect(db.tabelas).toEqual(["canonical_contract"])
    expect(db.upserts).toEqual([])
  })

  it("erro ao LER o contrato aborta (fail closed), sem tocar o catálogo", async () => {
    db.contrato = { data: null, error: { code: "08006", message: "connection failure" } }
    await expect(rodar()).rejects.toThrow(/não consegui ler o contrato canônico/)
    expect(db.tabelas).toEqual(["canonical_contract"])
  })

  it(`enforce ligado + ${SCORING_CONTRACT} permitido: segue adiante`, async () => {
    db.contrato = linha([SCORING_CONTRACT], true)
    await expect(rodar()).rejects.toThrow(/PASSOU_DO_PREFLIGHT/)
  })

  it("enforce desligado mantém o comportamento atual", async () => {
    db.contrato = linha(["s10-outro"], false)
    await expect(rodar()).rejects.toThrow(/PASSOU_DO_PREFLIGHT/)
  })

  it("tabela ausente (banco antes da 202) mantém o comportamento atual", async () => {
    db.contrato = { data: null, error: { code: "PGRST205", message: "Could not find the table" } }
    await expect(rodar()).rejects.toThrow(/PASSOU_DO_PREFLIGHT/)
  })
})

// ── as linhas de scoring carregam o contrato ─────────────────────────────────────────────────

function catalogo(): RawWork[] {
  let s = 7
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)
  return Array.from({ length: 60 }, (_, i) => {
    const notas = SCORING_CRITERION_SLUGS.map((slug) => ({ criterion_slug: slug, score: Math.round(r() * 20) / 2, source: "ai_accepted" }))
    const rating = 6 + r() * 3
    return {
      id: `w${String(i).padStart(3, "0")}`, publication_status_id: null, total_chapters: 40 + Math.floor(r() * 120),
      synopsis_quality: null, observation_adjustment: 0, user_score: i < 40 ? 5 + r() * 4 : null, is_archived: false,
      year: 2018, year_end: null, original_title: null, post_story_score: null, post_fl_score: null, post_ml_score: null,
      post_character_development_score: null, post_pacing_score: null, post_art_visual_score: null,
      post_impact_immersion_score: null, post_originality_score: null, category_scores: notas,
      platform_ratings: [{ id: `p${i}`, platform: "mal", rating, vote_count: 100 + Math.floor(r() * 5000) }], work_tags: [],
    } as unknown as RawWork
  })
}

describe("as linhas do recalc declaram o contrato", () => {
  it(`computeRecalc carimba scoring_contract = ${SCORING_CONTRACT} em TODA linha`, () => {
    const works = catalogo().map((raw) => buildWork(raw, {} as Parameters<typeof buildWork>[1]))
    const pesos: ScoreWeight[] = SCORING_CRITERION_SLUGS.map((slug, i) => ({ id: slug, slug, name: slug, weight: 10 + i, threshold: null, display_order: i, is_active: true }))
    const { rows } = computeRecalc({
      works, weights: pesos, config: { score_weights_auto: false, formula_version: "teste" } as unknown as FormulaConfig,
      tasteProfile: null, declaredTagPrefs: [], includeQuality: false, aiQualityByWork: new Map(), fast: true,
    })
    expect(rows.length).toBe(60)
    expect(new Set(rows.map((r) => r.scoring_contract))).toEqual(new Set([SCORING_CONTRACT]))
  })

  it("a lista de colunas do trigger (migration) só nomeia colunas que o recalc grava — e deixa fora o que não é scoring", () => {
    // Um nome digitado errado na lista do SQL NUNCA dispararia, e nada acusaria.
    const dir = join(process.cwd(), "supabase/migrations")
    const fonte = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
      .map((f) => readFileSync(join(dir, f), "utf8")).filter((sql) => /function public\.guard_scoring_contract/.test(sql)).at(-1)
    expect(fonte, "nenhuma migration define guard_scoring_contract").toBeDefined()
    const lista = fonte!.match(/colunas constant text\[\] := array\[([\s\S]*?)\];/)
    expect(lista).not.toBeNull()
    const colunas = [...lista![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(colunas).toContain("expected_score")

    const works = catalogo().map((raw) => buildWork(raw, {} as Parameters<typeof buildWork>[1]))
    const pesos: ScoreWeight[] = SCORING_CRITERION_SLUGS.map((slug, i) => ({ id: slug, slug, name: slug, weight: 10 + i, threshold: null, display_order: i, is_active: true }))
    const { rows } = computeRecalc({
      works, weights: pesos, config: { score_weights_auto: false, formula_version: "teste" } as unknown as FormulaConfig,
      tasteProfile: null, declaredTagPrefs: [], includeQuality: false, aiQualityByWork: new Map(), fast: true,
    })
    const gravadas = new Set(Object.keys(rows[0]))
    // Nota.Calc APOSENTADA (2026-10-07): o recalc deixou de gravar estas três, mas elas seguem na
    // tabela (legado, sem migration) e na lista do trigger — onde continuam servindo: um checkout
    // defasado que ainda as grave precisa do contrato. Saem da lista na migration que dropar as colunas.
    const LEGADO_FORA_DO_RECALC = ["calc_score", "mae_calc", "rmse_calc"]
    for (const c of colunas) {
      if (LEGADO_FORA_DO_RECALC.includes(c)) continue
      expect(gravadas, `a coluna ${c} do trigger não é gravada pelo recalc`).toContain(c)
    }
    // A exceção não pode virar brecha pra nome errado: o legado é coluna REAL e o recalc NÃO a grava.
    const todasAsMigrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(dir, f), "utf8")).join("\n")
    for (const c of LEGADO_FORA_DO_RECALC.filter((c) => colunas.includes(c))) {
      expect(todasAsMigrations, `${c} não é coluna declarada em migration nenhuma`).toMatch(new RegExp(`\\b${c}\\s+numeric`, "i"))
      expect(gravadas, `${c} é legado da Nota.Calc e não pode voltar a ser gravado pelo recalc`).not.toContain(c)
    }
    for (const fora of ["confidence", "alignment_score", "alignment_stale", "art_estimate", "art_percentile", "platform_avg", "total_votes"]) {
      expect(colunas, `${fora} não é resultado de scoring e não pode disparar a guarda`).not.toContain(fora)
    }
  })

  it("o espelho per-user leva o contrato quando a linha o traz (recalc)…", async () => {
    await mirrorOwnerScores("u1", [{ work_id: "w1", expected_score: 7.1, personal_fit: 0.4, scoring_contract: SCORING_CONTRACT }])
    expect(db.upserts).toHaveLength(1)
    expect(db.upserts[0].tabela).toBe("user_calculated_scores")
    expect(db.upserts[0].linhas[0].scoring_contract).toBe(SCORING_CONTRACT)
  })

  it("…e NÃO carimba linha que não o traz (Veredito, só alignment_*)", async () => {
    await mirrorOwnerScores("u1", [{ work_id: "w1", alignment_score: 61, alignment_at: "2026-10-03T00:00:00Z" }])
    expect(db.upserts[0].linhas[0]).not.toHaveProperty("scoring_contract")
    expect(db.upserts[0].linhas[0].alignment_score).toBe(61)
  })
})
