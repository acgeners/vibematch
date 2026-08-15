/**
 * DIAGNÓSTICO 2: separar "mudou o DADO" de "mudou o MODELO/PROMPT" nas reavaliações.
 * Só leitura.
 *
 * ALVO: LOCAL — só LÊ, então o `.env.analysis` (que vem DEPOIS e vence) o manda pro clone
 * local e o egress fica em zero. Sem ele, roda contra a NUVEM em silêncio.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-confidence-confound.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { pageAll } from "./lib/page-all"

type Ev = { work_id: string; confidence: number; cfg: string; model: string; pv: string; at: string; hash: string | null }

async function main() {
  const sb = createAdminClient()
  const raw = await pageAll<Record<string, unknown>>((f, t) =>
    sb
      .from("ai_evaluations")
      .select("work_id, confidence, model_name, prompt_version, created_at, input_hash")
      .eq("status", "completed")
      .order("created_at", { ascending: true })
      .range(f, t)
  )
  const evals: Ev[] = raw
    .filter((e) => e.confidence != null && e.model_name !== "mock-v1")
    .map((e) => ({
      work_id: e.work_id as string,
      confidence: Number(e.confidence),
      model: e.model_name as string,
      pv: e.prompt_version as string,
      cfg: `${e.model_name}/${e.prompt_version}`,
      at: e.created_at as string,
      hash: (e.input_hash as string) ?? null,
    }))
    .filter((e) => !Number.isNaN(e.confidence))

  const byWork = new Map<string, Ev[]>()
  for (const e of evals) {
    if (!byWork.has(e.work_id)) byWork.set(e.work_id, [])
    byWork.get(e.work_id)!.push(e)
  }

  const summ = (ds: number[], label: string) => {
    if (!ds.length) return console.log(`${label.padEnd(46)} n=0`)
    const m = ds.reduce((p, c) => p + c, 0) / ds.length
    const up = ds.filter((d) => d > 0.001).length
    const dn = ds.filter((d) => d < -0.001).length
    const eq = ds.length - up - dn
    console.log(
      `${label.padEnd(46)} n=${String(ds.length).padStart(4)}  Δmédio=${(m >= 0 ? "+" : "") + m.toFixed(4)}  ↑${up} ↓${dn} =${eq}`
    )
  }

  const sameCfg: number[] = []
  const diffCfg: number[] = []
  const sameCfgDiffHash: number[] = []   // mesma config, INPUT mudou → efeito puro do dado
  const sameCfgSameHash: number[] = []   // mesma config, mesmo input → ruído de amostragem
  const crossPairs = new Map<string, number[]>()

  for (const [, list] of byWork) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i]
      const d = b.confidence - a.confidence
      if (a.cfg === b.cfg) {
        sameCfg.push(d)
        if (a.hash && b.hash && a.hash !== b.hash) sameCfgDiffHash.push(d)
        else if (a.hash && b.hash && a.hash === b.hash) sameCfgSameHash.push(d)
      } else {
        diffCfg.push(d)
        const k = `${a.cfg} → ${b.cfg}`
        if (!crossPairs.has(k)) crossPairs.set(k, [])
        crossPairs.get(k)!.push(d)
      }
    }
  }

  console.log("=== Δ confiança entre avaliações consecutivas da MESMA obra ===")
  summ(sameCfg, "MESMO modelo+prompt (só o dado mudou)")
  summ(sameCfgDiffHash, "  └ dos quais input_hash MUDOU (dado novo)")
  summ(sameCfgSameHash, "  └ dos quais input_hash IGUAL (só re-run)")
  summ(diffCfg, "TROCOU modelo e/ou prompt")
  console.log()

  console.log("=== transições de config mais frequentes ===")
  for (const [k, v] of [...crossPairs.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
    summ(v, "  " + k)
  }
  console.log()

  // Confiança média por config, ordenada cronologicamente (1ª aparição)
  const firstSeen = new Map<string, string>()
  const perCfg = new Map<string, number[]>()
  for (const e of evals) {
    if (!firstSeen.has(e.cfg)) firstSeen.set(e.cfg, e.at)
    if (!perCfg.has(e.cfg)) perCfg.set(e.cfg, [])
    perCfg.get(e.cfg)!.push(e.confidence)
  }
  console.log("=== confiança média por config, em ordem cronológica de estreia ===")
  const ordered = [...perCfg.entries()]
    .filter(([, v]) => v.length >= 20)
    .sort((a, b) => (firstSeen.get(a[0])! < firstSeen.get(b[0])! ? -1 : 1))
  for (const [cfg, v] of ordered) {
    const m = v.reduce((p, c) => p + c, 0) / v.length
    console.log(
      `  ${firstSeen.get(cfg)!.slice(0, 10)}  ${cfg.padEnd(34)} n=${String(v.length).padStart(4)}  média=${m.toFixed(3)}`
    )
  }
  console.log()

  // tendência temporal global da confiança (avaliação mais recente por obra)
  const latest = new Map<string, Ev>()
  for (const e of evals) latest.set(e.work_id, e)
  const byMonth = new Map<string, number[]>()
  for (const e of evals) {
    const m = e.at.slice(0, 7)
    if (!byMonth.has(m)) byMonth.set(m, [])
    byMonth.get(m)!.push(e.confidence)
  }
  console.log("=== confiança média por mês (TODAS as avaliações) ===")
  for (const [m, v] of [...byMonth.entries()].sort()) {
    const avg = v.reduce((p, c) => p + c, 0) / v.length
    const bar = "█".repeat(Math.round((avg - 0.5) * 60))
    console.log(`  ${m}  n=${String(v.length).padStart(4)}  ${avg.toFixed(3)}  ${bar}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
