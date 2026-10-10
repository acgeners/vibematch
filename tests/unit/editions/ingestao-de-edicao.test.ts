import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchMangaUpdatesById } from "@/lib/external/mangaupdates"
import { clearEditionEvidenceCache, readEditionEvidence, rememberEditionEvidence } from "@/lib/editions/edition-evidence-cache"
import { extractMangaUpdatesEditionEvidence } from "@/lib/editions/edition-evidence"
import { recordMangaUpdatesEditionEvidence } from "@/lib/editions/record-edition-evidence"

/**
 * A ingestão futura (fase 1 de `mixed`): a evidência de edição sai da descrição CRUA do
 * MangaUpdates, fica no servidor até o save confirmar o vínculo, e só então vira estado — pela régua
 * `decideAutoEditionState`. Nada aqui chama a rede: o `fetch` é simulado.
 */

const DESCRICAO_CRUA = [
  "Ela despertou dentro de um romance…",
  "",
  "**Original Webtoon:**",
  "R19: [KakaoPage](https://page.kakao.com/content/1), [Daum](https://webtoon.kakao.com/content/x/2)",
  "R15: [KakaoPage](https://page.kakao.com/content/3)",
].join("\n")

describe("o conector do MangaUpdates lê a edição da descrição CRUA", () => {
  beforeEach(() => clearEditionEvidenceCache())
  afterEach(() => vi.unstubAllGlobals())

  it("R15/R19 que a limpeza apaga chegam como evidência mixed, guardada por id do MU", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ title: "Obra X", description: DESCRICAO_CRUA, categories: [{ category: "Romance" }], status: "40 Chapters (Ongoing)" }),
      })),
    )
    const detail = await fetchMangaUpdatesById(424242)
    expect(detail?.editionEvidence?.verdict).toBe("mixed")
    // A sinopse que o resto do app recebe continua colapsada (o cleanHtml junta as linhas) — é por
    // isso que a evidência TEM de sair do texto cru: lida da sinopse, a régua não acharia os blocos.
    expect(extractMangaUpdatesEditionEvidence({ description: detail?.synopsis, categories: [] }).verdict).not.toBe("mixed")
    expect(readEditionEvidence("mangaupdates", "424242")?.evidence.verdict).toBe("mixed")
  })
})

/** Supabase mínimo: só o que `recordMangaUpdatesEditionEvidence` usa, gravando as chamadas. */
function fakeSupabase(row: { state: string; decided_by: string } | null) {
  const writes: Array<{ op: string; payload: unknown; opts?: unknown; filters?: Array<[string, unknown]> }> = []
  const builder = {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
    }),
    upsert: async (payload: unknown, opts: unknown) => {
      writes.push({ op: "upsert", payload, opts })
      return { error: null }
    },
    update: (payload: unknown) => {
      const filters: Array<[string, unknown]> = []
      const chain = {
        eq: (col: string, val: unknown) => {
          filters.push([col, val])
          if (filters.length === 3) {
            writes.push({ op: "update", payload, filters })
            return Promise.resolve({ error: null })
          }
          return chain
        },
      }
      return chain
    },
  }
  const supabase = { from: (t: string) => (t === "work_edition_state" ? builder : null) }
  return { supabase: supabase as never, writes }
}

describe("o save grava a evidência — pela régua da ingestão", () => {
  beforeEach(() => clearEditionEvidenceCache())
  const evidenciaMixed = extractMangaUpdatesEditionEvidence({ description: DESCRICAO_CRUA, categories: [] })

  it("sem evidência em cache (servidor reiniciado entre a prévia e o save): não grava nada", async () => {
    const { supabase, writes } = fakeSupabase(null)
    expect(await recordMangaUpdatesEditionEvidence(supabase, "w1", "999")).toBe("sem_evidencia_em_cache")
    expect(writes).toEqual([])
  })

  it("obra sem estado: insere o veredito como decisão AUTOMÁTICA, sem sobrescrever no escuro", async () => {
    rememberEditionEvidence("mangaupdates", "777", evidenciaMixed, new Date())
    const { supabase, writes } = fakeSupabase(null)
    expect(await recordMangaUpdatesEditionEvidence(supabase, "w1", "777")).toBe("inserido")
    expect(writes).toHaveLength(1)
    expect(writes[0].op).toBe("upsert")
    expect(writes[0].opts).toEqual({ onConflict: "work_id", ignoreDuplicates: true })
    expect(writes[0].payload).toMatchObject({ work_id: "w1", state: "mixed", decided_by: "auto", basis: "mangaupdates_description" })
  })

  it("obra auditada: a ingestão não toca", async () => {
    rememberEditionEvidence("mangaupdates", "777", evidenciaMixed, new Date())
    const { supabase, writes } = fakeSupabase({ state: "single", decided_by: "audit" })
    expect(await recordMangaUpdatesEditionEvidence(supabase, "w1", "777")).toBe("mantido")
    expect(writes).toEqual([])
  })

  it("unknown automático (marcador) sobe para mixed só se a linha ainda for esse unknown", async () => {
    rememberEditionEvidence("mangaupdates", "777", evidenciaMixed, new Date())
    const { supabase, writes } = fakeSupabase({ state: "unknown", decided_by: "auto" })
    expect(await recordMangaUpdatesEditionEvidence(supabase, "w1", "777")).toBe("atualizado")
    expect(writes[0].op).toBe("update")
    expect(writes[0].filters).toEqual([["work_id", "w1"], ["decided_by", "auto"], ["state", "unknown"]])
  })

  it("o cache expira", () => {
    rememberEditionEvidence("mangaupdates", "5", evidenciaMixed, new Date("2026-10-10T00:00:00Z"))
    expect(readEditionEvidence("mangaupdates", "5", new Date("2026-10-10T01:00:00Z"))).not.toBeNull()
    expect(readEditionEvidence("mangaupdates", "5", new Date("2026-10-10T03:00:00Z"))).toBeNull()
  })
})

describe("arquitetura: o vínculo confirmado é o ÚNICO ponto que grava evidência", () => {
  const ROOT = path.resolve(__dirname, "../../..")
  const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

  it("upsertWorkExternalIds grava o vínculo e, com id do MangaUpdates, a evidência", () => {
    const src = semComentarios(fs.readFileSync(path.join(ROOT, "server/actions/works.ts"), "utf8"))
    const ini = src.indexOf("async function upsertWorkExternalIds(")
    expect(ini).toBeGreaterThan(-1)
    const corpo = src.slice(ini, src.indexOf("\n}\n", ini))
    expect(corpo).toMatch(/from\("work_external_ids"\)[\s\S]*upsert[\s\S]*recordMangaUpdatesEditionEvidence\(supabase, workId, muId\)/)
    expect(corpo).toMatch(/source === "mangaupdates"/)
  })

  it("nenhum código do app grava r19_edition, edition_state ou work_edition_state fora do dono", () => {
    const dirs = ["lib", "server", "app", "components"]
    const ofensores: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const rel = path.relative(ROOT, p)
          const src = semComentarios(fs.readFileSync(p, "utf8"))
          // Só GRAVAÇÃO conta: um campo de tipo `r19_edition: boolean` é leitura e não pode reprovar.
          const gravaPonte = /\.(update|insert|upsert)\(\s*\{[^}]*\b(r19_edition|edition_state)\s*:/.test(src)
          const gravaEstado = /from\("work_edition_state"\)[\s\S]{0,200}\.(insert|upsert|update|delete)\(/.test(src)
          if (gravaPonte) ofensores.push(`${rel}: grava r19_edition/edition_state`)
          if (gravaEstado && rel !== "lib/editions/record-edition-evidence.ts") ofensores.push(`${rel}: grava work_edition_state`)
        }
      }
    }
    for (const d of dirs) walk(path.join(ROOT, d))
    expect(ofensores).toEqual([])
  })
})
