import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Escopo das migrations 204 (estado de edição) e 205 (as 206 obras auditadas), lido do SOURCE.
 *
 * O COMPORTAMENTO é conferido por `npm run test:db-edicao-mixed` (Postgres local, transações
 * desfeitas: 56 casos, inclusive rollback exato e as guardas de entrada). Aqui ficam as invariantes
 * que não podem regredir sem ninguém rodar o banco: o que a 205 promete NÃO tocar, e que os dados
 * embutidos são os medidos.
 */
const ROOT = path.resolve(__dirname, "../../..")
const ler = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")
/** SQL sem comentários de linha — os comentários CITAM o que a migration não faz. */
const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "")
const M204 = "supabase/migrations/204_estado_de_edicao.sql"
const M205 = "supabase/migrations/205_edicoes_auditadas.sql"

type Estado = { work_id: string; titulo: string; state: string; classe: string; basis: string; r18_extra_chapters: boolean; fetched_at: string; evidence: Record<string, unknown> }

/** Os blocos `$dados$[ … ]$dados$` da 205, na ordem: estados, tags erradas, overrides, auto esperado. */
function blocosDeDados(): unknown[][] {
  const sql = ler(M205)
  return [...sql.matchAll(/\$dados\$\[\n?([\s\S]*?)\n?\]\$dados\$/g)].map((m) => JSON.parse(`[${m[1]}]`))
}

describe("migration 205 — os dados embutidos são os da auditoria", () => {
  const [estados, tagsErradas, overrides, autoEsperado] = blocosDeDados() as [Estado[], Array<{ work_id: string; tag_slug: string }>, Array<{ work_id: string; classificacao: string }>, Array<{ work_id: string; auto_depois: boolean }>]
  const porId = new Map(estados.map((e) => [e.work_id, e]))

  it("206 obras únicas: 140 mixed · 35 r18_only · 28 single · 3 unknown", () => {
    expect(estados).toHaveLength(206)
    expect(porId.size).toBe(206)
    const conta = (s: string) => estados.filter((e) => e.state === s).length
    expect([conta("mixed"), conta("r18_only"), conta("single"), conta("unknown")]).toEqual([140, 35, 28, 3])
  })

  it("wrong_signal vira single (estado editorial), nunca r18_only nem mixed", () => {
    expect(estados.filter((e) => e.classe === "wrong_signal").every((e) => e.state === "single")).toBe(true)
  })

  it("toda linha carrega a procedência: motivo da auditoria, MU com data e base da decisão", () => {
    for (const e of estados) {
      expect(e.evidence).toHaveProperty("auditoria.motivo")
      expect(e.evidence).toHaveProperty("mangaupdates.series_id")
      expect(Number.isNaN(Date.parse(e.fetched_at))).toBe(false)
      expect(e.basis).toMatch(/^(mangaupdates_description|mangaupdates_category|reviews|synopsis_text)$/)
    }
  })

  it("extras R19 só em mixed (7)", () => {
    const extras = estados.filter((e) => e.r18_extra_chapters)
    expect(extras).toHaveLength(7)
    expect(extras.every((e) => e.state === "mixed")).toBe(true)
  })

  it("os 6 overrides são das 6 obras mixed revisadas", () => {
    expect(overrides).toHaveLength(6)
    expect(overrides.every((o) => porId.get(o.work_id)?.state === "mixed")).toBe(true)
  })

  it("tags removidas: r19 só de wrong_signal, R19 Version só de mixed — nada mais", () => {
    for (const t of tagsErradas) {
      const classe = porId.get(t.work_id)?.classe
      if (t.tag_slug === "r19") expect(classe).toBe("wrong_signal")
      else if (t.tag_slug === "r19-version") expect(classe).toBe("confirmed_mixed")
      else throw new Error(`tag inesperada no plano: ${t.tag_slug}`)
    }
    expect(tagsErradas.filter((t) => t.tag_slug === "r19")).toHaveLength(15)
    expect(tagsErradas.filter((t) => t.tag_slug === "r19-version")).toHaveLength(6)
  })

  it("o recálculo de adult_auto só DESLIGA, e só wrong_signal", () => {
    expect(autoEsperado.every((a) => porId.get(a.work_id)?.classe === "wrong_signal")).toBe(true)
    expect(autoEsperado.filter((a) => a.auto_depois === false)).toHaveLength(13)
  })
})

describe("migration 205 — o que ela promete NÃO tocar", () => {
  const sql = semComentarios(ler(M205))

  it("não escreve em category_scores (nenhuma nota muda)", () => {
    expect(sql).not.toMatch(/(update|insert\s+into|delete\s+from)\s+public\.category_scores/i)
  })

  it("não toca adult_override: nem false (sinal errado se corrige na ORIGEM), nem os 6 true da fase 1", () => {
    expect(sql).not.toMatch(/set\s+adult_override\s*=/i)
    expect(sql).not.toMatch(/work_adult_override_log/)
    // A classificação da auditoria dos 6 fica na procedência, para a fase 2 remover com contexto.
    expect(sql).toMatch(/'override_work_level'/)
  })

  it("não liga adult_auto (a guarda recusa subida)", () => {
    expect(sql).toMatch(/passariam a adult_auto = true/)
  })

  it("cada tabela de backup que ela cria é usada pelo rollback", () => {
    const criadas = [...sql.matchAll(/create table if not exists (bkp\.mig205_\w+)/g)].map((m) => m[1])
    expect(criadas.length).toBeGreaterThanOrEqual(5)
    const rollback = ler("scripts/rollback/205_rollback.sql")
    for (const t of criadas) expect(rollback, t).toContain(t)
  })
})

describe("migration 204 — uma fonte só para o estado de edição", () => {
  const sql = semComentarios(ler(M204))

  it("r19_edition e edition_state só são gravados pela função de sync", () => {
    const gravacoes = [...sql.matchAll(/set\s+edition_state\s*=|set\s+r19_edition\s*=/gi)]
    expect(gravacoes).toHaveLength(1)
    const sync = sql.slice(sql.indexOf("function public.sync_work_edition_mirror"), sql.indexOf("revoke all on function public.sync_work_edition_mirror"))
    expect(sync).toMatch(/set edition_state = v_state, r19_edition = v_mixed/)
  })

  it("o gatilho antigo tag → r19_edition sai; a ponte fica presa ao estado por CHECK", () => {
    expect(sql).toMatch(/drop trigger if exists trg_work_tags_r19_edition on public\.work_tags/)
    expect(sql).toMatch(/check \(r19_edition = \(edition_state is not distinct from 'mixed'\)\)/)
  })

  it("o marcador de sinopse e a tag gravada por fora produzem no máximo 'unknown'", () => {
    const marcador = sql.slice(sql.indexOf("function public.trg_work_synopses_r19_marker"), sql.indexOf("-- ── 6)"))
    expect(marcador).toMatch(/'unknown', 'synopsis_marker', 'auto'/)
    expect(marcador).not.toMatch(/insert into public\.work_tags/)
    const guarda = sql.slice(sql.indexOf("function public.trg_work_tags_edition_guard"), sql.indexOf("drop trigger if exists trg_work_tags_edition_guard"))
    expect(guarda).toMatch(/'unknown', 'edition_tag', 'auto'/)
    expect(guarda).not.toMatch(/'mixed'\s*,\s*'edition_tag'/)
  })

  it("os dois rollbacks existem e a 204 recusa voltar com a 205 aplicada", () => {
    expect(ler("scripts/rollback/204_rollback.sql")).toMatch(/há estado auditado/)
    expect(fs.existsSync(path.join(ROOT, "scripts/rollback/205_rollback.sql"))).toBe(true)
  })
})
