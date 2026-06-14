import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

/** Snapshot a persistir em `external_source_health` (timestamps em ms epoch). */
export interface SourceHealthSnapshot {
  status: string
  lastOkAt: number | null
  lastFailAt: number | null
  failReason: string | null
  consecutiveFails: number
}

const iso = (ms: number | null): string | null => (ms != null ? new Date(ms).toISOString() : null)

/**
 * Upsert best-effort do snapshot de saúde de uma fonte externa (migration 098).
 * Fire-and-forget: ENGOLE qualquer erro (inclusive "relation does not exist"
 * antes da migration ser aplicada) — telemetria nunca pode quebrar o scraping.
 */
export async function upsertSourceHealth(
  source: string,
  snapshot: SourceHealthSnapshot,
): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase.from("external_source_health").upsert(
      {
        source,
        status: snapshot.status,
        last_ok_at: iso(snapshot.lastOkAt),
        last_fail_at: iso(snapshot.lastFailAt),
        fail_reason: snapshot.failReason,
        consecutive_fails: snapshot.consecutiveFails,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source" },
    )
  } catch {
    // Telemetria é best-effort; silêncio total (tabela pode nem existir ainda).
  }
}
