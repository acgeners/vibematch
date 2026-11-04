/**
 * Cópia dos backups COMPLETOS para o iCloud Drive — dono único da régua de "qual backup já está
 * lá fora" e de como ele chega lá.
 *
 * Por que existe: o backup de domingo grava só no disco do Mac. Se o disco falhar, ele vai junto
 * com as cópias. Aqui cada backup completo vira um DMG criptografado (AES-256, senha no Keychain)
 * em `iCloud Drive/VibeMatch-backups/`.
 *
 * As regras, cada uma porque o contrário falha calado:
 *   - só backup COMPLETO sai (`classificarBackup`), nunca pelo nome da pasta;
 *   - a cópia só conta depois de conferida: o DMG copiado para o iCloud tem o mesmo sha256 do que
 *     foi gerado, abre com a senha do Keychain e cada arquivo de dentro bate com o original. Até
 *     lá ele se chama `.parcial`, e o `.sha256` ao lado é escrito por último — DMG sem `.sha256`
 *     não está confirmado e é enviado de novo;
 *   - roda em modo de recuperação: manda os N completos mais recentes que ainda não estão lá, não
 *     só o de hoje. Semana que falhou é recuperada na seguinte;
 *   - a poda só apaga arquivos com o prefixo deste módulo e só além dos N mais recentes
 *     CONFIRMADOS. As cópias manuais da pasta (ex.: `VibeMatch-preservacao-*`) nunca são tocadas.
 *
 * A senha nunca vai para argumento de processo (apareceria no `ps`): ela é lida do Keychain e
 * entregue ao `hdiutil` pelo stdin.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"
import { classificarBackup } from "./backup-integridade.mjs"
import { listarFamilia } from "./backups-retencao.mjs"

export const DESTINO_PADRAO = path.join(
  os.homedir(),
  "Library/Mobile Documents/com~apple~CloudDocs/VibeMatch-backups",
)
export const destino = () => process.env.BACKUP_ICLOUD_DIR || DESTINO_PADRAO

/** Onde a senha mora no Keychain. A env existe só para teste (senha descartável). */
export const keychain = () => ({
  servico: process.env.BACKUP_ICLOUD_KEYCHAIN_SERVICE || "animedb-backup-icloud",
  conta: "animedb",
})
export const comandoCadastrarSenha = () =>
  `security add-generic-password -s ${keychain().servico} -a ${keychain().conta} -w`

export const KEEP_PADRAO = 5
export const keep = () => {
  const n = Number(process.env.BACKUP_ICLOUD_KEEP)
  return Number.isInteger(n) && n > 0 ? n : KEEP_PADRAO
}

const PREFIXO = "VibeMatch-backup-"
const RE_DMG = /^VibeMatch-backup-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)\.dmg$/
const RE_SIDECAR = /^([0-9a-f]{64}) {2}(\S+)\n?$/
export const SUFIXO_PARCIAL = ".parcial"

export const nomeDoDmg = (stamp) => `${PREFIXO}${stamp}.dmg`
export const stampDoDmg = (nome) => nome.match(RE_DMG)?.[1] ?? null

/** Os backups COMPLETOS da pasta de origem, do mais novo ao mais antigo. */
export function completosLocais(origem) {
  const nomes = listarFamilia("backup", origem)
  const completos = nomes.filter((n) => classificarBackup(path.join(origem, n)).completo)
  return { pastas: nomes.length, completos: completos.sort().reverse() }
}

/**
 * As cópias deste módulo no destino. `confirmada` = DMG + `.sha256` que nomeia exatamente ele.
 * Não relê o DMG: o iCloud pode ter tirado o conteúdo do disco ("Otimizar armazenamento"), e ler
 * forçaria o download. A conferência profunda acontece uma vez, ao enviar.
 */
export function copiasNoDestino(dir) {
  if (!fs.existsSync(dir)) return []
  const nomes = new Set(fs.readdirSync(dir))
  const copias = []
  for (const nome of nomes) {
    const stamp = stampDoDmg(nome)
    if (!stamp) continue
    let hash = null
    if (nomes.has(`${nome}.sha256`)) {
      const m = fs.readFileSync(path.join(dir, `${nome}.sha256`), "utf8").match(RE_SIDECAR)
      if (m && m[2] === nome) hash = m[1]
    }
    copias.push({ stamp, nome, hash, confirmada: hash !== null })
  }
  return copias.sort((a, b) => (a.stamp < b.stamp ? 1 : -1))
}

/** Puro: quais backups enviar. Os `keep` completos mais recentes que não estão confirmados lá. */
export function planejarEnvio({ completos, copias, keep: n }) {
  const confirmadas = new Set(copias.filter((c) => c.confirmada).map((c) => c.stamp))
  const alvo = [...completos].sort().reverse().slice(0, n)
  return { alvo, enviar: alvo.filter((s) => !confirmadas.has(s)), jaLa: alvo.filter((s) => confirmadas.has(s)) }
}

/**
 * Puro: quais cópias apagar do destino. Só as deste módulo, só CONFIRMADAS contam, e só o que
 * passar das `keep` mais recentes. Cópia não confirmada nunca é apagada aqui — o envio seguinte
 * a substitui.
 */
export function planejarPodaDestino({ copias, keep: n }) {
  const confirmadas = copias.filter((c) => c.confirmada).sort((a, b) => (a.stamp < b.stamp ? 1 : -1))
  return confirmadas.slice(n).map((c) => c.nome)
}

export function sha256Arquivo(arquivo) {
  const h = crypto.createHash("sha256")
  const fd = fs.openSync(arquivo, "r")
  try {
    const buf = Buffer.alloc(1 << 20)
    let lidos
    while ((lidos = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, lidos))
  } finally {
    fs.closeSync(fd)
  }
  return h.digest("hex")
}

/** Lê a senha do Keychain. Nunca a imprime. */
export function lerSenha() {
  const { servico, conta } = keychain()
  const r = spawnSync("security", ["find-generic-password", "-s", servico, "-a", conta, "-w"], { encoding: "utf8" })
  if (r.status !== 0) {
    const motivo = (r.stderr || "").trim()
    if (/could not be found/i.test(motivo)) return { erro: `a senha não está no Keychain. Cadastre com:\n  ${comandoCadastrarSenha()}` }
    if (/interaction is not allowed/i.test(motivo)) return { erro: "o Keychain está bloqueado (Mac bloqueado ou recém-ligado)" }
    return { erro: `o Keychain recusou a leitura: ${motivo || `código ${r.status}`}` }
  }
  const senha = r.stdout.replace(/\n$/, "")
  return senha ? { senha } : { erro: "a senha no Keychain está vazia" }
}

function hdiutil(args, senha) {
  return spawnSync("hdiutil", args, { input: senha ?? undefined, encoding: "utf8", maxBuffer: 16 << 20 })
}

export function criarDmg(origemDir, saida, senha, volume) {
  const r = hdiutil(
    ["create", "-quiet", "-encryption", "AES-256", "-stdinpass", "-format", "UDZO", "-volname", volume, "-srcfolder", origemDir, saida],
    senha,
  )
  if (r.status !== 0) throw new Error(`hdiutil create falhou: ${(r.stderr || "").trim() || `código ${r.status}`}`)
}

/** Monta somente leitura, fora do Finder. Devolve o ponto de montagem. */
export function montar(dmg, senha) {
  const pai = fs.mkdtempSync(path.join(os.tmpdir(), "animedb-icloud-mnt-"))
  const r = hdiutil(["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountrandom", pai, "-stdinpass", "-plist", dmg], senha)
  if (r.status !== 0) {
    fs.rmSync(pai, { recursive: true, force: true })
    throw new Error(`não abriu com a senha do Keychain: ${(r.stderr || "").trim() || `código ${r.status}`}`)
  }
  const ponto = [...r.stdout.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)].map((m) => m[1])[0]
  if (!ponto) throw new Error("hdiutil attach não informou o ponto de montagem")
  return { ponto, pai }
}

export function desmontar({ ponto, pai }) {
  let r = hdiutil(["detach", ponto, "-quiet"])
  if (r.status !== 0) r = hdiutil(["detach", ponto, "-quiet", "-force"])
  fs.rmSync(pai, { recursive: true, force: true })
  return r.status === 0
}

function listarArquivos(raiz) {
  const out = []
  const andar = (rel) => {
    for (const e of fs.readdirSync(path.join(raiz, rel), { withFileTypes: true })) {
      // Entradas do sistema de arquivos do volume (.fseventsd, .Trashes…), não do backup.
      if (rel === "" && e.name.startsWith(".")) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) andar(r)
      else out.push(r)
    }
  }
  andar("")
  return out.sort()
}

/** Confere arquivo a arquivo (nome + sha256). Devolve a lista de problemas (vazia = confere). */
export function compararConteudo(origemDir, montadoDir) {
  const a = listarArquivos(origemDir)
  const b = new Set(listarArquivos(montadoDir))
  const problemas = []
  for (const rel of a) {
    if (!b.has(rel)) problemas.push(`falta ${rel}`)
    else if (sha256Arquivo(path.join(origemDir, rel)) !== sha256Arquivo(path.join(montadoDir, rel))) {
      problemas.push(`${rel} difere do original`)
    }
    b.delete(rel)
  }
  for (const rel of b) problemas.push(`arquivo a mais: ${rel}`)
  if (a.length === 0) problemas.push("a pasta de origem está vazia")
  return problemas
}

/**
 * Envia UM backup: gera o DMG fora do iCloud, copia como `.parcial`, confere a cópia (hash,
 * abertura com a senha, conteúdo) e só então renomeia e escreve o `.sha256`.
 */
export function enviarBackup({ origemDir, stamp, destinoDir, senha }) {
  const nome = nomeDoDmg(stamp)
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "animedb-icloud-"))
  const parcial = path.join(destinoDir, nome + SUFIXO_PARCIAL)
  try {
    const gerado = path.join(staging, nome)
    criarDmg(origemDir, gerado, senha, `SatorIA backup ${stamp}`)
    const hash = sha256Arquivo(gerado)
    fs.copyFileSync(gerado, parcial)
    const hashCopia = sha256Arquivo(parcial)
    if (hashCopia !== hash) throw new Error(`a cópia no destino tem sha256 ${hashCopia}, o gerado tem ${hash}`)
    const montado = montar(parcial, senha)
    let problemas
    try {
      problemas = compararConteudo(origemDir, montado.ponto)
    } finally {
      desmontar(montado)
    }
    if (problemas.length) throw new Error(`o conteúdo do DMG não confere: ${problemas.slice(0, 5).join("; ")}`)
    const final = path.join(destinoDir, nome)
    fs.chmodSync(parcial, 0o600)
    fs.renameSync(parcial, final)
    const sidecarTmp = path.join(destinoDir, `${nome}.sha256${SUFIXO_PARCIAL}`)
    fs.writeFileSync(sidecarTmp, `${hash}  ${nome}\n`, { mode: 0o600 })
    fs.renameSync(sidecarTmp, `${final}.sha256`)
    return { nome, hash, bytes: fs.statSync(final).size }
  } catch (e) {
    fs.rmSync(parcial, { force: true })
    throw e
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

/** Restos de execução interrompida: só os `.parcial` deste módulo. */
export function limparParciais(dir) {
  if (!fs.existsSync(dir)) return []
  const restos = fs.readdirSync(dir).filter((n) => n.startsWith(PREFIXO) && n.endsWith(SUFIXO_PARCIAL))
  for (const n of restos) fs.rmSync(path.join(dir, n), { force: true })
  return restos
}

/** O que o macOS diz sobre o envio ao servidor do iCloud: true, false ou null (desconhecido). */
export function enviadoAoServidor(arquivo) {
  const r = spawnSync(
    "osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      'ObjC.import("Foundation"); function run(a){ const u=$.NSURL.fileURLWithPath(a[0]); const v=Ref(); ' +
        'u.getResourceValueForKeyError(v, $.NSURLUbiquitousItemIsUploadedKey, null); return String(ObjC.unwrap(v[0])) }',
      arquivo,
    ],
    { encoding: "utf8" },
  )
  const s = (r.stdout || "").trim()
  return s === "true" ? true : s === "false" ? false : null
}

export function notificar(texto) {
  if (process.env.BACKUP_ICLOUD_SEM_NOTIFICACAO === "1") return
  spawnSync("osascript", ["-e", `display notification ${JSON.stringify(texto)} with title "Backup SatorIA"`])
}
