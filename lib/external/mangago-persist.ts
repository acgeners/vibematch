import { createAdminClient } from "@/lib/supabase/admin"
import { extractMangagoSlug } from "./mangago-slug"
import { mangagoWorkUrl } from "./mangago-resolve"
import { buildMangagoResolveCacheKey } from "./mangago-cache"
import type { MangagoResolved } from "./mangago-resolve"
import type { MangagoResolveInput } from "./mangago-variants"

// ============================================================================
// E9 — Resolução + persistência do slug do Mangago por obra. Espelha
// server/actions/comix-hid.ts (persistComixHid/ensureComixHid): upsert de 1
// linha em `work_external_ids` (source="mangago"), fail-soft total, log
// estruturado do motivo. SEM wire-in no fluxo principal ainda.
// ============================================================================

type Supa = ReturnType<typeof createAdminClient>

// Log estruturado (1 JSON/linha) — mesmo padrão do comix-hid.
function log(event: "skipped" | "attempt" | "result", workId: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ scope: "mangago-persist", event, workId, ...fields }))
}

// ---------------------------------------------------------------------------
// persistMangagoSlug
// ---------------------------------------------------------------------------

export interface PersistMangagoSlugParams {
  supabase: Supa
  workId: string
  slug: string
  source?: "mangago"
}

export interface PersistMangagoSlugResult {
  ok: boolean
  slug?: string
  reason?: "invalid_slug" | "db_error"
}

/**
 * Upsert de 1 linha em `work_external_ids` (`onConflict work_id,source`),
 * NÃO-destrutivo. Valida o slug com `extractMangagoSlug` (rejeita inválido /
 * URL de outro domínio SEM gravar). Fail-soft: erro do Supabase → `ok:false`,
 * nunca lança.
 */
export async function persistMangagoSlug(p: PersistMangagoSlugParams): Promise<PersistMangagoSlugResult> {
  const slug = extractMangagoSlug(p.slug)
  if (!slug) return { ok: false, reason: "invalid_slug" }
  try {
    const { error } = await p.supabase
      .from("work_external_ids")
      .upsert({ work_id: p.workId, source: p.source ?? "mangago", external_id: slug }, { onConflict: "work_id,source" })
    if (error) {
      console.error("[persistMangagoSlug] failed:", error.message)
      return { ok: false, slug, reason: "db_error" }
    }
    return { ok: true, slug }
  } catch (err) {
    console.error("[persistMangagoSlug] threw:", String(err).slice(0, 160))
    return { ok: false, slug, reason: "db_error" }
  }
}

// ---------------------------------------------------------------------------
// ensureMangagoSlug
// ---------------------------------------------------------------------------

export type EnsureMangagoReason =
  | "disabled"
  | "invalid_work_id"
  | "already_persisted"
  | "rejected"
  | "manual_slug"
  | "resolved_auto"
  | "resolved_year_confirmed"
  | "resolved_review_not_persisted"
  | "no_match"
  | "persist_error"
  | "invalid_manual_slug"

export interface EnsureMangagoResult {
  slug: string | null
  url: string | null
  /** true só quando gravou (ou já estava gravado) uma linha aceita. */
  persisted: boolean
  reason: EnsureMangagoReason
  /** Resultado bruto do resolvedor quando houve resolução (senão null). */
  resolved: MangagoResolved | null
}

export interface EnsureMangagoSlugParams {
  supabase: Supa
  workId: string
  input: MangagoResolveInput
  /** Resolvedor injetado (o caller amarra search/cache/etc.). Deve ser fail-soft. */
  resolve: (input: MangagoResolveInput) => Promise<MangagoResolved | null>
  /** Gate: sem isto true, não toca DB nem resolve. */
  enabled: boolean
  /** URL/slug colado manualmente pelo usuário (override explícito). */
  manualSlugOrUrl?: string
}

function ok(slug: string | null, reason: EnsureMangagoReason, persisted: boolean, resolved: MangagoResolved | null = null): EnsureMangagoResult {
  return { slug, url: slug ? mangagoWorkUrl(slug) : null, persisted, reason, resolved }
}

/**
 * Garante o slug do Mangago pra uma obra: respeita o gate `enabled`, reusa o
 * slug persistido (sem re-resolver), aceita override manual, senão chama o
 * `resolve` injetado e **persiste só band "auto"** (inclui `method:"year_confirmed"`,
 * que é auto confirmado por ano). `review` retorna o resultado mas NÃO persiste;
 * `null`/reject não persiste. **Nunca lança** — qualquer falha degrada fail-soft.
 */
export async function ensureMangagoSlug(p: EnsureMangagoSlugParams): Promise<EnsureMangagoResult> {
  if (p.enabled !== true) {
    log("skipped", p.workId ?? "", { reason: "disabled" })
    return ok(null, "disabled", false)
  }
  if (!p.workId || typeof p.workId !== "string" || p.workId.trim() === "") {
    log("skipped", String(p.workId), { reason: "invalid_work_id" })
    return ok(null, "invalid_work_id", false)
  }

  // ---- Override manual (precede o DB/resolve) ----
  const manual = p.manualSlugOrUrl?.trim()
  if (manual) {
    const manualSlug = extractMangagoSlug(manual)
    if (manualSlug) {
      const persisted = await persistMangagoSlug({ supabase: p.supabase, workId: p.workId, slug: manualSlug })
      const reason: EnsureMangagoReason = persisted.ok ? "manual_slug" : "persist_error"
      log("result", p.workId, { reason, slug: manualSlug })
      return ok(manualSlug, reason, persisted.ok)
    }
    // Manual inválido / outro domínio: NÃO persiste. Se não há dados p/ resolver,
    // encerra como invalid_manual_slug; senão cai pro fluxo automático.
    if (!buildMangagoResolveCacheKey(p.input)) {
      log("result", p.workId, { reason: "invalid_manual_slug" })
      return ok(null, "invalid_manual_slug", false)
    }
    log("skipped", p.workId, { reason: "invalid_manual_slug", fallthrough: true })
  }

  // ---- Reuso do persistido ----
  try {
    const { data, error } = await p.supabase
      .from("work_external_ids")
      .select("external_id, is_rejected")
      .eq("work_id", p.workId)
      .eq("source", "mangago")
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) {
      if (data.is_rejected) {
        log("skipped", p.workId, { reason: "rejected" })
        return ok(null, "rejected", false)
      }
      const known = extractMangagoSlug(String(data.external_id ?? ""))
      if (known) {
        log("skipped", p.workId, { reason: "already_persisted", slug: known })
        return ok(known, "already_persisted", true)
      }
      // slug persistido inválido → ignora e re-resolve.
    }
  } catch (err) {
    // Fail-soft: falha na leitura NÃO bloqueia — degrada pro resolvedor.
    log("result", p.workId, { reason: "db_error", detail: String(err).slice(0, 160) })
  }

  // ---- Resolução automática ----
  log("attempt", p.workId, { reason: "no_persisted_slug" })
  let resolved: MangagoResolved | null = null
  try {
    resolved = await p.resolve(p.input)
  } catch (err) {
    // resolve deveria ser fail-soft; blindagem extra.
    log("result", p.workId, { reason: "no_match", detail: String(err).slice(0, 160) })
    return ok(null, "no_match", false)
  }

  if (!resolved) {
    log("result", p.workId, { reason: "no_match" })
    return ok(null, "no_match", false)
  }

  // Persiste só band "auto" (inclui year_confirmed). review não persiste.
  if (resolved.band === "auto") {
    const persisted = await persistMangagoSlug({ supabase: p.supabase, workId: p.workId, slug: resolved.slug })
    const reason: EnsureMangagoReason = persisted.ok
      ? resolved.method === "year_confirmed"
        ? "resolved_year_confirmed"
        : "resolved_auto"
      : "persist_error"
    log("result", p.workId, { reason, slug: resolved.slug, band: resolved.band, method: resolved.method })
    return ok(resolved.slug, reason, persisted.ok, resolved)
  }

  // review (ou qualquer não-auto): devolve o resultado, mas NÃO persiste.
  log("result", p.workId, { reason: "resolved_review_not_persisted", slug: resolved.slug, band: resolved.band })
  return ok(resolved.slug, "resolved_review_not_persisted", false, resolved)
}
