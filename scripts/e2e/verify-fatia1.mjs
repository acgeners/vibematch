#!/usr/bin/env node
/**
 * Verificação da FATIA 1 com DOIS USUÁRIOS DE VERDADE, chamando as SERVER ACTIONS direto.
 *
 * Nada de UI: botão escondido não prova nada — toda função exportada de um arquivo
 * "use server" é um endpoint HTTP público, e é ESSE endpoint que precisa recusar/isolar.
 * O id da action sai do bundle do cliente (é assim que um atacante o obteria também).
 *
 * Sessões: magic link (admin) → verifyOtp → cookies montados pelo PRÓPRIO @supabase/ssr
 * (mesmo código que o app usa pra ler). Nenhuma senha é tocada.
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
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP = "http://localhost:3001"

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })


const { findTestUsers } = await import("./_users.mjs")
let failures = 0
const ok = (msg) => console.log(`  ✅ ${msg}`)
const fail = (msg) => {
  failures++
  console.log(`  ❌ ${msg}`)
}
const check = (cond, msg) => (cond ? ok(msg) : fail(msg))

// ── Sessão real, sem senha ────────────────────────────────────────────────────────────
async function cookieHeaderFor(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (error) throw new Error(`generateLink ${email}: ${error.message}`)

  const anonClient = createClient(URL_, ANON, { auth: { persistSession: false } })
  const { data: sess, error: otpErr } = await anonClient.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "email",
  })
  if (otpErr) throw new Error(`verifyOtp ${email}: ${otpErr.message}`)

  // Deixa o @supabase/ssr montar os cookies — o mesmo código que o app usa pra LER.
  // Craftar "na mão" o formato (base64-, chunk .0/.1) é como o teste passa a testar a
  // minha suposição em vez do app.
  const jar = new Map()
  const ssr = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  })
  await ssr.auth.setSession({
    access_token: sess.session.access_token,
    refresh_token: sess.session.refresh_token,
  })
  if (jar.size === 0) throw new Error(`nenhum cookie gerado para ${email}`)
  return {
    userId: sess.user.id,
    cookie: [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; "),
  }
}

// ── Ids das server actions, extraídos do bundle do cliente ────────────────────────────
async function actionIds(pagePath) {
  const html = await (await fetch(`${APP}${pagePath}`)).text()
  const srcs = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1])
  const found = {}
  for (const src of srcs) {
    const js = await (await fetch(`${APP}${src}`)).text()
    // Turbopack (dev): createServerReference"])("<id>", callServer, void 0, findSourceMapURL, "<nome>")
    for (const m of js.matchAll(
      /createServerReference"\]\)\("([0-9a-f]{40,})"[\s\S]{0,600}?"(\w+)"\)/g,
    )) {
      found[m[2]] = m[1]
    }
  }
  return found
}

async function callAction(id, args, cookie, referer = "/titles") {
  const res = await fetch(`${APP}${referer}`, {
    method: "POST",
    headers: {
      "Next-Action": id,
      "Content-Type": "text/plain;charset=UTF-8",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  return { status: res.status, text }
}

/** O texto do retorno da action vem no stream RSC — procura a mensagem de erro. */
const said = (res, needle) => res.text.includes(needle)

// ── Estado no banco (service role: enxerga tudo, é o juiz) ────────────────────────────
async function stateOf(userId, workId) {
  const { data } = await admin
    .from("user_work_state")
    .select("is_favorite, personal_status_id, chapters_read, last_read_at, user_score")
    .eq("user_id", userId)
    .eq("work_id", workId)
    .maybeSingle()
  return data ?? null
}
async function workRow(workId) {
  const { data } = await admin
    .from("works")
    .select("title, is_favorite, personal_status_id, chapters_read, last_read_at, user_score")
    .eq("id", workId)
    .single()
  return data
}

async function main() {
  const { owner: OWNER, other: OTHER } = await findTestUsers(admin)
  console.log("── sessões reais (magic link → verifyOtp; nenhuma senha tocada)")
  const owner = await cookieHeaderFor(OWNER.email)
  const reader = await cookieHeaderFor(OTHER.email)
  console.log(`   curador/dono: ${owner.userId}`)
  console.log(`   leitora:      ${reader.userId}`)

  console.log("\n── ids das server actions (extraídos do bundle do cliente)")
  // `updateWorkStatus` só é referenciado no form da página da obra — daí varrer as duas.
  const { data: firstWork } = await admin.from("works").select("id").limit(1).single()
  const ids = {
    ...(await actionIds("/titles")),
    ...(await actionIds(`/titles/${firstWork.id}`)),
  }
  for (const name of ["toggleFavorite", "updateWorkStatus", "setFavoriteMany"]) {
    console.log(`   ${name}: ${ids[name] ?? "NÃO ENCONTRADO"}`)
  }
  if (!ids.toggleFavorite || !ids.updateWorkStatus) {
    throw new Error("não achei os ids das actions no bundle — abortando")
  }

  // Duas obras: uma que o DONO já acompanha (pra provar que ela não o sobrescreve) e
  // outra qualquer. Pega uma com capítulos lidos e não-favorita, pra os deltas serem claros.
  const { data: candidates } = await admin
    .from("works")
    .select("id, title, chapters_read, is_favorite, personal_status_id, user_score")
    .not("chapters_read", "is", null)
    .gt("chapters_read", 0)
    .eq("is_favorite", false)
    .eq("is_archived", false)
    .limit(2)
  const [workA, workB] = candidates
  console.log(`\n── obra A (teste da Leitora): ${workA.title}`)
  console.log(`   works: chapters_read=${workA.chapters_read} is_favorite=${workA.is_favorite} user_score=${workA.user_score}`)

  const beforeWorkA = await workRow(workA.id)
  const ownerBeforeA = await stateOf(owner.userId, workA.id)

  // ═════════════════════════════════════════════════════════════════════════════════
  console.log("\n1) ANÔNIMO (sem sessão) chama toggleFavorite — o buraco do PR #127")
  const anon = await callAction(ids.toggleFavorite, [workA.id, true], null)
  check(said(anon, "Entre na sua conta"), "recusado com 'Entre na sua conta' (ensureSignedIn)")
  const afterAnon = await workRow(workA.id)
  check(
    afterAnon.is_favorite === beforeWorkA.is_favorite,
    `works.is_favorite intacto (${afterAnon.is_favorite}) — o anônimo NÃO escreveu como o dono`,
  )

  // ═════════════════════════════════════════════════════════════════════════════════
  console.log("\n2) LEITORA favorita a obra A")
  const favRes = await callAction(ids.toggleFavorite, [workA.id, true], reader.cookie)
  check(!said(favRes, "Só o Curador"), "action NÃO recusou por papel (own_state vale pro leitor)")
  const readerA = await stateOf(reader.userId, workA.id)
  check(readerA?.is_favorite === true, "user_work_state DELA: is_favorite = true")
  const worksAfterFav = await workRow(workA.id)
  check(
    worksAfterFav.is_favorite === false,
    `🔴 works.is_favorite SEGUE false — ela não sobrescreveu o favorito do dono`,
  )
  const ownerAfterFav = await stateOf(owner.userId, workA.id)
  check(
    ownerAfterFav?.is_favorite === (ownerBeforeA?.is_favorite ?? false),
    "espelho do DONO intacto",
  )

  // ═════════════════════════════════════════════════════════════════════════════════
  console.log("\n3) LEITORA marca o capítulo 12 (o dono está no " + workA.chapters_read + ")")
  const st = await callAction(
    ids.updateWorkStatus,
    [workA.id, { personal_status: "Reading", chapters_read: 12, user_score: workA.user_score }],
    reader.cookie,
  )
  const readerA2 = await stateOf(reader.userId, workA.id)
  check(readerA2?.chapters_read === 12, "user_work_state DELA: chapters_read = 12")
  check(readerA2?.last_read_at != null, "a data de leitura DELA foi carimbada")
  const worksAfterCh = await workRow(workA.id)
  check(
    worksAfterCh.chapters_read === beforeWorkA.chapters_read,
    `🔴 works.chapters_read SEGUE ${beforeWorkA.chapters_read} — o capítulo do dono não virou 12`,
  )
  check(
    worksAfterCh.user_score === beforeWorkA.user_score,
    `works.user_score intacto (${beforeWorkA.user_score}) — a nota do dono não foi tocada`,
  )
  const ownerAfterCh = await stateOf(owner.userId, workA.id)
  check(
    (ownerAfterCh?.chapters_read ?? null) === (ownerBeforeA?.chapters_read ?? null),
    "espelho do DONO intacto (capítulos)",
  )

  // ═════════════════════════════════════════════════════════════════════════════════
  // ⚠️ Este passo MUDOU na Fatia 2a. Antes, a nota era RECUSADA (não tinha casa própria).
  // Agora ela é ACEITA e vai pra `user_work_state` — o que não pode, e é o que se checa aqui,
  // é ela encostar na nota do dono, que é o rótulo do Ridge dele.
  console.log("\n4) LEITORA dá a PRÓPRIA nota (Fatia 2a: aceita, mas na linha dela)")
  const scoreTry = await callAction(
    ids.updateWorkStatus,
    [workA.id, { personal_status: "Reading", chapters_read: 12, user_score: 9.9 }],
    reader.cookie,
  )
  check(!said(scoreTry, "Fatia 2"), "aceita (a nota dela tem casa própria desde a 2a)")
  const herScore = await stateOf(reader.userId, workA.id)
  check(Number(herScore?.user_score) === 9.9, "a nota DELA (9.9) foi pra user_work_state")
  const worksAfterScore = await workRow(workA.id)
  check(
    worksAfterScore.user_score === beforeWorkA.user_score,
    `🔴 works.user_score SEGUE ${beforeWorkA.user_score} — a nota do dono não virou 9.9`,
  )

  // ═════════════════════════════════════════════════════════════════════════════════
  console.log(`\n5) DONO marca o capítulo 77 na obra B: ${workB.title}`)
  const beforeB = await workRow(workB.id)
  const ownerSt = await callAction(
    ids.updateWorkStatus,
    [workB.id, { personal_status: "Reading", chapters_read: 77, user_score: beforeB.user_score }],
    owner.cookie,
  )
  check(!said(ownerSt, "Fatia 2"), "aceita (ele é o dono)")
  // FASE E inverteu este assert. Ele exigia `works.chapters_read === 77` — o dual-write. Agora
  // a linha compartilhada NÃO recebe escrita pessoal de ninguém, nem do dono: ela fica parada,
  // esperando o DROP. Quem tem que receber o 77 é o espelho DELE.
  const worksB = await workRow(workB.id)
  check(
    worksB.chapters_read !== 77,
    `works.chapters_read NÃO virou 77 (segue ${worksB.chapters_read}) — \`works\` não recebe mais escrita pessoal`,
  )
  const ownerB = await stateOf(owner.userId, workB.id)
  check(ownerB?.chapters_read === 77, "o ESPELHO do dono recebeu o 77 (é a única fonte agora)")
  const readerB = await stateOf(reader.userId, workB.id)
  check(
    readerB == null || readerB.chapters_read !== 77,
    "a Leitora NÃO herdou o capítulo 77 dele",
  )

  // ═════════════════════════════════════════════════════════════════════════════════
  console.log("\n6) O CATÁLOGO é o mesmo pros dois (título, capa, sinopse, notas da IA)")
  // ⚠️ A rota da obra resolve por SLUG. `/titles/<uuid>` devolve 200 — mas uma casca vazia
  // (115 KB contra 454 KB), sem capa, sem sinopse, sem tags. Um teste que fetch-asse o UUID
  // "passaria" comparando duas páginas igualmente vazias.
  const slug = workA.title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  const page = async (cookie) => {
    const res = await fetch(`${APP}/titles/${slug}`, { headers: cookie ? { cookie } : {} })
    const html = await res.text()
    if (html.length < 200_000) throw new Error(`página /titles/${slug} veio vazia (${html.length} bytes)`)
    return html
  }
  const [htmlOwner, htmlReader] = await Promise.all([page(owner.cookie), page(reader.cookie)])

  // Os fatos de catálogo vêm do BANCO e são procurados nas DUAS páginas. (Comparar "a primeira
  // imagem do HTML" não serve: a primeira imagem é o AVATAR de quem está logado.)
  const { data: cov } = await admin
    .from("work_covers")
    .select("url")
    .eq("work_id", workA.id)
    .eq("is_primary", true)
    .maybeSingle()
  const { data: tagRows } = await admin
    .from("work_tags")
    .select("tags(name)")
    .eq("work_id", workA.id)
    .limit(5)
  const tagNames = (tagRows ?? []).map((r) => r.tags?.name).filter(Boolean)
  const { data: cats } = await admin
    .from("category_scores")
    .select("criterion_slug, score")
    .eq("work_id", workA.id)

  const inBoth = (needle) => htmlOwner.includes(needle) && htmlReader.includes(needle)
  const { data: synRow } = await admin
    .from("works")
    .select("canonical_synopsis")
    .eq("id", workA.id)
    .single()

  check(inBoth(workA.title), `título igual nas duas páginas: ${workA.title}`)
  check(cov?.url != null && inBoth(cov.url), "MESMA capa primária nas duas")
  check(tagNames.length > 0 && tagNames.every(inBoth), `MESMAS tags nas duas (${tagNames.join(", ")})`)
  const synFrag = (synRow?.canonical_synopsis ?? "").slice(0, 60)
  check(synFrag.length > 20 && inBoth(synFrag), "MESMA sinopse nas duas")
  const aiScores = (cats ?? []).map((c) => Number(c.score).toFixed(1))
  check(
    aiScores.length > 0 && aiScores.every(inBoth),
    `MESMAS ${aiScores.length} notas da IA nas duas (${aiScores.join(" ")})`,
  )

  // E o que TEM que diferir: o estado de leitura dela vs. o dele.
  const stReader = await stateOf(reader.userId, workA.id)
  check(
    stReader?.chapters_read === 12 && beforeWorkA.chapters_read !== 12,
    `estado de leitura DIFERE: ela ${stReader?.chapters_read}, ele ${beforeWorkA.chapters_read}`,
  )

  // ⚠️ O BURACO QUE ESTE TESTE NÃO TINHA. Antes só se comparava CATÁLOGO nesta página — o
  // estado PESSOAL dela nunca foi checado aqui. E vazava: a página da obra vem de
  // `getWorkBySlug` → `getWorkWithAiEvaluations`, um caminho separado do `getWorkById`, que
  // ficou de fora do overlay na Fatia 1. O formulário de status DELA abria preenchido com o
  // capítulo e a nota DELE.
  const payload = (html) => html.replace(/\\"/g, '"')
  const pOwner = payload(htmlOwner)
  const pReader = payload(htmlReader)
  check(
    pReader.includes(`"chapters_read":12`),
    "a página DELA carrega o capítulo DELA (12) no formulário",
  )
  check(
    !pReader.includes(`"chapters_read":${beforeWorkA.chapters_read},`),
    `a página DELA não carrega o capítulo DELE (${beforeWorkA.chapters_read})`,
  )
  check(
    pOwner.includes(`"chapters_read":${beforeWorkA.chapters_read}`),
    "a página DELE segue carregando o capítulo dele",
  )

  // ── limpeza: desfaz o que o teste escreveu ──────────────────────────────────────
  console.log("\n── limpeza")
  await admin
    .from("user_work_state")
    .delete()
    .eq("user_id", reader.userId)
    .in("work_id", [workA.id, workB.id])
  await admin
    .from("works")
    .update({
      chapters_read: beforeB.chapters_read,
      personal_status_id: beforeB.personal_status_id,
      last_read_at: beforeB.last_read_at,
    })
    .eq("id", workB.id)
  await admin
    .from("user_work_state")
    .update({
      chapters_read: beforeB.chapters_read,
      personal_status_id: beforeB.personal_status_id,
      last_read_at: beforeB.last_read_at,
    })
    .eq("user_id", owner.userId)
    .eq("work_id", workB.id)
  const restoredB = await workRow(workB.id)
  check(
    restoredB.chapters_read === beforeB.chapters_read,
    `obra B restaurada (chapters_read=${beforeB.chapters_read})`,
  )

  console.log(
    failures === 0
      ? "\n✅ TUDO VERDE — a Leitora escreve o próprio estado, e o do dono fica intacto."
      : `\n❌ ${failures} verificação(ões) falharam.`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`\n💥 ${e.message}`)
  process.exit(1)
})
