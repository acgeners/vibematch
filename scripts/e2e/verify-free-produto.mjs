/**
 * O PRODUTO FREE — a Leitora cria os grupos dela e cadastra obra, sem gastar um token.
 *
 * As três coisas que não podem acontecer:
 *   1. ela ver os grupos DELE
 *   2. ela APAGAR/EDITAR um grupo dele passando o id (as actions usam service role em vários
 *      lugares — id não é segredo)
 *   3. a criação de obra dela disparar LLM (sairia do SALDO DA ANTHROPIC dele)
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

let fails = 0
const check = (c, m) => {
  console.log(`  ${c ? "✅" : "❌"} ${m}`)
  if (!c) fails++
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

const call = async (id, args, cookie, referer = "/favorites") =>
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

const owner = await session(OWNER.email)
const reader = await session(OTHER.email)
const ids = await actionIds(["/favorites", "/catalog", "/catalog/new"])
console.log(`createWorkList: ${ids.createWorkList ?? "?"} · deleteWorkList: ${ids.deleteWorkList ?? "?"}\n`)

// Grupos DELE, antes.
const { data: hisLists } = await admin.from("work_lists").select("id, name").eq("user_id", owner.userId)
console.log(`o dono tem ${hisLists.length} grupos: ${hisLists.map((l) => l.name).join(", ")}\n`)

console.log("1) A LEITORA CRIA UM GRUPO DELA")
const res = await call(ids.createWorkList, [{ name: "GRUPO DA LEITORA", color: "rose" }], reader.cookie)
check(!res.includes("Só o Curador"), "não recusada por papel (own_state vale pro leitor)")
const { data: herLists } = await admin.from("work_lists").select("id, name").eq("user_id", reader.userId)
check(herLists.length === 1, `o grupo é DELA (${herLists.length} grupo, user_id dela)`)

console.log("\n2) 🔴 ELA VÊ OS GRUPOS DELE?")
const favHtml = (await (await fetch(`${APP}/favorites`, { headers: { cookie: reader.cookie } })).text()).replace(/\\"/g, '"')
const vazou = hisLists.filter((l) => favHtml.includes(`"name":"${l.name}"`))
check(vazou.length === 0, `nenhum dos ${hisLists.length} grupos dele aparece pra ela` + (vazou.length ? ` — VAZOU: ${vazou.map((l) => l.name)}` : ""))
check(favHtml.includes("GRUPO DA LEITORA"), "e o grupo DELA aparece")

console.log("\n3) 🔴 ELA CONSEGUE APAGAR UM GRUPO DELE? (id não é segredo)")
const alvo = hisLists[0]
await call(ids.deleteWorkList, [alvo.id], reader.cookie)
const { data: aindaExiste } = await admin.from("work_lists").select("id").eq("id", alvo.id).maybeSingle()
check(aindaExiste != null, `o grupo "${alvo.name}" DELE continua de pé — a RLS negou`)

console.log("\n4) 🔴 CRIAR OBRA CUSTA IA PRA ELA?")
const { count: iaAntes } = await admin.from("ai_api_calls").select("*", { count: "exact", head: true })
const nome = `OBRA TESTE FREE ${Date.now()}`
// ⚠️ A UI usa `createWork` (o `createWorkPending` é código morto — nenhum bundle o referencia).
// Testar o endpoint errado é testar nada: o 404 "passava" porque a resposta não continha
// "Só o Curador".
const criar = await call(
  ids.createWork,
  [{ title: nome, publication_status: "Unknown", personal_status: "Want to Read", observation_adjustment: 0, tags: [], genres: [], alternative_titles: [], covers: [], synopses: [], story: 9, adult_content: 9 }],
  reader.cookie,
  "/catalog/new",
)
check(!criar.includes("Só o Curador"), "a Leitora PODE cadastrar obra")
const { data: nova } = await admin.from("works").select("id, ai_eval_status").eq("title", nome).maybeSingle()
check(nova != null, "a obra entrou no catálogo")
check(nova?.ai_eval_status === "pending", `nasceu PENDENTE pro Curador (${nova?.ai_eval_status})`)

// 🔴 Ela mandou story: 9 e adult_content: 9 no payload. As 9 notas de atributo são FATO DA
// OBRA (a IA as produz, e custam dinheiro) — um endpoint público não pode aceitá-las de
// quem não cura.
const { data: notasPostadas } = await admin.from("category_scores").select("criterion_slug, score").eq("work_id", nova?.id ?? "00000000-0000-0000-0000-000000000000")
check((notasPostadas ?? []).length === 0, `🔴 as notas que ela POSTOU foram descartadas (${(notasPostadas ?? []).length} gravadas)`)

await new Promise((r) => setTimeout(r, 3000)) // dá tempo do after() rodar, se houvesse
const { count: iaDepois } = await admin.from("ai_api_calls").select("*", { count: "exact", head: true })
check(
  iaDepois === iaAntes,
  `🔴 ZERO chamadas de IA (${iaAntes} → ${iaDepois}) — não saiu do saldo da Anthropic dele`,
)

console.log("\n── limpeza")
await admin.from("work_lists").delete().eq("user_id", reader.userId)
if (nova) await admin.from("works").delete().eq("id", nova.id)
const { count: sobrou } = await admin.from("work_lists").select("*", { count: "exact", head: true }).eq("user_id", owner.userId)
check(sobrou === hisLists.length, `os ${hisLists.length} grupos dele intactos ao final`)

console.log(fails === 0 ? "\n✅ O PRODUTO FREE ESTÁ DE PÉ." : `\n❌ ${fails} falha(s).`)
process.exit(fails === 0 ? 0 : 1)
