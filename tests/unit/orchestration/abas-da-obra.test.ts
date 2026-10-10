import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

/**
 * A distribuição dos blocos entre as abas da página da obra (2026-08-13).
 *
 * Teste de ARQUITETURA porque a página é um server component de ~2.000 linhas que não
 * renderiza em jsdom — e o que regride aqui não é comportamento, é ENDEREÇO: alguém
 * adiciona um card na aba que estiver aberta no editor e a régua se desfaz sem nada
 * quebrar. Medido antes da mudança: a aba de Notas tinha 3.496px (3,5 telas), sendo
 * 76% dela dois blocos — "Notas por critério" (1.735px) e o card de reviews (933px).
 * Depois: 650px, com a aba nova em 2.949px.
 *
 * A régua NÃO é procedência ("gerado por IA"), é o que se faz com o conteúdo:
 *  · Visão Geral      — descreve a obra pra decidir a leitura;
 *  · Análise da IA    — a leitura da obra PELA IA (atributos, síntese, arte, deep dive);
 *  · Notas & Avaliações — os números que comparam esta obra com o catálogo.
 * Por procedência, a sinopse consolidada (escrita por modelo) teria que sair da Visão
 * Geral e o Veredito sairia de perto da Nota Prevista — os dois contra o que se quer.
 */

const RAW = readFileSync(resolve(__dirname, "../../../app/catalog/[id]/page.tsx"), "utf8")

/**
 * Sem comentários. Eles CITAM o que foi movido ("as datas saíram daqui pro painel"), e um
 * teste que os lesse acusaria a própria explicação da mudança — a 1ª versão reprovou assim.
 */
const SOURCE = RAW.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

/**
 * Onde abre cada bloco da aba — o painel (`<TabsContent … value="…">`) e os conteúdos extras
 * dela (`<TabsExtraContent … value="…">`). TODAS as ocorrências.
 *
 * ⚠️ Uma aba pode ter mais de um bloco: a linha de avisos de conteúdo da Visão Geral mora FORA
 * do AdultGate, num `TabsExtraContent` da mesma aba. A 1ª versão deste helper pegava só a
 * primeira ocorrência, e só a escrita `<TabsContent value=` na mesma linha — um bloco com o
 * `value` na linha de baixo ficava invisível pro teste.
 */
function aberturas(valor: string): Array<{ inicio: number; fecho: string }> {
  const re = new RegExp(`<(TabsContent|TabsExtraContent)\\b[^>]*\\bvalue="${valor}"`, "g")
  return [...SOURCE.matchAll(re)].map((m) => ({ inicio: m.index ?? -1, fecho: `</${m[1]}>` }))
}

function corpo({ inicio, fecho }: { inicio: number; fecho: string }): string {
  const fim = SOURCE.indexOf(fecho, inicio)
  expect(fim, `bloco em ${inicio} não fecha`).toBeGreaterThan(inicio)
  return SOURCE.slice(inicio, fim)
}

/** Recorta o corpo da aba (todas as ocorrências, concatenadas) — as abas não se aninham. */
function aba(valor: string): string {
  const blocos = aberturas(valor)
  expect(blocos.length, `aba ${valor} não existe`).toBeGreaterThan(0)
  return blocos.map(corpo).join("\n")
}

describe("abas da página da obra", () => {
  it("a aba Análise da IA existe e tem gatilho próprio", () => {
    expect(SOURCE).toContain('<TabsTrigger value="ai"')
    expect(SOURCE).toContain("Análise da IA")
    // ⚠️ Sem ✨ no gatilho: aba é NAVEGAÇÃO, e o ✨ é a marca de "um modelo escreveu isto"
    // (ou, em botão, "esta ação chama um modelo"). Ver a régua do selo no CLAUDE.md.
    const trigger = SOURCE.slice(SOURCE.indexOf('<TabsTrigger value="ai"'))
    expect(trigger.slice(0, trigger.indexOf("</TabsTrigger>"))).not.toContain("<Sparkles")
  })

  it("a leitura da obra pela IA mora na aba da IA", () => {
    const ia = aba("ai")
    // ⚠️ Casa o COMPONENTE, não a forma do laço: a versão anterior exigia
    // `CRITERION_SLUGS.map` e reprovou quando ele virou `for`, com a grade no mesmo lugar.
    expect(ia).toContain("<CriteriaGrid")
    expect(ia).toContain("<WorkReviewsCard")
    // A estimativa de arte é PILOTO e ainda não está no repositório — quando entrar, é
    // aqui que ela mora (é leitura da IA sobre as reviews, não ficha da obra). Condicional
    // pra régua valer sem depender de trabalho não commitado.
    if (SOURCE.includes("ArtEstimateCard")) expect(ia).toContain("<ArtEstimateCard")
    expect(ia).toContain("<DeepDiveButton")
    // A ação mora onde o resultado aparece: avaliar produz os 9 atributos + o resumo.
    expect(ia).toContain("<AiEvaluationButton")
  })

  it("a aba de Notas fica só com o que COMPARA com o catálogo", () => {
    const notas = aba("scores")
    expect(notas).toContain("Bússola de leitura")
    expect(notas).toContain("Notas calculadas")
    expect(notas).toContain("Avaliações externas")
    // O que saiu — cada um destes valia centenas de px na aba mais longa da página.
    expect(notas).not.toContain("<CriteriaGrid")
    expect(notas).not.toContain("<WorkReviewsCard")
    expect(notas).not.toContain("<DeepDiveButton")
    expect(notas).not.toContain("<AiEvaluationButton")
  })

  it("a Visão Geral fica com o que descreve a obra, mais o estado dela", () => {
    const geral = aba("overview")
    expect(geral).toContain("<WorkStatePanel")
    expect(geral).toContain("Sinopses")
    expect(geral).toContain("<SynopsisQualitySuggestion")
    // Estrutura de abertura responde "como a obra começa?" — decisão de leitura, junto da
    // sinopse. É IA por procedência, mas a régua das abas é a pergunta, não quem escreveu.
    expect(geral).toContain("<OpeningStructureCard")
    if (SOURCE.includes("ArtEstimateCard")) expect(geral).not.toContain("<ArtEstimateCard")
  })

  it("o resumo da avaliação abre o bloco de critérios, e não é mais card próprio", () => {
    // Medido em 400 obras: o resumo sobrepõe 4,4% do vocabulário da sinopse (não é
    // redundante com ela) e 46% do das justificativas — é o contexto das nove notas.
    const geral = aba("overview")
    expect(geral).not.toContain("Resumo da última avaliação IA")
    expect(geral).not.toContain("latestAiEval.summary")

    const ia = aba("ai")
    const criterios = ia.slice(ia.indexOf("Notas por critério"))
    expect(criterios).toContain("latestAiEval.summary")
    // Antes da grade dos 9, não depois: ele existe pra dar contexto à leitura dos números.
    expect(criterios.indexOf("latestAiEval.summary")).toBeLessThan(
      criterios.indexOf("<CriteriaGrid"),
    )
  })

  it('"Gerar tudo" continua fora da aba da IA', () => {
    // Ele não pertence a nenhum resultado — cria todos —, então mora na linha de ações do
    // topo. É a exceção da régua "a ação mora onde o resultado aparece".
    expect(aba("overview")).toContain("<GenerateAllBanner")
    expect(aba("ai")).not.toContain("<GenerateAllBanner")
  })

  it("as datas e as fontes saíram da coluna da capa", () => {
    // Três lugares pra mesma pergunta ("em que pé está esta obra?") viraram um painel.
    const antesDasAbas = SOURCE.slice(0, SOURCE.indexOf('<TabsContent value="overview"'))
    expect(antesDasAbas).not.toContain("<LinkedSources")
    expect(antesDasAbas).not.toContain("Última avaliação em")
  })

  it("os avisos de conteúdo têm uma linha compacta na Visão Geral, FORA do portão 18+", () => {
    // O aviso ajuda a decidir se vale revelar uma obra oculta: dentro do AdultGate ele sairia
    // desfocado junto com o resto. E ele não é 18+ — o 18+ é `is_adult`, que não lê o aviso.
    const portao = SOURCE.indexOf("<AdultGate")
    expect(portao).toBeGreaterThan(-1)
    const comAviso = aberturas("overview").filter((b) => corpo(b).includes("<ContentWarningsSummary"))
    expect(comAviso.length, "a linha compacta mora num bloco da aba Visão Geral").toBe(1)
    expect(comAviso[0].inicio, "e esse bloco fica ANTES do AdultGate").toBeLessThan(portao)
    // E é conteúdo EXTRA da aba, não um 2º painel (`TabsExtraContent` tira id/role do Radix).
    expect(comAviso[0].fecho).toBe("</TabsExtraContent>")

    // Mesmo dado e mesma régua do card de reviews — não uma 2ª leitura do digest.
    expect(SOURCE).toContain("displayableContentWarnings(reviewsSnapshot.digest)")
    // E os avisos continuam no card de reviews, na aba da IA (não foram movidos).
    expect(aba("ai")).toContain("<WorkReviewsCard")
  })
})
