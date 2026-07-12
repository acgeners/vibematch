import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SourceHealthRow } from "./types"

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
 * Lê a saúde persistida das fontes. Best-effort igual ao upsert: qualquer erro
 * (inclusive tabela ausente) vira `{}` — a seleção de fontes NUNCA pode quebrar
 * porque a telemetria falhou. Sem linha = fonte sem histórico = tratada como ok.
 */
export async function getSourcesHealth(): Promise<Record<string, SourceHealthRow>> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("external_source_health")
      .select("source, status, fail_reason, last_ok_at")
    if (error || !data) return {}
    return Object.fromEntries(
      data.map((row) => [
        row.source as string,
        {
          status: (row.status as string) ?? "unknown",
          failReason: (row.fail_reason as string | null) ?? null,
          lastOkAt: (row.last_ok_at as string | null) ?? null,
        },
      ]),
    )
  } catch {
    return {}
  }
}

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
    // `last_ok_at`/`last_fail_at` só entram no payload quando TÊM valor. No upsert do
    // PostgREST, coluna ausente fica fora do `DO UPDATE SET` — ou seja, é PRESERVADA.
    //
    // Sem isso, uma queda gravava `last_ok_at = null` e APAGAVA o último sucesso. O
    // efeito era perverso: o aviso "A fonte não respondeu" mostra "Último sucesso: X"
    // só quando a fonte está fora — exatamente o instante em que o campo acabava de
    // ser zerado. Resultado: a linha nunca aparecia, e o banco esquecia que a fonte
    // um dia funcionou (a linha do myanimelist está assim, com last_ok_at nulo).
    const row: Record<string, unknown> = {
      source,
      status: snapshot.status,
      fail_reason: snapshot.failReason,
      consecutive_fails: snapshot.consecutiveFails,
      updated_at: new Date().toISOString(),
    }
    if (snapshot.lastOkAt != null) row.last_ok_at = iso(snapshot.lastOkAt)
    if (snapshot.lastFailAt != null) row.last_fail_at = iso(snapshot.lastFailAt)

    await supabase.from("external_source_health").upsert(row, { onConflict: "source" })
  } catch {
    // Telemetria é best-effort; silêncio total (tabela pode nem existir ainda).
  }
}
