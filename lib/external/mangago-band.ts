/**
 * E5 — Banding configurável do resolvedor do Mangago. Extrai a regra AUTO/
 * REVIEW/REJECT (antes fixa em `mangago-resolve.ts`) para uma função PURA
 * (`decideMangagoResolveBand`) + uma config lida de env com defaults idênticos
 * ao comportamento anterior. Nenhuma mudança de comportamento no default.
 *
 * A função pura recebe a config por parâmetro (nunca lê `process.env`), então é
 * 100% testável. A leitura de env vive em `readBandConfigFromEnv` (impura,
 * chamada 1x no carregamento do módulo do resolvedor).
 */

export type MangagoBand = "auto" | "review" | "reject"

export interface MangagoBandConfig {
  /** Score mínimo para AUTO. */
  autoMinScore: number
  /** Margem mínima (top − 2º) para AUTO. */
  autoMinMargin: number
  /** Score mínimo para NÃO rejeitar (piso de REVIEW). */
  acceptMinScore: number
  /** Se true, um match com reverse-substring risk pode virar AUTO. */
  allowReverseSubstringAuto: boolean
  /** Se true, um match com derivative risk (doujinshi/derivado) pode virar AUTO. */
  allowDerivativeAuto: boolean
}

export const DEFAULT_BAND_CONFIG: MangagoBandConfig = {
  autoMinScore: 0.9,
  autoMinMargin: 0.08,
  acceptMinScore: 0.72,
  allowReverseSubstringAuto: false,
  allowDerivativeAuto: false,
}

export interface BandDecision {
  band: MangagoBand
  /** Motivo legível (observabilidade): "auto" | "below_accept" | "score_below_auto+margin_below_auto" | … */
  reason: string
}

export function decideMangagoResolveBand(args: {
  score: number
  margin: number
  isReverseSubstringRisk: boolean
  /** E10B.6 — sinal de doujinshi/derivado; bloqueia AUTO por padrão. */
  isDerivativeRisk?: boolean
  config?: MangagoBandConfig
}): BandDecision {
  const cfg = args.config ?? DEFAULT_BAND_CONFIG
  const { score, margin, isReverseSubstringRisk } = args

  if (score < cfg.acceptMinScore) return { band: "reject", reason: "below_accept" }

  const reasons: string[] = []
  if (score < cfg.autoMinScore) reasons.push("score_below_auto")
  if (margin < cfg.autoMinMargin) reasons.push("margin_below_auto")
  if (isReverseSubstringRisk && !cfg.allowReverseSubstringAuto) reasons.push("reverse_substring_risk")
  if (args.isDerivativeRisk && !cfg.allowDerivativeAuto) reasons.push("derivative_risk")

  if (reasons.length === 0) return { band: "auto", reason: "auto" }
  return { band: "review", reason: reasons.join("+") }
}

// --- Leitura de env (impura, com defaults seguros — nunca deixa NaN entrar) ---

/** Número finito; vazio/ausente/inválido → fallback. Aceita 0 (ex.: margem 0). */
function numEnv(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** Booleano tolerante; valores fora de true/false/1/0/yes/no → fallback. */
export function boolEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback
  const v = raw.trim().toLowerCase()
  if (v === "true" || v === "1" || v === "yes") return true
  if (v === "false" || v === "0" || v === "no") return false
  return fallback
}

export function readBandConfigFromEnv(env: Record<string, string | undefined> = process.env): MangagoBandConfig {
  return {
    autoMinScore: numEnv(env.MANGAGO_RESOLVE_AUTO_MIN_SCORE, DEFAULT_BAND_CONFIG.autoMinScore),
    autoMinMargin: numEnv(env.MANGAGO_RESOLVE_AUTO_MIN_MARGIN, DEFAULT_BAND_CONFIG.autoMinMargin),
    acceptMinScore: numEnv(env.MANGAGO_RESOLVE_ACCEPT_MIN_SCORE, DEFAULT_BAND_CONFIG.acceptMinScore),
    allowReverseSubstringAuto: boolEnv(
      env.MANGAGO_RESOLVE_ALLOW_REVERSE_SUBSTRING_AUTO,
      DEFAULT_BAND_CONFIG.allowReverseSubstringAuto
    ),
    allowDerivativeAuto: boolEnv(
      env.MANGAGO_RESOLVE_ALLOW_DERIVATIVE_AUTO,
      DEFAULT_BAND_CONFIG.allowDerivativeAuto
    ),
  }
}
