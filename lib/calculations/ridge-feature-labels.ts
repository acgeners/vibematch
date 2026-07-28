import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { POST_READING_WEIGHT_LABELS } from "@/lib/constants/post-reading-criteria"
import { CRITERION_SLUGS } from "@/types/domain"

// Rótulos amigáveis pros nomes crus de feature do Ridge da Nota Prevista.
// (Espelha o mapa do painel de Calibração — mantido aqui pra ser reusado no
// /perfil sem importar de um componente de UI.)
const FEATURE_LABELS: Record<string, string> = {
  "IA(n)": "Nota da IA (combinada)",
  "Nota.M": "Média das plataformas",
  LogVotos: "Volume de votos",
  "Cps.N": "Capítulos",
  SinopseScore: "Qualidade da sinopse",
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

export interface PredictionDriver {
  /** Nome cru da feature (chave estável). */
  name: string
  /** Rótulo legível. */
  label: string
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
    .map((name, i) => ({ name, label: resolveFeatureLabel(name), coef: coefs[i] ?? 0 }))
    .filter((d) => !CRITERION_SET.has(d.name) && Math.abs(d.coef) > 1e-6)
    .sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef))
    .slice(0, limit)
}
