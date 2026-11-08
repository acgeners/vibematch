#!/usr/bin/env node
/**
 * Cópia semanal do que só existe neste Mac para o iCloud Drive, em DMG criptografado — régua em
 * `lib/copia-locais.mjs`. Roda sozinho no fim do `backup-primary.mjs` (agente de domingo).
 *
 *   node scripts/backup-locais-icloud.mjs              (npm run backup:locais) gera, confere, envia e poda
 *   node scripts/backup-locais-icloud.mjs --conferir   só leitura: as cópias que já estão no iCloud
 *   node scripts/backup-locais-icloud.mjs --ensaio     monta a cópia num tmp, mede e procura chave real;
 *                                                      não gera DMG, não lê o Keychain, não toca o iCloud
 *   --raiz=<pasta>                                     outro checkout (padrão: o deste script)
 *
 * Não acessa banco nenhum. Senha: a mesma dos dumps (Keychain, serviço `animedb-backup-icloud`).
 * Exit 0 = cópia conferida no iCloud; 1 = não saiu (nada é apagado do iCloud nesse caso).
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  copiasNoDestino,
  enviadoAoServidor,
  enviarPasta,
  lerSenha,
  limparParciais,
  notificar,
  planejarPodaDestino,
} from "./lib/backup-icloud.mjs"
import {
  PREFIXO_LOCAIS,
  RE_DMG_LOCAIS,
  ROOT,
  destinoLocais,
  keepLocais,
  leiaMe,
  montarCopia,
  nomeDoDmgLocais,
  procurarValores,
  tamanhoDe,
  tetoBytes,
  valoresSecretos,
} from "./lib/copia-locais.mjs"

const args = process.argv.slice(2)
const soConferir = args.includes("--conferir")
const ensaio = args.includes("--ensaio")
const raiz = path.resolve(args.find((a) => a.startsWith("--raiz="))?.slice(7) ?? ROOT)
const dest = destinoLocais()
const n = keepLocais()
const mb = (b) => `${(b / 1e6).toFixed(1)} MB`
let staging = null

// 🔴 `process.exit` não roda `finally`: sem limpar aqui, cada falha deixaria centenas de MB no tmp.
function falhar(msg) {
  if (staging) fs.rmSync(staging, { recursive: true, force: true })
  console.error(`\n🔴 cópia dos dados locais: ${msg}\n`)
  notificar(`A cópia dos dados locais no iCloud falhou: ${msg.split("\n")[0]}`)
  process.exit(1)
}

if (soConferir) {
  const copias = copiasNoDestino(dest, RE_DMG_LOCAIS)
  console.log(`iCloud: ${dest}`)
  if (!copias.length) console.log("  nenhuma cópia semanal dos dados locais ainda")
  for (const c of copias) {
    const enviado = c.confirmada ? enviadoAoServidor(path.join(dest, c.nome)) : null
    const servidor = enviado === true ? "enviado ao servidor" : enviado === false ? "ainda enviando" : "envio: desconhecido"
    console.log(`  ${c.confirmada ? "✅" : "🔴"} ${c.nome}  ${c.confirmada ? servidor : "SEM .sha256 — não confirmada"}`)
  }
  process.exit(0)
}

if (!ensaio) {
  if (!fs.existsSync(dest)) {
    if (!fs.existsSync(path.dirname(dest))) falhar(`pasta do iCloud Drive não encontrada: ${path.dirname(dest)}`)
    fs.mkdirSync(dest)
  }
  const restos = limparParciais(dest, PREFIXO_LOCAIS)
  if (restos.length) console.log(`removidos ${restos.length} resto(s) de envio interrompido: ${restos.join(", ")}`)
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-")
staging = fs.mkdtempSync(path.join(os.tmpdir(), "animedb-locais-"))
try {
  let resumo
  try {
    resumo = montarCopia({ raiz, staging })
  } catch (e) {
    falhar(`montar a cópia: ${e.message}`)
  }
  fs.writeFileSync(path.join(staging, "LEIA-ME.md"), leiaMe({ stamp, resumo }))
  fs.writeFileSync(path.join(staging, "resumo.json"), JSON.stringify({ stamp, ...resumo }, null, 2))

  const bytes = tamanhoDe(staging)
  console.log(
    `montada: ${resumo.incluidos.length} entradas locais, ${resumo.backups.incluir.length} de .backups, ` +
      `${resumo.branchesSoLocais} branch(es) só locais, WIP de ${resumo.worktreesComMudanca.length} worktree(s) — ${mb(bytes)}`,
  )
  if (resumo.backups.semFamilia.length) {
    console.log(`⚠️  ${resumo.backups.semFamilia.length} entrada(s) de .backups sem família, copiadas: ${resumo.backups.semFamilia.join(", ")}`)
  }
  if (bytes > tetoBytes()) {
    falhar(`a cópia tem ${mb(bytes)}, acima do teto de ${mb(tetoBytes())} (BACKUP_LOCAIS_MAX_MB). Algo grande caiu numa pasta ignorada — confira antes de subir.`)
  }

  // Chave real dentro de um arquivo copiado: a cópia sai (o DMG é criptografado e ficar sem cópia
  // seria pior), mas avisa — a chave está em texto aberto numa pasta do Mac.
  const vazados = procurarValores(staging, valoresSecretos(raiz))
  if (vazados.length) {
    const lista = vazados.map((v) => `${v.rel} (${v.chave})`).join(", ")
    console.log(`⚠️  valor de chave real encontrado em: ${lista}`)
    if (!ensaio) notificar(`Chave real em arquivo local copiado: ${vazados[0].rel}`)
  }

  if (ensaio) {
    console.log(`ensaio: nada foi gerado nem enviado; a cópia de verdade iria para ${dest}`)
    fs.rmSync(staging, { recursive: true, force: true }) // o `finally` não roda com exit
    process.exit(0)
  }

  const senha = lerSenha()
  if (senha.erro) falhar(senha.erro)
  try {
    const r = enviarPasta({
      origemDir: staging,
      nome: nomeDoDmgLocais(stamp),
      volume: `SatorIA dados locais ${stamp}`,
      destinoDir: dest,
      senha: senha.senha,
    })
    console.log(`✅ ${r.nome}  ${mb(r.bytes)}  conferido (sha256 ${r.hash.slice(0, 12)}…, abre com a senha, conteúdo igual)`)
  } catch (e) {
    falhar(e.message)
  }
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}

const apagar = planejarPodaDestino({ copias: copiasNoDestino(dest, RE_DMG_LOCAIS), keep: n })
for (const nome of apagar) {
  fs.rmSync(path.join(dest, nome), { force: true })
  fs.rmSync(path.join(dest, `${nome}.sha256`), { force: true })
}
if (apagar.length) console.log(`retenção no iCloud: removida(s) ${apagar.length} cópia(s) além das ${n} mais recentes: ${apagar.join(", ")}`)
