import "server-only"
import { decideRecalcCloudRun, normalizeOverride, probeGit } from "@/lib/ai/code-provenance"
import type { CodeGateDecision } from "@/lib/ai/code-provenance"
import { isLocalSupabaseUrl } from "@/lib/db-target"

/**
 * GUARDA DE CÓDIGO CANÔNICO DO RECÁLCULO — fora do Fly e com o banco na NUVEM, o recálculo só roda
 * a partir de checkout limpo contido em `origin/main` (a regra é a das chamadas pagas, em
 * `lib/ai/code-provenance.ts`).
 *
 * Por que só o recálculo, e não toda escrita na nuvem: a curadoria por obra ("Atualizar dados",
 * edição, vínculos) é intencional, tem uma pessoa decidindo e alcança uma obra. O recálculo regrava
 * os scores do CATÁLOGO INTEIRO e dispara sozinho — basta abrir uma página com pendência há ≥1h —,
 * então um `npm run dev` numa branch experimental o rodaria sem ninguém pedir.
 *
 * Recusado, nada é calculado nem gravado e `recalc_pending` continua de pé (quem o zera é o próprio
 * recálculo, ao terminar): o trabalho fica para um runtime canônico.
 */

/**
 * Override DELIBERADO, só deste guard. 🔴 `PAID_CLOUD_NONCANONICAL_REASON` NÃO o substitui (nem
 * o contrário): autorizar um experimento pago não autoriza regravar o catálogo.
 */
export const RECALC_OVERRIDE_ENV = "RECALC_CLOUD_NONCANONICAL_REASON"

/** Recálculo recusado ANTES de ler o catálogo (nada foi calculado nem gravado). */
export class RecalcBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RecalcBlockedError"
  }
}

/** O que vai em `payload.code` do job `recalculate_scores`. `null` = não determinado, nunca chute. */
export type RecalcCodeProvenance = {
  runtime: "fly" | "local"
  target: "cloud" | "local"
  basis: "fly" | "local_db" | "canonical" | "override" | "blocked"
  sha: string | null
  branch: string | null
  dirty: boolean | null
  in_origin_main: boolean | null
  canonical: boolean | null
  override_used: boolean
  /** Só quando o override foi de fato usado. */
  override_reason?: string
  git_error?: string
}

export type RecalcCodeCheck =
  | { allow: true; provenance: RecalcCodeProvenance }
  | { allow: false; message: string; provenance: RecalcCodeProvenance }

/** A decisão para ESTE processo, sem lançar. O git só é lido fora do Fly (lá não há checkout). */
export function checkRecalcCode(): RecalcCodeCheck {
  const onFly = Boolean(process.env.FLY_APP_NAME)
  const decision = decideRecalcCloudRun({
    onFly,
    localDb: isLocalSupabaseUrl(),
    git: onFly ? null : probeGit(),
    override: normalizeOverride(process.env[RECALC_OVERRIDE_ENV]),
  })
  const provenance = toJobProvenance(decision)
  return decision.allow ? { allow: true, provenance } : { allow: false, message: decision.message, provenance }
}

/**
 * Preflight dos dois caminhos que gravam scoring (`recalculateAll` e `recalculateForUser`), ANTES de
 * qualquer leitura. Lança `RecalcBlockedError`; com override, avisa e segue.
 */
export function assertRecalcCodeAllowed(): RecalcCodeProvenance {
  const check = checkRecalcCode()
  if (!check.allow) throw new RecalcBlockedError(check.message)
  const p = check.provenance
  if (p.override_used) {
    console.warn(
      `[recalc-guard] recálculo NÃO CANÔNICO liberado por ${RECALC_OVERRIDE_ENV} ("${p.override_reason}") — ` +
        `${p.branch ?? "(detached)"} @ ${p.sha?.slice(0, 7) ?? "?"} · dirty=${p.dirty} · in_origin_main=${p.in_origin_main}`,
    )
  }
  return p
}

function toJobProvenance(decision: CodeGateDecision): RecalcCodeProvenance {
  const p = decision.provenance
  const overrideUsed = decision.allow && decision.basis === "override"
  const out: RecalcCodeProvenance = {
    runtime: p.runtime,
    target: p.target,
    basis: decision.allow ? decision.basis : "blocked",
    sha: p.sha,
    branch: p.branch,
    dirty: p.dirty,
    in_origin_main: p.in_origin_main,
    canonical: p.canonical,
    override_used: overrideUsed,
  }
  if (overrideUsed && p.override_reason) out.override_reason = p.override_reason
  if (p.git_error) out.git_error = p.git_error
  return out
}
