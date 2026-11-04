#!/usr/bin/env node
/**
 * Copia os backups completos para o iCloud Drive, em DMG criptografado — régua em
 * `lib/backup-icloud.mjs`. Roda sozinho no fim do `backup-primary.mjs` (agente de domingo).
 *
 *   node scripts/backup-icloud.mjs              (npm run backup:icloud) envia o que falta e poda
 *   node scripts/backup-icloud.mjs --conferir   só leitura: o que está no iCloud e o que falta
 *   --origem=<pasta>                            outra pasta de backups (padrão: a do checkout)
 *
 * Não acessa banco nenhum. Senha: Keychain, serviço `animedb-backup-icloud` (cadastro único, ver
 * a mensagem impressa quando falta). Exit 0 = tudo conferido; 1 = alguma cópia não saiu.
 */
import fs from "node:fs"
import path from "node:path"
import { BASE } from "./lib/backups-retencao.mjs"
import { criarFunil } from "./lib/funil.mjs"
import {
  completosLocais,
  copiasNoDestino,
  destino,
  enviadoAoServidor,
  enviarBackup,
  keep,
  lerSenha,
  limparParciais,
  notificar,
  planejarEnvio,
  planejarPodaDestino,
} from "./lib/backup-icloud.mjs"

const args = process.argv.slice(2)
const origem = path.resolve(args.find((a) => a.startsWith("--origem="))?.slice(9) ?? BASE)
const soConferir = args.includes("--conferir")
const dest = destino()
const n = keep()
const mb = (b) => `${(b / 1e6).toFixed(1)} MB`

function falhar(msg) {
  console.error(`\n🔴 cópia no iCloud: ${msg}\n`)
  notificar(`A cópia do backup no iCloud falhou: ${msg.split("\n")[0]}`)
  process.exit(1)
}

const { pastas, completos } = completosLocais(origem)
const copias = copiasNoDestino(dest)
const plano = planejarEnvio({ completos, copias, keep: n })

const funil = criarFunil("cópia no iCloud")
funil.passo("pastas de backup", pastas)
funil.passo("completas", completos.length)
// O corte nas N mais recentes é de propósito: como passo do funil ele viraria um "dreno" que
// cresce a cada semana (a pasta local não é podada) e acabaria marcado em vermelho para sempre.
funil.passo(`das ${n} mais recentes, sem cópia confirmada no iCloud`, plano.enviar.length)

if (soConferir) {
  console.log(`iCloud: ${dest}`)
  if (!copias.length) console.log("  nenhuma cópia automática ainda")
  for (const c of copias) {
    const arq = path.join(dest, c.nome)
    const enviado = c.confirmada ? enviadoAoServidor(arq) : null
    const servidor = enviado === true ? "enviado ao servidor" : enviado === false ? "ainda enviando" : "envio: desconhecido"
    console.log(`  ${c.confirmada ? "✅" : "🔴"} ${c.nome}  ${c.confirmada ? servidor : "SEM .sha256 — não confirmada, será enviada de novo"}`)
  }
  funil.relatar()
  if (plano.enviar.length) console.log(`a enviar no próximo backup: ${plano.enviar.join(", ")}`)
  process.exit(0)
}

if (!completos.length) falhar(`nenhum backup completo em ${origem}`)

if (!fs.existsSync(dest)) {
  if (!fs.existsSync(path.dirname(dest))) falhar(`pasta do iCloud Drive não encontrada: ${path.dirname(dest)}`)
  fs.mkdirSync(dest)
}
const restos = limparParciais(dest)
if (restos.length) console.log(`removidos ${restos.length} resto(s) de envio interrompido: ${restos.join(", ")}`)

if (!plano.enviar.length) {
  funil.nadaAFazer("os backups mais recentes já estão no iCloud, conferidos.")
} else {
  funil.relatar()
  const senha = lerSenha()
  if (senha.erro) falhar(senha.erro)
  const falhas = []
  for (const stamp of plano.enviar) {
    try {
      const r = enviarBackup({ origemDir: path.join(origem, stamp), stamp, destinoDir: dest, senha: senha.senha })
      console.log(`✅ ${r.nome}  ${mb(r.bytes)}  conferido (sha256 ${r.hash.slice(0, 12)}…, abre com a senha, conteúdo igual)`)
    } catch (e) {
      falhas.push(`${stamp}: ${e.message}`)
      console.error(`🔴 ${stamp}: ${e.message}`)
    }
  }
  if (falhas.length) falhar(`${falhas.length} de ${plano.enviar.length} backup(s) não foram copiados.\n  ${falhas.join("\n  ")}`)
}

const apagar = planejarPodaDestino({ copias: copiasNoDestino(dest), keep: n })
for (const nome of apagar) {
  fs.rmSync(path.join(dest, nome), { force: true })
  fs.rmSync(path.join(dest, `${nome}.sha256`), { force: true })
}
if (apagar.length) console.log(`retenção no iCloud: removida(s) ${apagar.length} cópia(s) além das ${n} mais recentes: ${apagar.join(", ")}`)
