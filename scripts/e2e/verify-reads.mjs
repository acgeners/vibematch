#!/usr/bin/env node
/**
 * A outra metade da Fatia 1: as LEITURAS (/leitura, /favoritos, home).
 * A escrita já foi provada isolada (verify-fatia1.mjs). Aqui a pergunta é a do §13.2.4:
 * a Leitora vê os favoritos e os capítulos DELA — ou os do dono?
 */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const ROOT = "/Users/geners/Code/VibeMatch/animedb"
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"))
const { createServerClient } = require(path.join(ROOT, "node_modules/@supabase/ssr"))

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const APP = "http://localhost:3001"
const { findTestUsers } = await import("./_users.mjs")
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let failures = 0
const check = (cond, msg) => {
  if (cond) console.log(`  ✅ ${msg}`)
  else {
    failures++
    console.log(`  ❌ ${msg}`)
  }
}

async function cookieFor(email) {
  const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  const anonClient = createClient(URL_, ANON, { auth: { persistSession: false } })
  const { data: sess } = await anonClient.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "email",
  })
  const jar = new Map()
  const ssr = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)),
    },
  })
  await ssr.auth.setSession({
    access_token: sess.session.access_token,
    refresh_token: sess.session.refresh_token,
  })
  return {
    userId: sess.user.id,
    cookie: [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; "),
  }
}

const get = async (p, cookie) =>
  (await fetch(`${APP}${p}`, { headers: cookie ? { cookie } : {} })).text()

async function main() {
  const { owner: OWNER, other: OTHER } = await findTestUsers(admin)
  const owner = await cookieFor(OWNER.email)
  const reader = await cookieFor(OTHER.email)

  const readingId = (
    await admin.from("personal_status").select("id").eq("status", "Reading").single()
  ).data.id

  // O que o DONO está lendo (via works — a fonte dele) e o que ele favoritou.
  const { data: hisReading } = await admin
    .from("works")
    .select("id, title")
    .eq("personal_status_id", readingId)
    .eq("is_archived", false)
    .limit(50)
  const { data: hisFavs } = await admin
    .from("works")
    .select("id, title")
    .eq("is_favorite", true)
    .eq("is_archived", false)
    .limit(50)
  console.log(`dono: ${hisReading.length} obras "Reading", ${hisFavs.length} favoritas`)

  // A obra DELA: uma que ele NÃO está lendo e NÃO favoritou.
  const hisReadingIds = new Set(hisReading.map((w) => w.id))
  const hisFavIds = new Set(hisFavs.map((w) => w.id))
  // total_chapters > 3: o widget "Acompanhando" só mostra o que tem capítulo PENDENTE
  // (total − lidos > 0). Sem isso a obra dela seria filtrada e o teste passaria por vazio.
  const { data: pool } = await admin
    .from("works")
    .select("id, title, total_chapters")
    .eq("is_archived", false)
    .gt("total_chapters", 20)
    .limit(300)
  const hers = pool.find((w) => !hisReadingIds.has(w.id) && !hisFavIds.has(w.id))
  console.log(`obra DELA (que ele não lê nem favoritou): ${hers.title}\n`)

  await admin.from("user_work_state").upsert(
    {
      user_id: reader.userId,
      work_id: hers.id,
      is_favorite: true,
      personal_status_id: readingId,
      chapters_read: 3,
      last_read_at: "2026-07-01",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,work_id" },
  )

  console.log("/leitura")
  const [leituraOwner, leituraReader] = await Promise.all([
    get("/leitura", owner.cookie),
    get("/leitura", reader.cookie),
  ])
  const hisTitlesInHers = hisReading.filter((w) => leituraReader.includes(w.title))
  check(leituraOwner.includes(hisReading[0].title), `dono vê a lista DELE (${hisReading[0].title})`)
  check(leituraReader.includes(hers.title), `Leitora vê a obra DELA (${hers.title})`)
  check(
    hisTitlesInHers.length === 0,
    `Leitora NÃO vê nenhuma das ${hisReading.length} obras que ele está lendo` +
      (hisTitlesInHers.length ? ` — vazou: ${hisTitlesInHers.map((w) => w.title).join(", ")}` : ""),
  )
  check(!leituraOwner.includes(hers.title), "o dono NÃO vê a obra dela na lista dele")

  console.log("\n/favorites")
  const [favOwner, favReader] = await Promise.all([
    get("/favorites", owner.cookie),
    get("/favorites", reader.cookie),
  ])
  // ⚠️ NÃO adianta procurar TÍTULO nesta página: ela embute o catálogo INTEIRO (876 de 877
  // obras) no payload do picker de grupos — todo título "aparece", inclusive os favoritos
  // dele. O que importa não é o título estar lá, é o FLAG `isFavorite` de cada obra: é ele
  // que o /favorites usa pra montar o mosaico e a contagem. É esse flag que tem que ser DELA.
  const flags = (html) => {
    const raw = html.replace(/\\"/g, '"')
    const map = new Map()
    for (const m of raw.matchAll(/"title":"((?:[^"\\]|\\.)*)"[^{}]*?"isFavorite":(true|false)/g)) {
      map.set(m[1], m[2] === "true")
    }
    return map
  }
  const fOwner = flags(favOwner)
  const fReader = flags(favReader)

  const hisFlaggedForHer = hisFavs.filter((w) => fReader.get(w.title) === true)
  check(
    fOwner.size > 100 && fReader.size > 100,
    `payload do picker lido nos dois (${fOwner.size} / ${fReader.size} obras)`,
  )
  check(
    hisFavs.every((w) => fOwner.get(w.title) === true),
    `dono: as ${hisFavs.length} favoritas dele vêm marcadas isFavorite=true`,
  )
  check(
    hisFlaggedForHer.length === 0,
    `Leitora: NENHUMA das ${hisFavs.length} favoritas dele vem marcada pra ela` +
      (hisFlaggedForHer.length
        ? ` — vazou: ${hisFlaggedForHer.slice(0, 3).map((w) => w.title).join(", ")}`
        : ""),
  )
  check(
    fReader.get(hers.title) === true,
    `Leitora: a favorita DELA (${hers.title}) vem marcada isFavorite=true`,
  )
  const herTrue = [...fReader.values()].filter(Boolean).length
  check(herTrue === 1, `Leitora tem exatamente 1 favorita (não as ${hisFavs.length} dele) — ${herTrue}`)

  console.log("\n/ (home — cockpit de leitura)")
  const [homeOwner, homeReader] = await Promise.all([
    get("/", owner.cookie),
    get("/", reader.cookie),
  ])
  // ⚠️ A home também tem o widget "melhores por Nota Prevista que você não avaliou", que é
  // CATÁLOGO (expected_score) e é igual pros dois — uma obra que ele está lendo pode aparecer
  // ali legitimamente. Sem descontar esse conjunto, o teste acusa vazamento onde não há.
  // ⚠️ Este conjunto MUDOU na Fase C. O widget "melhores que você não avaliou" era ordenado
  // pela Nota Prevista DO DONO (e filtrado pela nota DELE) — ou seja, a home dela recomendava
  // pelo gosto dele, chamando de "pra você". Agora é per-usuário: sem modelo, ordena pela
  // NOTA DA COMUNIDADE. Então o conjunto a descontar aqui é o topo da comunidade.
  const { data: topUnrated } = await admin
    .from("calculated_scores")
    .select("platform_avg, works!inner(id, title, is_archived)")
    .not("platform_avg", "is", null)
    .eq("works.is_archived", false)
    .order("platform_avg", { ascending: false })
    .limit(12)
  const catalogTitles = new Set((topUnrated ?? []).map((r) => r.works.title))

  const hisInHerHome = hisReading
    .filter((w) => !catalogTitles.has(w.title))
    .filter((w) => homeReader.includes(w.title))
  check(
    hisInHerHome.length === 0,
    `"Acompanhando" da Leitora NÃO traz as obras dele` +
      (hisInHerHome.length ? ` — vazou: ${hisInHerHome.map((w) => w.title).join(", ")}` : ""),
  )
  check(homeReader.includes(hers.title), `"Acompanhando" dela traz a obra DELA (${hers.title})`)
  check(homeOwner !== homeReader, "as duas homes são diferentes (cada um vê o próprio estado)")

  console.log("\n── limpeza")
  await admin
    .from("user_work_state")
    .delete()
    .eq("user_id", reader.userId)
    .eq("work_id", hers.id)
  const { count } = await admin
    .from("user_work_state")
    .select("*", { count: "exact", head: true })
    .eq("user_id", reader.userId)
  check(count === 0, `estado da Leitora limpo (${count} linhas)`)

  console.log(failures === 0 ? "\n✅ LEITURAS ISOLADAS." : `\n❌ ${failures} falha(s).`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`\n💥 ${e.message}`)
  process.exit(1)
})
