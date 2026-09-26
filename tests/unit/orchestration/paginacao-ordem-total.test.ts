import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * 🔴 Toda paginação por offset tem ORDEM TOTAL.
 *
 * `range()` sem ordem não é paginação: o Postgres não promete a mesma ordem entre duas
 * requisições, então uma linha sai duplicada e outra some — sem erro, com um conjunto
 * plausível. Medido na nuvem em 2026-09-21: 2.050 linhas de `category_scores` em 3 páginas
 * voltaram com 1.550 ids únicos. Em 2026-09-26 eram 71 chamadas do paginador expostas a isso.
 *
 * O TIPO de `fetchAllRows` já exige `orderBy` não vazio. Este teste cobre o que o tipo não
 * enxerga: que a ordem declarada seja TOTAL (contém uma chave única real da tabela) e que o
 * construtor da query não traga `.order()`/`.range()` próprios por fora do helper.
 *
 * Lê o código pela AST do TypeScript, não por regex: genérico (`fetchAllRows<T>(`), quebra de
 * linha e construtor em variável são formas comuns aqui, e cada uma já furou uma varredura.
 */

/**
 * Chaves ÚNICAS reais, conferidas no schema da nuvem (`pg_dump` do backup de 2026-09-23:
 * PRIMARY KEY / UNIQUE / índice único). Ordenar por qualquer conjunto destes é total.
 *
 * ⚠️ Não vale "único por convenção": `created_at`, `updated_at`, `position` e `tags.name` NÃO
 * estão aqui porque nada no schema os garante. `works.title` está porque há garantia real —
 * `title` é NOT NULL e existe `works_title_lower_idx` (UNIQUE em `lower(title)`).
 */
const CHAVES_UNICAS: Record<string, string[][]> = {
  works: [["id"], ["title"]],
  works_owner: [["id"]], // view sobre `works` — herda a unicidade de `works.id`
  category_scores: [["id"], ["work_id", "criterion_slug"]],
  calculated_scores: [["id"], ["work_id"]],
  ai_evaluations: [["id"]],
  ai_eval_read_acks: [["user_id", "work_id", "queue"]],
  synopsis_quality_predictions: [["id"], ["work_id", "prompt_version"]],
  prediction_snapshots: [["id"], ["dedup_key"]],
  tags: [["id"], ["slug"]],
  work_embeddings: [["work_id"]],
  work_external_ids: [["id"], ["work_id", "source"]],
  work_external_reviews_manual: [["id"]],
  work_genres: [["work_id", "genre_id"]],
  work_list_items: [["list_id", "work_id"]],
  work_reviews: [["id"]],
  work_synopses: [["id"]],
  work_tags: [["work_id", "tag_id"]],
}

const PAGINADOR = "lib/supabase/paginate.ts"

interface Violacao {
  onde: string
  motivo: string
}

function linha(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1
}

/** Texto do construtor: o próprio argumento, ou as declarações do identificador no arquivo. */
function textoDoConstrutor(sf: ts.SourceFile, arg: ts.Expression): string | null {
  if (!ts.isIdentifier(arg)) return arg.getText(sf)
  const nome = arg.text
  const achados: string[] = []
  const visitar = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === nome && n.initializer) {
      achados.push(n.initializer.getText(sf))
    }
    if (ts.isFunctionDeclaration(n) && n.name?.text === nome) achados.push(n.getText(sf))
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  return achados.length > 0 ? achados.join("\n") : null
}

/** Colunas de um `orderBy` literal, ou null se ele não for uma lista literal legível. */
function colunasDoOrderBy(sf: ts.SourceFile, opcoes: ts.Expression | undefined): string[] | null | "ausente" {
  if (!opcoes || !ts.isObjectLiteralExpression(opcoes)) return "ausente"
  const prop = opcoes.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === "orderBy",
  )
  if (!prop) return "ausente"
  if (!ts.isArrayLiteralExpression(prop.initializer)) return null
  const cols: string[] = []
  for (const el of prop.initializer.elements) {
    if (ts.isStringLiteral(el)) cols.push(el.text)
    else if (ts.isObjectLiteralExpression(el)) {
      const c = el.properties.find(
        (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === "column",
      )
      if (!c || !ts.isStringLiteral(c.initializer)) return null
      cols.push(c.initializer.text)
    } else return null
  }
  return cols
}

export function analisarChamadasDoPaginador(arquivo: string, src: string): { chamadas: number; violacoes: Violacao[] } {
  const sf = ts.createSourceFile(arquivo, src, ts.ScriptTarget.Latest, true, arquivo.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const violacoes: Violacao[] = []
  let chamadas = 0
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^fetchAllRows(Parallel)?$/.test(n.expression.text)) {
      chamadas++
      const paralela = n.expression.text === "fetchAllRowsParallel"
      const onde = `${arquivo}:${linha(sf, n.getStart(sf))}`
      const falha = (motivo: string) => violacoes.push({ onde, motivo })
      const construtor = n.arguments[paralela ? 1 : 0]
      const cols = colunasDoOrderBy(sf, n.arguments[paralela ? 2 : 1])
      if (cols === "ausente") falha("sem `orderBy` — paginação sem ordem declarada")
      else if (cols === null) falha("`orderBy` não é uma lista literal de colunas (o teste não consegue conferir)")
      else if (cols.length === 0) falha("`orderBy` vazio")

      const texto = construtor ? textoDoConstrutor(sf, construtor) : null
      if (texto == null) {
        falha("construtor da query não resolvido no próprio arquivo")
      } else {
        if (/\.order\(/.test(texto)) falha("o construtor traz `.order()` próprio — a ordem vai em `orderBy`, que o helper aplica")
        if (/\.range\(/.test(texto)) falha("o construtor traz `.range()` próprio — quem pagina é o helper")
        const tabelas = [...new Set([...texto.matchAll(/\.from\(\s*["'`]([\w_]+)["'`]\s*\)/g)].map((m) => m[1]))]
        if (tabelas.length !== 1) {
          falha(`tabela não identificada no construtor (${tabelas.length === 0 ? "nenhum .from literal" : tabelas.join(", ")})`)
        } else if (Array.isArray(cols) && cols.length > 0) {
          const chaves = CHAVES_UNICAS[tabelas[0]]
          if (!chaves) falha(`tabela \`${tabelas[0]}\` sem chave única declarada em CHAVES_UNICAS`)
          else if (!chaves.some((k) => k.every((c) => cols.includes(c)))) {
            falha(
              `ordem PARCIAL em \`${tabelas[0]}\`: [${cols.join(", ")}] não contém chave única ` +
                `(${chaves.map((k) => k.join("+")).join(" ou ")})`,
            )
          }
        }
      }
    }
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  return { chamadas, violacoes }
}

const ARQUIVOS = execSync("git ls-files server lib app components", { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f) && f !== PAGINADOR)

const VARREDURA = ARQUIVOS.map((f) => analisarChamadasDoPaginador(f, readFileSync(f, "utf8")))
const TOTAL = VARREDURA.reduce((s, r) => s + r.chamadas, 0)

describe("paginação com ordem TOTAL — camada do paginador", () => {
  it(`há chamadas para conferir (hoje ${TOTAL}) — senão a varredura mudou de forma e não prova nada`, () => {
    expect(TOTAL).toBeGreaterThanOrEqual(70)
  })

  it("toda chamada de fetchAllRows/fetchAllRowsParallel declara ordem total, e o helper é quem ordena e pagina", () => {
    const violacoes = VARREDURA.flatMap((r) => r.violacoes)
    expect(violacoes.map((v) => `${v.onde} — ${v.motivo}`)).toEqual([])
  })
})

describe("sondas: a regra reprova o que deve reprovar", () => {
  const um = (codigo: string) => analisarChamadasDoPaginador("sonda.ts", codigo)

  it("sem orderBy → falha", () => {
    const r = um(`fetchAllRows(() => sb.from("works").select("id"), { label: "x" })`)
    expect(r.violacoes.map((v) => v.motivo).join()).toMatch(/sem `orderBy`/)
  })

  it("ordem parcial (`created_at`) → falha; com `id` desempatando → passa", () => {
    const parcial = um(`fetchAllRows(() => sb.from("ai_evaluations").select("*"), { orderBy: ["created_at"] })`)
    expect(parcial.violacoes.map((v) => v.motivo).join()).toMatch(/ordem PARCIAL/)
    const total = um(
      `fetchAllRows(() => sb.from("ai_evaluations").select("*"), { orderBy: [{ column: "created_at", ascending: false }, { column: "id", ascending: false }] })`,
    )
    expect(total.violacoes).toEqual([])
  })

  it("chave composta incompleta → falha (`work_id` sozinho em work_tags)", () => {
    const r = um(`fetchAllRows<T>(() => sb.from("work_tags").select("work_id"), { orderBy: ["work_id"] })`)
    expect(r.violacoes.map((v) => v.motivo).join()).toMatch(/ordem PARCIAL/)
  })

  it("construtor com `.order()`/`.range()` próprio → falha (a ordem do helper viria DEPOIS)", () => {
    const r = um(`fetchAllRows(() => sb.from("works").select("id").order("title"), { orderBy: ["id"] })`)
    expect(r.violacoes.map((v) => v.motivo).join()).toMatch(/`.order\(\)` próprio/)
  })

  it("construtor em variável é resolvido no arquivo — e a paralela confere o 3º argumento", () => {
    const ok = um(`const q = () => sb.from("work_reviews").select("id")\nfetchAllRowsParallel(c, q, { orderBy: ["id"] })`)
    expect(ok.violacoes).toEqual([])
    const ruim = um(`const q = () => sb.from("work_reviews").select("id")\nfetchAllRowsParallel(c, q, { label: "x" })`)
    expect(ruim.violacoes.map((v) => v.motivo).join()).toMatch(/sem `orderBy`/)
  })

  it("tabela fora do mapa → falha (chave única precisa ser declarada, não suposta)", () => {
    const r = um(`fetchAllRows(() => sb.from("tabela_nova").select("id"), { orderBy: ["id"] })`)
    expect(r.violacoes.map((v) => v.motivo).join()).toMatch(/sem chave única declarada/)
  })
})
