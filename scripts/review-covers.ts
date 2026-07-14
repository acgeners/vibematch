/**
 * Gera uma página de REVISÃO VISUAL das trocas de capa propostas.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/review-covers.ts
 *   → .local-experiments/covers-review.html   (abra no browser)
 *
 * Por que existe: o score de capa já me traiu uma vez — pedia trocar 2850×4096 por 700×950 com
 * plena confiança (a penalidade de compressão era, na prática, um imposto sobre tamanho). Número
 * que "faz sentido" não prova nada; a decisão final é visual. Esta página põe a capa ATUAL e a
 * PROPOSTA lado a lado, em tamanho real, com as medidas objetivas embaixo — pra o olho julgar se
 * o critério está certo antes de mexer em 195 obras.
 *
 * As imagens vêm das URLs originais (arquivo local, sem CSP), então é a capa de verdade, não um
 * thumbnail onde artefato de compressão não apareceria.
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { createAdminClient } from "@/lib/supabase/admin"
import { measureCover, scoreCover, type CoverMeasurement } from "@/lib/server/covers/measure-cover"

type Row = { id: string; work_id: string; url: string; source: string; is_primary: boolean }
type Scored = Row & { m: CoverMeasurement | null; score: number; dead: boolean }

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

async function main() {
  const sb = createAdminClient()

  const covers: Row[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb
      .from("work_covers")
      .select("id, work_id, url, source, is_primary")
      .order("id")
      .range(f, f + 999)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    covers.push(...(data as Row[]))
    if (data.length < 1000) break
  }
  const { count } = await sb.from("work_covers").select("*", { count: "exact", head: true })
  if (covers.length !== count) throw new Error(`paginação truncou: ${covers.length} de ${count}`)

  const { data: works } = await sb.from("works").select("id, title")
  const titleOf = new Map((works ?? []).map((w) => [w.id as string, w.title as string]))

  console.log(`medindo ${covers.length} capas…`)
  const scored: Scored[] = []
  const B = 32
  for (let i = 0; i < covers.length; i += B) {
    const r = await Promise.all(
      covers.slice(i, i + B).map(async (c) => {
        const m = await measureCover(c.url).catch(() => null)
        let dead = false
        if (!m) {
          try {
            const res = await fetch(c.url, { headers: { Range: "bytes=0-0" } })
            dead = !res.ok && res.status !== 416
          } catch {
            dead = true
          }
        }
        return { ...c, m, score: m ? scoreCover(m) : -1, dead }
      }),
    )
    scored.push(...r)
    process.stdout.write(`\r  ${Math.min(i + B, covers.length)}/${covers.length}`)
  }
  console.log("\n")

  const byWork = new Map<string, Scored[]>()
  for (const c of scored) byWork.set(c.work_id, [...(byWork.get(c.work_id) ?? []), c])

  type Caso = {
    work: string
    workId: string
    atual: Scored
    proposta: Scored
    ganho: number
    tipo: "upgrade" | "travada" | "marginal"
    motivo?: string
  }
  const casos: Caso[] = []

  const ehBanner = (c: Scored) => c.m != null && c.m.height < c.m.width

  for (const [workId, list] of byWork) {
    const atual = list.find((c) => c.is_primary)
    if (!atual || atual.dead || atual.score < 0) continue
    const medidas = list.filter((c) => c.score >= 0)
    if (!medidas.length) continue
    const melhor = medidas.reduce((a, b) => (b.score > a.score ? b : a))
    if (melhor.id === atual.id) continue

    const ganho = melhor.score - atual.score
    if (ganho <= 0) continue

    const menor = melhor.m!.width < atual.m!.width
    const travada = menor && !ehBanner(atual)

    casos.push({
      work: titleOf.get(workId) ?? workId.slice(0, 8),
      workId,
      atual,
      proposta: melhor,
      ganho,
      tipo: travada ? "travada" : ganho >= 0.15 ? "upgrade" : "marginal",
      motivo: travada
        ? `a proposta é MENOR (${melhor.m!.width}px < ${atual.m!.width}px) — bloqueada pela trava`
        : undefined,
    })
  }

  casos.sort((a, b) => b.ganho - a.ganho)
  const upgrades = casos.filter((c) => c.tipo === "upgrade")
  const travadas = casos.filter((c) => c.tipo === "travada")
  const marginais = casos.filter((c) => c.tipo === "marginal")

  const card = (c: Caso) => {
    const info = (s: Scored) => {
      if (!s.m) return "não medida"
      const kb = s.m.bytes ? `${Math.round(s.m.bytes / 1024)}KB` : "?"
      return `${s.m.width}×${s.m.height} · ${s.m.format} · ${kb}`
    }
    const lado = (s: Scored, rot: string, cor: string) => `
      <div class="lado">
        <div class="rot" style="background:${cor}">${rot}</div>
        <a href="${esc(s.url)}" target="_blank" rel="noreferrer">
          <img src="${esc(s.url)}" loading="lazy" alt="">
        </a>
        <div class="meta">
          <b>${esc(s.source)}</b><br>${info(s)}<br>
          <span class="score">score ${s.score.toFixed(2)}</span>
        </div>
      </div>`
    return `
    <div class="caso ${c.tipo}" data-work="${esc(c.workId)}">
      <div class="titulo">
        ${c.tipo === "upgrade" ? `<label class="ok"><input type="checkbox" class="aprovar" checked> aplicar</label>` : ""}
        ${esc(c.work)}
        <span class="ganho">+${c.ganho.toFixed(2)}</span>
        ${c.motivo ? `<span class="motivo">🔴 ${esc(c.motivo)}</span>` : ""}
      </div>
      <div class="par">
        ${lado(c.atual, "ATUAL", "#6b7280")}
        <div class="seta">→</div>
        ${lado(c.proposta, "PROPOSTA", c.tipo === "travada" ? "#dc2626" : "#16a34a")}
      </div>
    </div>`
  }

  const secao = (t: string, sub: string, list: Caso[]) =>
    !list.length ? "" : `<h2>${t} <span class="n">${list.length}</span></h2><p class="sub">${sub}</p>${list.map(card).join("")}`

  const html = `<!doctype html><meta charset="utf-8">
<title>Revisão de capas — ${upgrades.length} trocas propostas</title>
<style>
  body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#0b0d10;color:#e6e8eb}
  h1{font-size:20px;margin:0 0 4px}
  h2{font-size:16px;margin:36px 0 2px;border-top:1px solid #242830;padding-top:20px}
  .n{background:#242830;padding:1px 8px;border-radius:99px;font-size:12px;color:#9aa3af}
  .sub{color:#9aa3af;margin:0 0 16px;font-size:13px}
  .resumo{background:#12151a;border:1px solid #242830;border-radius:10px;padding:14px 16px;margin:12px 0 8px}
  .caso{background:#12151a;border:1px solid #242830;border-radius:10px;padding:12px 14px;margin-bottom:10px}
  .caso.travada{border-color:#7f1d1d}
  .titulo{font-weight:600;margin-bottom:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .ganho{background:#14532d;color:#86efac;padding:1px 7px;border-radius:5px;font-size:12px;font-weight:600}
  .travada .ganho{background:#450a0a;color:#fca5a5}
  .motivo{color:#fca5a5;font-size:12px;font-weight:400}
  .par{display:flex;gap:14px;align-items:flex-start}
  .lado{flex:0 0 auto;text-align:center}
  .rot{font-size:10px;font-weight:700;letter-spacing:.06em;padding:2px 8px;border-radius:4px;display:inline-block;margin-bottom:6px;color:#fff}
  .lado img{display:block;max-width:230px;max-height:330px;border-radius:6px;background:#1c1f26}
  .meta{font-size:11px;color:#9aa3af;margin-top:6px;line-height:1.45}
  .score{color:#e6e8eb;font-weight:600}
  .seta{align-self:center;font-size:26px;color:#4b5563}
  .ok{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:500;color:#86efac;
      background:#14532d;padding:3px 8px;border-radius:5px;cursor:pointer;user-select:none}
  .ok input{margin:0;cursor:pointer}
  #barra{position:sticky;top:0;z-index:9;background:#12151a;border:1px solid #2f3540;border-radius:10px;
         padding:10px 14px;margin:14px 0;display:flex;gap:12px;align-items:center}
  #cont{font-weight:600}
  #btn{background:#16a34a;color:#fff;border:0;border-radius:6px;padding:6px 12px;font-weight:600;cursor:pointer}
  #dica{color:#9aa3af;font-size:12px}
</style>
<h1>Revisão de capas — os critérios fazem sentido no olho?</h1>
<div class="resumo">
  O score já me traiu uma vez: pedia trocar <b>2850×4096 por 700×950</b> com plena confiança
  (a penalidade de compressão era, na prática, um <b>imposto sobre tamanho</b>). Corrigido — mas
  número que "faz sentido" não prova nada. <b>A imagem abaixo é a capa real, em tamanho real</b>
  (clique abre o original). Se alguma troca parecer errada, o critério ainda está errado.
</div>
<div id="barra">
  <span id="cont"></span>
  <button id="btn">Copiar lista aprovada</button>
  <span id="dica">→ cole no terminal</span>
</div>
${secao("Trocas propostas", "Marque o que aprova. O score NÃO distingue uma capa de um painel interno — vi um caso (Young Lady's Knight) onde a proposta é maior mas é claramente um painel com texto cravado. Por isso a decisão é sua, caso a caso.", upgrades)}
${secao("🔴 Travadas (NÃO seriam aplicadas)", "A proposta é MENOR que a atual. Depois do viés que achei, toda troca que diminui a capa é suspeita por padrão — estas ficam pra revisão humana.", travadas)}
${secao("Marginais (ignoradas)", "Ganho &lt; 0,15 — diferença pequena demais pra justificar mexer.", marginais)}
<script>
  const cbs = () => [...document.querySelectorAll(".aprovar")]
  const marcados = () => cbs().filter(c => c.checked).map(c => c.closest(".caso").dataset.work)
  const atualiza = () => {
    document.getElementById("cont").textContent =
      marcados().length + " de " + cbs().length + " trocas aprovadas"
  }
  document.addEventListener("change", e => { if (e.target.classList.contains("aprovar")) atualiza() })
  document.getElementById("btn").onclick = () => {
    const ids = marcados()
    const cmd = "npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/audit-covers.ts --apply=" + ids.join(",")
    navigator.clipboard.writeText(cmd)
    document.getElementById("dica").textContent = "✅ copiado (" + ids.length + " obras)"
  }
  atualiza()
</script>
`

  mkdirSync(".local-experiments", { recursive: true })
  writeFileSync(".local-experiments/covers-review.html", html)
  console.log(`✅ ${upgrades.length} upgrades · ${travadas.length} travadas · ${marginais.length} marginais`)
  console.log(`→ .local-experiments/covers-review.html`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
