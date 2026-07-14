/**
 * FASE E — `works` parou de receber escrita pessoal?
 *
 * ⚠️ ESTE TESTE MUDOU DE CONTRATO. Na Fase A ele exigia que `works` e `user_work_state`
 * ficassem IDÊNTICOS depois de cada writer (o dual-write). A Fase E **removeu** o lado `works`:
 * agora a pergunta é a INVERSA.
 *
 *   ANTES (Fase A):  depois do writer → works == espelho
 *   AGORA (Fase E):  depois do writer → o ESPELHO tem o valor novo
 *                                     E `works` NÃO mudou (a coluna está congelada, esperando o DROP)
 *
 * Não apaguei os asserts: INVERTI. "`works` não recebeu nada" é o invariante que passa a valer
 * a pena proteger — a regressão a temer agora é alguém RE-ADICIONAR um dual-write, e é
 * exatamente isso que este teste pega.
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

const call = async (id, args, cookie, referer = "/titles") =>
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

const same = (a, b, col) =>
  col === "observation_adjustment"
    ? Number(a ?? 0) === Number(b ?? 0)
    : String(a ?? null) === String(b ?? null)

/** As colunas pessoais da linha COMPARTILHADA (a que tem que ficar PARADA). */
const worksRow = async (workId) =>
  (await admin.from("works").select(COLS.join(", ")).eq("id", workId).single()).data

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

/** `works` mexeu depois do writer? Se mexeu, alguém re-adicionou um dual-write. */
const worksMexeu = (antes, depois) =>
  COLS.filter((c) => !same(antes[c], depois[c], c)).map(
    (c) => `${c}: ${antes[c]} → ${depois[c]}`,
  )

const owner = await session(OWNER.email)

// 📸 O estado de `works` ANTES de qualquer writer rodar. É o baseline do check 4: nenhuma
// coluna pessoal da linha compartilhada pode ter se mexido no fim do teste.
const WORKS_ANTES = await (async () => {
  const rows = []
  for (let f = 0; ; f += 500) {
    const { data, error } = await admin
      .from("works")
      .select(["id", ...COLS].join(", "))
      .order("id")
      .range(f, f + 499)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 500) break
  }
  return rows
})()

const { data: firstWork } = await admin.from("works").select("id").limit(1).single()
const ids = await actionIds(["/titles", `/titles/${firstWork.id}`, "/ai-evaluation"])
console.log(`dono: ${owner.userId}\n`)

// ── 1. setSynopsisQualityAction (triagem manual do ♥)
console.log("1) setSynopsisQualityAction — triagem manual do ♥")
const { data: w1 } = await admin
  .from("works")
  .select("id, title, synopsis_quality")
  .not("synopsis_quality", "is", null)
  .limit(1)
  .single()
const orig1 = w1.synopsis_quality
const novo1 = orig1 === "♥♥♥♥" ? "♥" : "♥♥♥♥"
if (ids.setSynopsisQualityAction) {
  const antes = await worksRow(w1.id)
  await call(ids.setSynopsisQualityAction, [w1.id, novo1], owner.cookie)
  const esp = await mirrorRow(owner.userId, w1.id)
  const mexeu = worksMexeu(antes, await worksRow(w1.id))
  check(esp?.synopsis_quality === novo1, `o ESPELHO recebeu o ♥ novo (${esp?.synopsis_quality})`)
  check(mexeu.length === 0, "`works` NÃO mudou" + (mexeu.length ? ` — VOLTOU O DUAL-WRITE: ${mexeu}` : ""))
  await call(ids.setSynopsisQualityAction, [w1.id, orig1], owner.cookie) // restaura
} else {
  console.log("  ⏭️  action não encontrada no bundle (a página /ai-evaluation não a expõe aqui)")
}

// ── 2. updateWorkStatus (o form de status — já era espelhado; regressão)
console.log("\n2) updateWorkStatus — o form de status")
const { data: w2 } = await admin
  .from("works")
  .select("id, title, chapters_read, user_score, personal_status_id, observations, observation_adjustment, synopsis_quality")
  .not("user_score", "is", null)
  .limit(1)
  .single()
const w2Antes = await worksRow(w2.id)
await call(
  ids.updateWorkStatus,
  [
    w2.id,
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
const esp2 = await mirrorRow(owner.userId, w2.id)
const mexeu2 = worksMexeu(w2Antes, await worksRow(w2.id))
check(
  esp2?.chapters_read === (w2.chapters_read ?? 0) + 1,
  `o ESPELHO recebeu o capítulo +1 (${esp2?.chapters_read})`,
)
check(mexeu2.length === 0, "`works` NÃO mudou" + (mexeu2.length ? ` — VOLTOU O DUAL-WRITE: ${mexeu2}` : ""))

// ── 3. toggleFavorite
console.log("\n3) toggleFavorite")
const favAntes = (await worksRow(w2.id)).is_favorite
await call(ids.toggleFavorite, [w2.id, true], owner.cookie)
const { data: f1 } = await admin.from("works").select("is_favorite").eq("id", w2.id).single()
const { data: f2 } = await admin
  .from("user_work_state")
  .select("is_favorite")
  .eq("user_id", owner.userId)
  .eq("work_id", w2.id)
  .single()
check(f2.is_favorite === true, "o ESPELHO recebeu o favorito (true)")
check(
  f1.is_favorite === favAntes,
  `\`works.is_favorite\` NÃO mudou (segue ${favAntes})` +
    (f1.is_favorite !== favAntes ? " — VOLTOU O DUAL-WRITE" : ""),
)
await call(ids.toggleFavorite, [w2.id, false], owner.cookie)

// ── 4. 🔴 O CATÁLOGO INTEIRO — `works` ficou PARADA?
//
// Este check mudou de pergunta. Ele era "quantas obras têm works ≠ espelho?" (o invariante do
// dual-write). Agora `works` não é mais escrita, então divergir é o ESPERADO — o espelho anda,
// a coluna morta não. Perguntar aquilo hoje seria exigir que o bug voltasse.
//
// A pergunta que vale: depois de rodar TODOS os writers acima, alguma coluna pessoal de `works`
// se mexeu? Se mexeu, alguém re-adicionou um dual-write — e é isso que não pode voltar.
console.log("\n4) 🔴 O catálogo inteiro — `works` ficou parada durante os writers?")
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

const worksDepois = await all("works", ["id", ...COLS].join(", "))
const antesById = new Map(WORKS_ANTES.map((w) => [w.id, w]))
const mexidas = worksDepois.filter((w) => {
  const antes = antesById.get(w.id)
  if (!antes) return false // obra criada durante o teste (não é escrita pessoal)
  return COLS.some((c) => !same(antes[c], w[c], c))
})
check(
  mexidas.length === 0,
  `${worksDepois.length} obras conferidas · \`works\` mexeu em: ${mexidas.length}` +
    (mexidas.length ? ` 🔴 VOLTOU O DUAL-WRITE (ex.: ${mexidas.slice(0, 3).map((d) => d.id.slice(0, 8))})` : ""),
)

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
