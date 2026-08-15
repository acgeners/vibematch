import { describe, it, expect } from "vitest"
import {
  cohesionOf,
  anchoredCohesionOf,
  weakestSeed,
  classifyCohesion,
  primaryEffectByStep,
  WEIGHT_STEPS,
} from "@/lib/discovery/blend"
import type { SeedPair, BlendCandidate } from "@/lib/discovery/blend"

/**
 * A coesão passou a ser DERIVADA dos pares (migration 192), em vez de vir como média pronta
 * do SQL. Este arquivo guarda as três leituras que saem do mesmo dado — e, principalmente, o
 * caso em que duas delas discordam, que é a razão de a semente principal existir.
 */

// Os três pares do trio que motivou a feature. A média dá 0,093 — o número que a tela
// mostrava — e `b|c` é NEGATIVO: no espaço centralizado o acaso é 0, então duas obras podem
// ficar ABAIXO dele. É essa negatividade que permite "geral fraca, ancorada razoável".
const A = "a", B = "b", C = "c"
const TRIO: SeedPair[] = [
  { a: A, b: B, sim: 0.22 },
  { a: A, b: C, sim: 0.119 },
  { a: B, b: C, sim: -0.06 },
]

describe("cohesionOf", () => {
  it("é a média dos pares INTERNOS ao conjunto", () => {
    expect(cohesionOf(TRIO, [A, B, C])).toBeCloseTo(0.093, 6)
    // Só o par a|b entra; a|c e b|c ficam de fora por citarem uma obra ausente.
    expect(cohesionOf(TRIO, [A, B])).toBeCloseTo(0.22, 6)
  })

  it("null com menos de 2 sementes — 0 seria indistinguível do alarme", () => {
    expect(cohesionOf(TRIO, [A])).toBeNull()
    expect(cohesionOf(TRIO, [])).toBeNull()
  })

  it("null quando o par pedido não existe (semente sem vetor)", () => {
    expect(cohesionOf([], [A, B])).toBeNull()
  })
})

describe("anchoredCohesionOf", () => {
  it("conta só os pares que TOCAM a principal", () => {
    // (0,22 + 0,119) / 2 — o par b|c fica fora porque nenhuma das duas dirige a busca.
    expect(anchoredCohesionOf(TRIO, [A, B, C], A)).toBeCloseTo(0.1695, 6)
    expect(anchoredCohesionOf(TRIO, [A, B, C], B)).toBeCloseTo(0.08, 6)
    expect(anchoredCohesionOf(TRIO, [A, B, C], C)).toBeCloseTo(0.0295, 6)
  })

  it("🔴 as duas leituras podem dar VEREDITOS opostos sobre as mesmas sementes", () => {
    const geral = cohesionOf(TRIO, [A, B, C])
    const ancorada = anchoredCohesionOf(TRIO, [A, B, C], A)

    expect(classifyCohesion(geral)).toBe("weak")
    expect(classifyCohesion(ancorada)).toBe("fair")

    // É por isso que a UI mostra as duas e o veredito segue a ancorada quando há principal:
    // usar a geral faria o alarme condenar uma busca que a própria ferramenta ancorou.
    expect(classifyCohesion(geral)).not.toBe(classifyCohesion(ancorada))
  })

  it("a discordância NÃO é constante — depende de qual semente ancora", () => {
    // Ancorar em B ou C mantém "weak". Um defeito que só aparece numa das três escolhas é
    // bem pior de achar do que um que aparece sempre, e o teste registra isso.
    expect(classifyCohesion(anchoredCohesionOf(TRIO, [A, B, C], B))).toBe("weak")
    expect(classifyCohesion(anchoredCohesionOf(TRIO, [A, B, C], C))).toBe("weak")
  })

  it("null sem principal, ou com principal fora do conjunto", () => {
    expect(anchoredCohesionOf(TRIO, [A, B, C], null)).toBeNull()
    expect(anchoredCohesionOf(TRIO, [A, B, C], "fantasma")).toBeNull()
  })
})

describe("weakestSeed", () => {
  it("aponta a semente cuja remoção mais sobe a coesão", () => {
    const w = weakestSeed(TRIO, [A, B, C])
    expect(w?.id).toBe(C)
    expect(w?.before).toBeCloseTo(0.093, 6)
    expect(w?.after).toBeCloseTo(0.22, 6)
  })

  it("🔴 null com 2 sementes — tirar uma deixa a busca abaixo do mínimo", () => {
    expect(weakestSeed(TRIO, [A, B])).toBeNull()
  })

  it("null quando remover qualquer uma PIORA (conjunto já homogêneo)", () => {
    const homogeneo: SeedPair[] = [
      { a: A, b: B, sim: 0.3 },
      { a: A, b: C, sim: 0.3 },
      { a: B, b: C, sim: 0.3 },
    ]
    expect(weakestSeed(homogeneo, [A, B, C])).toBeNull()
  })

  it("🔴 com principal, mede na régua ANCORADA — a mesma do veredito", () => {
    // Sem principal a régua é a geral: −0,05 → 0,28 nas obras reais que expuseram isto.
    // Com principal em A, tanto o "antes" quanto o "depois" têm de sair dos pares que
    // tocam A — senão o card mostra um ganho que não se refere ao número que ele julga.
    const w = weakestSeed(TRIO, [A, B, C], A)!
    expect(w.id).toBe(C)
    expect(w.before).toBeCloseTo(0.1695, 6) // ancorada em A, com as duas
    expect(w.after).toBeCloseTo(0.22, 6) // ancorada em A, só com B
    expect(w.before).not.toBeCloseTo(cohesionOf(TRIO, [A, B, C])!, 6)
  })

  it("🔴 a própria principal nunca é candidata a ser removida", () => {
    // Tirar a âncora não melhora a ancoragem — acaba com ela. Ancorando em C (a destoante),
    // quem sai é B ou A, nunca C.
    const w = weakestSeed(TRIO, [A, B, C], C)
    expect(w?.id).not.toBe(C)
  })

  it("a troca de FAIXA é o que a tela usa para decidir se nomeia a culpada", () => {
    const w = weakestSeed(TRIO, [A, B, C])!
    // Aqui vale: weak → fair. É o critério da UI, e ele não precisa de limiar inventado.
    expect(classifyCohesion(w.before)).not.toBe(classifyCohesion(w.after))

    // E um caso em que NÃO vale: sobe, mas continua na mesma faixa.
    const pouco: SeedPair[] = [
      { a: A, b: B, sim: 0.1 },
      { a: A, b: C, sim: 0.05 },
      { a: B, b: C, sim: 0.03 },
    ]
    const p = weakestSeed(pouco, [A, B, C])!
    expect(p.after).toBeGreaterThan(p.before)
    expect(classifyCohesion(p.before)).toBe(classifyCohesion(p.after))
  })
})

describe("primaryEffectByStep", () => {
  function cand(id: string, sim: number, flat: number, fit: number): BlendCandidate {
    return { workId: id, simPos: sim, simPosFlat: flat, simNeg: 0, fitPercentile: fit }
  }

  it("uma entrada por parada do slider", () => {
    const c = [cand("x", 1, 1, 50), cand("y", 2, 2, 50)]
    expect(primaryEffectByStep(c, 2)).toHaveLength(WEIGHT_STEPS.length)
  })

  it("🔴 tudo zero quando não há principal — as duas colunas são o mesmo número", () => {
    const c = [cand("x", 0.4, 0.4, 80), cand("y", 0.3, 0.3, 20), cand("z", 0.1, 0.1, 55)]
    for (const e of primaryEffectByStep(c, 3)) {
      expect(e).toEqual({ enters: 0, moves: 0 })
    }
  })

  it("acusa troca de membro e mudança de posição quando a ponderação muda a ordem", () => {
    // Com pesos iguais o topo-2 é x,y. Ponderada, z sobe e y sai.
    const c = [
      cand("x", 0.9, 0.9, 50),
      cand("y", 0.2, 0.8, 50),
      cand("z", 0.8, 0.1, 50),
    ]
    const soParecenca = primaryEffectByStep(c, 2)[WEIGHT_STEPS.indexOf(1)]
    expect(soParecenca.enters).toBe(1)
    expect(soParecenca.moves).toBeGreaterThan(0)
  })

  it("simPosFlat ausente é tratado como igual a simPos (nunca como zero)", () => {
    const c: BlendCandidate[] = [
      { workId: "x", simPos: 0.5, simNeg: 0, fitPercentile: 50 },
      { workId: "y", simPos: 0.2, simNeg: 0, fitPercentile: 50 },
    ]
    for (const e of primaryEffectByStep(c, 2)) expect(e.enters).toBe(0)
  })
})
