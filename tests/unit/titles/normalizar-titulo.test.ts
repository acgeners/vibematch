import { describe, it, expect } from "vitest"
import { normalizeWorkTitle, titleFixOrNull } from "@/lib/titles/title-normalize"

/**
 * A invariante que importa aqui NÃO é "o título fica bonito" — é **o que a função NÃO
 * toca**. Ela corrige 30 palavras conhecidas e copia o resto byte a byte; se um dia
 * alguém a transformar num title-caser de verdade, é aqui que reprova.
 *
 * Os casos vieram do ensaio contra as 988 obras reais (2026-08-17), não de imaginação —
 * inclusive o do `~`, que era um BUG achado pelo ensaio e que um teste inventado não teria
 * pegado: a fronteira de subtítulo pode ser prefixo do próprio token.
 */

describe("normalizeWorkTitle — o que ela corrige", () => {
  it("tira espaço das pontas sem tocar no espaçamento interno", () => {
    expect(normalizeWorkTitle("Horimiya ")).toBe("Horimiya")
    expect(normalizeWorkTitle(" Growing the Seed of Evil")).toBe("Growing the Seed of Evil")
    // Espaço duplo INTERNO sobrevive: colapsá-lo seria uma 2ª mudança viajando de carona.
    expect(normalizeWorkTitle("A  Tender  Heart")).toBe("A  Tender  Heart")
  })

  it("baixa artigo, preposição curta e conjunção no meio do título", () => {
    expect(normalizeWorkTitle("The Scent Of Desire")).toBe("The Scent of Desire")
    expect(normalizeWorkTitle("Straight To The Red Carpet")).toBe("Straight to the Red Carpet")
    expect(normalizeWorkTitle("A Taste For Being Treated Roughly")).toBe("A Taste for Being Treated Roughly")
  })

  it("sobe verbo, auxiliar, demonstrativo e pronome em qualquer posição", () => {
    expect(normalizeWorkTitle("Divorce is the Condition")).toBe("Divorce Is the Condition")
    expect(normalizeWorkTitle("My Master Likes to be Spanked")).toBe("My Master Likes to Be Spanked")
    expect(normalizeWorkTitle("I Was Tricked into this Fake Marriage!")).toBe("I Was Tricked into This Fake Marriage!")
    expect(normalizeWorkTitle("The Maid No Longer Desires her Master")).toBe("The Maid No Longer Desires Her Master")
  })
})

describe("normalizeWorkTitle — o que ela NÃO pode tocar", () => {
  it("preserva a palavra que abre um subtítulo", () => {
    // Metade das 18 acusações da regra ingênua era exatamente isto.
    for (const t of [
      "Cassmire: The Loyal Sword",
      "Regina Rena: To the Unforgiven",
      "Henkoi - The After School Diary",
      "OOTD: A Paladin's Devilish Pleasure",
    ]) {
      expect(titleFixOrNull(t)).toBeNull()
    }
  })

  it("preserva a palavra depois de VÍRGULA — escolha da curadora, não do manual", () => {
    // AP e Chicago mandariam `but` minúsculo aqui (conjunção é conjunção em qualquer
    // posição). Decidido em 2026-08-17 preservar: rebaixá-lo é tecnicamente correto e a
    // única coisa que consegue é chamar atenção para si.
    expect(
      titleFixOrNull("I’m Married into a Family of Tyrants, But Isn’t Their Obsession a Little Too Much?")
    ).toBeNull()
    // ⚠️ E a vírgula não vira desculpa para o resto do título: o `Of` daqui continua caindo.
    expect(normalizeWorkTitle("A Story, But The Scent Of Desire")).toBe("A Story, But the Scent of Desire")
  })

  it("trata fronteira PREFIXADA ao token, não só a sufixada ao anterior", () => {
    // 🔴 Contraprova do bug que o ensaio contra o catálogo pegou: sem a régua de prefixo
    // isto virava "~the Counterfeit Bride~".
    expect(titleFixOrNull("Nullitas ~The Counterfeit Bride~")).toBeNull()
    expect(titleFixOrNull('The Beginning ("The End")')).toBeNull()
  })

  it("não decide a briga AP × Chicago: with/from/into ficam como estão", () => {
    // ~60 obras dependem disto. Padronizá-las é decisão de estilo, não conserto.
    expect(normalizeWorkTitle("A Lonely Princess Falls In Love With A Misanthropic Emperor")).toBe(
      "A Lonely Princess Falls in Love With a Misanthropic Emperor"
    )
    expect(titleFixOrNull("She Is Obsessed with the Possessive Flame Emperor")).toBeNull()
    expect(titleFixOrNull("I Adopted the Male Lead from the Shelter")).toBeNull()
    expect(titleFixOrNull("I Fell into a Reverse Harem Game!")).toBeNull()
  })

  it("não mexe em sigla, caixa alta nem nome com maiúscula interna", () => {
    expect(titleFixOrNull("My First XXX: The Marquess Is Wild for His Princess")).toBeNull()
    expect(titleFixOrNull("BJ Alex")).toBeNull()
    expect(titleFixOrNull("McCoy AND the Beast")).toBeNull()
  })

  it("não mexe em primeira nem em última palavra", () => {
    expect(titleFixOrNull("The Beginning of the End")).toBeNull()
    expect(titleFixOrNull("A Story About A")).toBeNull()
  })

  it("passa longe de título sem alfabeto latino", () => {
    for (const t of ["俺だけレベルアップな件", "나 혼자만 레벨업", "Магическая битва"]) {
      expect(titleFixOrNull(t)).toBeNull()
    }
  })

  it("é idempotente — rodar duas vezes não muda mais nada", () => {
    for (const t of ["The Scent Of Desire", "Divorce is the Condition", "Cassmire: The Loyal Sword"]) {
      const uma = normalizeWorkTitle(t)
      expect(normalizeWorkTitle(uma)).toBe(uma)
    }
  })
})

/**
 * A outra metade do conserto: fechar a ENTRADA. Limpar o banco sem isto é conserto que
 * precisa ser refeito, e da próxima vez ninguém vai reparar — espaço nas pontas é
 * invisível no HTML.
 */
describe("schema de escrita — o título entra trimado pelos DOIS caminhos", () => {
  it("criação (workFormSchema)", async () => {
    const { workFormSchema } = await import("@/lib/validations/work.schema")
    const r = workFormSchema.parse({ title: "  Horimiya  " })
    expect(r.title).toBe("Horimiya")
  })

  it("edição (workUpdateSchema) — a cópia que ANTES sobrescrevia o base", async () => {
    const { workUpdateSchema } = await import("@/lib/validations/work.schema")
    const r = workUpdateSchema.parse({ title: " Growing the Seed of Evil " })
    expect(r.title).toBe("Growing the Seed of Evil")
  })

  it("título só de espaço REPROVA, nunca vira string vazia", async () => {
    const { workUpdateSchema } = await import("@/lib/validations/work.schema")
    expect(workUpdateSchema.safeParse({ title: "   " }).success).toBe(false)
  })
})
