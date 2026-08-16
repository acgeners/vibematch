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
import { bandCoherence } from "@/lib/criteria/justification"
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
      "o modelo escreve 'Faixa 4-6' e a nota cai em 7-8. Ou ele se contradisse, ou um pós-processamento mudou a nota sem reescrever a prosa. Nos dois casos, quem lê a ficha vê texto e número discordando.",
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
      .select("work_id, criterion_slug, score, works(title), ai_evaluations(ai_evaluation_scores(criterion_slug, justification))")
      .not("ai_evaluation_id", "is", null)
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as Array<{
      work_id: string; criterion_slug: string; score: string
      works?: { title?: string } | null
      ai_evaluations?: { ai_evaluation_scores?: Array<{ criterion_slug: string; justification: string | null }> } | null
    }>
    for (const r of rows) {
      const j = r.ai_evaluations?.ai_evaluation_scores?.find((x) => x.criterion_slug === r.criterion_slug)?.justification
      if (j) out.push({ workId: r.work_id, titulo: r.works?.title ?? r.work_id, slug: r.criterion_slug, nota: Number(r.score), just: j })
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

async function main() {
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
