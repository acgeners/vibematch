import { createAdminClient } from "@/lib/supabase/admin"
import { resolveComixUrl } from "@/lib/external/comix-resolve"
import { isComixRenderConfigured } from "@/lib/external/comix-render-client"

// ============================================================================
// Resolução + persistência do hid da Comix por obra (Peça 3). Fonte ÚNICA da
// lógica de persistência (reusada pelo fluxo de avaliação IA e pelo checador de
// capítulos). Ver DESIGN-COMIX-RENDER-SIDECAR.md §"Peça 3".
// ============================================================================

type Supa = ReturnType<typeof createAdminClient>

/**
 * Persiste o hid da Comix em `work_external_ids` — upsert de 1 linha
 * (`onConflict work_id,source`), NÃO-destrutivo (não toca outras fontes).
 * Fail-soft: loga e devolve `false` em erro (nunca lança). Fonte única.
 */
export async function persistComixHid(supabase: Supa, workId: string, hid: string): Promise<boolean> {
  const { error } = await supabase
    .from("work_external_ids")
    .upsert({ work_id: workId, source: "comix", external_id: hid }, { onConflict: "work_id,source" })
  if (error) {
    console.error("[persistComixHid] failed:", error.message)
    return false
  }
  return true
}

export interface EnsureComixHidParams {
  supabase: Supa
  workId: string
  title: string
  /** hid já aceito em `work_external_ids` (se houver) — reuso, sem re-resolver. */
  alreadyKnownHid: string | null
  /** Comix marcado como rejeitado pelo usuário → não resolve nem persiste. */
  comixRejected: boolean
  /** Cross-IDs ACEITOS pra desambiguação exata (o gate desta peça). */
  crossIds: { anilistId?: number; malId?: number; mangaUpdatesId?: string }
}

// Log estruturado (1 JSON/linha) — motivo da chamada/skip + desfecho.
function log(event: "skipped" | "attempt" | "result", workId: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ scope: "comix-resolve", event, workId, ...fields }))
}

/**
 * Garante o hid da Comix pra uma obra: reusa o persistido, respeita rejeição,
 * exige ≥1 cross-ID (gate), chama o sidecar via `resolveComixUrl`, persiste o
 * resultado. **Nunca lança** — qualquer falha → `null` (o Comix fica ausente e o
 * resto do pipeline segue). Emite logs estruturados do motivo e do desfecho.
 */
export async function ensureComixHid(p: EnsureComixHidParams): Promise<string | null> {
  // ---- Skips (com motivo) ----
  if (p.alreadyKnownHid) {
    log("skipped", p.workId, { reason: "already_persisted", hid: p.alreadyKnownHid })
    return p.alreadyKnownHid
  }
  if (p.comixRejected) {
    log("skipped", p.workId, { reason: "rejected" })
    return null
  }
  const presentCrossIds = (["anilistId", "malId", "mangaUpdatesId"] as const).filter((k) => p.crossIds[k])
  if (presentCrossIds.length === 0) {
    log("skipped", p.workId, { reason: "no_cross_id" })
    return null
  }
  if (!isComixRenderConfigured()) {
    log("skipped", p.workId, { reason: "sidecar_disabled" })
    return null
  }

  // ---- Resolução ----
  log("attempt", p.workId, { reason: "missing_hid_with_cross_id", crossIds: presentCrossIds })

  let outcome: "resolved" | "no_match" | "timeout" | "sidecar_unavailable" = "no_match"
  let resolved: { hid: string; url: string } | null = null
  try {
    resolved = await resolveComixUrl(
      {
        title: p.title,
        anilistId: p.crossIds.anilistId,
        malId: p.crossIds.malId,
        mangaUpdatesId: p.crossIds.mangaUpdatesId,
        allowTitleFallback: false, // gate desta peça
      },
      {
        onResult: (r) => {
          if (r.outcome === "sidecar_error") outcome = r.error === "render_timeout" ? "timeout" : "sidecar_unavailable"
          else if (r.outcome === "resolved") outcome = "resolved"
          else outcome = "no_match"
        },
      },
    )
  } catch (err) {
    // resolveComixUrl não deveria lançar; blindagem extra pra manter fail-soft.
    log("result", p.workId, { result: "sidecar_unavailable", detail: String(err).slice(0, 160) })
    return null
  }

  if (!resolved) {
    log("result", p.workId, { result: outcome })
    return null
  }

  // ---- Persistência ----
  const persisted = await persistComixHid(p.supabase, p.workId, resolved.hid)
  log("result", p.workId, {
    result: persisted ? "persisted" : "persist_failed",
    method: outcome,
    hid: resolved.hid,
    url: resolved.url,
  })
  return resolved.hid
}
