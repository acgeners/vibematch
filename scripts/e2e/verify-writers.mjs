/**
 * FASE A — o espelho parou de apodrecer?
 *
 * Antes: 8 caminhos de curadoria escreviam dado pessoal em `works` e o espelho ficava para
 * trás — em silêncio. Este teste exercita os writers de VERDADE (server actions, sessão do
 * curador) e, depois de cada um, exige que `works` e `user_work_state` estejam IDÊNTICOS.
 *
 * Sem este teste, "religuei os writers" é uma afirmação, não um fato.
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

/** works × espelho do dono: iguais? É a única pergunta deste teste. */
async function drift(ownerId, workId) {
  const { data: w } = await admin.from("works").select(COLS.join(", ")).eq("id", workId).single()
  const { data: s } = await admin
    .from("user_work_state")
    .select(COLS.join(", "))
    .eq("user_id", ownerId)
    .eq("work_id", workId)
    .maybeSingle()
  if (!s) return ["(sem linha no espelho)"]
  return COLS.filter((c) => {
    const a = w[c] ?? null
    const b = s[c] ?? null
    if (c === "observation_adjustment") return Number(a ?? 0) !== Number(b ?? 0)
    return String(a) !== String(b)
  }).map((c) => `${c}: works=${w[c]} espelho=${s[c]}`)
}

const owner = await session(OWNER.email)
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
  await call(ids.setSynopsisQualityAction, [w1.id, novo1], owner.cookie)
  const d = await drift(owner.userId, w1.id)
  check(d.length === 0, `♥ mudou pra ${novo1} e o espelho acompanhou` + (d.length ? ` — DIVERGIU: ${d}` : ""))
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
const d2 = await drift(owner.userId, w2.id)
check(d2.length === 0, "capítulo +1 e o espelho acompanhou" + (d2.length ? ` — DIVERGIU: ${d2}` : ""))

// ── 3. toggleFavorite
console.log("\n3) toggleFavorite")
await call(ids.toggleFavorite, [w2.id, true], owner.cookie)
const { data: f1 } = await admin.from("works").select("is_favorite").eq("id", w2.id).single()
const { data: f2 } = await admin
  .from("user_work_state")
  .select("is_favorite")
  .eq("user_id", owner.userId)
  .eq("work_id", w2.id)
  .single()
check(f1.is_favorite === f2.is_favorite, `favorito espelhado (${f1.is_favorite})`)
await call(ids.toggleFavorite, [w2.id, false], owner.cookie)

// ── 4. O CATÁLOGO INTEIRO: nenhuma obra divergente
console.log("\n4) 🔴 O catálogo inteiro — quantas obras têm works ≠ espelho?")
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
const works = await all("works", ["id", ...COLS].join(", "))
const state = await all("user_work_state", ["work_id", ...COLS].join(", "), owner.userId)
const byId = new Map(state.map((s) => [s.work_id, s]))
const divergentes = works.filter((w) => {
  const s = byId.get(w.id)
  if (!s) return true
  return COLS.some((c) => {
    const a = w[c] ?? null
    const b = s[c] ?? null
    if (c === "observation_adjustment") return Number(a ?? 0) !== Number(b ?? 0)
    return String(a) !== String(b)
  })
})
check(
  divergentes.length === 0,
  `${works.length} obras conferidas · divergentes: ${divergentes.length}` +
    (divergentes.length ? ` (ex.: ${divergentes.slice(0, 3).map((d) => d.id.slice(0, 8))})` : ""),
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

console.log(failures === 0 ? "\n✅ O ESPELHO PAROU DE APODRECER." : `\n❌ ${failures} falha(s).`)
process.exit(failures === 0 ? 0 : 1)
