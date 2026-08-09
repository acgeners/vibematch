import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "../../..")

/**
 * Teste de ARQUITETURA do gatilho do badge "Recalcular notas".
 *
 * `markRecalcPending` é chamado de ~30 lugares e o default é marcar. Isso é
 * correto (não marcar deixa nota velha na tela sem nada acusar), mas significa
 * que **um caller novo entra no badge sem ninguém decidir nada** — foi assim que
 * o badge passou a acender por salvar uma sinopse, por marcar "Lendo" e por ação
 * de leitor cujo estado o recalc global nem lê.
 *
 * Este teste ENUMERA os call sites a partir do source (não de uma lista escrita à
 * mão — ver [[project-testes-arquitetura-armadilhas]]) e compara com o inventário
 * abaixo. Ele falha quando um call site aparece, some ou muda de declaração. A
 * correção é sempre a mesma: decidir conscientemente se aquele caller mexe em
 * alguma entrada de `lib/calculations/recalc-inputs.ts` e atualizar o inventário.
 */

/** `true` = passa `{ changed }` e o gate pode PULAR; `false` = marca sempre. */
const INVENTARIO: Record<string, boolean> = {
  // ── Declaram materialidade (o gate pode pular) ──────────────────────────────
  updateWork: true, // o form da ficha mexe em muita coisa que não é feature
  updateWorkStatus: true, // status/capítulos/pós-leitura não movem número
  submitPostReadingAttributes: true, // entra só via attribute_bias, e só a do dono
  saveTagPreferences: true, // o recalc global lê as tags do DONO
  taste_profile_new_version: true, // idem, o perfil é lido por id explícito do dono

  // ── Marcam sempre: mexem direto em feature ou rótulo ────────────────────────
  submitAiReview: false, // as 9 notas
  "calibration-auto-apply": false,
  "calibration-accept": false,
  "calibration-edit": false,
  "calibration-revert": false,
  "calibration-bulk": false,
  "calibration-bulk-ids": false,
  "adult-content-bounds-clamp": false,
  "adult-content-retroactive-bounds": false,
  updateWorkExternalData: false, // ratings, votos, tags, capítulos, status
  applySynopsisPrediction: false, // SinopseScore
  applySynopsisPredictionBatch: false,
  setSynopsisQuality: false,
  infer_tags_ai_eval: false, // work_tags → os 3 sinais de fit
  infer_tags_ai_eval_batch: false,
  ai_inferred_tags_on_create: false,
  "reading-chapter-sync": false, // total_chapters → Cps.N
  "reading-status-sync": false, // publication_status → categórica Status
  saveQuickScore: false, // rótulo do Ridge
  clearUserRating: false,
  savePilotTaste: false,
  "external-list-import": false, // rótulos + obras novas
  createWork: false, // é assim que a obra nova ganha a 1ª Nota Prevista
  createWorksBatch: false,
}

/**
 * Contextos que JÁ NÃO PODEM voltar a marcar sem uma decisão explícita.
 * `setReadingStatusForWorks` grava `personal_status_id` + `chapters_read`, e
 * nenhuma das duas é feature nem rótulo: 100% dos disparos eram inócuos.
 */
const REMOVIDOS = ["setReadingStatusForWorks"]

interface CallSite {
  context: string
  declara: boolean
}

function callSites(): CallSite[] {
  const raw = execSync(
    `grep -rnoE 'markRecalcPending\\(\\s*"[^"]+"\\s*(,|\\))' --include='*.ts' --include='*.tsx' . ` +
      `--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=tests || true`,
    { cwd: ROOT, encoding: "utf8" },
  )
  return raw
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.includes("server/recalc/queue.ts"))
    .map((line) => {
      const m = line.match(/markRecalcPending\(\s*"([^"]+)"\s*(,|\))/)
      if (!m) throw new Error(`linha inesperada: ${line}`)
      return { context: m[1], declara: m[2] === "," }
    })
}

describe("inventário dos gatilhos de recálculo pendente", () => {
  const sites = callSites()

  it("não apareceu nem sumiu call site sem alguém decidir", () => {
    const encontrados = [...new Set(sites.map((s) => s.context))].sort()
    expect(encontrados).toEqual(Object.keys(INVENTARIO).sort())
  })

  it("cada call site declara materialidade exatamente como o inventário diz", () => {
    for (const site of sites) {
      expect(
        { context: site.context, declara: site.declara },
        `o call site "${site.context}" mudou de declaração — decida e atualize o inventário`,
      ).toEqual({ context: site.context, declara: INVENTARIO[site.context] })
    }
  })

  it("os contextos removidos não voltaram", () => {
    const encontrados = new Set(sites.map((s) => s.context))
    for (const removido of REMOVIDOS) expect(encontrados.has(removido)).toBe(false)
  })
})
