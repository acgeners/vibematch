/**
 * Carrega a classificação etária (Livre a 14 · 16 · 18) medida pela auditoria em `work_age_rating`
 * (migration 223) e recalcula o gate 18+ das obras afetadas (`official_rating`).
 *
 * ALVO: NUVEM — grava em `work_age_rating` e em `works.adult_auto`. US$0, nenhuma chamada de modelo.
 *
 * Uso (do checkout com `.env.local`; o `.backups/` é o do checkout):
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local \
 *     scripts/carregar-classificacao-etaria.ts --arquivo=<carga-classificacao.json>
 *   ... --execute     # grava (o padrão é ensaio)
 *
 * O arquivo sai de `Auditoria/classificacao-etaria-2026-11-14/scripts/aplicar_regra_grupos.py`
 * (fora do git: traz rótulos e ids de produtos de plataformas, lidos em 14–15/11/2026).
 *
 * Regras (plano puro em `scripts/lib/classificacao-etaria.ts`):
 * - linha decidida pela CURADORIA nunca é sobrescrita;
 * - linha cuja estrutura editorial mudou desde a auditoria (virou ou deixou de ser mixed) é pulada;
 * - o gate é decidido por `decideAdultAuto`, a mesma régua do app, e conferido depois por
 *   `planAdultAuto` (que relê do banco): divergência = falha.
 *
 * Desfazer a 1ª carga (a tabela nasceu vazia): o estado anterior do gate fica em
 * `.backups/classificacao-etaria-<stamp>/antes.json`; as linhas da auditoria saem com
 * `delete from work_age_rating where decidido_por = 'auditoria'`.
 */
import fs from "node:fs"
import path from "node:path"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { planAdultAuto } from "@/lib/tags/adult-classify"
import { parseAgeRating } from "@/lib/age-rating/age-rating"
import type { AgeRating } from "@/lib/age-rating/age-rating"
import { exigeAlvoNuvem } from "@/scripts/lib/exige-alvo-nuvem"
import { isAdultEfetivo, planejarCarga, planejarGate } from "./lib/classificacao-etaria"
import type { LinhaCarga, LinhaGravada, ObraAtual } from "./lib/classificacao-etaria"
import { podar } from "./lib/backups-retencao.mjs"
import { criarFunil } from "./lib/funil.mjs"

const EXECUTE = process.argv.includes("--execute")
const ARQUIVO = process.argv.find((a) => a.startsWith("--arquivo="))?.slice("--arquivo=".length) ?? null
const COMANDO =
  "npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/carregar-classificacao-etaria.ts --arquivo=<arquivo> --execute"
const CHUNK = 200

function falhar(msg: string): never {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

async function main() {
  if (EXECUTE) exigeAlvoNuvem(COMANDO)
  if (!ARQUIVO) falhar("faltou --arquivo=<carga-classificacao.json>")
  const entrada = JSON.parse(fs.readFileSync(path.resolve(ARQUIVO), "utf8")) as { linhas?: LinhaCarga[]; backup_base?: string }
  const linhas = entrada.linhas ?? []
  if (linhas.length === 0) falhar("o arquivo não tem linhas")

  const sb = createAdminClient()
  console.log(`alvo: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(EXECUTE ? "modo: EXECUTE (grava)" : "modo: ensaio (nada é gravado)")
  console.log(`arquivo: ${ARQUIVO} (auditoria sobre o backup ${entrada.backup_base ?? "?"})\n`)

  // ── Estado atual ────────────────────────────────────────────────────────────────────────
  const ids = [...new Set(linhas.map((l) => l.work_id))]
  const obras = new Map<string, ObraAtual>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await sb
      .from("works")
      .select("id, edition_state, adult_auto, adult_reason, adult_override, is_adult")
      .in("id", ids.slice(i, i + CHUNK))
    if (error) falhar(`works: ${error.message}`)
    for (const w of (data ?? []) as ObraAtual[]) obras.set(w.id, w)
  }
  const gravadasLista = await fetchAllRows<Record<string, unknown>>(
    () => sb.from("work_age_rating").select("work_id, versao, faixa, conflito, evidencia, decidido_por"),
    { orderBy: ["work_id", "versao"], label: "work_age_rating" },
  )
  const gravadas = new Map<string, LinhaGravada>(
    gravadasLista.map((r) => [
      `${r.work_id}:${r.versao}`,
      {
        work_id: r.work_id as string,
        versao: r.versao as LinhaGravada["versao"],
        faixa: parseAgeRating(r.faixa),
        conflito: (r.conflito as string | null) ?? null,
        evidencia: (r.evidencia as Record<string, unknown>) ?? {},
        decidido_por: r.decidido_por === "curadoria" ? "curadoria" : "auditoria",
      },
    ]),
  )

  const plano = planejarCarga(linhas, obras, gravadas)
  const funil = criarFunil("classificação etária, em linhas")
  funil.passo("no arquivo", plano.lidas)
  funil.passo("de obra que existe", plano.existentes)
  funil.passo("com a estrutura editorial de hoje", plano.versaoCompativel)
  funil.passo("não decididas pela curadoria", plano.livresDeCuradoria)
  funil.passo("novas ou diferentes do gravado", plano.gravar.length)

  // ── Gate 18+: candidatas = faixa 18 na linha `obra` (final) ∪ ligadas hoje por official_rating
  const faixaObraFinal = new Map<string, AgeRating | null>()
  for (const g of gravadas.values()) if (g.versao === "obra") faixaObraFinal.set(g.work_id, g.faixa)
  for (const g of plano.gravar) if (g.versao === "obra") faixaObraFinal.set(g.work_id, g.faixa)
  const { data: ligadasHoje, error: lErr } = await sb.from("works").select("id, edition_state, adult_auto, adult_reason, adult_override, is_adult").eq("adult_reason", "official_rating")
  if (lErr) falhar(`works official_rating: ${lErr.message}`)
  for (const w of (ligadasHoje ?? []) as ObraAtual[]) obras.set(w.id, w)
  const candidatas = [
    ...new Set([...[...faixaObraFinal].filter(([, f]) => f === 18).map(([id]) => id), ...((ligadasHoje ?? []) as ObraAtual[]).map((w) => w.id)]),
  ]
  const temForte = new Set<string>()
  for (let i = 0; i < candidatas.length; i += CHUNK) {
    const lote = candidatas.slice(i, i + CHUNK)
    // Filtro no embed (`!inner` + eq) em vez de `.in("tag_id", <todas as fortes>)`: a lista de ids
    // de tag na URL somada à de obras passaria do limite de tamanho do gateway.
    const rows = await fetchAllRows<{ work_id: string }>(
      () =>
        sb
          .from("work_tags")
          .select("work_id, tags!inner(adult_indicator_strong)")
          .in("work_id", lote)
          .eq("tags.adult_indicator_strong", true),
      { orderBy: ["work_id", "tag_id"], label: "work_tags fortes" },
    )
    for (const r of rows) temForte.add(r.work_id)
  }
  const gate = planejarGate(candidatas, obras, temForte, faixaObraFinal)
  funil.passo("obras com faixa 18 ou ligadas por ela (gate)", candidatas.length)
  funil.passo("com o gate 18+ mudando", gate.length)

  const conflitos = plano.gravar.filter((g) => g.conflito).length
  const porFaixa = new Map<string, number>()
  for (const g of plano.gravar) porFaixa.set(`${g.versao}:${g.faixa ?? "sem"}`, (porFaixa.get(`${g.versao}:${g.faixa ?? "sem"}`) ?? 0) + 1)
  console.log(`a gravar por versão:faixa → ${[...porFaixa].map(([k, v]) => `${k}=${v}`).join(" · ")}`)
  console.log(`conflitos que entram na fila: ${conflitos} · linhas iguais (não regravadas): ${plano.iguais}`)
  const liga = gate.filter((g) => g.depois.adult_auto).length
  console.log(`gate 18+: ${liga} liga(m) por official_rating · ${gate.length - liga} desliga(m)`)
  // O que o LEITOR vê: o is_adult efetivo (override, estrutura) antes × depois.
  const entram = gate.filter((g) => { const o = obras.get(g.work_id)!; return !isAdultEfetivo(o, g.antes.adult_auto) && isAdultEfetivo(o, g.depois.adult_auto) })
  const saem = gate.filter((g) => { const o = obras.get(g.work_id)!; return isAdultEfetivo(o, g.antes.adult_auto) && !isAdultEfetivo(o, g.depois.adult_auto) })
  const titulo = new Map(linhas.map((l) => [l.work_id, l.title]))
  console.log(`quem oculta 18+ deixa de ver ${entram.length} obra(s) e passa a ver ${saem.length}; ${gate.length - entram.length - saem.length} só mudam o motivo (já eram 18+, ou o override/estrutura decide)`)
  for (const g of entram) console.log(`  entra no 18+: ${titulo.get(g.work_id) ?? g.work_id}`)
  for (const g of saem) console.log(`  sai do 18+: ${titulo.get(g.work_id) ?? g.work_id}`)
  for (const p of plano.puladas) console.log(`  pulada: ${p.title} (${p.versao}) — ${p.motivo}`)

  if (plano.gravar.length === 0 && gate.length === 0) {
    funil.nadaAFazer("classificação já está como no arquivo — nada a gravar.")
    return
  }
  funil.relatar()

  if (!EXECUTE) {
    console.log(`\nensaio: nada foi gravado. Para gravar:\n  ${COMANDO.replace("<arquivo>", ARQUIVO)}`)
    return
  }

  // ── Execução: salva o antes, grava, confere ──────────────────────────────────────────────
  podar("classificacao-etaria")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const dir = path.resolve(process.cwd(), ".backups", `classificacao-etaria-${stamp}`)
  fs.mkdirSync(dir, { recursive: true })
  const tocadas = new Set(plano.gravar.map((g) => `${g.work_id}:${g.versao}`))
  fs.writeFileSync(
    path.join(dir, "antes.json"),
    JSON.stringify(
      {
        alvo: process.env.NEXT_PUBLIC_SUPABASE_URL,
        linhas: [...gravadas.entries()].filter(([k]) => tocadas.has(k)).map(([, v]) => v),
        gate: gate.map((g) => ({ work_id: g.work_id, ...g.antes })),
      },
      null,
      1,
    ),
  )
  fs.writeFileSync(path.join(dir, "plano.json"), JSON.stringify({ gravar: plano.gravar, gate }, null, 1))
  console.log(`estado anterior salvo em ${path.relative(process.cwd(), dir)}/antes.json`)

  const agora = new Date().toISOString()
  for (let i = 0; i < plano.gravar.length; i += CHUNK) {
    const lote = plano.gravar.slice(i, i + CHUNK).map((g) => ({ ...g, atualizado_em: agora }))
    const { data, error } = await sb.from("work_age_rating").upsert(lote, { onConflict: "work_id,versao" }).select("work_id")
    if (error) falhar(`gravando work_age_rating: ${error.message} — o estado anterior está em ${dir}`)
    if ((data ?? []).length !== lote.length) falhar(`work_age_rating: enviei ${lote.length}, o banco devolveu ${(data ?? []).length}`)
  }
  for (const g of gate) {
    const { error } = await sb.from("works").update(g.depois).eq("id", g.work_id)
    if (error) falhar(`gate de ${g.work_id}: ${error.message} — o estado anterior está em ${dir}`)
  }

  // Conferência: a régua do app, relendo do banco, não pode querer mudar mais nada.
  const restantes: string[] = []
  for (const id of candidatas) {
    const d = await planAdultAuto(sb, id)
    if (d) restantes.push(`${id} → ${JSON.stringify(d)}`)
  }
  if (restantes.length) {
    for (const r of restantes) console.error(`❌ conferência: ${r}`)
    falhar(`o gate não ficou como a régua do app decide — estado anterior em ${dir}`)
  }
  console.log(`✓ ${plano.gravar.length} linha(s) gravada(s); gate de ${gate.length} obra(s) atualizado e conferido.`)
}

main().catch((e) => falhar(e instanceof Error ? e.message : String(e)))
