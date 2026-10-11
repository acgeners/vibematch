import { describe, expect, it } from "vitest"
import { mentionsExplicitSexualContent } from "@/lib/editions/edition-content"
import { reviewsForEdition } from "@/lib/editions/edition-reviews"

/**
 * Vazamento medido no deploy v42 (2026-10-11): a régua só reconhecia "explícito" junto de "sexual",
 * e a versão NORMAL de 42 das 140 obras `mixed` mostrava o resumo da avaliação dizendo "conteúdo
 * adulto explícito", "conteúdo explícito" ou "cenas explícitas" (+4 sínteses de reviews e 3 traços do
 * digest). Todas as frases abaixo são dos dados de produção.
 *
 * A correção NÃO é um filtro de palavra: texto que nega, que fala de expectativa do leitor ou de
 * censura não afirma que a obra tem o conteúdo e continua visível.
 */
describe("afirma conteúdo explícito sem a palavra 'sexual' — sai da versão normal", () => {
  it.each([
    // resumos de avaliação (36 com esta forma)
    "Kill This Marriage combina fantasia (regressão, poderes de cura) com ambientação de nobreza europeia, drama familiar intenso e conteúdo adulto explícito.",
    "um manhwa de regressão com forte foco no romance e conteúdo adulto explícito, ambientado em nobreza europeia",
    "com romance como eixo principal e conteúdo explícito confirmado.",
    "misturando comédia absurda e cenas explícitas.",
    "Combina drama de reencontro, elementos de nobreza/palácio e cenas explícitas, com resolução rápida.",
    // sínteses de reviews
    "A obra é recomendada para quem aprecia angst, mas não para leitores aversivos a conteúdo explícito.",
    "leitores esperavam ver os filhos do casal, mas receberam apenas cenas de intimidade explícita nos últimos capítulos",
    "sugerindo um tom cômico e descontraído com conteúdo adulto explícito.",
    // traços do digest
    "capítulos explícitos/fan service percebidos como desnecessários por alguns",
    "Cenas de intimidade frequentes e explícitas na parte central",
    "conteúdo explícito/sem censura",
  ])("%s", (frase) => {
    expect(mentionsExplicitSexualContent(frase)).toBe(true)
  })
})

describe("não afirma — continua visível na versão normal", () => {
  it.each([
    // expectativa do leitor
    "A maior reclamação é a censura pesada nos capítulos finais, frustrando leitores que esperavam conteúdo adulto explícito conforme a tag sugeria.",
    "alguns acham excessiva, outros gostariam de mais conteúdo explícito",
    "o conteúdo adulto censurado é visto como insatisfatório por quem esperava cenas mais explícitas.",
    "desapontamento com o conteúdo adulto ser menos explícito que esperado.",
    // ausência / negação
    "outros criticam a falta de conteúdo adulto explícito apesar das promessas visuais e do título sugestivo.",
    "conteúdo maduro (cenas sensuais recorrentes, embora sem explicitação plena)",
    "cenas de intimidade não explícitas",
    // censura (descreve justamente a versão censurada)
    "há frustração generalizada com a censura inconsistente do conteúdo explícito: plataformas aplicam censura de formas distintas",
    "apesar da censura nas cenas mais explícitas.",
    // "explícito" em outro sentido
    "Há recomendação explícita de certos grupos de scan em detrimento de outros.",
    // violência sexual é fato das duas edições (mig 203)
    "Cena de abertura com sequestro e coerção sexual do ML, vista por parte do público como estupro explícito",
  ])("%s", (frase) => {
    expect(mentionsExplicitSexualContent(frase)).toBe(false)
  })
})

describe("a régua só vale na versão NORMAL de obra mixed", () => {
  const snapshot = (summary: string) => ({
    total: 1,
    bySource: [{ source: "mangadex", reviews: [{ text: "great art" }] }],
    manual: [],
    summary,
    digest: null,
  })
  const RESUMO = "tom cômico e descontraído com conteúdo adulto explícito."

  it("normal: a síntese que afirma sai inteira", () => {
    const v = reviewsForEdition(snapshot(RESUMO), "normal")
    expect(v.synthesisHidden).toBe(true)
    expect(v.snapshot.summary).toBeNull()
  })
  it("R18 e obra não-mixed: a mesma síntese fica intacta", () => {
    for (const ed of ["r18", null] as const) {
      const v = reviewsForEdition(snapshot(RESUMO), ed)
      expect(v.synthesisHidden).toBe(false)
      expect(v.snapshot.summary).toBe(RESUMO)
    }
  })
  it("normal: a síntese que só fala de expectativa continua", () => {
    const frase = "frustrando leitores que esperavam conteúdo adulto explícito conforme a tag sugeria."
    expect(reviewsForEdition(snapshot(frase), "normal").snapshot.summary).toBe(frase)
  })
})

/**
 * Os três textos ambíguos que o v43 deixou visíveis, decididos em 2026-10-11 (todos dos dados):
 * - "tornando-se mais explícito depois" revela a versão mais explícita → sai da normal;
 * - "some of the chapters are very explicit" afirma conteúdo explícito sem atribuição segura → sai;
 * - "graficamente explícito" sobre uma cena de violência sexual é fato da história → FICA.
 */
describe("resíduos do v43", () => {
  it.each([
    "A arte melhora ao longo da série, embora o conteúdo adulto seja inicialmente censurado (R-15), tornando-se mais explícito depois.",
    "My only gripe is that some of the chapters are very explicit and really only feel like fan service",
  ])("sai da versão normal: %s", (frase) => {
    expect(mentionsExplicitSexualContent(frase)).toBe(true)
  })

  it.each([
    // violência sexual descrita como gráfica: fato das duas edições (mig 203)
    "o momento em que o ML estupra a FL sob influência de brainwashing é amplamente criticado por ser graficamente explícito e praticamente ignorado pela trama",
    // "fica mais explícito" sem conteúdo adulto na frase, e com negação
    "A trama fica mais explícita sobre o passado da protagonista.",
    "o conteúdo adulto não fica mais explícito depois",
    // inglês: negação, expectativa, outro sujeito
    "The tags are there but it's not explicit so people are bound to be curious.",
    "the scenes aren't very explicit",
    "nothing explicit so some panel are like what even is this body part supposed to be",
    "I think the mature version should actually mean more explicit.",
    "She makes it pretty explicit since the very first chapter that something is wrong",
  ])("fica na versão normal: %s", (frase) => {
    expect(mentionsExplicitSexualContent(frase)).toBe(false)
  })
})
