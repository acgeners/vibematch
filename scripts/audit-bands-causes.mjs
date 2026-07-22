import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BAND_RE = /^\s*Faixa\s+(\d+(?:-\d+)?(?:\/\d+-\d+)?)\s*(?:\(([^)]*)\))?\s*:\s*([\s\S]*)$/i
const bounds = (b) => { const n = b.split(/[-/]/).map(Number).filter(Number.isFinite); return n.length ? [Math.min(...n), Math.max(...n)] : [0,10] }
async function pageAll(t, c) { const o=[]; for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(c).range(f,f+999); if(error)throw error; if(!data?.length)break; o.push(...data); if(data.length<1000)break} return o }
const evals = await pageAll('ai_evaluations','id, work_id, status, created_at')
const scores = await pageAll('ai_evaluation_scores','ai_evaluation_id, criterion_slug, justification, suggested_score, was_edited')
const cats = await pageAll('category_scores','work_id, criterion_slug, score, source')
const latest = new Map()
for (const e of evals) { if (e.status==='failed') continue; const c=latest.get(e.work_id); if(!c||new Date(e.created_at)>new Date(c.created_at)) latest.set(e.work_id,e) }
const vis = new Set([...latest.values()].map(e=>e.id)); const byId = new Map(evals.map(e=>[e.id,e]))
const cat = new Map(cats.map(c=>[`${c.work_id}::${c.criterion_slug}`,c]))
const out=[]
for (const s of scores) {
  if (!vis.has(s.ai_evaluation_id)) continue
  const m = s.justification?.match(BAND_RE); if (!m) continue
  const ev = byId.get(s.ai_evaluation_id); const c = cat.get(`${ev.work_id}::${s.criterion_slug}`); if (!c) continue
  const [lo,hi]=bounds(m[1]); const r=Math.round(c.score*10)/10
  if (r>=lo && r<=hi) continue
  out.push({slug:s.criterion_slug, band:m[1], lo, hi, score:r, sug:s.suggested_score, src:c.source, edited:s.was_edited})
}
const bucket = (r) => {
  if (r.slug==='couple_dynamics' && r.score===5 && r.hi<5) return 'regra couple_dynamics→5 (sem romance)'
  if (r.slug==='adult_content' && [5,7,8].includes(r.score) && r.score>r.hi) return 'regra adult_content→piso (R19/rating externo)'
  if (r.sug!=null && Math.round(r.sug*10)/10 !== r.score) return 'nota EDITADA (difere do suggested_score)'
  return 'incoerência da IA (nota ≠ faixa que ela citou)'
}
const agg=new Map()
for (const r of out) { const k=bucket(r); const v=agg.get(k)??{n:0,ex:[]}; v.n++; if(v.ex.length<3) v.ex.push(`${r.slug} nota ${r.score} vs faixa ${r.band} (sug ${r.sug}, src ${r.src})`); agg.set(k,v) }
console.log(`(B) ponto fora da faixa — ${out.length} casos visíveis, por CAUSA:\n`)
for (const [k,v] of [...agg].sort((a,b)=>b[1].n-a[1].n)) { console.log(`  ${String(v.n).padStart(4)}  ${k}`); for(const e of v.ex) console.log(`         · ${e}`) }
const slugAgg=new Map(); for(const r of out) slugAgg.set(r.slug,(slugAgg.get(r.slug)??0)+1)
console.log(`\n  por critério: ${[...slugAgg].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}`).join(' · ')}`)
