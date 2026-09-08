#!/usr/bin/env node
/**
 * Proxy contador entre o app e o Supabase — mede EGRESS POR ROTA, no fio.
 *
 *   node scripts/egress-proxy.mjs                       # alvo = .env.local
 *   EGRESS_ALVO=https://<ref>.supabase.co node scripts/egress-proxy.mjs
 *   curl -X POST 127.0.0.1:54331/__marca -d '/catalog'  # rotula o trecho seguinte
 *   curl 127.0.0.1:54331/__resumo                       # imprime a tabela
 *
 * Depois suba o app com NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331.
 *
 * 🔴 POR QUE NO FIO, e não somando `content_length` do log: o PostgREST responde CHUNKED e
 * o campo vem NULL em quase toda resposta grande — somá-lo dava 1,75 MB para o que eram
 * 374 MB. E o que o Supabase entrega é COMPRIMIDO (fator ~4 medido), então medir o JSON já
 * descomprimido superestima. Aqui conta-se o byte que atravessa o socket.
 *
 * ⚠️ Ele NÃO grava nada na nuvem — o resumo fica em memória e sai no stdout. Telemetria
 * gravada no próprio Supabase geraria o egress que estamos tentando medir.
 */
import http from "node:http"
import https from "node:https"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const envLocal = fs.existsSync(path.join(ROOT, ".env.local"))
  ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8") : ""
const ALVO = (process.env.EGRESS_ALVO
  ?? envLocal.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1] ?? "").replace(/^["']|["']$/g, "").replace(/\/$/, "")
if (!ALVO || ALVO.includes("54331")) {
  console.error("🔴 defina EGRESS_ALVO (ou NEXT_PUBLIC_SUPABASE_URL) — e não aponte para o próprio proxy.")
  process.exit(1)
}
const PORTA = Number(process.env.EGRESS_PORTA ?? 54331)

let marca = "(sem marca)"
const seg = new Map()   // marca -> { reqs, bytes, linhas, porChave: Map }
const atual = () => {
  if (!seg.has(marca)) seg.set(marca, { reqs: 0, bytes: 0, linhas: 0, porChave: new Map() })
  return seg.get(marca)
}
const tabela = (p) => (p.match(/\/rest\/v1\/([^?]+)/)?.[1] ?? p.split("?")[0])

function resumo() {
  const linhas = []
  linhas.push("marca                       reqs    linhas       bytes(fio)   dup")
  linhas.push("─".repeat(72))
  for (const [m, s] of seg) {
    const dup = [...s.porChave.values()].reduce((a, n) => a + (n > 1 ? n - 1 : 0), 0)
    linhas.push(`${m.padEnd(26)} ${String(s.reqs).padStart(5)} ${String(s.linhas).padStart(9)} ${(s.bytes / 1024).toFixed(1).padStart(13)} KB ${String(dup).padStart(5)}`)
  }
  linhas.push("─".repeat(72))
  for (const [m, s] of seg) {
    const top = [...s.porChave.entries()].sort((a, b) => b[1] - a[1]).filter(([, n]) => n > 1).slice(0, 6)
    if (top.length) {
      linhas.push(`\nrepetidas em ${m}:`)
      top.forEach(([k, n]) => linhas.push(`  ${n}×  ${k.slice(0, 100)}`))
    }
  }
  return linhas.join("\n")
}

http.createServer(async (req, res) => {
  if (req.url.startsWith("/__marca")) {
    let body = ""; for await (const c of req) body += c
    marca = (body || new URL(req.url, "http://x").searchParams.get("m") || "(sem marca)").trim()
    res.writeHead(200).end(`marca = ${marca}\n`); return
  }
  if (req.url.startsWith("/__resumo")) { res.writeHead(200, { "content-type": "text/plain" }).end(resumo() + "\n"); return }
  if (req.url.startsWith("/__zerar")) { seg.clear(); res.writeHead(200).end("zerado\n"); return }

  const headers = { ...req.headers }; delete headers.host
  let body
  if (req.method !== "GET" && req.method !== "HEAD") {
    const cs = []; for await (const c of req) cs.push(c); body = Buffer.concat(cs)
  }
  // 🔴 node:https CRU, nunca `fetch`. O `fetch` do Node descomprime de forma transparente,
  // então contar o corpo que ele devolve mede o JSON EXPANDIDO — e o Supabase entrega
  // comprimido. Medido em 08/09: /catalog dava 4.958 KB por fetch e 1.232 KB no fio (~4x),
  // que é exatamente o fator que este projeto ja tinha registrado. Reportar o numero errado
  // aqui superestimaria a quota em 4x.
  const alvoU = new URL(ALVO + req.url)
  const upstream = await new Promise((resolve) => {
    const r = https.request({
      hostname: alvoU.hostname, path: alvoU.pathname + alvoU.search, method: req.method,
      headers: { ...headers, host: alvoU.hostname },
    }, (up) => {
      const cs = []
      up.on("data", (c) => cs.push(c))
      up.on("end", () => resolve({ status: up.statusCode, headers: up.headers, buf: Buffer.concat(cs) }))
    })
    r.on("error", (e) => resolve({ erro: e }))
    if (body) r.write(body)
    r.end()
  })
  if (upstream.erro) { res.writeHead(502).end(String(upstream.erro.message)); return }

  const buf = upstream.buf                     // bytes DO FIO (ainda comprimidos, se houver)
  const s = atual()
  s.reqs++; s.bytes += buf.length
  const cr = upstream.headers["content-range"]
  if (cr?.includes("-")) {
    const [ini, fim] = cr.split("/")[0].split("-").map(Number)
    if (Number.isFinite(ini) && Number.isFinite(fim)) s.linhas += fim - ini + 1
  }
  const chave = `${req.method} ${tabela(req.url)}${req.url.includes("?") ? "?" + req.url.split("?")[1].slice(0, 120) : ""}`
  s.porChave.set(chave, (s.porChave.get(chave) ?? 0) + 1)

  res.writeHead(upstream.status, upstream.headers).end(buf)
}).listen(PORTA, "127.0.0.1", () => {
  console.log(`\n▶ proxy de egress  127.0.0.1:${PORTA}  →  ${ALVO}`)
  console.log(`  marcar:  curl -sX POST 127.0.0.1:${PORTA}/__marca -d '/catalog'`)
  console.log(`  resumo:  curl -s 127.0.0.1:${PORTA}/__resumo\n`)
})
process.on("SIGINT", () => { console.log("\n" + resumo() + "\n"); process.exit(0) })
