import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  alternativeTitlesFixOrNull,
  normalizeAlternativeTitles,
  splitAlternativeTitle,
} from "@/lib/titles/alternative-titles"
import { workFormSchema } from "@/lib/validations/work.schema"

/**
 * Os casos vêm do catálogo REAL (varredura de 2026-08-18 nas 988 obras do clone local +
 * a obra da nuvem que motivou o conserto), não de exemplos inventados: é o que separa uma
 * régua que quebra lista de uma que estraga título.
 */
describe("quebra o alias composto", () => {
  it("separa os cinco títulos do chip que vazava do card (obra real)", () => {
    const composto =
      "I Won’t Pick Up The Trash I Threw Away Again / Don't Pick Up What You've Thrown Away / " +
      "Don’t Pick Up The Trash Once Thrown Away / 버린 쓰레기는 다시 줍지 않는다 / " +
      "Don’t pick up the trash you threw away"
    expect(splitAlternativeTitle(composto)).toEqual([
      "I Won’t Pick Up The Trash I Threw Away Again",
      "Don't Pick Up What You've Thrown Away",
      "Don’t Pick Up The Trash Once Thrown Away",
      "버린 쓰레기는 다시 줍지 않는다",
      "Don’t pick up the trash you threw away",
    ])
  })

  it("quebra bullet, barra vertical, quebra de linha e ponto-e-vírgula COM espaço", () => {
    expect(splitAlternativeTitle("S-geup Hunter • Class S Hunter")).toEqual([
      "S-geup Hunter",
      "Class S Hunter",
    ])
    expect(splitAlternativeTitle("A | B")).toEqual(["A", "B"])
    expect(splitAlternativeTitle("A\nB")).toEqual(["A", "B"])
    expect(splitAlternativeTitle("Alpha; Beta")).toEqual(["Alpha", "Beta"])
  })

  it("aceita a barra com espaço de um lado só, e não deixa ponta vazia", () => {
    expect(splitAlternativeTitle("A /B")).toEqual(["A", "B"])
    expect(splitAlternativeTitle("A/ B")).toEqual(["A", "B"])
    expect(splitAlternativeTitle("A • B •")).toEqual(["A", "B"])
  })

  it("decodifica entidade HTML que a fonte serviu crua", () => {
    // Medido: 2 chips do catálogo exibiam "&amp;" na tela.
    expect(splitAlternativeTitle("The Wolf &amp; Red Riding Hood")).toEqual([
      "The Wolf & Red Riding Hood",
    ])
    expect(splitAlternativeTitle("A &#47; B")).toEqual(["A", "B"])
  })

  it("entidade sem ponto-e-vírgula também conta — o catálogo tem `&nbsp` solto", () => {
    expect(splitAlternativeTitle("The Regressed Demon Lord is Kind /&nbsp")).toEqual([
      "The Regressed Demon Lord is Kind",
    ])
    expect(splitAlternativeTitle("&nbsp")).toEqual([])
    // ⚠️ Nome desconhecido fica intacto: `&` seguido de palavra não é entidade por decreto.
    expect(splitAlternativeTitle("Tom &Jerry")).toEqual(["Tom &Jerry"])
  })
})

describe("o que NÃO é separador", () => {
  it("barra COLADA fica intacta — quebrar inventaria obra que não existe", () => {
    expect(splitAlternativeTitle("Fate/Zero")).toEqual(["Fate/Zero"])
    expect(splitAlternativeTitle("24/7 Idol")).toEqual(["24/7 Idol"])
  })

  it("ponto-e-vírgula colado fica intacto (Steins;Gate)", () => {
    expect(splitAlternativeTitle("Steins;Gate")).toEqual(["Steins;Gate"])
  })

  it("vírgula é pontuação de título, em qualquer alfabeto", () => {
    // 157 chips do catálogo têm vírgula latina ou CJK. A régua antiga do Mangago quebrava
    // nelas, e por isso `Ni chasseuse, ni princesse !` está partido em dois no banco.
    expect(splitAlternativeTitle("Ni chasseuse, ni princesse !")).toEqual([
      "Ni chasseuse, ni princesse !",
    ])
    expect(splitAlternativeTitle("兔子小姐，今晚請別關門")).toEqual(["兔子小姐，今晚請別關門"])
  })

  it("ponto médio (U+00B7) é nome chinês, não lista", () => {
    expect(splitAlternativeTitle("时光沙漏·逆转命运的少女")).toEqual(["时光沙漏·逆转命运的少女"])
  })

  it("troca de alfabeto sem espaço fica intacta — 15 dos 16 casos são legítimos", () => {
    expect(splitAlternativeTitle("成为BL主人公的妹妹")).toEqual(["成为BL主人公的妹妹"])
    expect(splitAlternativeTitle("夫をレベルMAXに育てようと思います")).toEqual([
      "夫をレベルMAXに育てようと思います",
    ])
  })
})

describe("dedup pela mesma régua de identidade do resto do app", () => {
  it("o composto some inteiro quando as partes já estão na lista (caso real)", () => {
    const antes = [
      "Don't Pick up the Trash You Threw Away",
      "Don't Pick up the Trash Once Thrown Away",
      "I Won't Pick Up the Trash I Threw Away Again",
      "Don't Pick up What You've Thrown Away",
      "버린 쓰레기는 다시 줍지 않는다",
      "I Won’t Pick Up The Trash I Threw Away Again / Don't Pick Up What You've Thrown Away / " +
        "Don’t Pick Up The Trash Once Thrown Away / 버린 쓰레기는 다시 줍지 않는다 / " +
        "Don’t pick up the trash you threw away",
    ]
    // Nada novo entra: as cinco partes só diferiam na caixa e no apóstrofo curvo.
    expect(normalizeAlternativeTitles(antes)).toEqual(antes.slice(0, 5))
  })

  it("apóstrofo curvo, caixa e espaço repetido não criam chip novo", () => {
    expect(normalizeAlternativeTitles(["I Won't Stop", "I Won’t stop", "I  Won't Stop"])).toEqual([
      "I Won't Stop",
    ])
  })

  it("acento e pontuação SOBREVIVEM — a chave não é a de identidade", () => {
    // 🔴 Medido: com `foldTitle` (que apaga acento e pontuação) o catálogo perde 5 chips, e
    // nos 5 o sobrevivente é a versão pior, só por ter vindo antes.
    const grafias = ["Qing Guixia, Dagong Daren!", "Qǐng Guìxia, Dàgōng Dàren!"]
    expect(normalizeAlternativeTitles(grafias)).toEqual(grafias)
    const hifen = ["Buin eun Milbat eseo Gidaryeotda", "Buin-eun Milbat-eseo Gidaryeotda"]
    expect(normalizeAlternativeTitles(hifen)).toEqual(hifen)
  })

  it("romanizações diferentes de verdade continuam sendo dois títulos", () => {
    const dois = ["Beorin Sseuregineun Dasi Jubji Anhneunda", "Beorin Sseuregineun Dasi Jupji Anneunda"]
    expect(normalizeAlternativeTitles(dois)).toEqual(dois)
  })

  it("descarta vazio, espaço e o que não sobra letra nenhuma", () => {
    expect(normalizeAlternativeTitles(["  ", "", null, undefined, "—", "A"])).toEqual(["A"])
  })

  it("preserva a ORDEM e o texto de quem já estava certo", () => {
    const limpos = ["Zeta", "Alpha", "버린 쓰레기"]
    expect(normalizeAlternativeTitles(limpos)).toEqual(limpos)
    expect(alternativeTitlesFixOrNull(limpos)).toBeNull()
    expect(alternativeTitlesFixOrNull(["A / B"])).toEqual(["A", "B"])
    expect(alternativeTitlesFixOrNull(null)).toBeNull()
  })
})

describe("a fronteira de ESCRITA quebra antes de gravar", () => {
  const base = {
    title: "Trash Will Always Be Trash",
    publication_status: "Unknown" as const,
    personal_status: "Untracked" as const,
  }

  it("o schema do formulário devolve os títulos já separados", () => {
    const parsed = workFormSchema.parse({
      ...base,
      alternative_titles: ["A / B", "b", "The Wolf &amp; Red"],
    })
    expect(parsed.alternative_titles).toEqual(["A", "B", "The Wolf & Red"])
  })

  it("o teto de 500 vale sobre o TÍTULO, não sobre a lista colada", () => {
    // Antes o `.max(500)` era checado no valor cru: uma lista de cinco títulos longos
    // reprovava com "máximo 500 caracteres" em vez de virar cinco chips.
    const um = "x".repeat(300)
    const outro = "y".repeat(300)
    const parsed = workFormSchema.parse({
      ...base,
      alternative_titles: [`${um} / ${outro}`],
    })
    expect(parsed.alternative_titles).toEqual([um, outro])

    const gigante = workFormSchema.safeParse({ ...base, alternative_titles: ["z".repeat(600)] })
    expect(gigante.success).toBe(false)
  })
})

/**
 * 🔴 Escrita de `works.alternative_titles` que não passe pelo dono devolve o defeito por
 * outra porta — e foi assim que o chip composto entrou: o backfill de aliases e o
 * "Atualizar dados" gravavam o que a fonte mandou, cru.
 *
 * ⚠️ O teste deriva os arquivos do GIT e o alvo da própria FORMA do código (o objeto do
 * `.insert`/`.update`), nunca de uma lista de nomes: o que precisa ser pego aqui é o
 * escritor que ainda não existe. Aceita a chamada inline OU a variável construída pelo
 * dono no mesmo arquivo — o que não passa é montar a lista por conta própria.
 */
describe("toda escrita de alternative_titles passa pelo dono", () => {
  /** As duas portas do módulo dono — `fixOrNull` é a que o backfill usa. */
  const DONO = /(normalizeAlternativeTitles|alternativeTitlesFixOrNull)\(/
  /** Tira o que fecha o objeto/chamada em volta do valor: `next })` → `next`. */
  const limpa = (expr: string) => expr.trim().replace(/[\s})]+$/, "")
  const arquivos = execSync('git ls-files "*.ts" "*.tsx"', { cwd: process.cwd(), encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("tests/"))
    .map((f) => ({ f, src: readFileSync(f, "utf8") }))
    .filter(({ src }) => src.includes("alternative_titles"))

  const escritas = arquivos.flatMap(({ f, src }) => {
    const achados: Array<{ f: string; linha: number; expr: string; src: string }> = []
    for (const m of src.matchAll(/\.(?:update|insert|upsert)\(\s*(\{[\s\S]*?\n\s*\})\s*[,)]/g)) {
      const campo = m[1].match(/alternative_titles\s*:\s*([^,\n]+)/)
      if (!campo) continue
      achados.push({ f, linha: src.slice(0, m.index).split("\n").length, expr: limpa(campo[1]), src })
    }
    for (const m of src.matchAll(/\.alternative_titles\s*=\s*([^\n]+)/g)) {
      achados.push({ f, linha: src.slice(0, m.index).split("\n").length, expr: limpa(m[1]), src })
    }
    return achados
  })

  it("existe escrita para varrer (senão o teste não prova nada)", () => {
    expect(escritas.length).toBeGreaterThan(2)
  })

  it("cada escrita chama o dono, direto ou pela variável que ele produziu", () => {
    for (const { f, linha, expr, src } of escritas) {
      // Ou o dono é chamado ali mesmo, ou a variável/campo escrito nasceu de uma chamada
      // dele no mesmo arquivo (`const next = …`, `depois: …`).
      const ligacao = expr.split(".").pop() ?? ""
      const daLigacao = /^[A-Za-z_$][\w$]*$/.test(ligacao)
        ? new RegExp(`\\b${ligacao}\\s*[:=][\\s\\S]{0,140}?${DONO.source}`).test(src)
        : false
      expect(
        DONO.test(expr) || daLigacao,
        `${f}:${linha} grava alternative_titles a partir de "${expr}" sem passar por ` +
          `lib/titles/alternative-titles. Alias composto ("A / B / C") volta pro banco por ` +
          `aí — e ele não casa com nada em foldTitle, então não serve nem pra busca nem ` +
          `pra duplicata.`,
      ).toBe(true)
    }
  })
})
