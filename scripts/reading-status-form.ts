/**
 * ⚠️ SUPERSEDED (2026-06-20) — NÃO é gate do pilot-2. A classificação de leitura passou a ser
 * AUTOMÁTICA via `npm run reading-status:auto` (deriva de `works.personal_status_id`). Este
 * formulário manual fica preservado como ferramenta histórica; não regenerar o HTML já gerado.
 *
 * CLI — gera o FORMULÁRIO OFFLINE de status de leitura do pilot-1 (Plano 3 Fase B2.2D,
 * Parte B). READ-ONLY: lê o snapshot base-1 (verifica a assinatura) + `SELECT` em `works`
 * (personal_status/chapters/last_read). NÃO escreve no banco, NÃO toca nos labels
 * contextuais, NÃO chama LLM, NÃO gera custo.
 *
 * Casca fina sobre `lib/synopsis-interest/reading-status-form` (lógica pura/testada).
 *
 * PROTEÇÃO: por padrão NÃO sobrescreve um formulário existente — aborta com mensagem
 * clara. Regeneração exige `--force` ou `--out=<outro caminho>`.
 *
 * Uso:
 *   npm run reading-status:form
 *   npm run reading-status:form -- --out=<caminho.html>
 *   npm run reading-status:form -- --force        # sobrescreve (explícito)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import {
  buildReadingStatusFormHtml,
  assertReadingStatusFormOffline,
  guardFormOutput,
  type ReadingStatusFormWork,
} from "@/lib/synopsis-interest/reading-status-form"
import { suggestReadingStatusFromDb } from "@/lib/synopsis-interest/reading-status-audit"

const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex")

const BASE = ".local-experiments/plan3/digest-exp-1/base-1/golden-snapshot-base.json"
const OUT_DIR = ".local-experiments/plan3/digest-exp-1/pilot-1-audit"
const EXPECTED_BASE_SIG_PREFIX = "634571c2"

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/)
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "true"]
  }),
) as Record<string, string>
const force = args.force === "true"
const outHtml = resolve(args.out ? args.out : `${OUT_DIR}/pilot-1-reading-status-form.html`)

interface BaseWork {
  workId: string
  title: string
}

async function main(): Promise<void> {
  // Proteção ANTES de qualquer acesso ao banco: não sobrescrever silenciosamente.
  const guard = guardFormOutput({ outputExists: existsSync(outHtml), force })
  if (!guard.allowed) {
    console.error(`⛔ ${guard.reason}`)
    console.error(`   caminho:      ${outHtml}`)
    console.error(`   sha256 atual: ${sha256Hex(readFileSync(outHtml, "utf8")).slice(0, 16)}… (PRESERVADO)`)
    process.exit(2)
  }

  const snap = JSON.parse(readFileSync(resolve(BASE), "utf8")) as {
    snapshotBaseSignature: string
    works: BaseWork[]
  }
  if (!String(snap.snapshotBaseSignature ?? "").startsWith(EXPECTED_BASE_SIG_PREFIX)) {
    throw new Error(`assinatura base-1 inesperada (esperado ${EXPECTED_BASE_SIG_PREFIX}…): ${snap.snapshotBaseSignature}`)
  }
  const works = snap.works
  const ids = works.map((w) => w.workId)

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const { data, error } = await sb
    .from("works")
    .select("id, personal_status_id, chapters_read, total_chapters, last_read_at")
    .in("id", ids)
  if (error) throw error
  const byId = new Map((data ?? []).map((r) => [r.id as string, r]))
  if (byId.size !== ids.length) {
    console.warn(`AVISO: ${ids.length - byId.size} work_id(s) não encontrados no banco (form mostrará '—').`)
  }

  const formWorks: ReadingStatusFormWork[] = works
    .map((w) => {
      const r = (byId.get(w.workId) ?? {}) as {
        personal_status_id?: number
        chapters_read?: number | null
        total_chapters?: number | null
        last_read_at?: string | null
      }
      const personalStatus = PERSONAL_STATUSES_BY_ID[r.personal_status_id ?? -1]?.status ?? `id:${r.personal_status_id ?? "null"}`
      const chaptersRead = typeof r.chapters_read === "number" ? r.chapters_read : null
      return {
        workId: w.workId,
        title: w.title,
        personalStatus,
        chaptersRead,
        totalChapters: typeof r.total_chapters === "number" ? r.total_chapters : null,
        lastReadAt: r.last_read_at ? String(r.last_read_at).slice(0, 10) : null,
        dbSuggested: suggestReadingStatusFromDb({ personalStatus, chaptersRead }),
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title))

  const html = buildReadingStatusFormHtml(formWorks, { goldenVersion: "pilot-1", baseSnapshotVersion: "base-1" })
  const check = assertReadingStatusFormOffline(html, { expectedCount: works.length })
  if (!check.ok) throw new Error("formulário NÃO passou na asserção offline: " + check.issues.join("; "))

  writeFileSync(outHtml, html)
  console.log(`✅ formulário gerado: ${outHtml}${force ? " (--force)" : ""}`)
  console.log(`   obras: ${formWorks.length} | sha256(html): ${sha256Hex(html).slice(0, 16)}…`)

  // Distribuição do SEED (eixo de leitura — NÃO são labels de interesse).
  const seed = formWorks.reduce<Record<string, number>>((a, w) => ((a[w.dbSuggested] = (a[w.dbSuggested] ?? 0) + 1), a), {})
  console.log("   seed do banco (sugestão, não autoritativa):", seed)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
