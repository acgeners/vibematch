/**
 * Reconcilia a inferência ESTRUTURAL da nota de Conteúdo Adulto por versão das obras mixed — a base
 * da versão padrão R15 e o piso da versão adulta de natureza sexual confirmada. A política é
 * `lib/editions/structural-inference.ts`; quem carrega e grava é
 * `server/editions/structural-inference-sync.ts`. Este script só os chama e imprime.
 *
 * 🔴 ALVO: NUVEM — GRAVA no catálogo (com `--execute`). Rodado contra o local, que é réplica
 * descartável, o trabalho é jogado fora no próximo `db:pull`.
 *
 *   # ensaio (PADRÃO): plano completo, nada gravado
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/reconciliar-inferencia-estrutural.ts
 *
 *   # aplica — só de checkout canônico (a mesma guarda do recálculo); dá para separar por versão
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/reconciliar-inferencia-estrutural.ts --execute --edicao=normal
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/reconciliar-inferencia-estrutural.ts --execute --edicao=r18
 *
 * ⚠️ US$0, nenhuma IA. Antes do `--execute`, rode `node scripts/backup-db.mjs` (o banco não tem
 * backup automático diário) — cada linha alterada guarda o estado anterior em `evidence.anterior`, mas
 * isso não substitui um backup.
 *
 * ⚠️ Depois de aplicar, o recálculo precisa rodar: a Nota Prevista e a Chance por versão só mudam nele.
 * O script marca a pendência quando grava algo.
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { assertRecalcCodeAllowed } from "@/server/recalc/code-guard"
import { reconcileStructuralInference } from "@/server/editions/structural-inference-sync"
import type { MixedEdition } from "@/lib/editions/mixed-edition"
// "nada a reconciliar" tem de sair junto do funil — ver scripts/lib/funil.mjs.
import { criarFunil } from "./lib/funil.mjs"

const EXECUTAR = process.argv.includes("--execute")
const EDICAO_ARG = process.argv.find((a) => a.startsWith("--edicao="))?.split("=")[1]
if (EDICAO_ARG && EDICAO_ARG !== "normal" && EDICAO_ARG !== "r18") {
  console.error(`--edicao deve ser "normal" ou "r18" (recebi "${EDICAO_ARG}")`)
  process.exit(2)
}
const EDICOES: MixedEdition[] | undefined = EDICAO_ARG ? [EDICAO_ARG as MixedEdition] : undefined

async function main() {
  if (EXECUTAR) assertRecalcCodeAllowed()
  const sb = createAdminClient()
  console.log(`alvo: ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "?"} · modo: ${EXECUTAR ? "EXECUÇÃO" : "ensaio (nada é gravado)"}${EDICOES ? ` · só ${EDICOES[0]}` : ""}`)

  const r = await reconcileStructuralInference(sb, { apply: EXECUTAR, editions: EDICOES })

  const porVersao = (ed: MixedEdition) => {
    const c = new Map<string, number>()
    for (const w of r.works) {
      const d = w.plan.decisions[ed]
      const chave = d.kind === "infer" ? `infer (${d.over ? `${d.over.source}${d.over.score != null ? ` ${d.over.score}` : ""}` : "sem linha"} → ${d.target.score})` : d.kind === "preserve" ? `preserve: ${d.reason}` : d.kind
      c.set(chave, (c.get(chave) ?? 0) + 1)
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }
  for (const ed of ["normal", "r18"] as MixedEdition[]) {
    console.log(`\n== versão ${ed}`)
    for (const [k, n] of porVersao(ed)) console.log(`  ${String(n).padStart(4)}  ${k}`)
  }

  const listar = (titulo: string, filtro: (w: (typeof r.works)[number]) => string | null) => {
    const linhas = r.works.map((w) => [w.workId, filtro(w)] as const).filter(([, t]) => t != null)
    console.log(`\n== ${titulo} (${linhas.length})`)
    for (const [id, t] of linhas) console.log(`  · ${id}  ${t}`)
  }
  listar("CONFLITOS — nota existente que a política não sustenta: base legada ou nota forte fora da fronteira (para a curadoria)", (w) => {
    // As duas versões: uma obra pode ter conflito nas duas, e mostrar só uma esconderia a outra.
    const motivos = (["normal", "r18"] as MixedEdition[]).flatMap((e) => {
      const d = w.plan.decisions[e]
      return d.kind === "conflict" ? [`${e}: ${d.reason}`] : []
    })
    return motivos.length > 0 ? motivos.join(" · ") : null
  })
  listar("versão adulta segue sem nota", (w) => (w.plan.decisions.r18.kind === "none" ? w.plan.decisions.r18.reason : null))
  listar("versão padrão segue sem nota", (w) => (w.plan.decisions.normal.kind === "none" ? w.plan.decisions.normal.reason : null))
  listar("RETIRADAS — inferência própria que deixou de valer", (w) => {
    const d = (["normal", "r18"] as MixedEdition[]).map((e) => w.plan.decisions[e]).find((x) => x.kind === "retract")
    return d && d.kind === "retract" ? d.reason : null
  })

  const funil = criarFunil("inferência estrutural por versão")
  funil.passo("obras no escopo", r.works.length)
  funil.passo("mixed", r.works.filter((w) => w.facts.isMixed).length)
  funil.passo("com natureza sexual confirmada", r.works.filter((w) => w.facts.isMixed && w.plan.sexualSignals.length > 0).length)
  const planejadas = r.works.filter((w) =>
    (["normal", "r18"] as MixedEdition[]).some((e) => (!EDICOES || EDICOES.includes(e)) && ["infer", "retract"].includes(w.plan.decisions[e].kind)),
  ).length
  funil.passo("com gravação planejada", planejadas)
  if (planejadas === 0) funil.nadaAFazer("nada a reconciliar.")
  funil.relatar()

  if (!EXECUTAR) {
    console.log("\nensaio: nada foi gravado. Para aplicar, --execute (e rode antes `node scripts/backup-db.mjs`).")
    return
  }
  console.log(`\ngravadas: ${r.changedWorkIds.length} obras · erros: ${r.errors.length}`)
  for (const e of r.errors) console.error(`  ✗ ${e}`)
  for (const w of r.works) for (const o of w.outcomes) if (o.action === "pulada") console.log(`  ~ ${w.workId}/${o.edition}: pulada (${o.detail})`)
  if (r.changedWorkIds.length > 0) {
    const { error } = await sb.rpc("touch_recalc_pending")
    console.log(error ? `⚠️ não marquei o recálculo pendente (${error.message}) — marque à mão` : "recálculo marcado como pendente")
  }
  if (r.errors.length > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
