import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  resolveFeatureLabel,
  resolveFeatureDescription,
  topNonCriterionDrivers,
} from "@/lib/calculations/ridge-feature-labels"
import { CRITERION_SLUGS } from "@/types/domain"

/**
 * As 27 features do modelo salvo em `formula_config.expected_ridge_coefficients`, lidas da
 * réplica local em 2026-08-13. Menos os 9 critérios (filtrados por `topNonCriterionDrivers`,
 * que já aparecem nas barras da assinatura), sobram 18 elegíveis ao gráfico de drivers.
 *
 * ⚠️ Fixa aqui de propósito: o gráfico corta no top-7 e um retreino promove qualquer uma das
 * outras 11 sem ninguém decidir nada. Se a lista real mudar, este teste é o lugar de atualizar
 * — e a falha obriga alguém a escrever a explicação da feature nova.
 */
const FEATURES_DO_MODELO = [
  ...CRITERION_SLUGS,
  "IA(n)",
  "Nota.M",
  "LogVotos",
  "Cps.N",
  "SinopseScore",
  "LovedTagOverlap",
  "AvoidedTagOverlap",
  "CriterionFitScore",
  "ReleaseAge",
  "RunLength",
  "Status_Completed",
  "Status_Hiatus",
  "Status_Ongoing",
  "Origin_ja",
  "Origin_ko",
  "Origin_other",
  "Origin_unknown",
  "Origin_zh",
]

/** Os que o modelo de hoje não usa, mas que o resolvedor tem que cobrir mesmo assim. */
const FORA_DO_MODELO_HOJE = [
  "Status_Cancelled",
  "Status_Unknown",
  "ObsAdjustment",
  "MeanPostScore",
  "post_story_score",
  "post_art_visual_score",
]

/** Tira comentários de bloco e de linha — o teste checa o CÓDIGO, não a prosa sobre ele. */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

describe("rótulo da feature", () => {
  it("🔴 SinopseScore é INTERESSE, não qualidade da sinopse", () => {
    // O valor vem de `SINOPSE_MAP[input.synopsisQuality]` — a coluna `synopsis_quality`,
    // que o app inteiro chama de Interesse. O rótulo antigo sobreviveu a uma renomeação e
    // afirmava que o modelo pesa a qualidade do TEXTO da sinopse.
    expect(resolveFeatureLabel("SinopseScore")).toBe("Interesse na obra")
  })

  it("🔴 o painel de Calibração NÃO tem cópia própria do mapa", () => {
    // Duas cópias do nome da MESMA feature é a armadilha do LOW_BALANCE_USD: renomear numa
    // faz as duas telas discordarem. Guardado lendo o SOURCE — um teste que só chamasse a
    // função passaria verde com a cópia intacta no outro arquivo.
    // ⚠️ SEM os comentários: o comentário que documenta a remoção CITA o nome velho, e a
    // 1ª versão deste teste reprovou acusando a própria explicação da mudança.
    const src = semComentarios(
      readFileSync(join(process.cwd(), "components/settings/calibration-panel.tsx"), "utf8"),
    )
    expect(src).toContain("ridge-feature-labels")
    expect(src).not.toMatch(/const FEATURE_LABELS\s*:/)
    expect(src).not.toMatch(/const STATUS_FEATURE_LABELS\s*:/)
    expect(src).not.toMatch(/const ORIGIN_FEATURE_LABELS\s*:/)
    // e nenhum resquício do nome velho em lugar nenhum dos dois arquivos
    expect(src).not.toContain("Qualidade da sinopse")
  })

  it("nome desconhecido volta cru em vez de virar rótulo inventado", () => {
    expect(resolveFeatureLabel("FeatureQueNinguemPreviu")).toBe("FeatureQueNinguemPreviu")
  })
})

describe("explicação da feature", () => {
  it("🔴 TODA feature do modelo salvo tem explicação — não só as 7 do topo", () => {
    // O gráfico ordena por |coef| e corta em 7; as outras 11 entram no dia em que o modelo
    // for retreinado. Sem isto, a promoção de uma feature a leva pra tela sem explicação.
    const semExplicacao = FEATURES_DO_MODELO.filter((n) => !resolveFeatureDescription(n))
    expect(semExplicacao).toEqual([])
  })

  it("cobre também o que está fora do modelo de hoje", () => {
    const semExplicacao = FORA_DO_MODELO_HOJE.filter((n) => !resolveFeatureDescription(n))
    expect(semExplicacao).toEqual([])
  })

  it("🔴 feature sem explicação devolve null — a UI não desenha tooltip vazio", () => {
    // O null é a resposta certa, não uma lacuna: inventar texto plausível pra uma feature
    // que ninguém previu é pior do que não explicar.
    expect(resolveFeatureDescription("FeatureQueNinguemPreviu")).toBeNull()
    expect(resolveFeatureDescription("Status_InventadoAgora")).toBeNull()
    expect(resolveFeatureDescription("Origin_xx")).toBeNull()
  })

  it("Status_ e Origin_ saem de TEMPLATE, não de uma lista de nomes", () => {
    // Um status novo no Supabase precisa entrar com explicação em vez de nascer mudo —
    // por isso a família toda é coberta, não só os 3 que o modelo de hoje usa.
    for (const s of ["Completed", "Ongoing", "Hiatus", "Cancelled", "Unknown"]) {
      expect(resolveFeatureDescription(`Status_${s}`)).toBeTruthy()
    }
    for (const o of ["ko", "ja", "zh", "other", "unknown"]) {
      expect(resolveFeatureDescription(`Origin_${o}`)).toBeTruthy()
    }
  })

  it("a explicação viaja junto do driver", () => {
    const drivers = topNonCriterionDrivers(
      { featureNames: ["romance", "SinopseScore", "LogVotos"], coefficients: [9, 1, 0.5] },
      7,
    )
    // `romance` é critério ⇒ filtrado, apesar de ser o maior coeficiente
    expect(drivers.map((d) => d.name)).toEqual(["SinopseScore", "LogVotos"])
    expect(drivers[0].label).toBe("Interesse na obra")
    expect(drivers[0].description).toContain("corações")
  })
})
