import { describe, it, expect } from "vitest"
import {
  computeMoodAdjusted,
  sortByMoodAdjusted,
  startabilityOf,
  readingProgressOf,
  MOOD_PRACTICAL_DIMENSIONS,
  type MoodWork,
} from "@/lib/calculations/mood-refine"
import { MOOD_DIMENSION_INFO, MOOD_DIMENSION_ORDER, moodDimensionLabel } from "@/lib/ui/mood-dimensions"
import { getPersonalStatusIdByName, getPublicationStatusIdByName } from "@/lib/constants/status-lookups"

/**
 * As dimensões práticas do refino passaram de BOOLEANAS para PESO −2..+2.
 *
 * O que isso destrava não é cosmético: o lado NEGATIVO passou a existir, e ele
 * responde perguntas que o liga/desliga não sabia fazer — "quero algo de nicho",
 * "quero algo ainda em andamento", "quero algo mais antigo".
 *
 * O cenário que motivou: várias obras com a MESMA nota na lista, cada uma com um
 * porém diferente (uma em hiato, outra com arte fraca, outra antiga), e nenhuma
 * forma de dizer qual porém importa AGORA. Medido em 2026-08-15: 32 grupos com 5+
 * obras na mesma Prioridade exibida.
 */

const ID = (nome: string) => {
  const id = getPublicationStatusIdByName(nome)
  if (id == null) throw new Error(`status "${nome}" não existe`)
  return id
}

/** Três obras empatadas na base, variando só nas dimensões práticas. */
function cluster(): MoodWork[] {
  return [
    {
      id: "concluida-popular-antiga",
      decisionScore: 8.2, scores: {}, totalChapters: 200, personalFit: 0.3,
      totalVotes: 50_000, synopsisQuality: "♥♥",
      artPercentile: 0.30, publicationStatusId: ID("Completed"), platformAvg: 7.5, year: 2015,
    },
    {
      id: "hiato-nicho-nova",
      decisionScore: 8.2, scores: {}, totalChapters: 40, personalFit: 0.3,
      totalVotes: 300, synopsisQuality: "♥♥",
      artPercentile: 0.95, publicationStatusId: ID("Hiatus"), platformAvg: 8.9, year: 2025,
    },
    {
      id: "andamento-medio",
      decisionScore: 8.2, scores: {}, totalChapters: 100, personalFit: 0.3,
      totalVotes: 5_000, synopsisQuality: "♥♥",
      artPercentile: 0.60, publicationStatusId: ID("Ongoing"), platformAvg: 8.0, year: 2021,
    },
  ]
}

const primeiro = (mood: Parameters<typeof sortByMoodAdjusted>[1]) =>
  sortByMoodAdjusted(cluster(), mood).map((w) => w.id)[0]

describe("cada dimensão prática move a ordem no sentido escolhido", () => {
  it("arte ↑ põe a de melhor arte no topo", () => {
    expect(primeiro({ attributes: {}, practical: { art: 2 } })).toBe("hiato-nicho-nova")
  })

  it("popularidade ↑ põe a mais votada no topo; ↓ põe a de NICHO", () => {
    expect(primeiro({ attributes: {}, practical: { popularity: 2 } })).toBe("concluida-popular-antiga")
    expect(primeiro({ attributes: {}, practical: { popularity: -2 } })).toBe("hiato-nicho-nova")
  })

  it("recência ↑ põe a mais nova; ↓ põe a mais antiga", () => {
    expect(primeiro({ attributes: {}, practical: { recency: 2 } })).toBe("hiato-nicho-nova")
    expect(primeiro({ attributes: {}, practical: { recency: -2 } })).toBe("concluida-popular-antiga")
  })

  it("média externa ↑ põe a melhor avaliada fora", () => {
    expect(primeiro({ attributes: {}, practical: { platform: 2 } })).toBe("hiato-nicho-nova")
  })
})

/**
 * 🔴 O caso que motivou a dimensão: "duas estão em hiato e eu não sei se vale
 * começar agora". Concluída não tem espera; em andamento entrega capítulo; em hiato
 * está parada sem data.
 */
describe("publicação — 'dá pra começar agora?'", () => {
  it("↑ prioriza a concluída, ↓ prioriza a que ainda está saindo", () => {
    expect(primeiro({ attributes: {}, practical: { publication: 2 } })).toBe("concluida-popular-antiga")
    // Do lado negativo, quem sobe é a EM ANDAMENTO — a em hiato é a pior das duas
    // que "ainda saem", e é justamente essa a dúvida da pessoa.
    expect(primeiro({ attributes: {}, practical: { publication: -2 } })).toBe("hiato-nicho-nova")
  })

  it("a régua de 'startability' ordena concluída > em andamento > hiato > cancelada", () => {
    const concluida = startabilityOf(ID("Completed"))!
    const andamento = startabilityOf(ID("Ongoing"))!
    const hiato = startabilityOf(ID("Hiatus"))!
    const cancelada = startabilityOf(ID("Cancelled"))!
    expect(concluida).toBeGreaterThan(andamento)
    expect(andamento).toBeGreaterThan(hiato)
    expect(hiato).toBeGreaterThan(cancelada)
  })

  it("sem status é null — 'não sei' não vira 'é ruim'", () => {
    expect(startabilityOf(null)).toBeNull()
    expect(startabilityOf(undefined)).toBeNull()
  })

  /**
   * 🔴 Bug real, achado quando a Ana perguntou "e os outros status?": o `return 0`
   * final pegava Cancelled E Unknown juntos, então "não sabemos se acabou" era
   * tratado como o PIOR caso. O docstring já dizia "cai no meio, não em zero" — a
   * prosa estava certa e o código não. NULL faz o cálculo tratar como sem dado
   * (contribuição neutra), que é o tratamento correto de ausência.
   */
  it("status DESCONHECIDO é null, não zero — não é o mesmo que cancelada", () => {
    expect(startabilityOf(ID("Unknown"))).toBeNull()
    expect(startabilityOf(ID("Cancelled"))).toBe(0)
  })

  /**
   * A régua tem que cobrir TODOS os status da tabela, não os quatro que eu lembrei.
   * Status novo no Supabase cai no `null` (neutro) em vez de virar "pior caso" calado.
   */
  it("todo status conhecido tem tratamento explícito, e o resto cai no neutro", () => {
    const semTratamento = ["Completed", "Ongoing", "Hiatus", "Cancelled"].filter(
      (nome) => startabilityOf(ID(nome)) == null,
    )
    expect(semTratamento, "status sem valor declarado em startabilityOf").toEqual([])
  })
})

/**
 * "Continuar o que já abri" × "começar algo novo" — a dimensão que a Ana pediu ao
 * perguntar "e status de leitura, não entra?". Medido antes de entrar: separa 37,9%
 * dos pares empatados, mesmo patamar da média externa. O teto vem da distribuição —
 * 690 das 978 obras estão em `Untracked`, então a maioria dos pares não separa.
 */
describe("leitura — 'continuar' × 'começar'", () => {
  const PER = (nome: string) => {
    const id = getPersonalStatusIdByName(nome)
    if (id == null) throw new Error(`status pessoal "${nome}" não existe`)
    return id
  }

  it("em curso é 1, não-começada é 0", () => {
    expect(readingProgressOf(PER("Reading"))).toBe(1)
    expect(readingProgressOf(PER("On-hold"))).toBe(1)
    expect(readingProgressOf(PER("Untracked"))).toBe(0)
    expect(readingProgressOf(PER("Want to Read"))).toBe(0)
  })

  /**
   * 🔴 A régua é `tracksProgress`, não `isUnread` — e a diferença não é teórica.
   * Medido nas flags: `is_unread` é true SÓ em Untracked e Want to Read. "Not Now" e
   * "Not Interested" têm `is_unread = false`, então a 1ª versão as classificava como
   * "já comecei" — afirmando que a pessoa abriu obras que ela adiou ou recusou.
   */
  it("'Not Now' e 'Not Interested' são NÃO-COMEÇADAS, apesar de is_unread=false", () => {
    expect(readingProgressOf(PER("Not Now"))).toBe(0)
    expect(readingProgressOf(PER("Not Interested"))).toBe(0)
  })

  /**
   * 🔴 Terminal é NEUTRO, não 0 nem 1. Em 0, "quero começar algo novo" promoveria
   * obras que você JÁ LEU junto com as que nunca abriu; em 1, "quero continuar"
   * ofereceria o que não tem como continuar.
   */
  it("obra terminada ou largada fica FORA dos dois lados", () => {
    expect(readingProgressOf(PER("Finished"))).toBeNull()
    expect(readingProgressOf(PER("Dropped"))).toBeNull()
  })

  it("sem status é neutro — ausência de linha não é 'não comecei'", () => {
    expect(readingProgressOf(null)).toBeNull()
    expect(readingProgressOf(undefined)).toBeNull()
  })

  it("move a ordem nos dois sentidos", () => {
    const works: MoodWork[] = [
      { ...cluster()[0], id: "lendo", personalStatusId: PER("Reading") },
      { ...cluster()[1], id: "nova", personalStatusId: PER("Untracked") },
      { ...cluster()[2], id: "terminada", personalStatusId: PER("Finished") },
    ]
    expect(sortByMoodAdjusted(works, { attributes: {}, practical: { reading: 2 } })[0].id).toBe("lendo")
    expect(sortByMoodAdjusted(works, { attributes: {}, practical: { reading: -2 } })[0].id).toBe("nova")
  })
})

describe("magnitude e ausência", () => {
  it("++ pesa o dobro de + quando duas dimensões disputam", () => {
    // Arte favorece a de hiato; popularidade favorece a concluída.
    const arteForte = computeMoodAdjusted(cluster(), { attributes: {}, practical: { art: 2, popularity: 1 } })
    const empatado = computeMoodAdjusted(cluster(), { attributes: {}, practical: { art: 1, popularity: 1 } })
    const gap = (m: Map<string, number | null>) => m.get("hiato-nicho-nova")! - m.get("concluida-popular-antiga")!
    expect(gap(arteForte)).toBeGreaterThan(gap(empatado))
  })

  /**
   * 🔴 Sem dado a contribuição é NEUTRA (0,5), nunca zero: 2,5% das obras não têm
   * estimativa de arte, e afundá-las por dado ausente puniria a obra errada.
   */
  it("obra sem estimativa de arte não afunda por causa disso", () => {
    const works = cluster()
    works[1] = { ...works[1], artPercentile: null }
    const adj = computeMoodAdjusted(works, { attributes: {}, practical: { art: 2 } })
    // Com arte 0,30 contra "sem dado", a de arte baixa NÃO pode ficar acima da neutra.
    expect(adj.get("hiato-nicho-nova")!).toBeGreaterThan(adj.get("concluida-popular-antiga")!)
  })

  it("a correção continua limitada ao MAE — o mood não inventa distância", () => {
    const adj = computeMoodAdjusted(cluster(), {
      attributes: {},
      practical: { art: 2, popularity: 2, recency: 2, platform: 2, publication: 2 },
    })
    for (const w of cluster()) {
      expect(Math.abs(adj.get(w.id)! - w.decisionScore!)).toBeLessThanOrEqual(0.9 + 1e-9)
    }
  })
})

/**
 * O catálogo de rótulos e a lista de dimensões do cálculo têm que concordar — se
 * uma dimensão entrar no cálculo sem rótulo, o controle some da tela sem nada
 * acusar; com rótulo e sem cálculo, o controle não faz nada.
 */
describe("rótulos e cálculo descrevem o MESMO conjunto", () => {
  it("toda dimensão do cálculo tem rótulo, e vice-versa", () => {
    expect([...MOOD_PRACTICAL_DIMENSIONS].sort()).toEqual(Object.keys(MOOD_DIMENSION_INFO).sort())
    expect([...MOOD_DIMENSION_ORDER].sort()).toEqual([...MOOD_PRACTICAL_DIMENSIONS].sort())
  })

  /**
   * ⚠️ Nem toda dimensão é bipolar. "Mais de nicho" tem uso; "sinopse menos
   * interessante" não tem. As unipolares declaram `down: null` e o controle desenha
   * só o lado de priorizar — oferecer um lado sem significado é pior que não oferecer.
   */
  it("dimensão sem oposto cai no rótulo positivo, nunca inventa um negativo", () => {
    expect(MOOD_DIMENSION_INFO.synopsis.down).toBeNull()
    expect(moodDimensionLabel("synopsis", -2)).toContain(MOOD_DIMENSION_INFO.synopsis.up)
    // As bipolares dizem coisas DIFERENTES nos dois lados.
    expect(moodDimensionLabel("popularity", 1)).toContain("popular")
    expect(moodDimensionLabel("popularity", -1)).toContain("nicho")
    expect(moodDimensionLabel("publication", 1)).not.toBe(moodDimensionLabel("publication", -1))
  })

  it("o ++ aparece no rótulo só na intensidade máxima", () => {
    expect(moodDimensionLabel("art", 2)).toContain("++")
    expect(moodDimensionLabel("art", 1)).not.toContain("++")
    expect(moodDimensionLabel("popularity", -2)).toContain("++")
  })
})
