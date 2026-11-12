/**
 * Confere TODOS os códigos da Comix vinculados (`work_external_ids`, source='comix') e marca os que
 * devolvem 404 — a lista "Código não funciona (404)" do painel da Comix e o "(404)" da aba Fontes.
 *
 * POR QUÊ: até a migration 222 o 404 só existia no log. Os lotes (capítulos e reviews) passaram a
 * gravar a marca sozinhos, mas o de reviews leva ~11 h para dar a volta no catálogo; este script
 * faz a primeira passada inteira em minutos (uma página por código, sem reviews nem capítulos).
 * Na 1ª medição (lote de capítulos de 11/11), 12 códigos deram 404.
 *
 * A REGRA (dono: `recordSourceLinkStatus`, `lib/external/link-status.ts`):
 *   · 404/410 → marca o código como morto (só se ele ainda é o vinculado);
 *   · página existe → limpa a marca daquele código, se houver;
 *   · indisponível (Cloudflare, timeout, rede) → NÃO grava nada: não prova nada sobre o código.
 * O resumo conta os indisponíveis em separado: muitos deles = rode de novo com o Docker ligado.
 *
 * CUSTO DE IA: ZERO.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA (só as colunas de marca da 222, nunca o vínculo).
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/conferir-links-comix.ts            # ensaio
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/conferir-links-comix.ts --execute
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/conferir-links-comix.ts --limit=20
 */
import { createClient } from "@supabase/supabase-js"
import { fetchComixByIdOutcome } from "../lib/external/comix"
import { recordSourceLinkStatus } from "../lib/external/link-status"
import { classifySourceLink } from "../lib/external/source-link-state"
import { criarFunil } from "./lib/funil.mjs"

const EXECUTE = process.argv.includes("--execute")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? null
const LIMITE = Number(arg("limit")) || Infinity
// Polidez com o origin: uma página por código, em sequência.
const PAUSA_MS = 300

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Linha = {
  id: string
  work_id: string
  external_id: string | null
  is_rejected: boolean | null
  not_found_external_id: string | null
}

/** Paginado e com ordem total (`id`): o `select` corta em 1000 sem avisar. */
async function vinculosComix(): Promise<Linha[]> {
  const out: Linha[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("work_external_ids")
      .select("id, work_id, external_id, is_rejected, not_found_external_id")
      .eq("source", "comix")
      .order("id")
      .range(from, from + 999)
    if (error) throw new Error(`work_external_ids: ${error.message}`)
    out.push(...(data as Linha[]))
    if (data.length < 1000) break
  }
  return out
}

async function obrasAtivas(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("works")
      .select("id, title")
      .eq("is_archived", false)
      .order("id")
      .range(from, from + 999)
    if (error) throw new Error(`works: ${error.message}`)
    for (const w of data as Array<{ id: string; title: string }>) out.set(w.id, w.title)
    if (data.length < 1000) break
  }
  return out
}

async function main() {
  console.log(`conferir-links-comix — ${EXECUTE ? "EXECUTE (grava as marcas)" : "ensaio (não grava)"}`)
  const funil = criarFunil(EXECUTE ? "links da Comix --execute" : "links da Comix")
  const [linhas, ativas] = await Promise.all([vinculosComix(), obrasAtivas()])
  funil.passo("vínculos da Comix", linhas.length)
  // Só o que tem código: ausente declarado e lacuna não têm página para abrir.
  const comCodigo = linhas.filter((l) => {
    const estado = classifySourceLink(l)
    return (estado === "linked" || estado === "dead") && ativas.has(l.work_id)
  })
  const alvo = comCodigo.slice(0, LIMITE)
  funil.passo("com código, em obra ativa", alvo.length)

  const mortos: Array<{ titulo: string; hid: string; nova: boolean }> = []
  let ok = 0
  let indisponiveis = 0
  let revividos = 0
  for (const [i, l] of alvo.entries()) {
    const hid = l.external_id as string
    const { linkStatus } = await fetchComixByIdOutcome(hid)
    if (linkStatus === "not_found") {
      mortos.push({ titulo: ativas.get(l.work_id) ?? l.work_id, hid, nova: l.not_found_external_id !== hid })
    } else if (linkStatus === "ok") {
      ok++
      if (l.not_found_external_id === hid) revividos++
    } else {
      indisponiveis++
    }
    if (EXECUTE && linkStatus) await recordSourceLinkStatus(l.work_id, "comix", hid, linkStatus)
    if ((i + 1) % 50 === 0) console.log(`  … ${i + 1}/${alvo.length} (404: ${mortos.length} · indisponíveis: ${indisponiveis})`)
    await sleep(PAUSA_MS)
  }

  funil.passo("responderam (existe ou 404)", ok + mortos.length, { reterAoMenos: 0.9 })
  funil.passo("com 404", mortos.length)
  const passou = funil.relatar()

  console.log(`\nexiste: ${ok} · 404: ${mortos.length} · indisponíveis: ${indisponiveis} · voltaram a existir: ${revividos}`)
  for (const m of mortos.sort((a, b) => a.titulo.localeCompare(b.titulo))) {
    console.log(`  404 · ${m.hid} · ${m.titulo}${m.nova ? "" : " (já marcada)"}`)
  }
  if (indisponiveis > 0) {
    console.log(`\n⚠️ ${indisponiveis} código(s) não responderam: nada foi gravado para eles. Ligue o Docker e rode de novo.`)
  }
  if (!EXECUTE) {
    if (mortos.length === 0 && revividos === 0) funil.nadaAFazer("nenhuma marca a gravar")
    else console.log(`\nensaio: ${mortos.filter((m) => m.nova).length} marca(s) nova(s) e ${revividos} a limpar. Rode com --execute para gravar.`)
  } else {
    console.log(`\ngravado: ${mortos.length} marcada(s) como 404 · ${revividos} marca(s) limpa(s).`)
  }
  if (!passou) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
