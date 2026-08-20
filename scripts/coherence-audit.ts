/**
 * Auditoria de COERÊNCIA INTERNA das notas de atributo.
 *
 * A régua que faltava. O gold (`scripts/gold-mae.ts`) mede PRECISÃO — distância até o
 * julgamento humano, n=30, piso de detecção 0,10. Este script mede a outra metade do
 * objetivo: **a nota contradiz a própria justificativa?** Isso é falsificável por inspeção,
 * não precisa de rótulo humano, e roda sobre ~8.700 atributos — então enxerga movimentos
 * que o gold nunca conseguiria.
 *
 * As 4 imagens que abriram esta investigação eram, em maioria, incoerência — não erro de
 * precisão. Uma nota pode estar perto do gold E contradizer o próprio texto.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/coherence-audit.ts
 *   ... --source=.pilot/piloto-v25-....json      # mede uma saída já paga
 *   ... --sample=30                              # imprime casos marcados, pra validar à mão
 *   ... --check=D --sample=20                    # só uma checagem
 *
 * 🔴 As checagens são regex sobre prosa e TÊM falso positivo. Antes de usar o número numa
 * decisão, rode `--sample` e meça a taxa de erro da própria régua. Nenhuma decisão deve
 * sair daqui sem esse passo — foi exatamente pular a validação do instrumento que fez esta
 * investigação gastar US$2 em medições que não decidiram nada.
 */
import { createClient } from "@supabase/supabase-js"
import { CRITERION_SLUGS } from "@/types/domain"
import { bandCoherence, parseJustification } from "@/lib/criteria/justification"
import { computeAdultContentBounds, clampAdultContentScore } from "@/lib/ai-evaluation/adult-content-rules"
import { autorDaNota } from "@/lib/criteria/nota-autor"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import fs from "node:fs"

interface Item { workId: string; titulo: string; slug: string; nota: number; just: string }
interface Check {
  id: string
  nome: string
  porque: string
  /** Só roda nos critérios listados; `null` = todos. */
  slugs: string[] | null
  viola: (it: Item) => boolean
}



const CHECKS: Check[] = [
  {
    id: "A",
    nome: "faixa citada ≠ faixa da nota",
    porque:
      "o modelo escreve 'Faixa 4-6' e propõe uma nota que cai em 7-8 — ele se contradiz dentro da própria avaliação. Compara a nota PROPOSTA com a prosa dela, não a nota vigente: nota trocada depois é curadoria, não defeito.",
    slugs: null,
    // 🔴 A comparação era `citada !== bandForScore(nota)` sobre o PRIMEIRO par de números
    // da prosa, e isso tem dois falsos positivos grandes: citação composta ("Faixa 7-8/9")
    // e nota de meio ponto na borda (8,5 contra "7-8" — os bins da rubrica são de inteiros
    // e não se tocam). Medido em 2026-08-16 no catálogo: 483 acusações, das quais 226 eram
    // borda e 6 de 6 amostradas eram citação composta. A régua real é 71 casos, e agora ela
    // tem dono e teste (`bandCoherence`) em vez de um regex por script.
    viola: (it) => bandCoherence(it.nota, it.just) === "divergente",
  },
]

/**
 * 🔴 TRÊS CHECAGENS FORAM REMOVIDAS depois de reprovarem validação manual (2026-08-10).
 * Ficam registradas aqui pra ninguém reinventá-las achando que são boa ideia:
 *
 *   B "prosa afirma ausência, nota ≥ 5"           → 6 de 6 amostrados eram falso positivo
 *   C "intensidade fraca, nota no topo da faixa"  → 5 de 5 falso positivo
 *   D "couple_dynamics: valência por leitor"      → ~6 de 8 falso positivo (51% do total marcado!)
 *
 * A causa é a mesma nas três: **regex sobre prosa de modelo não mede semântica**. O
 * vocabulário aparece negado, comparado ou como nome de gênero —
 *   B casou "ritmo mais agitado que slice of life" (comparação que afirma o CONTRÁRIO);
 *   C casou "humor presente mas pontual, não dominante" com nota 6, que é a nota CERTA;
 *   D casou "o casal se comunica abertamente, com Iona reassegurando Leroy" como se não
 *     houvesse menção à reação do personagem.
 *
 * Só a checagem A sobrevive porque é ESTRUTURAL: extrai o rótulo e compara com
 * `bandForScore`. Não interpreta nada. Julgar se uma frase apoia a valência em opinião de
 * leitor exige entender a frase — é trabalho de juiz-LLM, com custo e validação próprios.
 */

// ── Fontes ─────────────────────────────────────────────────────────────────────

async function doCatalogo(): Promise<Item[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
  const sb = createClient(url, key)
  const out: Item[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("category_scores")
      .select("work_id, criterion_slug, works(title), ai_evaluations(ai_evaluation_scores(criterion_slug, justification, suggested_score))")
      .not("ai_evaluation_id", "is", null)
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as Array<{
      work_id: string; criterion_slug: string; score: string
      works?: { title?: string } | null
      ai_evaluations?: { ai_evaluation_scores?: Array<{ criterion_slug: string; justification: string | null; suggested_score: number | null }> } | null
    }>
    for (const r of rows) {
      const aes = r.ai_evaluations?.ai_evaluation_scores?.find((x) => x.criterion_slug === r.criterion_slug)
      // 🔴 Compara a nota que a IA PROPÔS com a prosa que ela mesma escreveu — não a nota
      // vigente. Medido em 17/08: das 20 acusações contra a nota vigente, **19 eram edições
      // da curadora** (ela trocou o número, a prosa da IA ficou). Isso não é o modelo se
      // contradizendo, é troca de autor — e a página já credita isso ("Ajustada por você ·
      // a IA sugeria X"). Manter aquela comparação fazia a régua acusar curadoria como
      // defeito, que é o alarme que sempre toca.
      if (aes?.justification && aes.suggested_score != null) {
        out.push({ workId: r.work_id, titulo: r.works?.title ?? r.work_id, slug: r.criterion_slug, nota: Number(aes.suggested_score), just: aes.justification })
      }
    }
    if (rows.length < 1000) break
  }
  return out
}

function doJson(caminho: string): Item[] {
  const d = JSON.parse(fs.readFileSync(caminho, "utf8")) as {
    resultados: Array<{ workId?: string; titulo?: string; title?: string; depois?: Record<string, number>; novo?: Record<string, number>; justificativas: Record<string, string> }>
  }
  const out: Item[] = []
  for (const r of d.resultados) {
    const notas = r.depois ?? r.novo ?? {}
    for (const slug of CRITERION_SLUGS) {
      const nota = notas[slug]
      const just = r.justificativas?.[slug]
      if (nota != null && just) out.push({ workId: r.workId ?? "", titulo: r.titulo ?? r.title ?? "", slug, nota, just })
    }
  }
  return out
}

// ── Main ───────────────────────────────────────────────────────────────────────

function pad(s: string, n: number) { return s.length >= n ? s : s + " ".repeat(n - s.length) }

/**
 * A OUTRA pergunta: a FICHA se contradiz para quem lê?
 *
 * 🔴 As checagens A–D comparam a prosa com a nota que a IA PROPÔS — a pergunta certa para "o
 * modelo se contradiz", e por isso elas acusam 0 hoje. Mas a tela não mostra a nota proposta:
 * mostra a PERSISTIDA. Medido em 2026-08-20, essa diferença escondia **85 fichas** em que o
 * limite de `adult_content` moveu a nota, o texto seguia argumentando outra faixa, e nenhuma
 * régua deste script via nada.
 *
 * A régua aqui não é "prosa bate com nota" — é **"dá para saber QUEM decidiu?"**:
 *
 *  · faixa citada = faixa da nota exibida                     → coerente
 *  · diverge, mas `ai_edited`/`ai_calibrated`                 → a página credita (ok)
 *  · diverge, e o limite explica EXATAMENTE a nota            → a página credita (ok)
 *  · diverge e ninguém assume                                 → **defeito**
 *
 * ⚠️ Ela depende do que a página mostra. Se um dos três créditos sair da tela
 * (`app/catalog/[id]/page.tsx`), esta auditoria passa a aprovar ficha órfã — o que ela mede é
 * a TELA, não o banco.
 */
interface ItemTela {
  workId: string
  titulo: string
  slug: string
  exibida: number
  proposta: number
  source: string
  just: string
  limiteExplica: boolean
}

async function doTela(): Promise<ItemTela[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
  const sb = createClient(url, key)
  const pag = async <T,>(t: string, sel: string): Promise<T[]> => {
    const out: T[] = []
    for (let f = 0; ; f += 1000) {
      const { data, error } = await sb.from(t).select(sel).range(f, f + 999)
      if (error) throw new Error(`${t}: ${error.message}`)
      out.push(...((data ?? []) as T[]))
      if (!data || data.length < 1000) break
    }
    return out
  }
  // Tags e gêneros só servem ao limite de adult_content, que é o único critério com clamp.
  const wt = await pag<{ work_id: string; tags: { name: string; adult_score_tier: string | null; tag_group_id: string } | null }>(
    "work_tags", "work_id, tags(name, adult_score_tier, tag_group_id)")
  const tagsBy = new Map<string, Array<{ name: string; group: string | null; scoreTier: "label" | "explicit" | null }>>()
  for (const r of wt) {
    if (!r.tags) continue
    const l = tagsBy.get(r.work_id) ?? []
    const tier = r.tags.adult_score_tier
    l.push({
      name: r.tags.name,
      group: TAG_GROUP_ID_TO_NORMALIZED_SLUG[r.tags.tag_group_id] ?? null,
      scoreTier: tier === "label" || tier === "explicit" ? tier : null,
    })
    tagsBy.set(r.work_id, l)
  }
  const wg = await pag<{ work_id: string; genres: { name: string } | null }>("work_genres", "work_id, genres(name)")
  const genBy = new Map<string, string[]>()
  for (const r of wg) {
    const l = genBy.get(r.work_id) ?? []
    if (r.genres?.name) l.push(r.genres.name)
    genBy.set(r.work_id, l)
  }

  const out: ItemTela[] = []
  const rows = await pag<{
    work_id: string; criterion_slug: string; score: string; source: string | null
    works?: { title?: string } | null
    ai_evaluations?: { ai_evaluation_scores?: Array<{ criterion_slug: string; justification: string | null; suggested_score: number | null }> } | null
  }>("category_scores",
    "work_id, criterion_slug, score, source, works(title), ai_evaluations(ai_evaluation_scores(criterion_slug, justification, suggested_score))")
  for (const r of rows) {
    const aes = r.ai_evaluations?.ai_evaluation_scores?.find((x) => x.criterion_slug === r.criterion_slug)
    if (!aes?.justification || aes.suggested_score == null) continue
    const proposta = Number(aes.suggested_score)
    let limiteExplica = false
    if (r.criterion_slug === "adult_content") {
      const b = computeAdultContentBounds({ tags: tagsBy.get(r.work_id) ?? [], genres: genBy.get(r.work_id) ?? [] })
      limiteExplica = clampAdultContentScore(proposta, b) === Number(r.score)
    }
    out.push({
      workId: r.work_id, titulo: r.works?.title ?? r.work_id, slug: r.criterion_slug,
      exibida: Number(r.score), proposta, source: r.source ?? "?", just: aes.justification, limiteExplica,
    })
  }
  return out
}

async function auditoriaDaTela() {
  const itens = await doTela()
  const semAutor: ItemTela[] = []
  let coerentes = 0, creditadoHumano = 0, creditadoAuditoria = 0, creditadoLimite = 0, semFaixa = 0
  for (const it of itens) {
    const citada = parseJustification(it.just).band
    if (!citada) { semFaixa++; continue }
    if (bandCoherence(it.exibida, it.just) !== "divergente") { coerentes++; continue }
    // 🔴 Mesmo dono que a página usa para escolher qual crédito imprimir. Uma segunda régua
    // aqui aprovaria justamente as fichas que a tela deixa órfãs.
    switch (autorDaNota({ source: it.source, exibida: it.exibida, proposta: it.proposta, limiteExplica: it.limiteExplica })) {
      case "curadoria": creditadoHumano++; break
      case "auditoria": creditadoAuditoria++; break
      case "limite": creditadoLimite++; break
      default: semAutor.push(it)
    }
  }
  console.log(`
${"=".repeat(96)}
AUDITORIA DA TELA — a ficha diz QUEM decidiu a nota?
${"=".repeat(96)}`)
  console.log(`atributos com faixa citada: ${itens.length - semFaixa} (sem faixa: ${semFaixa})`)
  console.log(`  coerentes (prosa = faixa da nota exibida): ${coerentes}`)
  console.log(`  diverge, creditado "Ajustada por você":    ${creditadoHumano}`)
  console.log(`  diverge, creditado "pela auditoria":       ${creditadoAuditoria}`)
  console.log(`  diverge, creditado "pelo limite":          ${creditadoLimite}`)
  console.log(`  🔴 diverge e NINGUÉM assume:               ${semAutor.length}`)
  for (const it of semAutor.slice(0, 25))
    console.log(`     [${it.slug}] ${it.titulo} — exibe ${it.exibida}, IA propôs ${it.proposta} (${it.source})`)
  if (semAutor.length > 25) console.log(`     … e mais ${semAutor.length - 25}`)
}

async function main() {
  if (process.argv.includes("--tela")) {
    await auditoriaDaTela()
    return
  }
  const src = process.argv.find((a) => a.startsWith("--source="))?.slice("--source=".length) ?? "catalogo"
  const amostra = Number(process.argv.find((a) => a.startsWith("--sample="))?.slice("--sample=".length) ?? 0)
  const soCheck = process.argv.find((a) => a.startsWith("--check="))?.slice("--check=".length)?.toUpperCase()

  const itens = src === "catalogo" ? await doCatalogo() : doJson(src)
  console.log(`fonte: ${src}`)
  console.log(`atributos analisados: ${itens.length} (${new Set(itens.map((i) => i.workId)).size} obras)\n`)

  const checks = soCheck ? CHECKS.filter((c) => c.id === soCheck) : CHECKS
  const marcados = new Map<string, Item[]>()

  console.log(pad("check", 6) + pad("o que pega", 44) + pad("elegíveis", 11) + pad("marcados", 10) + "taxa")
  let totalMarcados = 0, totalElegiveis = 0
  for (const c of checks) {
    const eleg = itens.filter((i) => !c.slugs || c.slugs.includes(i.slug))
    const marc = eleg.filter(c.viola)
    marcados.set(c.id, marc)
    totalMarcados += marc.length; totalElegiveis += eleg.length
    console.log(pad(c.id, 6) + pad(c.nome, 44) + pad(String(eleg.length), 11) + pad(String(marc.length), 10) +
      `${((marc.length / eleg.length) * 100).toFixed(1)}%`)
  }
  console.log(`\nTOTAL: ${totalMarcados} incoerências marcadas`)

  // Por critério — mostra onde o defeito se concentra.
  console.log(`\n${pad("critério", 20)}${checks.map((c) => pad(c.id, 7)).join("")}total`)
  for (const slug of CRITERION_SLUGS) {
    const cells = checks.map((c) => pad(String((marcados.get(c.id) ?? []).filter((i) => i.slug === slug).length), 7)).join("")
    const t = checks.reduce((a, c) => a + (marcados.get(c.id) ?? []).filter((i) => i.slug === slug).length, 0)
    console.log(pad(slug, 20) + cells + t)
  }

  if (amostra > 0) {
    console.log(`\n${"=".repeat(96)}\nAMOSTRA PARA VALIDAR A RÉGUA — leia e conte quantos são falso positivo\n${"=".repeat(96)}`)
    for (const c of checks) {
      const marc = marcados.get(c.id) ?? []
      if (!marc.length) continue
      console.log(`\n### ${c.id} — ${c.nome}\n${c.porque}\n`)
      // Passo determinístico pra cobrir a lista inteira, não só o começo.
      const passo = Math.max(1, Math.floor(marc.length / Math.min(amostra, marc.length)))
      for (let k = 0; k < marc.length && k / passo < amostra; k += passo) {
        const i = marc[k]
        console.log(`— [${i.slug} = ${i.nota}] ${i.titulo}`)
        console.log(`  ${i.just.replace(/\s+/g, " ").slice(0, 300)}`)
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
