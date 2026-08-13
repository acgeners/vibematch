import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { POST_READING_WEIGHT_LABELS } from "@/lib/constants/post-reading-criteria"
import { CRITERION_SLUGS } from "@/types/domain"

// Rótulos amigáveis pros nomes crus de feature do Ridge da Nota Prevista.
//
// 🔴 DONO ÚNICO. Este mapa já foi espelhado em `components/settings/calibration-panel.tsx`,
// byte a byte, e o comentário daqui documentava a cópia como se fosse aceitável. Não é: é a
// mesma armadilha do `LOW_BALANCE_USD` e do `STRONG_TAG_WEIGHT`. O painel de Calibração
// importa `resolveFeatureLabel` desde 2026-08-13.
const FEATURE_LABELS: Record<string, string> = {
  "IA(n)": "Nota da IA (combinada)",
  "Nota.M": "Média das plataformas",
  LogVotos: "Volume de votos",
  "Cps.N": "Capítulos",
  /**
   * 🔴 NÃO é "Qualidade da sinopse", apesar do nome da feature. O valor sai de
   * `SINOPSE_MAP[input.synopsisQuality]` (`♥=2 · ♥♥=5 · ♥♥♥=8 · ♥♥♥♥=13`) — ou seja, da
   * coluna `synopsis_quality`, que o app inteiro chama de **Interesse**. O rótulo antigo
   * sobreviveu a uma renomeação e afirmava, no gráfico mais visível da `/conta/perfil`,
   * que o modelo pesa a qualidade do TEXTO da sinopse. Ele pesa o quanto a pessoa QUIS ler.
   */
  SinopseScore: "Interesse na obra",
  LovedTagOverlap: "Tags que você amou",
  AvoidedTagOverlap: "Tags que você evita",
  CriterionFitScore: "Alinhamento de critérios",
  ReleaseAge: "Idade da obra",
  RunLength: "Duração",
  ObsAdjustment: "Ajuste de observação",
  MeanPostScore: "Nota pós-leitura (média)",
}

const STATUS_FEATURE_LABELS: Record<string, string> = {
  Ongoing: "Em andamento",
  Completed: "Completo",
  Hiatus: "Hiato",
  Cancelled: "Cancelado",
  Unknown: "Desconhecido",
}

const ORIGIN_FEATURE_LABELS: Record<string, string> = {
  ko: "Coreano (manhwa)",
  ja: "Japonês (mangá)",
  zh: "Chinês (manhua)",
  other: "Outro",
  unknown: "Desconhecido",
}

/**
 * Uma frase por feature, em segunda pessoa e sem nome de mecanismo — o gráfico é lido por
 * quem quer saber o que aquilo mede na vida dele, não como o Ridge o calcula.
 *
 * ⚠️ Cobre as 18 que PODEM aparecer, não as 7 que aparecem hoje. O gráfico ordena por
 * |coeficiente| e corta no top-7, então um retreino promove qualquer uma das outras sem
 * ninguém decidir nada. Medido em 2026-08-13 no `formula_config`: 27 features, menos os 9
 * critérios que `topNonCriterionDrivers` filtra ⇒ 18 elegíveis.
 *
 * ⚠️ `Status_*` e `Origin_*` saem de TEMPLATE, logo abaixo — status novo no banco entra com
 * explicação, em vez de nascer mudo.
 */
const FEATURE_DESCRIPTIONS: Record<string, string> = {
  "IA(n)": "A nota que a IA dá para a obra juntando os nove critérios.",
  "Nota.M": "A nota que o público dá nos sites de leitura.",
  LogVotos: "Quanta gente votou — separa obra conhecida de obra que quase ninguém leu.",
  "Cps.N": "O tamanho da obra: quantos capítulos ela tem.",
  SinopseScore: "O quanto você quis ler quando viu a sinopse — de um a quatro corações.",
  LovedTagOverlap: "Quantas tags que você ama esta obra tem.",
  AvoidedTagOverlap:
    "Quantas tags que você evita esta obra tem. É a única da lista que derruba a nota.",
  CriterionFitScore:
    "O quanto as notas da obra caem dentro das faixas que te agradam — romance na medida, drama na dose certa.",
  ReleaseAge: "Há quantos anos a obra começou a sair.",
  RunLength: "Por quantos anos a obra ficou saindo, do primeiro capítulo ao último.",
  ObsAdjustment: "O empurrãozinho que você deu na nota da obra à mão.",
  MeanPostScore: "A média das notas que você deu depois de terminar de ler.",
}

/** O que cada estado de publicação quer dizer, na 2ª metade da frase do template. */
const STATUS_FEATURE_DESCRIPTIONS: Record<string, string> = {
  Completed: "Se a obra já terminou. Diz se você tende a dar notas mais altas pras que têm fim.",
  Ongoing:
    "Se a obra ainda está saindo. Diz se você tende a gostar mais — ou menos — de acompanhar em tempo real.",
  Hiatus: "Se a obra está parada. Diz se isso costuma pesar contra na sua nota.",
  Cancelled:
    "Se a obra foi cancelada sem terminar. Diz se isso costuma pesar contra na sua nota.",
  Unknown: "Se ninguém sabe em que pé a publicação está.",
}

const ORIGIN_FEATURE_DESCRIPTIONS: Record<string, string> = {
  ko: "Se a obra é coreana. Diz se você tende a dar notas mais altas pras manhwas.",
  ja: "Se a obra é japonesa. Diz se você tende a dar notas mais altas pros mangás.",
  zh: "Se a obra é chinesa. Diz se você tende a dar notas mais altas pras manhuas.",
  other: "Se a obra vem de outro país.",
  unknown: "Se não deu pra saber de onde a obra vem.",
}

/** Resolve o nome cru de uma feature do Ridge pra um rótulo legível. */
export function resolveFeatureLabel(name: string): string {
  const criterion = CRITERIA_INFO[name as keyof typeof CRITERIA_INFO]
  if (criterion) return criterion.name
  const post = POST_READING_WEIGHT_LABELS[name as keyof typeof POST_READING_WEIGHT_LABELS]
  if (post) return `Pós-leitura: ${post}`
  if (FEATURE_LABELS[name]) return FEATURE_LABELS[name]
  if (name.startsWith("Status_")) {
    const raw = name.slice("Status_".length)
    return `Status: ${STATUS_FEATURE_LABELS[raw] ?? raw}`
  }
  if (name.startsWith("Origin_")) {
    const raw = name.slice("Origin_".length)
    return `Origem: ${ORIGIN_FEATURE_LABELS[raw] ?? raw}`
  }
  return name
}

/**
 * Explicação em uma frase, ou `null` quando a feature não tem uma.
 *
 * 🔴 O `null` é a resposta certa, não uma lacuna: sem descrição a UI não desenha tooltip nem
 * o sublinhado que o anuncia, e a linha fica muda. Inventar um texto plausível para uma
 * feature que ninguém previu é pior do que não explicar — é a mesma escolha do
 * `resolveFeatureLabel`, que devolve o nome cru em vez de adivinhar um rótulo bonito.
 */
export function resolveFeatureDescription(name: string): string | null {
  const criterion = CRITERIA_INFO[name as keyof typeof CRITERIA_INFO]
  // A rubrica completa tem dois parágrafos; num tooltip cabe a primeira frase.
  if (criterion?.description) return criterion.description.split("\n")[0]
  const post = POST_READING_WEIGHT_LABELS[name as keyof typeof POST_READING_WEIGHT_LABELS]
  if (post) return `A nota que você deu para ${post.toLowerCase()} depois de ler a obra.`
  if (FEATURE_DESCRIPTIONS[name]) return FEATURE_DESCRIPTIONS[name]
  if (name.startsWith("Status_")) {
    return STATUS_FEATURE_DESCRIPTIONS[name.slice("Status_".length)] ?? null
  }
  if (name.startsWith("Origin_")) {
    return ORIGIN_FEATURE_DESCRIPTIONS[name.slice("Origin_".length)] ?? null
  }
  return null
}

export interface PredictionDriver {
  /** Nome cru da feature (chave estável). */
  name: string
  /** Rótulo legível. */
  label: string
  /** Uma frase explicando o que a feature mede — `null` quando não há. */
  description: string | null
  /** Coeficiente do Ridge (features padronizadas → |coef| = importância; sinal = direção). */
  coef: number
}

const CRITERION_SET = new Set<string>(CRITERION_SLUGS as readonly string[])

/**
 * Top-N features da Nota Prevista por importância (|coef|), EXCLUINDO os 9
 * critérios IA — que já aparecem nas barras da Assinatura. Sinal preservado
 * (+ puxa a nota pra cima, − pra baixo).
 */
export function topNonCriterionDrivers(
  ridge: { featureNames?: string[]; coefficients?: number[] } | null | undefined,
  limit = 7,
): PredictionDriver[] {
  const names = ridge?.featureNames
  const coefs = ridge?.coefficients
  if (!names?.length || !coefs?.length) return []
  return names
    .map((name, i) => ({
      name,
      label: resolveFeatureLabel(name),
      description: resolveFeatureDescription(name),
      coef: coefs[i] ?? 0,
    }))
    .filter((d) => !CRITERION_SET.has(d.name) && Math.abs(d.coef) > 1e-6)
    .sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef))
    .slice(0, limit)
}
