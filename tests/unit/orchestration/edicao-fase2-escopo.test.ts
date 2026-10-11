import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

/**
 * Escopo das migrations 213–215 (fase 2 de mixed), lido do SOURCE. O COMPORTAMENTO no banco é
 * conferido por `npm run test:db-edicao-fase2` (retrato de produção, transações desfeitas). Aqui
 * ficam as invariantes que não podem regredir sem ninguém rodar o banco.
 */
const ROOT = path.resolve(__dirname, "../../..")
const ler = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")
const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "")
const M = {
  213: "supabase/migrations/213_scores_por_edicao.sql",
  214: "supabase/migrations/214_scores_por_edicao_dados.sql",
  215: "supabase/migrations/215_libera_overrides_mixed.sql",
} as const

type Linha = {
  work_id: string; titulo: string; edition: "normal" | "r18"; score: number | null; source: string
  confidence: string | null; evidence: Record<string, unknown>
}
const bloco = <T,>(rel: string, marca = "dados"): T[] => {
  const m = ler(rel).match(new RegExp(`\\$${marca}\\$\\[\\n?([\\s\\S]*?)\\n?\\]\\$${marca}\\$`))
  if (!m) throw new Error(`sem bloco ${marca} em ${rel}`)
  return JSON.parse(`[${m[1]}]`) as T[]
}

const ONE_LAST_NIGHT = "8719d6a0-b7ee-45ea-ba61-7cbaaf6d185d"
const OVERRIDES_FASE1 = [
  "b0fe0d03-55a9-4a62-a092-145eab2e58b1", "0907dc04-99c0-4393-b2b8-d9663b07d356", "2d8cb9ce-78ef-4b0c-a1e4-4662146ffb55",
  ONE_LAST_NIGHT, "4d6e8e8a-608e-403a-b53e-afa214e6b482", "c01b9720-f162-4d35-bf99-3a2c34a09adc",
]

describe("as migrations JÁ APLICADAS (210–212) não são editadas", () => {
  // Aplicadas em produção em 2026-10-11 03:53Z; os cabeçalhos foram corrigidos no #554. Mudar o arquivo
  // agora mentiria sobre o que roda no banco — fase nova usa número novo (213+).
  it.each([
    ["supabase/migrations/210_tags_adultas_coerencia.sql", "30cd2f3352faa710208ce1ec9ff4aa2a19d42c3ef4a31e97753a3854ec73562b"],
    ["supabase/migrations/211_r19_injetado_pela_nota.sql", "443f8bbb7824b298999bd6787eb40c302d80a45470d5f3fabe8d774c92bcbad7"],
    ["supabase/migrations/212_sinal_forte_por_evidencia_auditada.sql", "1a1815c8633c1e86b34ed06a9c504c387d3f6a1ccdfcd9091b1bbf9df3c4df1c"],
  ])("%s", (rel, sha) => {
    expect(createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex")).toBe(sha)
  })
  it("a fase 2 não ressuscita os números do rascunho antigo (206–209)", () => {
    const nomes = fs.readdirSync(path.join(ROOT, "supabase/migrations"))
    expect(nomes.filter((n) => /^20[6-9]_/.test(n))).toEqual([])
  })
})

describe("213–215 não escrevem em category_scores (a nota legada fica)", () => {
  it.each(Object.entries(M))("%s", (_n, rel) => {
    expect(semComentarios(ler(rel))).not.toMatch(/(update|insert\s+into|delete\s+from)\s+public\.category_scores/i)
  })
  it("213 só cria estrutura: nenhum insert/update de dado de obra", () => {
    const sql = semComentarios(ler(M[213]))
    expect(sql).not.toMatch(/insert\s+into\s+public\.work_edition_scores/i)
    expect(sql).not.toMatch(/update\s+public\.works\b/i)
  })
  it("214 não toca works (gate, override, estado)", () => {
    expect(semComentarios(ler(M[214]))).not.toMatch(/update\s+public\.works\b/i)
  })
  it("213 não aceita fonte 'por regra' nem nota R18 automática", () => {
    expect(semComentarios(ler(M[213]))).not.toMatch(/rule_derived/)
  })
})

describe("214 — as 280 linhas por edição (210 com nota + 70 'não avaliado')", () => {
  const linhas = bloco<Linha>(M[214])
  const conta = (ed: string, src: string) => linhas.filter((l) => l.edition === ed && l.source === src).length

  it("140 obras × 2 edições, uma linha por (obra, edição)", () => {
    expect(linhas).toHaveLength(280)
    expect(new Set(linhas.map((l) => `${l.work_id}:${l.edition}`)).size).toBe(280)
  })
  it("R18: 82 reaproveitadas, 58 sem nota · normal: 1 real, 127 baseline, 12 sem nota", () => {
    expect([conta("r18", "reused_existing"), conta("r18", "not_rated")]).toEqual([82, 58])
    expect([conta("normal", "reused_existing"), conta("normal", "inferred_base"), conta("normal", "not_rated")]).toEqual([1, 127, 12])
  })
  it("nenhuma R18 = 9 por regra: toda nota R18 é a da avaliação existente, com a procedência dela", () => {
    for (const l of linhas.filter((x) => x.edition === "r18" && x.score != null)) {
      expect(l.source).toBe("reused_existing")
      expect((l.evidence.legado as { score: number }).score).toBe(l.score)
    }
  })
  it("todo baseline é 5,0 de baixa confiança com a regra, o texto e a R18 SEXUAL na procedência", () => {
    for (const l of linhas.filter((x) => x.source === "inferred_base")) {
      expect(l.score).toBe(5)
      expect(l.confidence).toBe("baixa")
      expect(l.edition).toBe("normal")
      expect(l.evidence.regra).toBe("baseline_normal_mixed_v1")
      expect(String(l.evidence.texto)).toMatch(/presume-se conteúdo sexual atenuado\/censurado/)
      expect(Object.keys((l.evidence.condicoes as { r18_sexual: object }).r18_sexual).length).toBeGreaterThan(0)
    }
  })
  it("sem nota ⇔ score nulo (ausência explícita, nunca 0)", () => {
    for (const l of linhas) expect(l.score === null).toBe(l.source === "not_rated")
  })
  it("210 linhas têm nota e 70 são ausência explícita — sem confiança, nunca zero", () => {
    expect(linhas.filter((l) => l.score != null)).toHaveLength(210)
    const ausentes = linhas.filter((l) => l.source === "not_rated")
    expect(ausentes).toHaveLength(70)
    for (const l of ausentes) {
      expect(l.score).toBeNull()
      expect(l.confidence).toBeNull()
    }
    expect(linhas.some((l) => l.score === 0)).toBe(false)
  })
  it("nenhuma nota da normal é ≥ 7 (nada copiado da R18)", () => {
    expect(linhas.filter((l) => l.edition === "normal" && (l.score ?? 0) >= 7)).toEqual([])
  })
  it("os 10 casos de R18 só nos extras (7 da fase 1 + 3 novos) não recebem baseline na normal", () => {
    const extras = linhas.filter((l) => l.edition === "normal" && String(l.evidence.motivo ?? "").startsWith("R18 só nos extras"))
    expect(extras).toHaveLength(10)
    expect(extras.every((l) => l.source === "not_rated")).toBe(true)
    const novos = bloco<{ work_id: string }>(M[214], "extras").map((e) => e.work_id)
    expect(novos).toHaveLength(3)
    for (const id of novos) expect(extras.map((l) => l.work_id)).toContain(id)
  })
  it("obra sem prova de R18 SEXUAL não recebe baseline (I Have Never Abandoned the Tyrant, My Brother's Boyfriend…)", () => {
    const semSexual = linhas.filter((l) => l.edition === "normal" && String(l.evidence.motivo ?? "").startsWith("nenhum sinal de que a edição R18 seja SEXUAL"))
    expect(semSexual.map((l) => l.titulo).sort()).toEqual(["I Have Never Abandoned the Tyrant", "My Brother's Boyfriend Fell for Me"])
    expect(semSexual.every((l) => l.source === "not_rated")).toBe(true)
  })
})

describe("215 — os overrides só saem com a versão normal representável", () => {
  const ovr = bloco<{ work_id: string; classificacao: string }>(M[215])
  const normalComNota = new Set(
    bloco<Linha>(M[214]).filter((l) => l.edition === "normal" && l.source !== "not_rated").map((l) => l.work_id),
  )

  it("libera 5 dos 6 overrides da fase 1 — One Last Night fica", () => {
    expect(ovr).toHaveLength(5)
    expect(ovr.every((o) => OVERRIDES_FASE1.includes(o.work_id))).toBe(true)
    expect(ovr.map((o) => o.work_id)).not.toContain(ONE_LAST_NIGHT)
  })
  it("cada um tem nota da normal com procedência na 214", () => {
    for (const o of ovr) expect(normalComNota.has(o.work_id), o.work_id).toBe(true)
  })
  it("confere o critério no banco, protege One Last Night, grava histórico; e NÃO exige nota < 9", () => {
    const sql = semComentarios(ler(M[215]))
    expect(sql).toMatch(/s\.source <> 'not_rated'/)
    expect(sql).toMatch(/w\.edition_state = 'mixed'/)
    expect(sql).toMatch(/insert into public\.work_adult_override_log/)
    expect(sql).toMatch(/One Last Night perdeu o override/)
    expect(sql).not.toMatch(/score\s*<\s*9/)
    expect(ler(M[215])).toMatch(/APLICAR SÓ DEPOIS DO DEPLOY/)
  })
})

describe("rollbacks existem para as três", () => {
  it.each(["213", "214", "215"])("scripts/rollback/%s_rollback.sql", (n) => {
    expect(fs.existsSync(path.join(ROOT, `scripts/rollback/${n}_rollback.sql`))).toBe(true)
  })
})
