/**
 * FATIA 2a — a Leitora AVALIA. Dois usuários reais, server actions chamadas direto.
 *
 * A pergunta que este teste existe pra responder: a nota dela vira o rótulo do modelo DELE?
 * (Se virar, a Nota Prevista de 878 obras muda sem ninguém ter pedido — em silêncio.)
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
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
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

const call = async (id, args, cookie) =>
  (
    await fetch(`${APP}/titles`, {
      method: "POST",
      headers: {
        "Next-Action": id,
        "Content-Type": "text/plain;charset=UTF-8",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(args),
    })
  ).text()

// A migration 154 dropou as colunas pessoais de `works`. O que esta suíte chamava de "a linha
// compartilhada" é agora a linha do DONO no espelho — é ela que não pode ser sobrescrita por ela.
const workRow = async (id) =>
  (
    await admin
      .from("user_work_state")
      .select("user_score, observations, synopsis_quality, post_story_score, chapters_read")
      .eq("user_id", OWNER.current_user_id)
      .eq("work_id", id)
      .maybeSingle()
  ).data ?? {}
const stateRow = async (uid, id) =>
  (
    await admin
      .from("user_work_state")
      .select("user_score, observations, synopsis_quality, post_story_score, chapters_read")
      .eq("user_id", uid)
      .eq("work_id", id)
      .maybeSingle()
  ).data
const calcRow = async (id) =>
  (
    await admin
      .from("calculated_scores")
      .select("expected_score, calc_score")
      .eq("work_id", id)
      .single()
  ).data

const owner = await session(OWNER.email)
const reader = await session(OTHER.email)

const { data: firstWork } = await admin.from("works").select("id").limit(1).single()
const ids = await actionIds(["/titles", `/titles/${firstWork.id}`])
if (!ids.updateWorkStatus) throw new Error("não achei o id de updateWorkStatus no bundle")
console.log(`updateWorkStatus: ${ids.updateWorkStatus}\n`)

// Obra que o DONO já avaliou — o pior caso: a nota dela poderia sobrescrever a dele.
const { data: candRow, error: candErr } = await admin
  .from("user_work_state")
  .select("work_id, user_score, post_story_score, works!inner(id, title, is_archived)")
  .eq("user_id", OWNER.current_user_id)
  .not("user_score", "is", null)
  .not("post_story_score", "is", null)
  .eq("works.is_archived", false)
  .limit(1)
  .single()
if (candErr) throw new Error(`não achei cobaia no espelho: ${candErr.message}`)
const cand = { ...candRow, id: candRow.works.id, title: candRow.works.title }

const before = await workRow(cand.id)
const beforeCalc = await calcRow(cand.id)
console.log(`obra: ${cand.title}`)
console.log(`  works (do DONO): nota=${before.user_score} post_story=${before.post_story_score} ♥=${before.synopsis_quality}`)
console.log(`  calculated_scores: expected=${beforeCalc.expected_score} (o Ridge DELE)\n`)

console.log("1) LEITORA avalia a obra: nota 9.9, ♥♥♥♥, observação e pós-leitura próprias")
// O nome do status vem do BANCO — escrever "Completed" aqui é o que fez esta suíte ficar
// vermelha quando o status foi renomeado para "Finished": o Zod (`z.enum(PERSONAL_STATUSES)`,
// gerado por sync-constants) rejeitou o payload INTEIRO, e nenhuma escrita dela passou. O Zod
// fez o trabalho dele; quem estava errado era o teste, fixando um rótulo que mora no Supabase.
const { data: statusFullyRead } = await admin
  .from("personal_status")
  .select("status")
  .eq("is_fully_read", true)
  .single()

const res = await call(
  ids.updateWorkStatus,
  [
    cand.id,
    {
      personal_status: statusFullyRead.status,
      chapters_read: 5,
      user_score: 9.9,
      observations: "ANOTACAO DA LEITORA",
      synopsis_quality: "♥♥♥♥",
      observation_adjustment: 0,
      post_story_score: 2,
    },
  ],
  reader.cookie,
)
check(!res.includes("Fatia 2"), "NÃO é mais recusada (a nota dela tem casa própria agora)")
check(!res.includes("Só o Curador"), "não recusada por papel")

const hers = await stateRow(reader.userId, cand.id)
check(Number(hers?.user_score) === 9.9, `nota DELA gravada em user_work_state: ${hers?.user_score}`)
check(hers?.observations === "ANOTACAO DA LEITORA", "observação DELA gravada")
check(hers?.synopsis_quality === "♥♥♥♥", "interesse ♥ DELA gravado")
check(Number(hers?.post_story_score) === 2, "pós-leitura DELA gravada")

console.log("\n2) 🔴 O DADO DO DONO — a parte que não pode se mexer")
const after = await workRow(cand.id)
check(
  Number(after.user_score) === Number(before.user_score),
  `works.user_score SEGUE ${before.user_score} (não virou 9.9) — o rótulo do Ridge dele está intacto`,
)
check(after.observations === before.observations, "works.observations intacta (não virou a nota dela)")
check(after.synopsis_quality === before.synopsis_quality, `works.synopsis_quality segue ${before.synopsis_quality}`)
check(
  Number(after.post_story_score) === Number(before.post_story_score),
  `works.post_story_score segue ${before.post_story_score}`,
)
const ownerMirror = await stateRow(owner.userId, cand.id)
check(
  Number(ownerMirror?.user_score) === Number(before.user_score),
  "espelho do DONO intacto (a nota dele continua a dele)",
)

console.log("\n3) 🔴 O MODELO DELE — a Nota Prevista não pode ter se mexido")
const afterCalc = await calcRow(cand.id)
check(
  Number(afterCalc.expected_score) === Number(beforeCalc.expected_score),
  `expected_score SEGUE ${beforeCalc.expected_score} — a avaliação dela NÃO retreinou o Ridge dele`,
)

console.log("\n4) Cada um vê a SUA nota na página da obra")
const slug = cand.title
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
const page = async (cookie) =>
  (await (await fetch(`${APP}/titles/${slug}`, { headers: { cookie } })).text()).replace(/\\"/g, '"')
const [pOwner, pReader] = await Promise.all([page(owner.cookie), page(reader.cookie)])
const scoreIn = (html) => [...html.matchAll(/"userScore":([^,}]+)/g)].map((m) => m[1])
check(pReader.includes("ANOTACAO DA LEITORA"), "a página DELA mostra a observação dela")
check(!pOwner.includes("ANOTACAO DA LEITORA"), "a página DELE não mostra a observação dela")
check(
  pOwner.includes(`"userScore":${before.user_score}`) || pOwner.includes(`"user_score":${before.user_score}`),
  `a página DELE mostra a nota dele (${before.user_score})`,
)
check(
  !pReader.includes(`"user_score":${before.user_score},`),
  "a página DELA não carrega a nota dele",
)
void scoreIn

console.log("\n── limpeza")
await admin.from("user_work_state").delete().eq("user_id", reader.userId).eq("work_id", cand.id)
const post = await workRow(cand.id)
check(
  Number(post.user_score) === Number(before.user_score) && post.observations === before.observations,
  "obra restaurada (nada do dono foi tocado, então não houve o que restaurar)",
)

console.log(failures === 0 ? "\n✅ FATIA 2a VERDE." : `\n❌ ${failures} falha(s).`)
process.exit(failures === 0 ? 0 : 1)
