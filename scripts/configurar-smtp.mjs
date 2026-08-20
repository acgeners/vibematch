#!/usr/bin/env node
/**
 * Liga o SMTP do projeto na nuvem — o que falta para "Esqueci minha senha" funcionar.
 *
 *   node scripts/configurar-smtp.mjs                    → ENSAIO: mostra o estado e o plano
 *   node scripts/configurar-smtp.mjs --executar         → aplica (pede as credenciais no env)
 *   node scripts/configurar-smtp.mjs --testar=a@b.com   → dispara um reset real e diz o que houve
 *
 * 🔴 ALVO: NUVEM — ele escreve a CONFIGURAÇÃO do projeto Supabase (não o banco). O ref sai do
 * `NEXT_PUBLIC_SUPABASE_URL` do `.env.local`, e o script IMPRIME o alvo antes de qualquer
 * escrita: configurar o projeto errado é o tipo de erro que só aparece quando alguém não
 * recebe um e-mail.
 *
 * ── por que este script existe, e por que ele não roda sozinho ────────────────────────────
 *
 * O código de recuperação de senha está pronto e testado desde 2026-08-06 (`/forgot-password`
 * → e-mail → `/reset-password`, e `server/actions/auth.ts` chama `resetPasswordForEmail`).
 * O que falta é CONFIGURAÇÃO: medido na Management API em 19/08/2026, `smtp_host`,
 * `smtp_user`, `smtp_pass` e `smtp_admin_email` são todos `None`, e o provedor embutido do
 * Supabase é declaradamente de desenvolvimento — não entrega a usuário real.
 *
 * ⚠️ **A urgência é baixa HOJE, e isso também foi medido**: a nuvem tem **2 contas** (ambas
 * da dona) e **`mailer_autoconfirm` está LIGADO**, então o cadastro não depende de e-mail
 * nenhum. O único fluxo quebrado é o "esqueci minha senha" — que só dói quando houver leitor
 * de verdade. Por isso a decisão de 19/08/2026 foi ADIAR e deixar o caminho pronto, em vez de
 * ligar um Gmail pessoal em produção agora.
 *
 * ✅ **A decisão foi REVISTA e reafirmada no mesmo dia**, com um fato novo: tentou-se o Gmail,
 * e o cadastro da conta de produto está bloqueado pelo telefone (ver (a) abaixo). Com isso o
 * DOMÍNIO deixou de ser a opção cara — é retomar por ele, não pelo Gmail.
 *
 * ── a escolha que este script NÃO faz por você ────────────────────────────────────────────
 *
 * Sem domínio próprio, Resend/SendGrid/Mailgun **não servem**: os três exigem domínio
 * verificado (SPF/DKIM) para enviar a terceiros; sem isso só deixam mandar para você mesmo.
 * O app é `satoria.fly.dev`, sem domínio. Então a escolha real é:
 *
 *   (a) **Gmail + App Password agora** — funciona hoje, e tem TRÊS preços. Dois já conhecidos:
 *       o Gmail REESCREVE o `From` para o endereço autenticado, ou seja o e-mail de redefinição
 *       sai de um Gmail pessoal (o formato que as pessoas aprenderam a tratar como phishing); e
 *       é uso fora do previsto para conta pessoal. O terceiro é o RAIO DE DANO: a App Password
 *       não é limitada a enviar — dá acesso ao Mail da conta (envio e leitura por IMAP) —, e ela
 *       fica guardada na config do projeto Supabase.
 *
 *       🔴 **E criar uma conta de PRODUTO para escapar disso está bloqueado (medido 19/08/2026):**
 *       o cadastro para na verificação do Google com "Este número de telefone foi usado muitas
 *       vezes". O bloqueio é do TELEFONE, não do nome — nenhum nome de usuário passa com esse
 *       número. Retomar por aqui exige outro número, não outra ideia de nome.
 *       ⚠️ E o Gmail ignora PONTO: `satoria`, `sator.ia` e `satori.a` são o mesmo cadastro.
 *
 *   (b) **domínio próprio primeiro** — compra + DNS, e aí um provedor de verdade passa a ser
 *       possível. Sem o problema do `From`.
 *
 * Este script executa (a). Para (b), só mudam host/porta/usuário — a forma da chamada é a
 * mesma.
 *
 * ── o que ele muda, e o que ele deliberadamente não muda ──────────────────────────────────
 *
 * MUDA: `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `smtp_admin_email`,
 * `smtp_sender_name`, e o `rate_limit_email_sent` (hoje **2 por hora no projeto INTEIRO** —
 * com duas pessoas pedindo reset na mesma hora, a segunda não recebe nada e a tela não tem
 * como saber disso).
 *
 * NÃO MUDA `mailer_autoconfirm`. Desligá-lo passa a exigir confirmação por e-mail no cadastro,
 * o que transforma um SMTP mal configurado em "ninguém consegue criar conta" — trocar um fluxo
 * quebrado por um pior. Isso é decisão à parte, depois de o envio estar comprovado.
 *
 * ⚠️ **Os templates em português continuam valendo só no LOCAL.** `supabase/templates/*.html`
 * entram pelo `config.toml`; na nuvem, `PATCH /config/auth` com template devolve **400**
 * ("Email template modification is not available for free tier projects using the default
 * email provider"). Vale a pena RE-TESTAR isto depois de configurar o SMTP: a mensagem culpa
 * o *provedor default*, então com SMTP próprio o endpoint pode passar a aceitar. O script
 * imprime esse lembrete no fim em vez de tentar — falhar aqui abortaria uma configuração que
 * já deu certo.
 */

import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"

const ROOT = path.resolve(import.meta.dirname, "..")
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "")
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!TOKEN || !URL_) {
  console.error("faltam SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL no .env.local")
  process.exit(1)
}
const REF = URL_.match(/https:\/\/([^.]+)\./)?.[1]
if (!REF) {
  console.error(`não consegui derivar o ref do projeto de ${URL_}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const EXECUTAR = args.includes("--executar")
const TESTAR = args.find((a) => a.startsWith("--testar="))?.split("=")[1]

const API = `https://api.supabase.com/v1/projects/${REF}/config/auth`
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }

/** Os campos que descrevem o estado do envio — o resto da config de auth não interessa aqui. */
const CAMPOS = [
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_admin_email",
  "smtp_sender_name",
  "rate_limit_email_sent",
  "mailer_autoconfirm",
  "site_url",
]

async function lerEstado() {
  const r = await fetch(API, { headers: H })
  if (!r.ok) throw new Error(`GET /config/auth → ${r.status} ${await r.text()}`)
  const j = await r.json()
  const out = {}
  for (const c of CAMPOS) out[c] = j[c] ?? null
  // a senha nunca é impressa; só se ela existe
  out.smtp_pass = j.smtp_pass ? "<definida>" : null
  return out
}

function imprimir(estado) {
  const larg = Math.max(...Object.keys(estado).map((k) => k.length))
  for (const [k, v] of Object.entries(estado)) {
    const valor = v === null ? "None" : String(v)
    const marca = v === null && k.startsWith("smtp") ? " ←" : ""
    console.log(`   ${k.padEnd(larg)}  ${valor}${marca}`)
  }
}

function perguntar(texto, { oculto = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    if (!oculto) return rl.question(texto, (v) => (rl.close(), resolve(v.trim())))
    // App Password não deve ficar no scrollback do terminal nem no histórico do shell.
    process.stdout.write(texto)
    const mute = (chunk, enc, cb) => cb()
    const original = rl.output.write.bind(rl.output)
    rl.output.write = mute
    rl.question("", (v) => {
      rl.output.write = original
      process.stdout.write("\n")
      rl.close()
      resolve(v.trim())
    })
  })
}

async function main() {
  console.log(`projeto: ${REF}  (${URL_})`)
  console.log(`site_url do reset: o link do e-mail aponta para o site_url + /reset-password\n`)

  const antes = await lerEstado()
  console.log("estado ATUAL do envio de e-mail:")
  imprimir(antes)

  const jaConfigurado = Boolean(antes.smtp_host)
  console.log()

  if (!EXECUTAR) {
    console.log(
      jaConfigurado
        ? "✅ já há SMTP configurado. Use --testar=<e-mail> para conferir o fluxo ponta a ponta."
        : "⚠️  sem SMTP: o Supabase usa o provedor embutido, que é de DESENVOLVIMENTO e não\n" +
            "   entrega a usuário real. O 'esqueci minha senha' falha em silêncio para quem pede."
    )
    if (TESTAR) await testar(TESTAR)
    else {
      console.log("\nensaio — nada foi escrito. Para aplicar:")
      console.log("   node scripts/configurar-smtp.mjs --executar")
      console.log("\nvocê vai precisar de uma App Password do Google (exige 2FA na conta):")
      console.log("   https://myaccount.google.com/apppasswords")
    }
    return
  }

  // ── escrita ────────────────────────────────────────────────────────────────────────────
  const user = await perguntar("e-mail que vai AUTENTICAR e enviar (ex.: voce@gmail.com): ")
  if (!user.includes("@")) throw new Error("e-mail inválido")
  const pass = await perguntar("App Password (16 caracteres, não aparece na tela): ", {
    oculto: true,
  })
  if (pass.replace(/\s/g, "").length !== 16) {
    throw new Error("a App Password do Google tem 16 caracteres — confira se colou inteira")
  }
  const nome = (await perguntar("nome que aparece como remetente [SatorIA]: ")) || "SatorIA"

  const corpo = {
    smtp_host: "smtp.gmail.com",
    smtp_port: 587,
    smtp_user: user,
    smtp_pass: pass.replace(/\s/g, ""),
    smtp_admin_email: user,
    smtp_sender_name: nome,
    // 🔴 2/hora é do PROJETO inteiro, não por usuário: duas pessoas pedindo reset na mesma
    // hora e a segunda não recebe nada, sem erro na tela dela.
    rate_limit_email_sent: 30,
  }

  console.log("\nvai escrever em", REF, "→", {
    ...corpo,
    smtp_pass: `<${corpo.smtp_pass.length} caracteres>`,
  })

  const r = await fetch(API, { method: "PATCH", headers: H, body: JSON.stringify(corpo) })
  const txt = await r.text()
  if (!r.ok) throw new Error(`PATCH /config/auth → ${r.status} ${txt}`)

  console.log("\n✅ aplicado. Estado agora:")
  imprimir(await lerEstado())

  console.log("\n▶ próximos passos, nesta ordem:")
  console.log("   1. node scripts/configurar-smtp.mjs --testar=<seu e-mail>")
  console.log("      (confere o fluxo REAL; 200 não basta — o e-mail tem que CHEGAR)")
  console.log("   2. re-teste os templates em português: com SMTP próprio, o PATCH de")
  console.log("      `mailer_templates_recovery_content` pode passar a ser aceito (o 400 de")
  console.log("      08/2026 culpava o provedor DEFAULT). Os arquivos estão em")
  console.log("      supabase/templates/recovery.html e confirmation.html.")
  console.log("   3. só DEPOIS de o envio estar comprovado, considere desligar")
  console.log("      `mailer_autoconfirm` — antes disso, desligá-lo trava a criação de conta.")
}

async function testar(email) {
  console.log(`\n▶ disparando um reset real para ${email} …`)
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anon) throw new Error("falta NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local")
  const site = (await lerEstado()).site_url
  const r = await fetch(`${URL_}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, redirect_to: `${site}/reset-password` }),
  })
  const txt = await r.text()
  console.log(`   HTTP ${r.status} ${txt || "(corpo vazio)"}`)
  console.log(
    r.ok
      ? "\n⚠️  200 aqui significa 'o Supabase ACEITOU o pedido', NUNCA 'o e-mail chegou'.\n" +
          "   Sem SMTP o provedor embutido engole a mensagem e a resposta é a mesma. Confira a\n" +
          "   caixa de entrada (e o spam) — é essa a única prova."
      : "\n❌ o pedido foi recusado. Com 429, você bateu no rate_limit_email_sent."
  )
}

main().catch((e) => {
  console.error("\n❌", e.message)
  process.exit(1)
})
