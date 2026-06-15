"use server"

import { spawn } from "node:child_process"
import { promises as fs, openSync, closeSync } from "node:fs"
import path from "node:path"
import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchComixById, fetchComixReviews } from "@/lib/external/comix"
import { extractComixHid } from "@/lib/external/comix-hid"
import { isBlockedCoverUrl, recordCoverUrlResult } from "@/lib/external/blocked-covers"
import { flareSolverrHealth } from "@/lib/external/flaresolverr"
import { getComixStatus } from "@/lib/external/comix-gate"

const CACHE_DIR = path.join(process.cwd(), ".cache")
const LOG_PATH = path.join(CACHE_DIR, "resolve-comix.log")
const STATUS_PATH = path.join(CACHE_DIR, "resolve-comix.status.json")
// Log das resoluções por-obra disparadas na criação (append; não colide com o
// log/status do batch, que alimentam o painel "Resolver").
const ONCREATE_LOG_PATH = path.join(CACHE_DIR, "resolve-comix-oncreate.log")
// Acima disso (e sem pid vivo) um "running" é considerado órfão — ex.: o
// servidor Next reiniciou no meio do batch e perdeu o listener de exit.
const STALE_MS = 20 * 60_000

interface ResolverStatus {
  state: "idle" | "running" | "done" | "failed"
  startedAt?: string
  finishedAt?: string
  pid?: number
  exitCode?: number
  summary?: string
}

async function readStatus(): Promise<ResolverStatus> {
  try {
    return JSON.parse(await fs.readFile(STATUS_PATH, "utf8")) as ResolverStatus
  } catch {
    return { state: "idle" }
  }
}

async function writeStatus(s: ResolverStatus): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true })
  await fs.writeFile(STATUS_PATH, JSON.stringify(s, null, 2), "utf8")
}

function pidAlive(pid?: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function isStaleRunning(s: ResolverStatus): boolean {
  if (s.state !== "running") return false
  const started = s.startedAt ? Date.parse(s.startedAt) : 0
  return Date.now() - started > STALE_MS || !pidAlive(s.pid)
}

export async function getComixResolverStatus(): Promise<ResolverStatus & { logTail?: string }> {
  const raw = await readStatus()
  const status: ResolverStatus = isStaleRunning(raw)
    ? { ...raw, state: "failed", summary: raw.summary || "interrompido (servidor reiniciou?)" }
    : raw

  let logTail: string | undefined
  try {
    const log = await fs.readFile(LOG_PATH, "utf8")
    logTail = log.split("\n").filter(Boolean).slice(-12).join("\n")
  } catch {
    /* sem log ainda */
  }
  return { ...status, logTail }
}

/**
 * Dispara `npm run resolve-comix-hids` em background (não-await — o batch leva
 * ~10 min). O progresso vai pro log em `.cache/`; o status é lido por
 * getComixResolverStatus (polling no client). Recusa se já houver um run vivo.
 *
 * PRÉ-REQUISITO: Chrome/Chromium na máquina do servidor (CHROME_PATH). Em dev
 * (Mac) usa o Chrome do sistema; em prod precisa instalar o Chromium.
 */
export async function startComixResolver(): Promise<{ ok: boolean; error?: string }> {
  const current = await readStatus()
  if (current.state === "running" && !isStaleRunning(current)) {
    return { ok: false, error: "O resolver já está em execução." }
  }

  await fs.mkdir(CACHE_DIR, { recursive: true })
  const logFd = openSync(LOG_PATH, "w") // trunca o log anterior
  const startedAt = new Date().toISOString()

  try {
    const child = spawn("npm", ["run", "resolve-comix-hids"], {
      cwd: process.cwd(),
      env: { ...process.env, COMIX_HEADLESS: "1" },
      stdio: ["ignore", logFd, logFd],
      detached: false,
    })

    await writeStatus({ state: "running", startedAt, pid: child.pid })

    child.on("exit", (code) => {
      void (async () => {
        let summary = ""
        try {
          const log = await fs.readFile(LOG_PATH, "utf8")
          summary = log.match(/Fim\.\s*(matched=\d+\s+noMatch=\d+\s+error=\d+)/)?.[1] ?? ""
        } catch {
          /* ignore */
        }
        await writeStatus({
          state: code === 0 ? "done" : "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode: code ?? undefined,
          summary,
        }).catch(() => {})
      })()
    })

    child.on("error", (err) => {
      void writeStatus({
        state: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        summary: err.message,
      }).catch(() => {})
    })

    return { ok: true }
  } finally {
    closeSync(logFd) // o filho herdou a própria cópia do fd
  }
}

/**
 * Resolve o hid da Comix de UMA obra (recém-criada) em background, escopando o
 * batch script com `--work <id>`. Spawn detached, não-await: a busca exige um
 * browser real (Puppeteer) pra gerar o token `_=` da Comix, então roda fora do
 * caminho da requisição. A obra que já tiver hid é pulada pelo próprio script.
 *
 * PRÉ-REQUISITO: Chrome/Chromium na máquina (CHROME_PATH) — ok em dev. O pé
 * prod-safe (GitHub Action com Chrome) entra no deploy (II.A fase 5); por isso
 * NÃO há fallback aqui, só o caminho dev. Best-effort: falha de spawn só loga.
 */
/**
 * Status observado do Comix (ComixGate, in-memory) — exposto como action pra o
 * cliente (ex.: toast por lote na avaliação). Leitura passiva, sem rede.
 */
export async function getComixHealthStatus() {
  return getComixStatus()
}

/**
 * Status leve da resolução do Comix de uma obra (pro watcher da página atualizar
 * sozinha quando o resolver de background termina). `resolved` = a obra já tem um
 * hid do Comix aceito.
 */
export async function getComixResolutionStatus(workId: string): Promise<{ resolved: boolean }> {
  if (!workId) return { resolved: false }
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("work_external_ids")
    .select("external_id")
    .eq("work_id", workId)
    .eq("source", "comix")
    .eq("is_rejected", false)
    .maybeSingle()
  return { resolved: Boolean(data?.external_id) }
}

/**
 * Roda o script resolver e RESOLVE quando o filho fecha (em vez de fire-and-forget).
 * Awaitar mantém o `after()` vivo até o fim (~60s, Chrome+Cloudflare) sem o filho
 * ser morto pelo ciclo do request — e ainda permite enriquecer/recalcular depois.
 * Retorna o exit code (-1 = falha de spawn).
 */
async function runResolverScript(extraArgs: string[]): Promise<number> {
  await fs.mkdir(CACHE_DIR, { recursive: true })
  const logFd = openSync(ONCREATE_LOG_PATH, "a") // append — acumula entre criações
  try {
    return await new Promise<number>((resolve) => {
      // --variants 12: vale gastar mais buscas pra tentar as alt-titles em inglês —
      // webtoons coreanos têm o título do Comix (ex.: "The Sorcerers") só lá no meio
      // das alternativas, fora do default 2. early-break em ≥0.95 corta cedo.
      const child = spawn(
        "npm",
        ["run", "resolve-comix-hids", "--", ...extraArgs, "--variants", "12"],
        {
          cwd: process.cwd(),
          env: { ...process.env, COMIX_HEADLESS: "1" },
          stdio: ["ignore", logFd, logFd],
        },
      )
      child.on("error", (err) => {
        console.error("[runResolverScript] spawn error:", err.message)
        resolve(-1)
      })
      child.on("close", (code) => resolve(code ?? 0))
    })
  } finally {
    closeSync(logFd)
  }
}

/**
 * Após o hid estar resolvido, busca o detalhe do Comix (via FlareSolverr — vale em
 * prod, é só o detalhe-por-hid) e grava:
 *  - **rating/votos** em `platform_ratings` (a média bayesiana `platform_avg` é
 *    recalculada do `platform_ratings` em todo recalc e NÃO filtra por fonte, então o
 *    Comix passa a pesar na nota);
 *  - **sinopse** em `work_synopses` (fonte `comix`) e **capa** em `work_covers` (fonte
 *    `comix`) — espelhando o que a colagem manual traz, mas de forma NÃO-DESTRUTIVA:
 *    só adiciona se ainda não houver linha da fonte `comix`, sempre como secundária
 *    (`is_primary=false`) no fim da lista; nunca sobrescreve o que o usuário escolheu.
 *    A capa só entra se o host do Comix não estiver bloqueado no momento (mesma regra
 *    do `validateComixHid`).
 * Retorna `true` quando o **rating** mudou (→ o caller recalcula a nota). Sinopse/capa
 * são efeitos colaterais de display e não exigem recalc. No-op se não há hid/detalhe.
 */
async function enrichComixDataForWork(workId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("work_external_ids")
    .select("external_id")
    .eq("work_id", workId)
    .eq("source", "comix")
    .eq("is_rejected", false)
    .maybeSingle()
  const hid = data?.external_id
  if (!hid) return false
  const detail = await fetchComixById(hid)
  if (!detail) return false

  let ratingChanged = false

  // 1. Rating/votos → platform_ratings (alimenta a bayesiana).
  const rating = detail.rating
  if (rating != null && rating >= 0 && rating <= 10) {
    const { error } = await supabase.from("platform_ratings").upsert(
      { work_id: workId, platform: "comix", rating, vote_count: detail.votes ?? 0 },
      { onConflict: "work_id,platform" },
    )
    if (error) console.error("[enrichComixDataForWork] rating upsert falhou:", error.message)
    else ratingChanged = true
  }

  // 2. Sinopse do Comix → work_synopses (não-destrutivo: só se ainda não houver fonte comix).
  const synopsis = detail.synopsis?.trim()
  if (synopsis) {
    const { data: synRows } = await supabase
      .from("work_synopses")
      .select("source, position")
      .eq("work_id", workId)
    const hasComix = (synRows ?? []).some((r) => r.source === "comix")
    if (!hasComix) {
      const nextPos = Math.max(-1, ...(synRows ?? []).map((r) => r.position ?? 0)) + 1
      const { error } = await supabase
        .from("work_synopses")
        .insert({ work_id: workId, source: "comix", text: synopsis, is_primary: false, position: nextPos })
      if (error) console.error("[enrichComixDataForWork] synopsis insert falhou:", error.message)
    }
  }

  // 3. Capa do Comix → work_covers (mesma regra; só se a capa não estiver bloqueada).
  const coverUrl = detail.coverUrl && !isBlockedCoverUrl(detail.coverUrl) ? detail.coverUrl : null
  if (coverUrl) {
    const { data: coverRows } = await supabase
      .from("work_covers")
      .select("source, position")
      .eq("work_id", workId)
    const hasComix = (coverRows ?? []).some((r) => r.source === "comix")
    if (!hasComix) {
      const nextPos = Math.max(-1, ...(coverRows ?? []).map((r) => r.position ?? 0)) + 1
      const { error } = await supabase
        .from("work_covers")
        .insert({ work_id: workId, source: "comix", url: coverUrl, is_primary: false, position: nextPos })
      if (error) console.error("[enrichComixDataForWork] cover insert falhou:", error.message)
    }
  }

  return ratingChanged
}

export async function resolveComixHidForWork(workId: string): Promise<void> {
  if (!workId) return
  console.log(`[resolveComixHidForWork] disparado para work ${workId}`)
  try {
    const code = await runResolverScript(["--work", workId])
    if (code !== 0) return
    // Achou o hid → grava rating/sinopse/capa do Comix; recalcula só se o rating mudou
    // (pra a bayesiana e a Nota Prevista refletirem a fonte). A sinopse/capa entram como
    // fonte secundária e aparecem no próximo refresh da página (watcher).
    const wrote = await enrichComixDataForWork(workId)
    if (wrote) {
      const { recalculateWork } = await import("@/server/actions/calculations")
      await recalculateWork(workId)
    }
  } catch (err) {
    console.error("[resolveComixHidForWork] falha:", err instanceof Error ? err.message : err)
  }
}

/**
 * Resolução "mop-up" pós-lote: dispara UM run do resolver SEM `--work`, que mira
 * todas as obras ainda sem comix id (após um lote, são exatamente as recém-criadas
 * — o resto do catálogo já está resolvido). Um único processo evita o conflito de
 * `userDataDir` do Chrome que N spawns `--work` concorrentes causariam.
 */
export async function resolveComixHidsPending(workIds?: string[]): Promise<void> {
  console.log("[resolveComixHidsPending] disparado (mop-up pós-lote)")
  try {
    const code = await runResolverScript([])
    if (code !== 0) return
    // Enriquece rating/sinopse/capa do Comix das obras do lote (as recém-criadas são as
    // que o mop-up acabou de resolver) e recalcula só as que ganharam rating.
    for (const id of workIds ?? []) {
      const wrote = await enrichComixDataForWork(id)
      if (wrote) {
        const { recalculateWork } = await import("@/server/actions/calculations")
        await recalculateWork(id)
      }
    }
  } catch (err) {
    console.error("[resolveComixHidsPending] falha:", err instanceof Error ? err.message : err)
  }
}

/**
 * Preenchimento manual do hid da Comix pra uma obra. Aceita hid cru ou URL,
 * VALIDA via fetchComixById (SSR token-free — não precisa de browser) e só
 * então persiste em work_external_ids. Retorna o título resolvido pra confirmar.
 */
interface ComixManualResult {
  ok: boolean
  hid?: string
  title?: string
  coverUrl?: string | null
  year?: number | null
  chapters?: number | null
  synopsis?: string | null
  error?: string
}

/**
 * Valida um hid/URL da Comix via SSR token-free (sem gravar nada) e devolve o
 * detalhe resolvido. Usado tanto pela criação de obra (onde ainda não há workId)
 * quanto como base do setComixHidManually.
 */
export async function validateComixHid(hidOrUrl: string): Promise<ComixManualResult> {
  const hid = extractComixHid(hidOrUrl)
  if (!hid) return { ok: false, error: "Não consegui extrair um hid válido (cole o hid ou a URL da comix.to)." }

  const detail = await fetchComixById(hid)
  if (!detail || !detail.title) {
    return { ok: false, error: `O hid "${hid}" não resolve na Comix. Confira o hid/URL.` }
  }

  // Cover da comix (static.comix.to) é bloqueada por Cloudflare — devolve null
  // pra UI não tentar carregar uma imagem quebrada.
  const coverUrl = detail.coverUrl && !isBlockedCoverUrl(detail.coverUrl) ? detail.coverUrl : null
  return {
    ok: true,
    hid,
    title: detail.title,
    coverUrl,
    year: detail.year ?? null,
    chapters: detail.chapters ?? null,
    synopsis: detail.synopsis ?? null,
  }
}

// Hid canário pra o diagnóstico: obra antiga/estável e popular na Comix ("Jinx"),
// que existe e tem comentários. Não depende de nenhuma obra do catálogo do usuário.
const COMIX_CANARY_HID = "003kd"

// Tipos NÃO exportados: arquivo "use server" só pode exportar funções async. O client
// deriva o shape via `Awaited<ReturnType<typeof checkComixHealth>>` (mesmo padrão de
// getComixResolverStatus em resolve-comix-panel).
interface ComixHealthCheck {
  ok: boolean
  /** Nome curto da superfície testada (ex.: "FlareSolverr", "Detalhe (SSR)"). */
  label: string
  /** Detalhe legível do resultado (versão, título resolvido, status HTTP…). */
  detail: string
  /** Latência da chamada em ms (omitido p/ checks que não fazem rede pesada). */
  ms?: number
}

interface ComixHealthResult {
  checks: ComixHealthCheck[]
  checkedAt: string
}

/**
 * Diagnóstico da Comix SEM precisar testar numa obra: roda um canário (hid fixo) por
 * todas as superfícies que a app usa — FlareSolverr (dependência), detalhe (SSR solve),
 * reviews (cadeia de threads) e imagem (CDN static.comix.to). A 1ª chamada paga o solve
 * frio do Cloudflare (~11s) e aquece a sessão `comix`; as seguintes ficam rápidas.
 * Se o FlareSolverr estiver fora, pula detalhe/reviews (falhariam) e retorna rápido.
 */
export async function checkComixHealth(): Promise<ComixHealthResult> {
  const checks: ComixHealthCheck[] = []
  const checkedAt = new Date().toISOString()

  // 1. FlareSolverr — dependência de tudo (toda call da Comix passa por ele agora).
  const fs = await flareSolverrHealth()
  checks.push({
    ok: fs.ok,
    label: "FlareSolverr",
    detail: fs.ok
      ? `v${fs.version ?? "?"} · sessões: ${fs.sessions?.length ? fs.sessions.join(", ") : "nenhuma"}`
      : (fs.error ?? "indisponível"),
  })

  // FlareSolverr fora → detalhe/reviews falhariam (e demorariam ~25s cada no abort).
  // Pula pra dar um diagnóstico rápido e claro.
  if (!fs.ok) {
    checks.push({ ok: false, label: "Detalhe (SSR)", detail: "pulado — FlareSolverr fora" })
    checks.push({ ok: false, label: "Reviews (threads)", detail: "pulado — FlareSolverr fora" })
    checks.push({ ok: false, label: "Imagem (CDN)", detail: "não testado — depende do detalhe" })
    return { checks, checkedAt }
  }

  // 2. Detalhe (SSR solve) — porta de entrada de tudo (reviews também começam por aqui).
  const t1 = Date.now()
  const detail = await fetchComixById(COMIX_CANARY_HID)
  checks.push({
    ok: !!detail?.title,
    label: "Detalhe (SSR)",
    detail: detail?.title
      ? `"${detail.title}"${detail.year ? ` (${detail.year})` : ""}`
      : `canário ${COMIX_CANARY_HID} não resolveu`,
    ms: Date.now() - t1,
  })

  // 3. Reviews (cadeia de threads) — endpoints /threads/* (CF-gated desde 2026-06-12).
  const t2 = Date.now()
  const reviews = await fetchComixReviews(COMIX_CANARY_HID)
  checks.push({
    ok: reviews.length > 0,
    label: "Reviews (threads)",
    detail: reviews.length > 0
      ? `${reviews.length} comentários do canário`
      : "0 — cadeia de threads falhou (ou canário sem comentários)",
    ms: Date.now() - t2,
  })

  // 4. Imagem (CDN static.comix.to) — host próprio, fora do FlareSolverr. Testa o
  // cover do detalhe direto; 403 = CF re-bloqueou (app usa fallback cross-source).
  const coverUrl = detail?.coverUrl ?? null
  if (!coverUrl) {
    checks.push({ ok: false, label: "Imagem (CDN)", detail: "sem cover no detalhe pra testar" })
  } else {
    const t3 = Date.now()
    let ok = false
    let info = ""
    try {
      const res = await fetch(coverUrl, { cache: "no-store", signal: AbortSignal.timeout(8000) })
      void res.body?.cancel() // não baixa a imagem; só os headers interessam
      const ct = res.headers.get("content-type") ?? ""
      ok = res.ok && ct.startsWith("image/")
      info = ok ? `200 ${ct}` : `${res.status} (bloqueado — usa fallback cross-source)`
    } catch (err) {
      info = err instanceof Error ? err.message : String(err)
    }
    // Alimenta o bloqueio dinâmico de covers: o canário é o re-probe manual que
    // libera/re-bloqueia o host (ex.: static.comix.to) a partir do 200 real.
    recordCoverUrlResult(coverUrl, ok)
    checks.push({ ok, label: "Imagem (CDN)", detail: info, ms: Date.now() - t3 })
  }

  return { checks, checkedAt }
}

export async function setComixHidManually(input: {
  workId: string
  hidOrUrl: string
}): Promise<ComixManualResult> {
  const validated = await validateComixHid(input.hidOrUrl)
  if (!validated.ok || !validated.hid) return validated

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("work_external_ids")
    .upsert(
      { work_id: input.workId, source: "comix", external_id: validated.hid, is_rejected: false },
      { onConflict: "work_id,source" },
    )
  if (error) return { ok: false, error: error.message }

  revalidatePath("/settings")
  revalidatePath("/titles")
  return validated
}
