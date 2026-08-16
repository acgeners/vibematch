import { describe, it, expect } from "vitest"
import { classifyProfileTagOrigin } from "@/lib/ai-recommendation/profile-tag-origin"
import type { DeclaredTagLite } from "@/lib/ai-recommendation/profile-tag-origin"
import type { ProfileTag } from "@/lib/ai-recommendation/types"

const tag = (name: string, strength = 0.8): ProfileTag => ({ name, group: null, strength })
const decl = (
  name: string,
  stance: "love" | "avoid",
  source: DeclaredTagLite["source"] = "tag",
): DeclaredTagLite => ({ name, stance, source })

/**
 * A manchete "X de Y" da /account/taste-profile sai daqui. Um erro nesta função não quebra nada:
 * ele imprime um número plausível e maior, afirmando um entendimento que não houve.
 */
describe("classifyProfileTagOrigin", () => {
  it("separa confirmada (mesma stance) de descoberta (não declarada)", () => {
    const split = classifyProfileTagOrigin(
      [tag("Villainess", 0.9), tag("Isekai", 0.7)],
      [tag("Harem", 0.5)],
      [decl("Villainess", "love"), decl("Harem", "avoid")],
    )
    expect(split.confirmed.map((t) => t.name)).toEqual(["Villainess", "Harem"])
    expect(split.discovered.map((t) => t.name)).toEqual(["Isekai"])
    expect(split.conflicts).toEqual([])
    expect(split.agreementBase).toBe(2)
    expect(split.profileTotal).toBe(3)
  })

  it("🔴 stance oposta é CONFLITO, nunca confirmação", () => {
    // Contar as duas juntas transformaria uma discordância em prova de acerto — o
    // oposto do que ela é. É o único caso em que o número da manchete pode subir
    // enquanto o entendimento piora.
    const split = classifyProfileTagOrigin(
      [tag("Harem", 0.6)],
      [],
      [decl("Harem", "avoid")],
    )
    expect(split.confirmed).toEqual([])
    expect(split.conflicts.map((t) => t.name)).toEqual(["Harem"])
    expect(split.conflicts[0]!.conflict).toBe(true)
    // O denominador continua contando a tag: os dois lados opinaram sobre ela.
    expect(split.agreementBase).toBe(1)
    expect(split.confirmed.length).toBe(0)
  })

  it("🔴 declaração de GRUPO/SUBGRUPO não conta como concordância", () => {
    // `getDeclaredTagPreferences` expande grupo/subgrupo pra todas as tags membras —
    // certo pro ranker, errado aqui: quem marca um grupo inteiro faz qualquer tag dele
    // "concordar" sem nunca ter opinado sobre ela. Medido no perfil v23: com expansão
    // dá 314 declaradas e 23 concordâncias; só com nível tag, 147 e 17.
    const split = classifyProfileTagOrigin(
      [tag("Villainess"), tag("Isekai")],
      [],
      [decl("Villainess", "love", "group"), decl("Isekai", "love", "subgroup")],
    )
    expect(split.confirmed).toEqual([])
    expect(split.discovered.map((t) => t.name)).toEqual(["Villainess", "Isekai"])
    expect(split.agreementBase).toBe(0)
    expect(split.declaredTotal).toBe(0)
  })

  it("casa por nome normalizado (caixa e espaço), que é o único vínculo existente", () => {
    // O perfil guarda NOME, não id de tag — se o casamento fosse sensível a caixa, a
    // concordância cairia a zero sem nenhum erro aparecer.
    const split = classifyProfileTagOrigin(
      [tag("  Slow Romance ")],
      [],
      [decl("slow romance", "love")],
    )
    expect(split.confirmed).toHaveLength(1)
    expect(split.discovered).toEqual([])
  })

  it("declaredOnly conta as declaradas que ficaram fora do destilado", () => {
    const split = classifyProfileTagOrigin(
      [tag("Villainess")],
      [],
      [decl("Villainess", "love"), decl("Revenge", "love"), decl("Netorare", "avoid")],
    )
    expect(split.declaredTotal).toBe(3)
    expect(split.declaredOnly).toBe(2)
  })

  it("ordena cada balde por força, pra a tag mais forte aparecer primeiro", () => {
    const split = classifyProfileTagOrigin(
      [tag("fraca", 0.3), tag("forte", 0.95), tag("media", 0.6)],
      [],
      [],
    )
    expect(split.discovered.map((t) => t.name)).toEqual(["forte", "media", "fraca"])
  })

  it("sem declaração nenhuma, tudo é descoberta e a manchete não aparece", () => {
    // `agreementBase` 0 é o sinal de "não há o que comparar" — a UI esconde o bloco em
    // vez de imprimir "0 de 0", que leria como fracasso.
    const split = classifyProfileTagOrigin([tag("a"), tag("b")], [tag("c")], [])
    expect(split.agreementBase).toBe(0)
    expect(split.discovered).toHaveLength(3)
  })

  it("não conta a mesma tag duas vezes em declaredOnly", () => {
    // Nome repetido na declaração (níveis diferentes resolvidos a montante) não pode
    // inflar nem o total nem o "fora do destilado".
    const split = classifyProfileTagOrigin(
      [tag("Villainess")],
      [],
      [decl("Villainess", "love"), decl("villainess", "love")],
    )
    expect(split.declaredTotal).toBe(1)
    expect(split.declaredOnly).toBe(0)
  })
})
