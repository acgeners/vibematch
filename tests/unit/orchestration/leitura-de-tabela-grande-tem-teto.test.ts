import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Nenhuma leitura de tabela GRANDE pode depender do teto implícito do PostgREST.
 *
 * 🔴 Ele corta em **1000 linhas sem erro e sem log**: a query "funciona", devolve um recorte
 * e o app trabalha achando que é o universo. O catálogo cruzou esse número na nuvem em 2026
 * e transformou em bug ativo o que era risco: medido em 2026-08-18, `/catalog` escondia 9
 * obras de TODAS as páginas ao ordenar por Nota Prevista, o `/ranking` perdia a sinopse do
 * hover de 19, os KPIs do `/dashboard` saíam de um recorte arbitrário, e os percentis que
 * pintam toda nota da interface eram tirados de 1000 das 1009 obras.
 *
 * ⚠️ **A réplica LOCAL não reproduz** (978 obras, abaixo do corte). Toda medição feita lá —
 * que é onde os scripts de análise rodam — dá o defeito por inexistente. Este teste é a
 * única defesa que não depende de alguém lembrar disso.
 */

// Tabelas cujo CONJUNTO o app lê de ponta a ponta, com a contagem medida na nuvem em
// 2026-08-18. Entra aqui a tabela que já passou (ou vai passar) de 1000 linhas.
const GRANDES: Record<string, number> = {
  work_reviews: 47241,
  work_tags: 44161,
  ai_evaluation_scores: 22116,
  category_scores: 8946,
  prediction_snapshots: 7949,
  work_external_ids: 7703,
  platform_ratings: 6937,
  work_covers: 4730,
  work_genres: 4387,
  ai_evaluations: 2517,
  synopsis_quality_predictions: 2384,
  work_synopses: 2376,
  user_calculated_scores: 1896,
  works: 1019,
  works_owner: 1019,
  calculated_scores: 1019,
  user_work_state: 1019,
  work_embeddings: 1016,
}

/**
 * ⚠️ `tags` (3.042 linhas) fica FORA de propósito, e o motivo é medido: nenhuma leitura do
 * app pega o conjunto todo. A mais larga é por `tag_group_id`, e o maior grupo tem **394**
 * tags; as demais são `.in()` sobre uma lista explícita (as tags de UMA obra, a seleção do
 * onboarding). A única leitura ampla já declara `.limit(10000)`. No dia em que um grupo
 * passar de 1000, ela entra aqui — a exclusão é da TABELA, com número, não uma lista de
 * chamadas dispensadas.
 */

const RAIZES = ["server", "lib", "app"]

function arquivosDeCodigo(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome.startsWith(".")) continue
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) arquivosDeCodigo(p, out)
    else if (/\.(ts|tsx)$/.test(nome)) out.push(p)
  }
  return out
}

/** A linha em que o índice cai — pra decidir se o `.from(` está dentro de um comentário. */
function linhaDe(src: string, i: number): string {
  const ini = src.lastIndexOf("\n", i) + 1
  const fim = src.indexOf("\n", i)
  return src.slice(ini, fim === -1 ? src.length : fim)
}

interface Leitura {
  arquivo: string
  tabela: string
  trecho: string
  declarada: boolean
}

/** As formas que ACABAM com o corte silencioso — ou por paginar, ou por não trazer linhas. */
function temTeto(l: Leitura, src: string, i: number): boolean {
  const antes = src.slice(Math.max(0, i - 700), i)
  return (
    /fetchAllRows(Parallel)?\s*\(/.test(antes) || // paginador compartilhado
    /\.range\(/.test(l.trecho) || // paginação à mão
    /count:\s*"exact"[\s\S]{0,80}head:\s*true/.test(l.trecho) || // conta no servidor, 0 linhas
    /\.single\(\)|\.maybeSingle\(\)/.test(l.trecho) || // uma linha
    /\.(insert|update|upsert|delete)\(/.test(l.trecho.slice(0, 200)) || // escrita
    /\.eq\("id",|\.eq\("work_id",|\.eq\("slug",|\.in\("id",|\.in\("work_id",|selectByIdsInChunks/.test(
      l.trecho.slice(0, 400),
    ) || // escopada por chave
    /\.limit\(/.test(l.trecho) // teto EXPLÍCITO — alguém escolheu, e aparece no diff
  )
}

describe("leitura de tabela grande nunca depende do corte de 1000", () => {
  const leituras = (() => {
    const out: Array<Leitura & { ok: boolean }> = []
    for (const raiz of RAIZES) {
      for (const arquivo of arquivosDeCodigo(raiz)) {
        const src = readFileSync(arquivo, "utf8")
        for (const m of src.matchAll(/\.from\("([a-z_]+)"\)/g)) {
          if (!(m[1] in GRANDES)) continue
          const i = m.index ?? 0
          const trimmed = linhaDe(src, i).trimStart()
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue
          const l: Leitura = {
            arquivo,
            tabela: m[1],
            trecho: src.slice(i, i + 900),
            declarada: /leitura-limitada:/.test(src.slice(Math.max(0, i - 700), i)),
          }
          out.push({ ...l, ok: l.declarada || temTeto(l, src, i) })
        }
      }
    }
    return out
  })()

  it("há leituras para varrer (senão a varredura mudou de forma e não prova nada)", () => {
    // Contraprova de vacuidade: sem isto, um regex quebrado deixaria o teste verde pra sempre.
    expect(leituras.length).toBeGreaterThan(20)
    expect(new Set(leituras.map((l) => l.tabela)).size).toBeGreaterThan(5)
  })

  it("toda leitura de tabela grande pagina, conta no servidor, é escopada ou declara o teto", () => {
    const sem = leituras.filter((l) => !l.ok)
    const relato = sem
      .map(
        (l) =>
          `  ${l.arquivo} [${l.tabela}, ${GRANDES[l.tabela].toLocaleString("pt-BR")} linhas]\n` +
          `    ${l.trecho.replace(/\s+/g, " ").slice(0, 120)}`,
      )
      .join("\n")
    expect(
      sem,
      `Leitura sem teto em tabela que passa de 1000 linhas — o PostgREST corta ali SEM erro:\n${relato}\n\n` +
        `Saídas: \`fetchAllRows\` (@/lib/supabase/paginate), \`count: "exact", head: true\` quando só ` +
        `precisa contar, escopo por chave, ou — se o teto vier de outro lugar — um comentário ` +
        `\`leitura-limitada: <motivo medido>\` encostado na query.`,
    ).toHaveLength(0)
  })

  it("a declaração `leitura-limitada` é exceção RARA — se virar hábito, a régua parou de valer", () => {
    // Não é um teto de qualidade arbitrário: hoje é UMA (a query principal do /ranking, cujo
    // `.limit(2000)` mora nos call sites). Se este número subir, o certo é perguntar por que
    // paginar deixou de ser a saída — não afrouxar a régua.
    const declaradas = leituras.filter((l) => l.declarada)
    expect(declaradas.length, `declarações hoje: ${declaradas.map((d) => d.arquivo).join(", ")}`).toBeLessThanOrEqual(3)
  })
})
