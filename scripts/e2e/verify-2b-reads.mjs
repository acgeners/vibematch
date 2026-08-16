/**
 * FATIA 2b — a Leitora parou de ver a Nota Prevista DELE?
 *
 * Este é o último vazamento da Fase 2. Ela lia "você vai gostar 8,6 disso" — e aquilo era a
 * previsão do gosto DELE, num app que ela nunca alimentou.
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
  return { cookie: [...jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ") }
}

const owner = await session(OWNER.email)
const reader = await session(OTHER.email)

// Obra com Nota Prevista alta e nota da comunidade — o pior caso pro vazamento.
const { data: w } = await admin
  .from("calculated_scores")
  .select("work_id, expected_score, personal_fit, chance_score, platform_avg, total_votes, works!inner(title)")
  .not("expected_score", "is", null)
  .not("platform_avg", "is", null)
  .order("expected_score", { ascending: false })
  .limit(1)
  .single()

const title = w.works.title
const slug = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
console.log(`obra: ${title}`)
console.log(`  Nota Prevista DELE: ${w.expected_score} · comunidade: ${Number(w.platform_avg).toFixed(2)} (${w.total_votes} votos)\n`)

const page = async (cookie, path) =>
  (await (await fetch(`${APP}${path}`, { headers: { cookie } })).text()).replace(/\\"/g, '"')

console.log("1) A PÁGINA DA OBRA — o card de SIMILARES é onde o vazamento se escondia")
const [pOwner, pReader] = await Promise.all([page(owner.cookie, `/catalog/${slug}`), page(reader.cookie, `/catalog/${slug}`)])

// ⚠️ NÃO procure o score da própria obra no payload: ali só vêm os das obras SIMILARES (o da
// obra é renderizado como texto). E foi justamente nos similares que a Nota Prevista DELE
// vazava pra ela. Então é neles que se mede.
const propsOf = (html, key) => [...html.matchAll(new RegExp(`"${key}":([^,}]+)`, "g"))].map((m) => m[1])
const expOwner = propsOf(pOwner, "expectedScore")
const expReader = propsOf(pReader, "expectedScore")
const fitReader = propsOf(pReader, "personalFit")
const platReader = propsOf(pReader, "platformAvg")

check(
  expOwner.some((v) => v !== "null"),
  `o DONO vê Nota Prevista nas similares (${expOwner.slice(0, 3).join(", ")})`,
)
check(
  expReader.length > 0 && expReader.every((v) => v === "null"),
  `🔴 a LEITORA vê Nota Prevista NULL em todas as similares (${expReader.length} obras)`,
)
check(
  fitReader.length > 0 && fitReader.every((v) => v === "null"),
  "🔴 a LEITORA vê Alinhamento NULL — não herda o perfil de gosto dele",
)
check(
  platReader.some((v) => v !== "null"),
  `a LEITORA VÊ a nota da comunidade (${platReader.slice(0, 2).map((v) => Number(v).toFixed(2)).join(", ")}) — o fato da obra fica`,
)

console.log("\n2) O RANKING — sem modelo, a ordem sai da comunidade")
const [rOwner, rReader] = await Promise.all([page(owner.cookie, "/ranking"), page(reader.cookie, "/ranking")])
const firstTitles = (html) => {
  const m = [...html.matchAll(/"title":"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1])
  return m.slice(0, 6)
}
const oTop = firstTitles(rOwner)
const rTop = firstTitles(rReader)
check(oTop.length > 0 && rTop.length > 0, `ambos carregam o ranking (${oTop.length} / ${rTop.length} títulos)`)
check(
  JSON.stringify(oTop) !== JSON.stringify(rTop),
  "a ORDEM difere — ela não está vendo o ranking do gosto dele",
)
console.log(`     dono:    ${oTop.slice(0, 3).join(" · ")}`)
console.log(`     leitora: ${rTop.slice(0, 3).join(" · ")}`)

// A prova positiva: o topo dela tem que ser o das MAIS VOTADAS/melhor avaliadas pela comunidade
const { data: topCommunity } = await admin
  .from("calculated_scores")
  .select("platform_avg, works!inner(title, is_archived)")
  .eq("works.is_archived", false)
  .not("platform_avg", "is", null)
  .order("platform_avg", { ascending: false })
  .limit(3)
const esperado = (topCommunity ?? []).map((r) => r.works.title)
check(
  esperado.some((t) => rTop.includes(t)),
  `o topo dela vem da comunidade (esperado: ${esperado[0]})`,
)

console.log("\n3) 🔴 O NÚMERO NÃO PODE SER UM CHUTE COM CARA DE PREVISÃO")
const { data: herScores } = await admin
  .from("user_calculated_scores")
  .select("expected_score")
  .eq("user_id", (await admin.from("user_settings").select("current_user_id").eq("email", OTHER.email).single()).data.current_user_id)
  .not("expected_score", "is", null)
check(
  (herScores ?? []).length === 0,
  `ela não tem NENHUMA Nota Prevista gravada (${(herScores ?? []).length}) — porque não tem rótulos`,
)

console.log(fails === 0 ? "\n✅ 2b VERDE — o último vazamento fechou." : `\n❌ ${fails} falha(s).`)
process.exit(fails === 0 ? 0 : 1)

console.log("\n── DEBUG: por que o ranking dela veio vazio?")
const rHtml = await page(reader.cookie, "/ranking")
console.log("   tamanho do html:", rHtml.length)
for (const marker of ["Nenhuma obra", "nenhum resultado", "workId", "expectedScore", "platformAvg", "Ajuste os filtros"]) {
  console.log(`   contém "${marker}":`, rHtml.includes(marker))
}
const oHtml = await page(owner.cookie, "/ranking")
console.log("   (dono) tamanho do html:", oHtml.length)
