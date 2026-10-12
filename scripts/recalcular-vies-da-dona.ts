/**
 * Recalcula o `attribute_bias` da CONTA PRINCIPAL pela régua atual: amostras de `adult_content` de obra
 * mixed pela VERSÃO LIDA (mig 216) e leitura COMPLETA das amostras (o `select` antigo cortava 1.721 em
 * 1.000). Mesma conta de `recomputeAttributeBias` — que só roda quando a pessoa salva a pós-leitura de
 * atributos; este script aplica a régua sem esperar por isso.
 *
 * ALVO: NUVEM · US$0 · nenhuma chamada de IA · ENSAIO por padrão (só lê).
 *
 *   # 1. ensaio: mostra conta, amostras, viés gravado × recalculado e o comando de execução
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/recalcular-vies-da-dona.ts --cloud
 *   # 2. grava (só os atributos que mudam), salvando o estado anterior em .backups/vies-dona-<stamp>/
 *   npx tsx … scripts/recalcular-vies-da-dona.ts --cloud --execute --amostras=<n> --conta=<prefixo>
 *   # desfazer: devolve as linhas salvas (ensaio sem --execute)
 *   npx tsx … scripts/recalcular-vies-da-dona.ts --cloud --restaurar=.backups/vies-dona-<stamp> [--execute]
 *
 * O alvo é DECLARADO (`--cloud` ou `--local`) e conferido contra a URL efetiva — a mesma régua de
 * `recalculate-scores.ts`. Guardas antes de gravar: conta principal = a linha mais antiga de
 * `user_settings` (a régua de `getOwnerUserId`) e com papel `curador`; leitura paginada igual ao
 * `count: exact`; `--amostras` e `--conta` iguais ao que o ensaio imprimiu. Depois de gravar, confere que
 * nenhuma outra linha de `attribute_bias` mudou. Toca SÓ `attribute_bias`.
 */
import fs from "node:fs"
import path from "node:path"
import { createAdminClient } from "@/lib/supabase/admin"
import { isLocalSupabaseUrl, supabaseTargetLabel } from "@/lib/db-target"
import { attributeBiasRows, computeAttributeBias } from "@/lib/calculations/attribute-bias"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { compararVies, conferirDepois, conferirGuardasVies } from "./lib/vies-dona"
import type { LinhaVies, LinhaViesConta } from "./lib/vies-dona"
import { podar } from "./lib/backups-retencao.mjs"
import { criarFunil } from "./lib/funil.mjs"

const argv = process.argv.slice(2)
const arg = (nome: string) => argv.find((a) => a.startsWith(`--${nome}=`))?.split("=").slice(1).join("=") ?? null
const executar = argv.includes("--execute")

function falhar(msg: string): never {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

const fmt = (v: number | null | undefined) => (v == null ? "—" : Number(v).toFixed(2))

async function lerTodasAsLinhas(sb: ReturnType<typeof createAdminClient>): Promise<LinhaViesConta[]> {
  return fetchAllRows<LinhaViesConta>(
    () => sb.from("attribute_bias").select("user_id, attribute_slug, n_samples, mean_bias_raw, bias_applied, stddev_bias, last_updated_at"),
    { orderBy: ["user_id", "attribute_slug"], label: "attribute_bias" },
  )
}

async function main() {
  // ── Alvo declarado e conferido ──────────────────────────────────────────────────────────
  const cloud = argv.includes("--cloud")
  const local = argv.includes("--local")
  if (cloud === local) falhar("declare o alvo: --cloud (produção) ou --local (clone descartável)")
  if (cloud && isLocalSupabaseUrl()) falhar(`--cloud, mas a URL efetiva é LOCAL (${supabaseTargetLabel()})`)
  if (local && !isLocalSupabaseUrl()) falhar(`--local, mas a URL efetiva NÃO é local (${supabaseTargetLabel()})`)
  console.log(`alvo: ${cloud ? "NUVEM" : "LOCAL"} · ${supabaseTargetLabel()} · ${executar ? "EXECUÇÃO" : "ensaio (nada é gravado)"}`)

  const sb = createAdminClient()

  // ── A conta principal, pela régua do app ────────────────────────────────────────────────
  const { data: dona, error: donaErr } = await sb
    .from("user_settings")
    .select("current_user_id, role")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (donaErr) falhar(`user_settings: ${donaErr.message}`)
  if (!dona?.current_user_id) falhar("user_settings sem linha — não há conta principal")
  const donaId = String(dona.current_user_id)
  console.log(`conta principal: ${donaId} (papel ${dona.role ?? "?"})`)

  const restaurar = arg("restaurar")
  if (restaurar) return restaurarDe(sb, donaId, restaurar)

  // ── Amostras: leitura paginada + contagem exata ────────────────────────────────────────
  const { count, error: countErr } = await sb
    .from("user_attribute_assessment")
    .select("*", { count: "exact", head: true })
    .eq("user_id", donaId)
  if (countErr) falhar(`contagem de user_attribute_assessment: ${countErr.message}`)
  const plano = await computeAttributeBias(donaId, sb, sb)

  const amostras = arg("amostras")
  const falhas = conferirGuardasVies({
    donaId,
    papel: dona.role ?? null,
    lidas: plano.lidas,
    contagemExata: count ?? null,
    executar,
    amostrasInformadas: amostras == null ? null : Number(amostras),
    contaInformada: arg("conta"),
  })

  const antesTudo = await lerTodasAsLinhas(sb)
  const gravadasDona = antesTudo.filter((r) => r.user_id === donaId)
  const novas = attributeBiasRows(donaId, plano.computations, new Date().toISOString())
  const comparacao = compararVies(gravadasDona, novas)

  console.log(`\namostras lidas: ${plano.lidas} (count exato: ${count ?? "?"})`)
  console.log("atributo            lidas  usadas   gravado → recalculado   delta   muda?")
  for (const c of comparacao) {
    const lidas = plano.lidasPorSlug[c.slug] ?? 0
    const delta = c.antes ? Number(c.depois.bias_applied) - Number(c.antes.bias_applied) : null
    console.log(
      `${c.slug.padEnd(19)} ${String(lidas).padStart(5)}  ${String(c.depois.n_samples).padStart(6)}   ` +
        `${fmt(c.antes?.bias_applied).padStart(7)} → ${fmt(c.depois.bias_applied).padStart(6)}   ` +
        `${(delta == null ? "novo" : (delta >= 0 ? "+" : "") + delta.toFixed(2)).padStart(5)}   ${c.muda ? "sim" : "—"}`,
    )
  }
  const fora = gravadasDona.filter((r) => !novas.some((n) => n.attribute_slug === r.attribute_slug))
  if (fora.length) console.log(`fora do recálculo (intocados): ${fora.map((r) => r.attribute_slug).join(", ")}`)

  const mudam = comparacao.filter((c) => c.muda)
  // Em ATRIBUTOS do começo ao fim (as amostras estão na tabela acima): unidades misturadas fariam o
  // funil apontar uma "queda" de 1.700 amostras para 11 atributos que não existe.
  const funil = criarFunil("viés da conta principal, em atributos")
  funil.passo("gravados hoje", gravadasDona.length)
  funil.passo("recalculados pela régua", comparacao.length)
  funil.passo("com viés diferente do gravado", mudam.length)

  if (falhas.length) {
    funil.relatar()
    for (const f of falhas) console.error(`❌ guarda: ${f}`)
    falhar("nada foi gravado.")
  }
  if (mudam.length === 0) {
    funil.nadaAFazer("viés já está pela régua atual — nada a gravar.")
    return
  }
  funil.relatar()

  if (!executar) {
    console.log(`\nensaio: ${mudam.length} atributo(s) mudariam. Para gravar:`)
    console.log(
      `  npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/recalcular-vies-da-dona.ts ` +
        `${cloud ? "--cloud" : "--local"} --execute --amostras=${plano.lidas} --conta=${donaId.slice(0, 8)}`,
    )
    return
  }

  // ── Execução: salva o antes, grava só o que muda, confere o depois ─────────────────────
  podar("vies-dona")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const dir = path.resolve(process.cwd(), ".backups", `vies-dona-${stamp}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "antes.json"), JSON.stringify({ donaId, alvo: supabaseTargetLabel(), linhas: gravadasDona }, null, 2))
  fs.writeFileSync(path.join(dir, "plano.json"), JSON.stringify(mudam, null, 2))
  console.log(`estado anterior salvo em ${path.relative(process.cwd(), dir)}/antes.json`)

  const planejadas: LinhaVies[] = mudam.map((c) => c.depois)
  const { error } = await sb.from("attribute_bias").upsert(mudam.map((c) => c.depois), { onConflict: "user_id,attribute_slug" })
  if (error) falhar(`gravando attribute_bias: ${error.message} — o estado anterior está em ${dir}`)

  const depoisTudo = await lerTodasAsLinhas(sb)
  const pos = conferirDepois({ donaId, antes: antesTudo, depois: depoisTudo, planejadas })
  if (pos.length) {
    for (const f of pos) console.error(`❌ conferência: ${f}`)
    falhar(`a gravação não ficou como planejado — restaure com --restaurar=${path.relative(process.cwd(), dir)} --execute`)
  }
  console.log(`✓ ${mudam.length} atributo(s) gravado(s); nenhuma outra linha de attribute_bias mudou.`)
}

async function restaurarDe(sb: ReturnType<typeof createAdminClient>, donaId: string, dir: string) {
  const arquivo = path.resolve(process.cwd(), dir, "antes.json")
  if (!fs.existsSync(arquivo)) falhar(`não achei ${arquivo}`)
  const salvo = JSON.parse(fs.readFileSync(arquivo, "utf8")) as { donaId: string; linhas: LinhaViesConta[] }
  if (salvo.donaId !== donaId) falhar(`o backup é da conta ${salvo.donaId}, não da principal ${donaId}`)
  const linhas = salvo.linhas.filter((r) => r.user_id === donaId)
  console.log(`restauração: ${linhas.length} linha(s) de ${donaId}`)
  if (!executar) {
    console.log("ensaio: nada foi gravado. Repita com --execute para devolver estas linhas.")
    return
  }
  const { error } = await sb.from("attribute_bias").upsert(linhas, { onConflict: "user_id,attribute_slug" })
  if (error) falhar(`restaurando attribute_bias: ${error.message}`)
  console.log(`✓ ${linhas.length} linha(s) restaurada(s).`)
}

main().catch((e) => falhar(e instanceof Error ? e.message : String(e)))
