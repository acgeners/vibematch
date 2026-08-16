import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { attributeArtSrc, buildGlossary } from "@/lib/criteria/glossary"
import { GLOSSARY_NOTES } from "@/lib/criteria/glossary-notes"
import { CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import { bandForScore } from "@/lib/criteria/justification"
import { CRITERION_SLUGS } from "@/types/domain"

const RAIZ = process.cwd()
const TAMANHOS = [480, 160, 64] as const

/**
 * O dicionário DERIVA do banco (`criteria` → sync-constants), então a defesa não é conferir
 * o texto — é garantir que critério novo não entre na página pela metade. Sem isto ele
 * renderiza um verbete vazio ou com a arte quebrada, que é falha silenciosa: a página abre,
 * o `tsc` passa, e só quem rolar até lá descobre.
 */
describe("dicionário dos atributos", () => {
  const entries = buildGlossary()

  it("tem um verbete para cada critério, na ordem canônica", () => {
    expect(entries.map((e) => e.slug)).toEqual([...CRITERION_SLUGS])
  })

  it.each(CRITERION_SLUGS)("%s tem nome, descrição e as 4 faixas", (slug) => {
    const entry = entries.find((e) => e.slug === slug)
    expect(entry, `sem verbete para ${slug}`).toBeDefined()
    expect(entry!.name.length, `${slug} sem nome`).toBeGreaterThan(0)
    expect(entry!.description.length, `${slug} sem descrição`).toBeGreaterThan(20)
    // A rubrica do banco tem 4 faixas nos 9 critérios; se um vier com menos, a página
    // desenharia uma escala incompleta sem nada acusar.
    expect(entry!.bands, `${slug} não tem 4 faixas parseadas`).toHaveLength(4)
    for (const band of entry!.bands) {
      expect(band.label.length, `${slug} ${band.band} sem rótulo`).toBeGreaterThan(0)
      expect(band.text.length, `${slug} ${band.band} sem definição`).toBeGreaterThan(20)
    }
  })

  it.each(CRITERION_SLUGS)("%s tem as três artes preparadas em public/", (slug) => {
    for (const tamanho of TAMANHOS) {
      const src = attributeArtSrc(slug, tamanho)
      const arquivo = join(RAIZ, "public", src.replace(/^\//, ""))
      expect(
        existsSync(arquivo),
        `falta ${src} — rode: node scripts/preparar-artes-atributos.mjs`
      ).toBe(true)
    }
  })

  it("as artes são WebP de verdade, não PNG renomeado", () => {
    // O Chromium devolve PNG em silêncio quando não codifica o formato pedido, e o script
    // grava com extensão .webp mesmo assim. Os 4 primeiros bytes denunciam.
    for (const slug of CRITERION_SLUGS) {
      const arquivo = join(RAIZ, "public", attributeArtSrc(slug, 480).replace(/^\//, ""))
      if (!existsSync(arquivo)) continue
      const cabecalho = readFileSync(arquivo).subarray(0, 4).toString("ascii")
      expect(cabecalho, `${slug}-480.webp não começa com RIFF`).toBe("RIFF")
    }
  })

  it("a cobertura impressa bate com o bin que a nota de fato cai em", () => {
    // O rótulo "7-8" não cobre 8,5, mas o BIN cobre — é o erro que a página existe para
    // não repetir. Cada faixa é conferida contra `bandForScore`, o dono da regra.
    for (const entry of entries) {
      for (const band of entry.bands) {
        const [inicio, fim] = band.covers.split("–").map((n) => Number(n.replace(",", ".")))
        expect(bandForScore(inicio), `${entry.slug}: ${inicio} deveria cair em ${band.band}`).toBe(band.band)
        expect(bandForScore(fim), `${entry.slug}: ${fim} deveria cair em ${band.band}`).toBe(band.band)
        // meio ponto logo abaixo do fim declarado — o caso que o rótulo esconde
        const meio = fim - 0.5
        if (meio > inicio) {
          expect(bandForScore(meio), `${entry.slug}: ${meio} deveria cair em ${band.band}`).toBe(band.band)
        }
      }
    }
  })

  it("nenhuma nota fica órfã de um slug que não existe mais", () => {
    // Rename de critério deixaria a nota viva no arquivo e invisível na tela — o mesmo
    // efeito de não ter escrito nota nenhuma, sem nada acusar.
    for (const slug of Object.keys(GLOSSARY_NOTES)) {
      expect(CRITERION_SLUGS as readonly string[], `nota órfã: ${slug}`).toContain(slug)
    }
  })

  it("cada faixa da rubrica ainda declara o rótulo com |", () => {
    // O parser depende do formato "0-3 | Rótulo: definição". Se o banco mudar a forma, a
    // página perde os rótulos em silêncio — aqui isso vira falha.
    for (const slug of CRITERION_SLUGS) {
      for (const range of CRITERIA_RUBRICS[slug]?.ranges ?? []) {
        expect(range, `${slug}: faixa sem "|"`).toContain("|")
        expect(range, `${slug}: faixa sem ":"`).toContain(":")
      }
    }
  })
})
