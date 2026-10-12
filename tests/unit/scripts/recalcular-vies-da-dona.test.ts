import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { compararVies, conferirDepois, conferirGuardasVies, mesmoVies } from "../../../scripts/lib/vies-dona"
import type { EntradaGuardas, LinhaVies, LinhaViesConta } from "../../../scripts/lib/vies-dona"

/**
 * `scripts/recalcular-vies-da-dona.ts` — recalcula o `attribute_bias` da conta principal pela régua
 * atual (versão lida + leitura completa). As partes puras (guardas, comparação, conferência depois da
 * escrita) e as garantias que só o source mostra: ensaio por padrão, sem IA, toca só `attribute_bias`.
 */
const SRC = readFileSync(join(process.cwd(), "scripts/recalcular-vies-da-dona.ts"), "utf8")
const codigo = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const DONA = "e62ef992-1111-2222-3333-444455556666"
const guardas = (over: Partial<EntradaGuardas> = {}) =>
  conferirGuardasVies({
    donaId: DONA, papel: "curador", lidas: 1721, contagemExata: 1721, executar: false,
    amostrasInformadas: null, contaInformada: null, ...over,
  })

describe("guardas — qualquer divergência impede a escrita", () => {
  it("ensaio sem flags passa (só lê)", () => {
    expect(guardas()).toEqual([])
  })
  it("execução com --amostras e --conta iguais ao ensaio passa", () => {
    expect(guardas({ executar: true, amostrasInformadas: 1721, contaInformada: "e62ef992" })).toEqual([])
  })
  it("conta principal que não é curadora", () => {
    expect(guardas({ papel: "leitor" }).join()).toMatch(/não "curador"/)
  })
  it("leitura cortada (o corte de 1.000) ou sem contagem", () => {
    expect(guardas({ lidas: 1000 }).join()).toMatch(/leitura incompleta: 1000 amostras lidas, 1721/)
    expect(guardas({ contagemExata: null }).join()).toMatch(/leitura incompleta/)
  })
  it("--execute sem --amostras, ou com número diferente do lido", () => {
    expect(guardas({ executar: true, contaInformada: "e62ef992" }).join()).toMatch(/exige --amostras/)
    expect(guardas({ executar: true, amostrasInformadas: 1700, contaInformada: "e62ef992" }).join()).toMatch(/--amostras=1700/)
  })
  it("--execute sem --conta, curta demais, ou de outra conta", () => {
    expect(guardas({ executar: true, amostrasInformadas: 1721 }).join()).toMatch(/exige --conta/)
    expect(guardas({ executar: true, amostrasInformadas: 1721, contaInformada: "e62e" }).join()).toMatch(/não é a conta principal/)
    expect(guardas({ executar: true, amostrasInformadas: 1721, contaInformada: "74f2a78e" }).join()).toMatch(/não é a conta principal/)
  })
  it("nenhuma amostra", () => {
    expect(guardas({ lidas: 0, contagemExata: 0 }).join()).toMatch(/nenhuma amostra/)
  })
})

const linha = (slug: string, bias: number, n = 10): LinhaVies => ({ attribute_slug: slug, n_samples: n, mean_bias_raw: bias, bias_applied: bias, stddev_bias: 0.5 })

describe("comparação gravado × recalculado", () => {
  it("numeric do PostgREST (string) não conta como mudança", () => {
    expect(mesmoVies({ attribute_slug: "x", n_samples: "10" as unknown as number, mean_bias_raw: "0.10" as unknown as number, bias_applied: "0.1" as unknown as number, stddev_bias: "0.5" as unknown as number }, linha("x", 0.1))).toBe(true)
  })
  it("marca só o que muda; atributo sem linha gravada é novo", () => {
    const c = compararVies([linha("romance", 0.07), linha("adult_content", 0)], [linha("romance", 0.07), linha("adult_content", -0.07), linha("angst", 0.24)])
    expect(c.map((x) => [x.slug, x.muda])).toEqual([["romance", false], ["adult_content", true], ["angst", true]])
    expect(c[2].antes).toBeNull()
  })
})

describe("conferência depois da escrita", () => {
  const conta = (user_id: string, slug: string, bias: number, quando = "t0"): LinhaViesConta => ({ ...linha(slug, bias), user_id, last_updated_at: quando })
  const antes = [conta(DONA, "adult_content", 0), conta(DONA, "romance", 0.07), conta(DONA, "fantasy_nobility", -0.19), conta("outra", "adult_content", 0.3)]
  const planejadas = [linha("adult_content", -0.07)]
  it("só a linha planejada mudou ⇒ ok", () => {
    const depois = antes.map((r) => (r.user_id === DONA && r.attribute_slug === "adult_content" ? { ...r, ...planejadas[0], last_updated_at: "t1" } : r))
    expect(conferirDepois({ donaId: DONA, antes, depois, planejadas })).toEqual([])
  })
  it("outra CONTA mudou ⇒ falha", () => {
    const depois = antes.map((r) => (r.user_id === "outra" ? { ...r, bias_applied: 0 } : r.attribute_slug === "adult_content" ? { ...r, ...planejadas[0] } : r))
    expect(conferirDepois({ donaId: DONA, antes, depois, planejadas }).join()).toMatch(/outra\|adult_content/)
  })
  it("atributo da dona que NÃO estava no plano mudou ⇒ falha", () => {
    const depois = antes.map((r) => (r.attribute_slug === "romance" ? { ...r, last_updated_at: "t1" } : r.attribute_slug === "adult_content" && r.user_id === DONA ? { ...r, ...planejadas[0] } : r))
    expect(conferirDepois({ donaId: DONA, antes, depois, planejadas }).join()).toMatch(/romance/)
  })
  it("o valor gravado não é o planejado ⇒ falha", () => {
    expect(conferirDepois({ donaId: DONA, antes, depois: antes, planejadas }).join()).toMatch(/não ficou com o valor planejado/)
  })
  it("linha nova de outra conta ⇒ falha", () => {
    const depois = [...antes.map((r) => (r.user_id === DONA && r.attribute_slug === "adult_content" ? { ...r, ...planejadas[0] } : r)), conta("intrusa", "drama", 1)]
    expect(conferirDepois({ donaId: DONA, antes, depois, planejadas }).join()).toMatch(/linha nova fora do alvo: intrusa/)
  })
})

describe("o que só o source mostra", () => {
  it("é ENSAIO por padrão: cada escrita tem, NA PRÓPRIA função, um `if (!executar) { … return }` antes", () => {
    expect(codigo).toMatch(/const executar = argv\.includes\("--execute"\)/)
    const funcoes = codigo.split(/\n(?=async function )/)
    let escritas = 0
    for (const f of funcoes) {
      for (const m of f.matchAll(/\.upsert\(/g)) {
        escritas++
        const antes = f.slice(0, m.index)
        const guarda = antes.lastIndexOf("if (!executar) {")
        expect(guarda, `upsert sem guarda de ensaio na função "${f.slice(0, 40)}"`).toBeGreaterThan(-1)
        expect(antes.slice(guarda, antes.indexOf("\n  }", guarda))).toMatch(/return/)
      }
    }
    expect(escritas).toBe(2)
  })
  it("escreve SÓ em attribute_bias (nenhum insert/update/delete, nenhuma outra tabela)", () => {
    const escritas = [...codigo.matchAll(/\.from\("(\w+)"\)\s*\.(upsert|insert|update|delete)\(/g)].map((m) => m[1])
    expect(escritas).toEqual(["attribute_bias", "attribute_bias"])
    expect(codigo).not.toMatch(/\.(insert|update|delete)\(/)
  })
  it("nenhuma chamada de IA", () => {
    expect(SRC).not.toMatch(/anthropic|ai-evaluation|ai-recommendation\/(service|ranker)|requestAiEvaluation|messages\.create/i)
  })
  it("o alvo é declarado e conferido contra a URL", () => {
    expect(codigo).toMatch(/cloud === local/)
    expect(codigo).toMatch(/isLocalSupabaseUrl\(\)/)
  })
  it("a conta é a da régua do app (linha mais antiga de user_settings)", () => {
    expect(codigo).toMatch(/\.from\("user_settings"\)[\s\S]{0,80}\.order\("created_at", \{ ascending: true \}\)[\s\S]{0,20}\.limit\(1\)/)
  })
  it("salva o estado anterior ANTES de gravar, na família declarada", () => {
    const salva = codigo.indexOf('"antes.json"')
    const grava = codigo.indexOf('.from("attribute_bias").upsert(mudam')
    expect(salva).toBeGreaterThan(-1)
    expect(grava).toBeGreaterThan(salva)
    expect(codigo).toMatch(/podar\("vies-dona"\)/)
  })
})
