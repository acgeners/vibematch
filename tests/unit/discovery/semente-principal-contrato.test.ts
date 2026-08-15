import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { PRIMARY_SEED_WEIGHT } from "@/lib/discovery/limits"

/**
 * O peso da semente principal está EM VIGOR no SQL, não no TypeScript.
 *
 * 🔴 `PRIMARY_SEED_WEIGHT` existe só para a tela escrever "peso 2×". Se ele divergir do
 * multiplicador da migration, o app anuncia um regime e o banco aplica outro — exatamente a
 * armadilha do `tier_band_width`, onde a constante do código dizia 0,25, a coluna do banco
 * valia 0,5, e o valor medido NUNCA esteve em vigor por duas semanas sem nada acusar.
 *
 * Por isso o teste DERIVA o número do arquivo da migration em vez de repeti-lo aqui.
 */

const ROOT = join(__dirname, "../../..")
const MIGRATIONS = join(ROOT, "supabase/migrations")

function migrationMaisRecenteCom(trecho: string): string {
  const arquivos = readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .reverse()
  for (const nome of arquivos) {
    const sql = readFileSync(join(MIGRATIONS, nome), "utf8")
    if (sql.toLowerCase().includes(trecho.toLowerCase())) return sql
  }
  return ""
}

/** As colunas do `returns table(...)` da definição MAIS RECENTE da função. */
function colunasDaRpc(fn: string): string[] {
  const arquivos = readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .reverse()

  for (const nome of arquivos) {
    const sql = readFileSync(join(MIGRATIONS, nome), "utf8")
    const i = sql.toLowerCase().indexOf(`create function public.${fn}`)
    if (i < 0) continue
    const m = sql.slice(i).match(/returns\s+table\s*\(([\s\S]*?)\)\s*language/i)
    if (!m) continue
    return m[1]
      .split(",")
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean)
  }
  return []
}

describe("peso da semente principal", () => {
  const sql = migrationMaisRecenteCom("primary_seed_id")

  it("a migration vigente é legível (senão o teste passa por vacuidade)", () => {
    expect(sql).toContain("create function public.find_similar_to_seeds")
    expect(sql).toContain("primary_seed_id")
  })

  it("🔴 o multiplicador do SQL é o mesmo que a tela anuncia", () => {
    // `CASE WHEN c.work_id = primary_seed_id THEN 2.0::double precision`
    const m = sql.match(
      /when\s+[\w.]*work_id\s*=\s*primary_seed_id\s+then\s+([0-9]+(?:\.[0-9]+)?)/i,
    )
    expect(m, "não achei o multiplicador da principal no CASE da migration").not.toBeNull()
    expect(Number(m![1])).toBe(PRIMARY_SEED_WEIGHT)
  })

  it("as coadjuvantes valem 1 — senão o caso 'sem principal' deixaria de ser neutro", () => {
    const m = sql.match(/else\s+([0-9]+(?:\.[0-9]+)?)::double precision\s+end\s+as\s+w/i)
    expect(m, "não achei o peso das demais sementes").not.toBeNull()
    expect(Number(m![1])).toBe(1)
  })
})

describe("contrato da RPC find_similar_to_seeds", () => {
  const colunas = colunasDaRpc("find_similar_to_seeds")

  it("devolve as colunas que o consumidor declara", () => {
    expect(colunas).toEqual(
      expect.arrayContaining(["id", "sim_pos", "sim_pos_flat", "sim_neg", "nearest_seed_id"]),
    )
  })

  it("🔴 nenhum campo de SimRow falta na RPC", () => {
    const src = readFileSync(join(ROOT, "server/queries/seed-discovery.ts"), "utf8")
    const m = src.match(/interface\s+SimRow\s*\{([\s\S]*?)\n\}/)
    expect(m).not.toBeNull()

    const declarados = [...m![1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s*[?:]/gim)].map((x) => x[1])
    const forasteiros = declarados.filter((c) => !colunas.includes(c))
    expect(
      forasteiros,
      `SimRow declara ${forasteiros.join(", ")} — a RPC não devolve isso, então o campo chega ` +
        `undefined e some em silêncio (mesma classe do user_score no Deep Dive).`,
    ).toEqual([])
  })

  it("🔴 sim_pos_flat existe — sem ela o 'efeito da principal' custaria uma 2ª varredura", () => {
    expect(colunas).toContain("sim_pos_flat")
  })
})

describe("seeds_diagnostics foi aposentada", () => {
  it("a migration a derruba", () => {
    const sql = migrationMaisRecenteCom("seed_pair_similarity")
    expect(sql).toMatch(/drop function if exists public\.seeds_diagnostics/i)
  })

  it("🔴 nenhum código a chama nem a CITA", () => {
    // Chamada órfã a função dropada não é erro de tipo: o `rpc()` aceita qualquer string e
    // o erro vira um `console.warn` que ninguém lê, com a página servindo dado incompleto.
    //
    // ⚠️ Comentário também conta, de propósito. Um docblock apontando para função que não
    // existe mais é lido como verdade conferida e manda a próxima pessoa procurar no lugar
    // errado — a mesma família do bloco 🔴 desatualizado no CLAUDE.md. Foi o que este teste
    // pegou de primeira, em `lib/discovery/blend.ts`.
    const dirs = ["server", "lib", "components", "app", "scripts"]
    const ofensores: string[] = []

    function varre(dir: string) {
      for (const nome of readdirSync(dir, { withFileTypes: true })) {
        if (nome.name === "node_modules" || nome.name.startsWith(".")) continue
        const caminho = join(dir, nome.name)
        if (nome.isDirectory()) varre(caminho)
        else if (/\.(ts|tsx|mjs|js)$/.test(nome.name)) {
          if (readFileSync(caminho, "utf8").includes("seeds_diagnostics")) {
            ofensores.push(caminho.slice(ROOT.length + 1))
          }
        }
      }
    }
    for (const d of dirs) varre(join(ROOT, d))

    expect(ofensores, "use seed_pair_similarity — seeds_diagnostics não existe mais").toEqual([])
  })
})
