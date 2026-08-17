/**
 * Piloto da AUDITORIA de critérios — roda o prompt vivo numa amostra e imprime o que ele
 * proporia, sem gravar sugestão nenhuma.
 *
 * ALVO: NUVEM — a única escrita é o log de custo em `ai_api_calls`, que é o que torna a
 * medição de custo real em vez de estimada. **Não grava em `score_calibration_suggestions`
 * nem em `category_scores`.**
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/pilot-audit.ts --list
 *   ... scripts/pilot-audit.ts --execute [--n=30]
 *
 * 🔴 O QUE ESTE PILOTO PRECISA RESPONDER, e é diferente das outras medições do repo: não é
 * "a nota mudou no rumo pretendido" (isso é consistência, e o gold já mostrou que rumo certo
 * convive com estar mais longe da curadora). É **a sugestão de maior confiança está certa?**
 * A régua de hoje é 0 de 2 — as duas únicas sugestões que alcançaram 0,85 foram julgadas
 * erradas. Qualquer coisa acima disso precisa vir de julgamento humano, não de contagem.
 *
 * ⚠️ Por isso a saída é feita pra ser JULGADA, não somada: as sugestões saem ordenadas por
 * confiança, com o consenso das reviews ao lado, pra dar pra dizer "esta procede" olhando a
 * mesma evidência que o modelo viu. Contar quantas mudaram de faixa mediria outra coisa.
 *
 * ⚠️ A amostra é ALEATÓRIA com semente fixa, não estratificada. O piloto do prompt de
 * avaliação estratifica porque mira mecanismos conhecidos; aqui a pergunta é sobre a
 * qualidade média da sugestão, e estratificar enviesaria justamente o que se quer medir.
 */
import { createClient } from "@supabase/supabase-js"
import { MODEL, PROMPT_VERSION, requestCalibrationAudit } from "@/lib/ai-calibration/service"
import { AUDIT_OUT_OF_SCOPE } from "@/lib/ai-calibration/policy"
import { exigeAlvoNuvem } from "@/scripts/lib/exige-alvo-nuvem"
import fs from "node:fs"
import path from "node:path"

const EXECUTE = process.argv.includes("--execute")
const N = Number(process.argv.find((a) => a.startsWith("--n="))?.slice(4) ?? 30)
const COMANDO = "npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/pilot-audit.ts --execute"
const SAIDA = ".pilot"

/** Semente fixa: duas execuções comparam a MESMA amostra, senão o delta mede a amostra. */
function embaralhaDeterminístico<T>(itens: T[], semente: number): T[] {
  const out = [...itens]
  let s = semente
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function main() {
  if (EXECUTE) exigeAlvoNuvem(COMANDO)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")

  // As queries do servidor são a fonte — replicar o carregamento aqui faria o piloto medir
  // um input diferente do que o run de verdade manda, que é o pior modo de falha possível.
  const { loadWorksForAudit, loadCriterionAnchors } = await import("@/server/queries/calibration")

  const pool = await loadWorksForAudit()
  console.log(`alvo: ${url}`)
  console.log(`prompt: ${PROMPT_VERSION} · modelo: ${MODEL}`)
  console.log(
    `pool: ${pool.works.length} obras · fora: ${pool.semDigest} sem digest, ${pool.semLeitura} sem pós-leitura`,
  )
  console.log(`fora do escopo: ${Object.keys(AUDIT_OUT_OF_SCOPE).join(", ")}\n`)

  const amostra = embaralhaDeterminístico(pool.works, 20260816).slice(0, N)
  console.log(`amostra: ${amostra.length} obras (semente fixa)\n`)
  for (const w of amostra.slice(0, 10)) console.log(`  · ${w.title}`)
  if (amostra.length > 10) console.log(`  … +${amostra.length - 10}`)

  if (!EXECUTE) {
    console.log(`\nensaio (US$0). Para rodar de verdade:\n  ${COMANDO}`)
    return
  }

  const anchors = await loadCriterionAnchors()
  console.log(`\nâncoras: ${anchors.length} critérios\n`)

  const lotes: (typeof amostra)[] = []
  for (let i = 0; i < amostra.length; i += 10) lotes.push(amostra.slice(i, i + 10))

  const todas: Array<{
    obra: string
    slug: string
    de: number
    para: number
    conf: number
    just: string
    consenso: string | null
  }> = []
  let inTok = 0
  let outTok = 0
  for (const [i, lote] of lotes.entries()) {
    process.stdout.write(`lote ${i + 1}/${lotes.length} (${lote.length} obras)… `)
    const r = await requestCalibrationAudit(lote, { runId: null, chunkIndex: i }, anchors)
    inTok += r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheCreationTokens
    outTok += r.usage.outputTokens
    for (const s of r.suggestions) {
      const w = lote.find((x) => x.workId === s.workId)
      todas.push({
        obra: w?.title ?? s.workId,
        slug: s.criterionSlug,
        de: s.currentScore,
        para: s.suggestedScore,
        conf: s.confidence,
        just: s.justification,
        consenso: w?.digest.consensus ?? null,
      })
    }
    console.log(`${r.suggestions.length} sugestões`)
  }

  todas.sort((a, b) => b.conf - a.conf)

  console.log(`\n${"─".repeat(78)}`)
  console.log(`${todas.length} sugestões em ${amostra.length} obras · tokens ${inTok} in / ${outTok} out`)
  const acima = todas.filter((t) => t.conf >= 0.8).length
  console.log(`confiança ≥ 0,80: ${acima} (${((acima / Math.max(todas.length, 1)) * 100).toFixed(1)}%) · máxima: ${todas[0]?.conf ?? 0}`)
  console.log(`${"─".repeat(78)}\n`)
  console.log("AS 10 DE MAIOR CONFIANÇA — é isto que precisa ser julgado:\n")
  for (const t of todas.slice(0, 10)) {
    console.log(`[conf ${t.conf.toFixed(2)}] ${t.obra} · ${t.slug}: ${t.de.toFixed(1)} → ${t.para.toFixed(1)}`)
    console.log(`   por quê: ${t.just}`)
    if (t.consenso) console.log(`   consenso: ${t.consenso.slice(0, 220)}…`)
    console.log()
  }

  fs.mkdirSync(SAIDA, { recursive: true })
  const arq = path.join(SAIDA, `audit-${PROMPT_VERSION}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  fs.writeFileSync(arq, JSON.stringify({ promptVersion: PROMPT_VERSION, model: MODEL, n: amostra.length, inTok, outTok, sugestoes: todas }, null, 2))
  console.log(`saída: ${arq}`)
  console.log(`\n🔴 RODAR NÃO É MEDIR. Julgue as 10 acima antes de decidir religar o auto-apply —`)
  console.log(`   a régua a bater é 0 de 2, que é a precisão observada no topo da escala hoje.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
