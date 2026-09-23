import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { fantasyDriftFrom, LEGACY_SPLIT_COPY_SOURCE } from "@/lib/calculations/fantasy-drift"

/**
 * A INSTRUMENTAÇÃO DA DERIVA — observabilidade, não política.
 *
 * 🔴 Por que ela existe: a troca do slot `fantasy_nobility` → `fantasy` foi medida e não
 * mostrou dano distinguível do nulo (z = 1,24 · p ≈ 0,10). Mas aquele teste só enxerga efeito
 * a partir de ~0,014 de cvMAE, com 60 de 1.026 obras migradas. Sem contar o denominador, um
 * dano que apareça com a migração avançada seria indistinguível de zero.
 */
const RAIZ = execSync("git rev-parse --show-toplevel").toString().trim()
const src = (p: string) => readFileSync(join(RAIZ, p), "utf8")

describe("fantasyDriftFrom: a conta", () => {
  it("conta real e legado sem misturar", () => {
    expect(fantasyDriftFrom({ real: 60, legacy: 966 })).toEqual({
      real: 60, legacy: 966, ratio: 60 / 1026,
    })
  })

  /** 🔴 Zero obras NÃO é "0% migrado" — é "não há o que medir". Zero entraria na série como
   *  se a migração não tivesse andado, que é uma afirmação diferente. */
  it("razão é null quando não há nenhuma das duas — nunca divisão por zero", () => {
    const d = fantasyDriftFrom({ real: 0, legacy: 0 })
    expect(d.ratio).toBeNull()
    expect(Number.isNaN(d.ratio as unknown as number)).toBe(false)
  })

  it("0% e 100% são representáveis, e diferentes de null", () => {
    expect(fantasyDriftFrom({ real: 0, legacy: 10 }).ratio).toBe(0)
    expect(fantasyDriftFrom({ real: 10, legacy: 0 }).ratio).toBe(1)
  })

  it("o marcador do seed é o da migration 197", () => {
    expect(LEGACY_SPLIT_COPY_SOURCE).toBe("legacy_split_copy")
  })
})

describe("a leitura no banco", () => {
  const q = src("server/queries/fantasy-drift.ts")

  /** Só obras ATIVAS: o recalc trabalha com `is_archived = false`, e contar arquivadas faria a
   *  razão discordar do universo que produziu o cvMAE da mesma linha. */
  it("conta só obras ativas, pelo join", () => {
    expect(q).toContain('works!inner(is_archived)')
    expect(q).toContain('.eq("works.is_archived", false)')
  })

  it("separa real de legado pelo SOURCE, nos dois sentidos", () => {
    expect(q).toContain('.eq("source", LEGACY_SPLIT_COPY_SOURCE)')
    expect(q).toContain('.neq("source", LEGACY_SPLIT_COPY_SOURCE)')
  })

  /** 🔴 `count: exact, head: true`: somar no cliente cairia no corte silencioso de 1.000 linhas
   *  do PostgREST — o catálogo já passou disso. */
  it("conta no SERVIDOR, sem trafegar linha", () => {
    expect(q).toContain('{ count: "exact", head: true }')
  })

  /** Engolir o erro faria `count = null` virar "0 real / 0 legado" — medição inventada. */
  it("não engole o erro do PostgREST", () => {
    expect(q).toMatch(/if \(error\) throw new Error/)
  })
})

describe("o recalc grava a série", () => {
  const c = src("server/actions/calculations.ts")

  it("as quatro colunas entram no calibration_history", () => {
    for (const col of [
      "fantasy_real_count", "fantasy_legacy_copy_count",
      "fantasy_real_ratio", "scoring_criteria_signature",
    ]) expect(c, `${col} não é gravada`).toContain(col)
  })

  /** Observabilidade não pode derrubar o recálculo: falhar aqui perde uma linha da série. */
  it("a falha da medição não invalida o recalc", () => {
    expect(c).toMatch(/try \{\s*\n\s*drift = await readFantasyDrift/)
  })

  /** Sem a assinatura não dá para saber se um cvMAE pertence ao vetor com `fantasy` ou ao
   *  vetor com `fantasy_nobility` — a série viraria duas medições empilhadas. */
  it("a assinatura do vetor viaja junto", () => {
    expect(src("server/queries/fantasy-drift.ts")).toContain("SCORING_CRITERION_SLUGS.join(\",\")")
  })

  it("é observabilidade: sem limiar, sem alarme, sem rollback", () => {
    const sql = src("supabase/migrations/198_producer_alvo_11_atributos.sql")
    expect(sql).not.toMatch(/create\s+trigger/i)
    expect(c).not.toMatch(/fantasy_real_ratio\s*[<>]/)
  })
})

describe("as colunas novas não quebram o histórico", () => {
  const sql = src("supabase/migrations/198_producer_alvo_11_atributos.sql")

  /** As 2.274 linhas antigas não têm as colunas: `add column` sem NOT NULL e sem default as
   *  deixa NULL e legíveis. Um NOT NULL aqui reprovaria a própria migration. */
  it("são nullable e sem default — histórico antigo segue legível", () => {
    for (const col of [
      "fantasy_real_count", "fantasy_legacy_copy_count",
      "fantasy_real_ratio", "scoring_criteria_signature",
    ]) {
      const m = sql.match(new RegExp(`add column if not exists ${col} ([a-z ]+);`))
      expect(m, `${col} não é adicionada`).not.toBeNull()
      expect(m![1], `${col} veio com NOT NULL/DEFAULT`).not.toMatch(/not null|default/i)
    }
  })
})
