"use server"

import { spawn } from "node:child_process"
import { promises as fs, openSync, closeSync } from "node:fs"
import path from "node:path"
import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchComixById } from "@/lib/external/comix"
import { extractComixHid } from "@/lib/external/comix-hid"
import { isBlockedCoverUrl } from "@/lib/external/blocked-covers"

const CACHE_DIR = path.join(process.cwd(), ".cache")
const LOG_PATH = path.join(CACHE_DIR, "resolve-comix.log")
const STATUS_PATH = path.join(CACHE_DIR, "resolve-comix.status.json")
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
