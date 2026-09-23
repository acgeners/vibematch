import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"

/**
 * A rota experimental 9 × 11 tem de ser tecnicamente INCAPAZ de gravar.
 *
 * 🔴 Ela roda com `createAdminClient()` (service role), que ignora RLS e pode escrever em
 * qualquer tabela. O que a mantém read-only não é permissão do banco — é não existir caminho
 * de escrita no código. Um teste que só lesse o texto da action não bastaria: o risco mora em
 * reusar, mais adiante, uma função que também persiste.
 */
const RAIZ = execSync("git rev-parse --show-toplevel").toString().trim()
const src = (p: string) => readFileSync(join(RAIZ, p), "utf8")

/**
 * ⚠️ As asserções abaixo casam CÓDIGO, não prosa. Sem isto o teste reprova o próprio
 * comentário que explica por que `recalculateAll` NÃO é chamado — foi o que uma sonda
 * pegou aqui. Stripper conservador: conhece string e comentário, NÃO conhece regex
 * literal (nenhum dos arquivos da feature tem um; se passar a ter, revise isto).
 */
function semComentarios(t: string): string {
  let out = "", i = 0
  while (i < t.length) {
    const c = t[i], d = t[i + 1]
    if (c === '"' || c === "'" || c === "`") {
      const aspa = c
      out += c; i++
      while (i < t.length && t[i] !== aspa) { if (t[i] === "\\") { out += t[i]; i++ } ; out += t[i]; i++ }
      out += t[i] ?? ""; i++
      continue
    }
    if (c === "/" && d === "/") { while (i < t.length && t[i] !== "\n") i++; continue }
    if (c === "/" && d === "*") { i += 2; while (i < t.length && !(t[i] === "*" && t[i + 1] === "/")) i++; i += 2; continue }
    out += c; i++
  }
  return out
}

/** Os arquivos que a feature adiciona — a fronteira inteira dela. */
const ARQUIVOS = [
  "lib/model-metrics/criteria-experiment.ts",
  "server/queries/criteria-experiment.ts",
  "server/actions/criteria-experiment.ts",
  "app/curation/model-metrics/criteria-experiment/page.tsx",
  "components/curation/criteria-experiment-panel.tsx",
]

describe("nenhum caminho de escrita na feature", () => {
  it.each(ARQUIVOS)("%s não chama insert/update/upsert/delete", (arquivo) => {
    const c = src(arquivo)
    for (const m of ["insert", "upsert", "delete", "update"]) {
      expect(c, `${arquivo} chama .${m}(`).not.toMatch(new RegExp(`\\.${m}\\s*\\(`))
    }
  })

  /**
   * `rpc()` pode escrever (duas das RPCs do projeto escrevem), então também fica de fora.
   */
  it.each(ARQUIVOS)("%s não dispara RPC", (arquivo) => {
    expect(src(arquivo)).not.toMatch(/\.rpc\s*\(/)
  })

  /** Os nomes que persistem ou enfileiram persistência. */
  const PROIBIDOS = [
    "recalculateAll",
    "recalculateScoresNow",
    "recalculateScoresInBackground",
    "ensureRecalculateScores",
    "markRecalcPending",
    "recalculateForUser",
    "refreshEmbeddings",
    "buildEmbeddingInput",
    "requestAiEvaluation",
    "triggerAiEvaluation",
    "revalidatePath",
    "revalidateTag",
  ]
  it.each(ARQUIVOS)("%s não importa nem chama caminho de persistência/provider", (arquivo) => {
    const c = semComentarios(src(arquivo))
    for (const nome of PROIBIDOS) {
      expect(c, `${arquivo} CHAMA ${nome}`).not.toMatch(new RegExp(`\\b${nome}\\s*\\(`))
      expect(c, `${arquivo} IMPORTA ${nome}`).not.toMatch(
        new RegExp(`import[^;]*\\b${nome}\\b[^;]*from`, "s"),
      )
    }
  })

  it("a action é dedicada e NÃO reusa uma que também escreve", () => {
    const a = src("server/actions/criteria-experiment.ts")
    expect(a).toContain('"use server"')
    // gate: a leitura cobre o catálogo inteiro
    expect(a).toContain("ensureAdmin()")
    // nada importado de módulos que persistem
    expect(a).not.toMatch(/from "@\/server\/actions\/(settings|calculations|ai)"/)
    expect(a).not.toMatch(/from "@\/server\/recalc\//)
  })
})

describe("computeRecalc é reusado por ser PURO — e isso é conferido, não suposto", () => {
  const calc = src("server/actions/calculations.ts")
  const corpo = (() => {
    const i = calc.indexOf("export function computeRecalc")
    // até o próximo export de topo
    const j = calc.indexOf("\nexport ", i + 10)
    return calc.slice(i, j === -1 ? calc.length : j)
  })()

  it("o corpo de computeRecalc não faz I/O de banco", () => {
    expect(corpo.length).toBeGreaterThan(500)
    // 🔴 `.from("tabela")`, não `\.from\(` cru: `Array.from({…})` casa o segundo e a sonda
    // me desmentiu com exatamente isso — o corpo estava limpo e o teste acusava.
    expect(corpo, "computeRecalc passou a tocar o banco").not.toMatch(/\.from\s*\(\s*["'`]/)
    expect(corpo).not.toMatch(/supabase/i)
    expect(corpo).not.toMatch(/\.(insert|upsert|delete)\s*\(/)
  })

  /** A feature reusa o núcleo PURO; quem persiste é `recalculateAll`, e ela não o importa. */
  it("a query importa computeRecalc e NÃO recalculateAll", () => {
    const q = semComentarios(src("server/queries/criteria-experiment.ts"))
    expect(q).toContain("computeRecalc")
    expect(q).not.toContain("recalculateAll")
  })
})

describe("o experimento não altera o contrato oficial", () => {
  it("a lista oficial continua vindo de SCORING_CRITERION_SLUGS", () => {
    const l = src("lib/model-metrics/criteria-experiment.ts")
    expect(l).toContain("export const OFFICIAL_CRITERIA: readonly string[] = SCORING_CRITERION_SLUGS")
  })

  /**
   * 🔴 A lista experimental é INJETADA por parâmetro. Trocar a constante — mesmo que
   * temporariamente, mesmo que "só no harness" — deixaria estado global mutável no caminho do
   * recálculo real, que roda em background no mesmo processo.
   */
  it("o experimental entra por parâmetro, sem estado global nem flag", () => {
    const l = src("lib/model-metrics/criteria-experiment.ts")
    expect(l).toContain("criterionSlugs: criterios")
    for (const proibido of ["globalThis", "process.env", "let SCORING", "= SCORING_CRITERION_SLUGS ="]) {
      expect(l, `estado global via ${proibido}`).not.toContain(proibido)
    }
    // produção não passa opções: o default do Ridge continua sendo a lista congelada
    const e = src("lib/calculations/expected.ts")
    expect(e).toContain("criterios: readonly string[] = SCORING_CRITERION_SLUGS")
    expect(e).toContain("opts.criterionSlugs ?? SCORING_CRITERION_SLUGS")
  })

  it("não existe botão de aplicar/promover na tela", () => {
    const p = semComentarios(src("components/curation/criteria-experiment-panel.tsx"))
    for (const t of ["Aplicar", "Promover", "Adotar", "Ativar experimental"]) {
      expect(p, `a tela oferece "${t}"`).not.toContain(t)
    }
  })

  /** Veredito automático viraria decisão de produto tomada por um limiar que ninguém escolheu. */
  it("a tela descreve a medição, sem aprovar nem reprovar", () => {
    const p = semComentarios(src("components/curation/criteria-experiment-panel.tsx"))
    expect(p).toContain("está claramente separada da distribuição de permutação")
    for (const t of ["aprovado", "reprovado", "APROVADO", "REPROVADO"]) {
      expect(p, `a tela dá veredito: ${t}`).not.toContain(t)
    }
  })
})

describe("pré-198 a página não estoura", () => {
  it("a disponibilidade é checada no load e degrada com mensagem", () => {
    const q = src("server/queries/criteria-experiment.ts")
    expect(q).toContain("export async function experimentoDisponivel")
    // erro de leitura NÃO pode virar "disponível"
    expect(q).toContain("if (error) return { disponivel: false")
    const p = src("app/curation/model-metrics/criteria-experiment/page.tsx")
    expect(p).toContain("experimentoDisponivel()")
    const painel = src("components/curation/criteria-experiment-panel.tsx")
    expect(painel).toContain("O experimento estará disponível após o producer de 11 atributos ser ativado.")
  })

  it("a action recusa antes de carregar o catálogo", () => {
    const a = src("server/actions/criteria-experiment.ts")
    const i = a.indexOf("experimentoDisponivel()")
    const j = a.indexOf("carregarObrasDoExperimento()")
    expect(i).toBeGreaterThan(0)
    expect(i, "checa disponibilidade DEPOIS de ler o catálogo").toBeLessThan(j)
  })
})

describe("a tela diz que o ESCOPO é a Nota Prevista, não o cálculo inteiro", () => {
  const pagina = src("app/curation/model-metrics/criteria-experiment/page.tsx")
  const entrada = src("app/curation/model-metrics/page.tsx")
  const painel = src("components/curation/criteria-experiment-panel.tsx")

  /**
   * 🔴 "9 × 11" sozinho sugere que o cálculo INTEIRO roda com 11 — e não roda. O experimento
   * mexe só no vetor do Ridge; Nota.IA, Chance/Bússola, embeddings e a inferência de pesos
   * seguem nos 9 oficiais e nem entram na comparação. Sem o nome certo, um Δ de cvMAE seria
   * lido como o efeito no produto todo.
   */
  it("o heading e a entrada nomeiam a Nota Prevista", () => {
    expect(pagina).toContain('title="Comparar Nota Prevista: 9 × 11 atributos"')
    expect(entrada).toContain("Comparar Nota Prevista: 9 × 11 atributos")
  })

  it("a explicação de escopo está no topo da página", () => {
    expect(pagina).toContain("<strong>Nota Prevista (Ridge)</strong>")
    expect(pagina).toContain("Os demais componentes do cálculo oficial")
    expect(pagina).toContain("permanecem inalterados")
  })

  /** O que fica FORA é o que impede a leitura larga — por isso é asserido item a item. */
  it.each(["Nota.IA", "Chance/Bússola", "embeddings", "inferência de pesos"])(
    "a página declara que %s NÃO entra na comparação", (componente) => {
      expect(pagina).toContain("Não entram nesta comparação")
      expect(pagina).toContain(componente)
    },
  )

  it("os dois braços são descritos como o MESMO Ridge", () => {
    expect(pagina).toContain("Ridge com os 9 critérios atuais")
    expect(pagina).toContain("o MESMO Ridge + 2 critérios")
    expect(pagina).toContain("O ranking oficial não é alterado")
  })

  /**
   * ⚠️ Os rótulos das métricas também precisam do escopo: "CV MAE OOF · 9" sem dizer Ridge
   * volta a soar como o cálculo todo. Aqui basta o rótulo — a ressalva longa fica no topo.
   */
  it("os rótulos das métricas dizem Ridge / Nota Prevista", () => {
    expect(painel).toContain('rotulo="CV MAE OOF · Ridge 9"')
    expect(painel).toContain('rotulo="CV MAE OOF · Ridge 11"')
    expect(painel).toContain("rho(Nota Prevista, user_score)")
    expect(painel).toContain("Só a Nota Prevista (Ridge)")
  })

  it("nenhum heading da feature promete '11 atributos' sem escopo", () => {
    for (const [nome, texto] of [["página", pagina], ["entrada", entrada]] as const) {
      // heading antigo: "Comparar 9 × 11 atributos" sem "Nota Prevista" antes
      expect(texto, `${nome} voltou ao heading sem escopo`).not.toMatch(
        /Comparar 9 × 11 atributos/,
      )
    }
  })
})
