/**
 * PAINEL DE CONSISTÊNCIA das notas de atributo.
 *
 * A régua que faltava — e a razão de ela faltar é instrutiva. O gold
 * (`scripts/gold-mae.ts`) mede PRECISÃO: distância até o julgamento da curadora, n=30, piso
 * de detecção **0,10**. As tentativas v23/v24/v25 foram reprovadas por ele, mas o que elas
 * mudavam era majoritariamente COERÊNCIA e CONSISTÊNCIA — e o ganho de precisão disponível
 * (~0,05) está ABAIXO do que aquele instrumento enxerga. Foi medir a coisa certa com a régua
 * errada, quatro vezes.
 *
 * 🔴 O número que fecha o argumento: o ruído entre DUAS RODADAS IDÊNTICAS é **0,289**
 * (151 pares). Nenhuma diferença de prompt menor que isso é distinguível de ruído por
 * comparação direta. Consistência, ao contrário, é medível sobre o catálogo inteiro — 8.757
 * notas vigentes, sem rótulo humano, sem custo de IA, sem falso positivo de regex.
 *
 * As quatro dimensões:
 *
 *   1. DISPERSÃO      — share por faixa e σ dos 9 critérios (4 estão colapsados)
 *   2. RÉGUAS VIVAS   — quantas versões de prompt × modelo coexistem no catálogo
 *   3. REPRODUTIBILIDADE — amplitude entre reavaliações da mesma obra, com e sem controle
 *   4. COERÊNCIA prosa×nota — delegada a `scripts/coherence-audit.ts` (checagem A, estrutural)
 *
 * ⚠️ Este painel NÃO mede acurácia e não substitui o gold. Uma régua pode ficar perfeitamente
 * consistente e estar consistentemente errada. Os dois instrumentos respondem perguntas
 * diferentes e nenhum dos dois sozinho autoriza trocar a régua do catálogo.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/consistency-panel.ts
 *   ... --save=.consistency/v26.json          # grava o retrato de hoje
 *   ... --baseline=.consistency/v26.json      # compara com um retrato anterior
 *   ... --piloto=.pilot/piloto-v27-<ts>.json  # julga um PILOTO (seção 5)
 *
 * 🔴 Só o modo --baseline responde "melhorou?". Um número solto não diz nada: `protagonist`
 * com σ 0,89 é ruim, mas se o retrato anterior tinha 0,71 então a mudança FUNCIONOU. Medir
 * movimento é justamente o que a empreitada v23–v25 não conseguiu fazer.
 *
 * ── Por que `--piloto` existe (2026-08-10) ──────────────────────────────────────────────
 *
 * 🔴 **`--baseline` NÃO enxerga um piloto, e essa lacuna quase produziu a quinta rodada
 * inconclusiva.** O `pilot-prompt-*.ts` não grava em `category_scores` nem em
 * `ai_evaluation_scores` — de propósito, para não sujar o catálogo com uma régua em teste. As
 * dimensões 1–3 leem exatamente essas duas tabelas. Logo, rodar o piloto e depois rodar o
 * painel compara o catálogo com ele mesmo: os dois retratos vêm idênticos, e o piloto que
 * custou dinheiro não entra na conta.
 *
 * 🔴 **E comparar as obras do piloto CONTRA o retrato do catálogo seria pior que não medir.**
 * Os estratos são deliberadamente NÃO representativos (regressão+posse, ação×slice-of-life,
 * protagonista passivo…) — foram escolhidos para concentrar os mecanismos sob teste. Qualquer
 * diferença contra o catálogo mediria a seleção da amostra, não a mudança de régua, e mediria
 * com sinal plausível. Por isso a seção 5 é PAREADA: as mesmas obras, antes × depois.
 *
 * ⚠️ **O piso do painel (0,289) é de AMPLITUDE por nota e não se aplica a share por faixa.**
 * Usar um piso de uma grandeza para julgar outra é a mesma troca de régua que reprovou a
 * v23–v25 pelo gold. Por isso a dimensão 3 passou a medir também a **taxa de troca de faixa
 * entre rodadas idênticas** — o piso na grandeza em que a seção 5 fala.
 */
import { createClient } from "@supabase/supabase-js"
import { CRITERION_SLUGS } from "@/types/domain"
import { bandForScore } from "@/lib/criteria/justification"
import fs from "node:fs"
import path from "node:path"

/**
 * ⚠️ PREGUIÇOSO de propósito. Criado no escopo do módulo, o cliente explode no `import` de
 * quem só quer uma função pura daqui (`validateSupabaseUrl` rejeita `undefined`) — e aí a
 * guarda de entrypoint lá embaixo vira decoração, porque o efeito colateral acontece antes
 * de qualquer `main()`. Foi o que aconteceu ao escrever o teste do `zContraPiso`.
 */
let _sb: ReturnType<typeof createClient> | null = null
function db() {
  if (!_sb) {
    _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    })
  }
  return _sb
}

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=")

/** ⚠️ O `select` do PostgREST corta em 1000 linhas sem avisar — pagine sempre. */
async function todas<T>(tabela: string, cols: string, filtro?: (q: never) => unknown): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = db().from(tabela).select(cols).range(from, from + 999)
    if (filtro) q = filtro(q as never) as typeof q
    const { data, error } = await q
    if (error) throw new Error(`${tabela}: ${error.message}`)
    if (!data?.length) break
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

/**
 * z da CONTAGEM de trocas de faixa contra o piso de ruído (Bernoulli, p = piso).
 *
 * 🔴 Existe como função própria porque foi aqui que a 1ª versão errou: eu comparava
 * `flipPct > piso * 2`, com o "2" escolhido por mim, sem nada por trás — e o limiar produziu
 * um falso negativo de beira de faca no primeiro uso real (24,4% contra um piso de 12,2%,
 * reprovado por um `>` estrito). Múltiplo do piso não tem noção de TAMANHO DE AMOSTRA: 3 de
 * 12 e 60 de 240 dão a mesma porcentagem e evidências completamente diferentes.
 */
export function zContraPiso(flips: number, n: number, pisoPct: number): number {
  const p0 = pisoPct / 100
  const dp = Math.sqrt(n * p0 * (1 - p0))
  return dp > 0 ? (flips - p0 * n) / dp : 0
}

function sigma(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

const pct = (n: number, d: number) => (d ? (100 * n) / d : 0)
const f1 = (n: number) => n.toFixed(1)
const f2 = (n: number) => n.toFixed(2)
/** Delta com sinal, ou vazio quando não há baseline. */
function delta(atual: number, antes: number | undefined, casas = 2, melhorSubindo = true): string {
  if (antes === undefined) return ""
  const d = atual - antes
  if (Math.abs(d) < 10 ** -casas / 2) return "  (=)"
  const seta = d > 0 === melhorSubindo ? "↑" : "↓"
  return `  (${seta}${d > 0 ? "+" : ""}${d.toFixed(casas)})`
}

interface Retrato {
  gerado_em: string
  dispersao: Record<string, { n: number; sigma: number; faixas: Record<string, number>; dominante: number }>
  reguas: { combinacoes: number; versoes: number; modelos: number; detalhe: Array<{ v: string; m: string; obras: number }> }
  reprodutibilidade: { pares_sem_controle: number; amplitude_sem_controle: number; pares_com_controle: number; amplitude_com_controle: number; por_criterio: Record<string, number> }
}

// ── 5. PILOTO — comparação PAREADA (antes × depois nas MESMAS obras) ─────────────────────

interface PilotoItem {
  grupo: string
  workId: string
  title: string
  erro?: string
  antes: Record<string, number>
  depois: Record<string, number>
}

/**
 * Julga um piloto sem ele ter tocado o catálogo.
 *
 * ⚠️ O que este julgamento NÃO isola: o `antes` foi produzido meses antes, com o pool de
 * reviews da época, e o piloto remonta o contexto pelos helpers públicos. O delta mistura
 * mudança de PROMPT com deriva das FONTES — está documentado no cabeçalho do próprio piloto.
 * Isolar exigiria rodar as duas versões sobre o mesmo contexto na mesma execução (~2× o custo).
 */
function julgarPiloto(caminho: string, pisoFlipPct: number): void {
  const j = JSON.parse(fs.readFileSync(caminho, "utf8")) as {
    promptVersion: string
    model: string
    custo?: { usd?: number; chamadas?: number }
    resultados: PilotoItem[]
  }
  const ok = j.resultados.filter((r) => !r.erro && Object.keys(r.depois).length > 0)

  console.log(`\n5. PILOTO — ${path.basename(caminho)}  (${j.promptVersion} · ${j.model})`)
  console.log(`   ${ok.length} obras válidas de ${j.resultados.length}${j.custo?.usd != null ? ` · custou $${j.custo.usd.toFixed(4)}` : ""}`)
  console.log(`   🔴 PAREADO: mesmas obras antes × depois. NUNCA compare estes estratos com o catálogo —`)
  console.log(`      eles foram escolhidos para concentrar os mecanismos, então a diferença mediria a AMOSTRA.`)

  // Por critério: quanto a nota andou, e quantas cruzaram FAIXA (a grandeza que decide).
  console.log(`\n   por critério (só notas presentes nos dois lados)`)
  console.log(`   ${"critério".padEnd(18)}${"n".padStart(4)}${"Δ médio".padStart(10)}${"trocou faixa".padStart(14)}${"  ↓ / ↑".padEnd(10)}`)
  let totalNotas = 0
  let totalFlips = 0
  for (const slug of CRITERION_SLUGS) {
    const pares = ok
      .filter((r) => r.antes[slug] != null && r.depois[slug] != null)
      .map((r) => ({ a: Number(r.antes[slug]), d: Number(r.depois[slug]) }))
    if (!pares.length) continue
    const deltaMedio = pares.reduce((s, p) => s + (p.d - p.a), 0) / pares.length
    const flips = pares.filter((p) => bandForScore(p.a) !== bandForScore(p.d))
    const desceu = flips.filter((p) => p.d < p.a).length
    totalNotas += pares.length
    totalFlips += flips.length
    console.log(
      `   ${slug.padEnd(18)}${String(pares.length).padStart(4)}` +
        `${(deltaMedio > 0 ? "+" : "") + f2(deltaMedio)}`.padStart(10) +
        `${f1(pct(flips.length, pares.length))}%`.padStart(14) +
        `${`${desceu} / ${flips.length - desceu}`.padStart(9)}`,
    )
  }

  // 🔴 A leitura que decide: o movimento é distinguível do ruído de rodadas idênticas?
  //
  // ⚠️ NÃO use múltiplo do piso ("2× o piso") — a 1ª versão desta função fazia isso e o
  // limiar era INVENTADO por mim, sem nada por trás. Pior: ele produziu um falso negativo de
  // beira de faca logo no primeiro uso (24,4% contra 24,4%, reprovado por um `>` estrito).
  // O teste certo já existe e não pede número escolhido a dedo: sob a hipótese de ruído puro,
  // trocar de faixa é Bernoulli com p = piso, então o desvio-padrão da CONTAGEM é conhecido.
  const flipPct = pct(totalFlips, totalNotas)
  const p0 = pisoFlipPct / 100
  const esperado = p0 * totalNotas
  const dp = Math.sqrt(totalNotas * p0 * (1 - p0))
  const z = zContraPiso(totalFlips, totalNotas, pisoFlipPct)
  console.log(`\n   trocaram faixa: ${totalFlips}/${totalNotas} = ${f1(flipPct)}%   ·   piso (rodadas idênticas): ${f1(pisoFlipPct)}%`)
  console.log(`   esperado sob ruído puro: ${f1(esperado)} ± ${f1(dp)}  ⇒  z = ${f1(z)}`)
  console.log(
    Math.abs(z) >= 2
      ? `   ⇒ movimento DISTINGUÍVEL do ruído. O que ele significa depende do RUMO, abaixo.`
      : `   ⇒ movimento DENTRO do ruído. Não sustenta conclusão nenhuma — nem "funcionou" nem "não funcionou".`,
  )
  // ⚠️ O piso é um teto disfarçado: os "pares idênticos" casam versão+modelo, mas foram
  // avaliados em datas diferentes, com o pool de reviews de cada época. Ele já embute deriva
  // de fonte — o que o torna CONSERVADOR para julgar um piloto que embute a mesma deriva.
  console.log(`   ⚠️ "acima do ruído" não é "melhorou": faixa certa e faixa errada se movem igual. Quem`)
  console.log(`      responde ACURÁCIA é o gold (scripts/gold-mae.ts), e ele continua obrigatório.`)

  // Por estrato: cada um foi construído contra UM mecanismo. Movimento no controle é alarme.
  console.log(`\n   por estrato (cada um mira um mecanismo; F-controle NÃO deveria andar)`)
  for (const grupo of [...new Set(ok.map((r) => r.grupo))].sort()) {
    const doGrupo = ok.filter((r) => r.grupo === grupo)
    const pares = doGrupo.flatMap((r) =>
      CRITERION_SLUGS.filter((s) => r.antes[s] != null && r.depois[s] != null).map((s) => ({
        a: Number(r.antes[s]),
        d: Number(r.depois[s]),
      })),
    )
    if (!pares.length) continue
    const absMedio = pares.reduce((s, p) => s + Math.abs(p.d - p.a), 0) / pares.length
    const flips = pares.filter((p) => bandForScore(p.a) !== bandForScore(p.d)).length
    const zG = zContraPiso(flips, pares.length, pisoFlipPct)
    const marca = grupo.startsWith("F-") && zG >= 2 ? `  ⚠ controle se moveu (z=${f1(zG)})` : ""
    console.log(
      `   ${grupo.padEnd(22)}${String(doGrupo.length).padStart(3)} obras  |Δ| médio ${f2(absMedio)}  faixa ${f1(pct(flips, pares.length))}%${marca}`,
    )
  }
  console.log(`   🔴 ENTANGLEMENT: as 9 notas saem de UMA leitura, então mexer numa rubrica move as vizinhas.`)
  console.log(`      O controle andar não invalida o piloto — mas invalida ler o efeito como se fosse local.`)
}

async function main() {
  const baselinePath = arg("baseline")
  const base: Retrato | undefined = baselinePath
    ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
    : undefined

  // ── 1. DISPERSÃO ────────────────────────────────────────────────────────────
  // As notas VIGENTES (category_scores), não as sugeridas: são elas que governam o
  // /ranking, os limiares min_/max_ e as features do Ridge.
  const vigentes = await todas<{ criterion_slug: string; score: number }>(
    "category_scores",
    "criterion_slug, score",
  )
  const dispersao: Retrato["dispersao"] = {}
  for (const slug of CRITERION_SLUGS) {
    const notas = vigentes.filter((r) => r.criterion_slug === slug).map((r) => Number(r.score))
    if (!notas.length) continue
    const faixas: Record<string, number> = {}
    for (const n of notas) faixas[bandForScore(n)] = (faixas[bandForScore(n)] ?? 0) + 1
    const dominante = Math.max(...Object.values(faixas))
    dispersao[slug] = {
      n: notas.length,
      sigma: sigma(notas),
      faixas: Object.fromEntries(Object.entries(faixas).map(([k, v]) => [k, pct(v, notas.length)])),
      dominante: pct(dominante, notas.length),
    }
  }

  // ── 2. RÉGUAS VIVAS ─────────────────────────────────────────────────────────
  const avals = await todas<{ id: string; work_id: string; prompt_version: string | null; model_name: string | null; status: string }>(
    "ai_evaluations",
    "id, work_id, prompt_version, model_name, status",
  )
  const avalPorId = new Map(avals.map((a) => [a.id, a]))
  const ligadas = await todas<{ work_id: string; ai_evaluation_id: string | null }>(
    "category_scores",
    "work_id, ai_evaluation_id",
  )
  const obrasPorRegua = new Map<string, Set<string>>()
  for (const cs of ligadas) {
    const a = cs.ai_evaluation_id ? avalPorId.get(cs.ai_evaluation_id) : undefined
    if (!a) continue
    const chave = `${a.prompt_version ?? "?"}|${a.model_name ?? "?"}`
    if (!obrasPorRegua.has(chave)) obrasPorRegua.set(chave, new Set())
    obrasPorRegua.get(chave)!.add(cs.work_id)
  }
  const detalhe = [...obrasPorRegua.entries()]
    .map(([k, s]) => ({ v: k.split("|")[0], m: k.split("|")[1], obras: s.size }))
    .sort((a, b) => b.obras - a.obras)
  const reguas: Retrato["reguas"] = {
    combinacoes: detalhe.length,
    versoes: new Set(detalhe.map((d) => d.v)).size,
    modelos: new Set(detalhe.map((d) => d.m)).size,
    detalhe,
  }

  // ── 3. REPRODUTIBILIDADE ────────────────────────────────────────────────────
  // 🔴 A comparação SEM controle mistura réguas diferentes e mede a deriva do prompt, não a
  // do modelo. A diferença entre as duas linhas é o tamanho do problema que este painel existe
  // para acompanhar: medido em 2026-08-10, 0,987 → 0,317 (68% vinha da mistura).
  const sugeridas = await todas<{ ai_evaluation_id: string; criterion_slug: string; suggested_score: number | null }>(
    "ai_evaluation_scores",
    "ai_evaluation_id, criterion_slug, suggested_score",
  )
  const semControle = new Map<string, number[]>()
  const comControle = new Map<string, number[]>()
  for (const s of sugeridas) {
    if (s.suggested_score == null) continue
    const a = avalPorId.get(s.ai_evaluation_id)
    if (!a || a.status !== "completed") continue
    const nota = Number(s.suggested_score)
    const k1 = `${a.work_id}|${s.criterion_slug}`
    const k2 = `${k1}|${a.prompt_version}|${a.model_name}`
    if (!semControle.has(k1)) semControle.set(k1, [])
    if (!comControle.has(k2)) comControle.set(k2, [])
    semControle.get(k1)!.push(nota)
    comControle.get(k2)!.push(nota)
  }
  const amplitudes = (m: Map<string, number[]>) =>
    [...m.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ k, amp: Math.max(...v) - Math.min(...v) }))
  const aSem = amplitudes(semControle)
  const aCom = amplitudes(comControle)

  // 🔴 O PISO NA GRANDEZA CERTA. A amplitude (0,289) é por NOTA; a seção 5 fala em FAIXA, e
  // as duas não se convertem — uma amplitude de 0,3 pt não cruza faixa no meio dela e cruza
  // na borda. Sem este número, "o piloto moveu 15% das notas de faixa" não tem contra o quê
  // ser lido, e a tentação é comparar com 0,289, que é exatamente a troca de régua que
  // reprovou a v23–v25 pelo instrumento errado.
  const paresIdenticos = [...comControle.entries()].filter(([, v]) => v.length > 1)
  const flipsIdenticos = paresIdenticos.filter(([, v]) => new Set(v.map(bandForScore)).size > 1).length
  const pisoFlipPct = pct(flipsIdenticos, paresIdenticos.length)
  const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const porCriterio: Record<string, number> = {}
  for (const slug of CRITERION_SLUGS) {
    const xs = aSem.filter((x) => x.k.split("|")[1] === slug).map((x) => x.amp)
    if (xs.length) porCriterio[slug] = media(xs)
  }
  const reprodutibilidade: Retrato["reprodutibilidade"] = {
    pares_sem_controle: aSem.length,
    amplitude_sem_controle: media(aSem.map((x) => x.amp)),
    pares_com_controle: aCom.length,
    amplitude_com_controle: media(aCom.map((x) => x.amp)),
    por_criterio: porCriterio,
  }

  // ── SAÍDA ───────────────────────────────────────────────────────────────────
  const retrato: Retrato = {
    gerado_em: new Date().toISOString(),
    dispersao,
    reguas,
    reprodutibilidade,
  }

  console.log("\n══ PAINEL DE CONSISTÊNCIA ══" + (base ? `  (baseline: ${path.basename(baselinePath!)} de ${base.gerado_em.slice(0, 10)})` : ""))

  console.log("\n1. DISPERSÃO — notas vigentes, por critério (ordenado por σ)")
  console.log("   ⚠️ o ⚠ marca faixa dominante ≥70%: convenção de LEITURA deste painel, não régua do domínio")
  const bandas = [...new Set(Object.values(dispersao).flatMap((d) => Object.keys(d.faixas)))].sort()
  console.log(`   ${"critério".padEnd(18)}${"n".padStart(5)}${"σ".padStart(8)}${"".padEnd(9)}${bandas.map((b) => b.padStart(7)).join("")}   dominante`)
  for (const [slug, d] of Object.entries(dispersao).sort((a, b) => a[1].sigma - b[1].sigma)) {
    const faixas = bandas.map((b) => f1(d.faixas[b] ?? 0).padStart(7)).join("")
    const marca = d.dominante >= 70 ? " ⚠" : "  "
    console.log(
      `   ${slug.padEnd(18)}${String(d.n).padStart(5)}${f2(d.sigma).padStart(8)}${delta(d.sigma, base?.dispersao[slug]?.sigma).padEnd(9)}${faixas}   ${f1(d.dominante)}%${marca}`,
    )
  }

  console.log(`\n2. RÉGUAS VIVAS no catálogo: ${reguas.combinacoes} combinações${delta(reguas.combinacoes, base?.reguas.combinacoes, 0, false)} (${reguas.versoes} versões de prompt × ${reguas.modelos} modelos)`)
  console.log("   🔴 toda comparação ENTRE obras — ordenação, limiar, Ridge, personal_fit — supõe uma régua só")
  for (const d of reguas.detalhe.slice(0, 12)) {
    console.log(`   ${d.v.padEnd(16)} ${d.m.padEnd(28)} ${String(d.obras).padStart(4)} obras`)
  }
  if (reguas.detalhe.length > 12) console.log(`   … e mais ${reguas.detalhe.length - 12}`)

  const r = reprodutibilidade
  console.log("\n3. REPRODUTIBILIDADE — amplitude entre reavaliações da mesma obra")
  console.log(`   sem controlar nada        ${f2(r.amplitude_sem_controle)} pt${delta(r.amplitude_sem_controle, base?.reprodutibilidade.amplitude_sem_controle, 2, false)}   (${r.pares_sem_controle} pares)`)
  console.log(`   controlando versão+modelo ${f2(r.amplitude_com_controle)} pt${delta(r.amplitude_com_controle, base?.reprodutibilidade.amplitude_com_controle, 2, false)}   (${r.pares_com_controle} pares)`)
  const atribuivel = r.amplitude_sem_controle ? pct(r.amplitude_sem_controle - r.amplitude_com_controle, r.amplitude_sem_controle) : 0
  console.log(`   ⇒ ${f1(atribuivel)}% da instabilidade vem da MISTURA de réguas, não do modelo`)
  console.log(`   ⚠️ o piso é o ruído entre rodadas idênticas (0,289 medido) — abaixo disso nada é distinguível`)
  console.log(`   troca de FAIXA entre rodadas idênticas: ${f1(pisoFlipPct)}%  (${flipsIdenticos}/${paresIdenticos.length} pares)`)
  console.log(`   ⚠️ este é o piso da seção 5 — a amplitude de 0,289 é por NOTA e NÃO se converte em faixa`)
  const piores = Object.entries(r.por_criterio).sort((a, b) => b[1] - a[1]).slice(0, 3)
  console.log(`   piores: ${piores.map(([s, v]) => `${s} ${f2(v)}`).join(" · ")}`)

  console.log("\n4. COERÊNCIA prosa×nota — rode `scripts/coherence-audit.ts` (checagem A, estrutural)")
  console.log("   ⚠️ só a checagem A sobrevive à validação manual; as semânticas eram regex sobre prosa e deram 5/5 e 6/6 de falso positivo")

  const pilotoPath = arg("piloto")
  if (pilotoPath) julgarPiloto(pilotoPath, pisoFlipPct)
  console.log()

  const savePath = arg("save")
  if (savePath) {
    fs.mkdirSync(path.dirname(savePath), { recursive: true })
    fs.writeFileSync(savePath, JSON.stringify(retrato, null, 2))
    console.log(`retrato salvo em ${savePath}\n`)
  }
}

// ⚠️ Guarda de entrypoint: sem ela, `import` deste módulo (num teste) DISPARA a varredura do
// catálogo inteiro. Mesmo motivo pelo qual o teste do `db-diff` tem de ler o source em vez de
// importar — e é justamente o que impede testar a estatística que quebrou.
if (process.argv[1] && process.argv[1].endsWith("consistency-panel.ts")) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
