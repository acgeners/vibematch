/**
 * FASE E — `works` parou de receber escrita pessoal?
 *
 * ⚠️ ESTE TESTE MUDOU DE CONTRATO. Na Fase A ele exigia que `works` e `user_work_state`
 * ficassem IDÊNTICOS depois de cada writer (o dual-write). A Fase E **removeu** o lado `works`:
 * agora a pergunta é a INVERSA.
 *
 *   ANTES (Fase A):  depois do writer → works == espelho
 *   FASE E:          depois do writer → o ESPELHO tem o valor novo
 *                                     E `works` NÃO mudou (coluna congelada, esperando o DROP)
 *   AGORA (mig 154): depois do writer → o ESPELHO tem o valor novo
 *                                     E as colunas de `works` NÃO EXISTEM (o DROP aconteceu)
 *
 * Não apaguei os asserts: INVERTI, e depois o schema os absorveu. "`works` não recebeu nada" não
 * é mais um fato a conferir em runtime — é uma impossibilidade estrutural. O que sobra pra proteger
 * é a impossibilidade em si: o check 4 fica vermelho no dia em que alguém recriar as colunas e
 * reabrir o caminho do dual-write.
 *
 * Exercita os writers de VERDADE (server actions, sessão do curador). O juiz é o banco.
 */
import fs from "node:fs"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const R = "/Users/geners/Code/VibeMatch/animedb"
for (const l of fs.readFileSync(R + "/.env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const { createClient } = require(R + "/node_modules/@supabase/supabase-js")
const { createServerClient } = require(R + "/node_modules/@supabase/ssr")
const U = process.env.NEXT_PUBLIC_SUPABASE_URL
const A = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const APP = "http://localhost:3001"
const admin = createClient(U, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { findTestUsers } = await import("./_users.mjs")
const { owner: OWNER, other: OTHER } = await findTestUsers(admin)

let failures = 0
const check = (c, m) => {
  if (c) console.log(`  ✅ ${m}`)
  else {
    failures++
    console.log(`  ❌ ${m}`)
  }
}

async function session(email) {
  const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  const a = createClient(U, A, { auth: { persistSession: false } })
  const { data: s } = await a.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "email" })
  const jar = new Map()
  const ssr = createServerClient(U, A, {
    cookies: {
      getAll: () => [...jar].map(([n, v]) => ({ name: n, value: v })),
      setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)),
    },
  })
  await ssr.auth.setSession({
    access_token: s.session.access_token,
    refresh_token: s.session.refresh_token,
  })
  return {
    userId: s.user.id,
    cookie: [...jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; "),
  }
}

async function actionIds(paths) {
  const found = {}
  for (const p of paths) {
    const html = await (await fetch(`${APP}${p}`)).text()
    for (const src of [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1])) {
      const js = await (await fetch(`${APP}${src}`)).text()
      for (const m of js.matchAll(/createServerReference"\]\)\("([0-9a-f]{40,})"[\s\S]{0,600}?"(\w+)"\)/g)) {
        found[m[2]] = m[1]
      }
    }
  }
  return found
}

const call = async (id, args, cookie, referer = "/catalog") =>
  (
    await fetch(`${APP}${referer}`, {
      method: "POST",
      headers: {
        "Next-Action": id,
        "Content-Type": "text/plain;charset=UTF-8",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(args),
    })
  ).text()

const COLS = [
  // `is_favorite` FALTAVA aqui. O check 3 o conferia à parte, então o check 4 (o catálogo
  // inteiro) nunca olhou pra ele — 882 obras varridas, e o favorito não era uma delas.
  "is_favorite",
  "personal_status_id",
  "chapters_read",
  "user_score",
  "observations",
  "observation_adjustment",
  "synopsis_quality",
  "synopsis_quality_source",
  "synopsis_interest_skipped",
  "post_story_score",
]

/** A linha do espelho do dono (a que tem que RECEBER a escrita). */
const mirrorRow = async (ownerId, workId) =>
  (
    await admin
      .from("user_work_state")
      .select(COLS.join(", "))
      .eq("user_id", ownerId)
      .eq("work_id", workId)
      .maybeSingle()
  ).data

const owner = await session(OWNER.email)

// O check 4 era: "varre as 882 obras e prova que nenhuma coluna pessoal de `works` se mexeu".
//
// A migration 154 dropou essas 19 colunas. O check virou impossível de escrever — e desnecessário:
// um writer não consegue mais mover o que não existe. O schema passou a garantir por CONSTRUÇÃO o
// que a suíte conferia em runtime, o que é estritamente mais forte (o antigo só pegava as obras que
// ele varria; este pega qualquer escrita, em qualquer obra, pra sempre).
//
// Então o check 4 vira uma asserção de SCHEMA: as colunas continuam mortas. Se alguém as recriar
// (um "só pra facilitar", uma migration revertida), o dual-write volta a ser possível — e isto
// fica vermelho antes que volte a corromper dado.
const { data: ressuscitadas, error: schemaErr } = await admin
  .from("works")
  .select(COLS.join(", "))
  .limit(1)

const colunasMortas = Boolean(schemaErr) && /does not exist/i.test(schemaErr.message)

const { data: firstWork } = await admin.from("works").select("id").limit(1).single()
const ids = await actionIds(["/catalog", `/catalog/${firstWork.id}`, "/curation/works"])
console.log(`dono: ${owner.userId}\n`)

// As obras-cobaia agora saem do ESPELHO do dono — `works` não tem mais o dado pessoal com que
// escolhê-las (era `.not("synopsis_quality","is",null)` na tabela compartilhada).
const { data: w1 } = await admin
  .from("user_work_state")
  .select("work_id, synopsis_quality")
  .eq("user_id", owner.userId)
  .not("synopsis_quality", "is", null)
  .limit(1)
  .single()

// ── 1. setSynopsisQualityAction (triagem manual do ♥)
console.log("1) setSynopsisQualityAction — triagem manual do ♥")
const orig1 = w1.synopsis_quality
const novo1 = orig1 === "♥♥♥♥" ? "♥" : "♥♥♥♥"
if (ids.setSynopsisQualityAction) {
  await call(ids.setSynopsisQualityAction, [w1.work_id, novo1], owner.cookie)
  const esp = await mirrorRow(owner.userId, w1.work_id)
  check(esp?.synopsis_quality === novo1, `o ESPELHO recebeu o ♥ novo (${esp?.synopsis_quality})`)
  await call(ids.setSynopsisQualityAction, [w1.work_id, orig1], owner.cookie) // restaura
} else {
  console.log("  ⏭️  action não encontrada no bundle (a página /curation/works não a expõe aqui)")
}

// ── 2. updateWorkStatus (o form de status — já era espelhado; regressão)
console.log("\n2) updateWorkStatus — o form de status")
const { data: w2 } = await admin
  .from("user_work_state")
  .select("work_id, chapters_read, user_score, personal_status_id, observations, observation_adjustment, synopsis_quality")
  .eq("user_id", owner.userId)
  .not("user_score", "is", null)
  .limit(1)
  .single()
await call(
  ids.updateWorkStatus,
  [
    w2.work_id,
    {
      personal_status: "Reading",
      chapters_read: (w2.chapters_read ?? 0) + 1,
      user_score: w2.user_score,
      observations: w2.observations,
      observation_adjustment: w2.observation_adjustment ?? 0,
      synopsis_quality: w2.synopsis_quality,
    },
  ],
  owner.cookie,
)
const esp2 = await mirrorRow(owner.userId, w2.work_id)
check(
  esp2?.chapters_read === (w2.chapters_read ?? 0) + 1,
  `o ESPELHO recebeu o capítulo +1 (${esp2?.chapters_read})`,
)

// ── 3. toggleFavorite
console.log("\n3) toggleFavorite")
await call(ids.toggleFavorite, [w2.work_id, true], owner.cookie)
const { data: f2 } = await admin
  .from("user_work_state")
  .select("is_favorite")
  .eq("user_id", owner.userId)
  .eq("work_id", w2.work_id)
  .single()
check(f2.is_favorite === true, "o ESPELHO recebeu o favorito (true)")
await call(ids.toggleFavorite, [w2.work_id, false], owner.cookie)

// ── 4. 🔴 `works` NÃO PODE receber escrita pessoal — agora garantido pelo SCHEMA
//
// Este check já tinha mudado de pergunta uma vez. Era "quantas obras têm works ≠ espelho?" (o
// invariante do dual-write); virou "alguma coluna pessoal de `works` se mexeu durante os writers?".
//
// A migration 154 dropou as 19 colunas, e a pergunta virou melhor ainda: elas não existem. Um
// dual-write não "não acontece" — ele é IMPOSSÍVEL, e um `insert`/`update` que tentasse escrever
// nelas explodiria com 42703 em vez de corromper em silêncio. Varrer 882 linhas procurando
// movimento numa coluna inexistente seria teatro.
//
// O que sobra pra guardar é o schema: se alguém recriar essas colunas (um "só pra facilitar", uma
// migration revertida), o caminho do dual-write reabre. Isto fica vermelho no dia em que reabrir.
console.log("\n4) 🔴 `works` não tem mais as colunas pessoais — o dual-write é impossível?")
check(
  colunasMortas,
  colunasMortas
    ? `as ${COLS.length} colunas pessoais seguem MORTAS em \`works\` (migration 154)`
    : `🔴 as colunas pessoais VOLTARAM a existir em \`works\` (${ressuscitadas ? "o select passou" : schemaErr?.message}) — o caminho do dual-write reabriu`,
)

const PAGE = 500
const all = async (t, cols, uid) => {
  const rows = []
  for (let f = 0; ; f += PAGE) {
    let q = admin.from(t).select(cols).order(uid ? "work_id" : "id").range(f, f + PAGE - 1)
    if (uid) q = q.eq("user_id", uid)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

// E o espelho do dono tem que estar VIVO — se ele estivesse vazio, os checks acima passariam
// por vacuidade (nada escrito em works, nada escrito em lugar nenhum).
const espelho = await all("user_work_state", ["work_id", ...COLS].join(", "), owner.userId)
check(
  espelho.length > 800,
  `o espelho do dono tem ${espelho.length} linhas (não ficou vazio — os checks acima não passam por vacuidade)`,
)

// restaura o capítulo da obra 2
await call(
  ids.updateWorkStatus,
  [
    w2.id,
    {
      personal_status: "Reading",
      chapters_read: w2.chapters_read,
      user_score: w2.user_score,
      observations: w2.observations,
      observation_adjustment: w2.observation_adjustment ?? 0,
      synopsis_quality: w2.synopsis_quality,
    },
  ],
  owner.cookie,
)

console.log(
  failures === 0
    ? "\n✅ `works` NÃO recebe mais escrita pessoal — o espelho é a única fonte."
    : `\n❌ ${failures} falha(s).`,
)
process.exit(failures === 0 ? 0 : 1)
