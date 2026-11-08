/**
 * Cópia SEMANAL do que só existe neste Mac — fora do git e fora do backup do banco — para o iCloud
 * Drive, em DMG criptografado (mesma senha do Keychain dos dumps). Roda no fim do agente de domingo
 * (`backup-primary.mjs` → `backup-locais-icloud.mjs`).
 *
 * Por que existe: a `Auditoria/` (pilotos pagos, pacotes da revisão cega), o gold set, o "estado
 * anterior" das correções feitas na nuvem, as branches só locais e o trabalho não commitado dos
 * worktrees não estão no GitHub (o repositório é PÚBLICO, então não podem ir para lá) nem no dump do
 * banco. Até 2026-11 a única cópia fora do Mac era uma foto manual, sem criptografia.
 *
 * As regras, cada uma porque o contrário falha calado:
 *   - o que entra é DERIVADO do git (tudo que ele ignora ou não rastreia), menos `EXCLUIDOS`, que
 *     carrega o motivo de cada exclusão. Uma lista do que incluir envelheceria: pasta nova só local
 *     ficaria de fora sem ninguém perceber;
 *   - a exclusão vale em TODA profundidade (um `.env` dentro de uma pasta copiada não entra);
 *   - de `.backups/` entram só as famílias com `copiaLocal: true` (`backups-retencao.mjs`); entrada
 *     sem família entra, porque não dá para saber se é recriável;
 *   - link simbólico é copiado como link, com o alvo escrito nele (a `Auditoria/` tem centenas de
 *     atalhos relativos); resolvê-lo apontaria para o Mac, não para dentro da cópia;
 *   - a cópia só conta depois de conferida (`enviarPasta`: hash, abertura com a senha, conteúdo).
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { FAMILIAS } from "./backups-retencao.mjs"

export const ROOT = path.resolve(import.meta.dirname, "..", "..")

export const DESTINO_LOCAIS_PADRAO = path.join(
  os.homedir(),
  "Library/Mobile Documents/com~apple~CloudDocs/VibeMatch-copias",
)
export const destinoLocais = () => process.env.BACKUP_LOCAIS_DIR || DESTINO_LOCAIS_PADRAO

export const KEEP_LOCAIS_PADRAO = 2
export const keepLocais = () => {
  const n = Number(process.env.BACKUP_LOCAIS_KEEP)
  return Number.isInteger(n) && n > 0 ? n : KEEP_LOCAIS_PADRAO
}

/** Teto da cópia antes de gerar o DMG: algo grande caiu numa pasta ignorada e encheria o iCloud. */
export const TETO_MB_PADRAO = 2000
export const tetoBytes = () => {
  const n = Number(process.env.BACKUP_LOCAIS_MAX_MB)
  return (Number.isFinite(n) && n > 0 ? n : TETO_MB_PADRAO) * 1e6
}

export const PREFIXO_LOCAIS = "VibeMatch-locais-"
export const RE_DMG_LOCAIS = /^VibeMatch-locais-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)\.dmg$/
export const nomeDoDmgLocais = (stamp) => `${PREFIXO_LOCAIS}${stamp}.dmg`

/**
 * O que o git ignora ou não rastreia e NÃO entra na cópia. `casa` recebe o caminho relativo à raiz
 * do repositório, sem barra no fim, e vale para arquivo e para pasta em qualquer profundidade.
 */
export const EXCLUIDOS = [
  { casa: (r) => /(^|\/)\.env[^/]*$/.test(r), motivo: "segredo: arquivo .env nunca entra em cópia" },
  { casa: (r) => /(^|\/)node_modules(\/|$)/.test(r), motivo: "dependências: `npm install` recria" },
  { casa: (r) => /^\.(next|turbo)(\/|$)/.test(r), motivo: "cache de build do Next" },
  { casa: (r) => /^\.cache(\/|$)/.test(r), motivo: "Chrome do sidecar (~120 MB), baixado de novo" },
  { id: "backups", casa: (r) => /^\.backups(\/|$)/.test(r), motivo: "tratado por família (`copiaLocal` em backups-retencao.mjs)" },
  { casa: (r) => /(^|\/)\.DS_Store$/.test(r), motivo: "metadado do Finder" },
  { casa: (r) => /\.tsbuildinfo$/.test(r) || r === "next-env.d.ts", motivo: "gerado pelo TypeScript/Next" },
  { casa: (r) => /^supabase\/\.(temp|branches)(\/|$)/.test(r), motivo: "estado do CLI do Supabase" },
]

/** `ignorar`: ids de regra que não valem nesta cópia (a de `.backups`, ao copiar uma família escolhida). */
export const motivoDeExclusao = (rel, ignorar = []) =>
  EXCLUIDOS.find((e) => !ignorar.includes(e.id) && e.casa(rel))?.motivo ?? null

/**
 * Puro: a partir de `git status --ignored --porcelain=v1 -z`, os caminhos que entram (`??` e `!!`)
 * e os que ficam fora, com o motivo. Arquivo rastreado e modificado não entra aqui: ele vai no patch
 * do checkout principal (`coletarWip`).
 */
export function selecionarCaminhos(porcelanaZ) {
  const incluir = []
  const excluidos = []
  for (const reg of porcelanaZ.split("\0")) {
    if (reg.length < 4) continue
    const xy = reg.slice(0, 2)
    if (xy !== "??" && xy !== "!!") continue
    const rel = reg.slice(3).replace(/\/$/, "")
    const motivo = motivoDeExclusao(rel)
    if (motivo) excluidos.push({ rel, motivo })
    else incluir.push(rel)
  }
  return { incluir: incluir.sort(), excluidos }
}

/** Puro: de `.backups/`, quais entradas entram. Sem família ⇒ entra (não dá para saber se recria). */
export function selecionarBackups(nomes) {
  const incluir = []
  const fora = []
  const semFamilia = []
  for (const nome of [...nomes].sort()) {
    const familia = FAMILIAS.find((f) => f.casa(nome))
    if (!familia) {
      semFamilia.push(nome)
      incluir.push(nome)
    } else if (familia.copiaLocal) incluir.push(nome)
    else fora.push({ nome, familia: familia.id })
  }
  return { incluir, fora, semFamilia }
}

function git(args, cwd, opts = {}) {
  const r = spawnSync("git", args, { cwd, encoding: opts.binario ? "buffer" : "utf8", maxBuffer: 1 << 30 })
  if (r.status !== 0) {
    const erro = Buffer.isBuffer(r.stderr) ? r.stderr.toString("utf8") : r.stderr
    throw new Error(`git ${args.slice(0, 3).join(" ")} falhou: ${(erro || "").trim() || `código ${r.status}`}`)
  }
  return r.stdout
}

/**
 * Copia `rel` (arquivo, pasta ou link) para `destino`, aplicando `EXCLUIDOS` em toda profundidade.
 * Dentro de uma entrada de `.backups/` já escolhida por família, a regra de `.backups` não vale —
 * senão ela barraria a própria entrada; as outras (`.env`, `.DS_Store`…) continuam valendo.
 */
export function copiarComExclusao(raiz, rel, destino) {
  const ignorar = /^\.backups\/./.test(rel) ? ["backups"] : []
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  fs.cpSync(path.join(raiz, rel), destino, {
    recursive: true,
    verbatimSymlinks: true,
    preserveTimestamps: true,
    filter: (src) => motivoDeExclusao(path.relative(raiz, src), ignorar) === null,
  })
}

/** Bytes de uma árvore, sem seguir links. */
export function tamanhoDe(dir) {
  let total = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) total += tamanhoDe(p)
    else total += fs.statSync(p).size
  }
  return total
}

/** Branches locais com commit que não está em nenhuma branch remota — o que só existe aqui. */
function branchesSoLocais(raiz) {
  const nomes = git(["for-each-ref", "refs/heads", "--format=%(refname:short)"], raiz).split("\n").filter(Boolean)
  const linhas = []
  for (const b of nomes) {
    const n = Number(git(["rev-list", "--count", b, "--not", "--remotes"], raiz).trim())
    if (n > 0) linhas.push(`${b}  (${n} commit(s) fora do GitHub)`)
  }
  return linhas
}

/** O repositório inteiro num bundle conferido + a lista do que só existe aqui. */
export function coletarGit(raiz, destino) {
  fs.mkdirSync(destino, { recursive: true })
  const bundle = path.join(destino, "repo.bundle")
  git(["bundle", "create", bundle, "--all"], raiz)
  git(["bundle", "verify", bundle], raiz)
  fs.writeFileSync(path.join(destino, "refs.txt"), git(["for-each-ref", "--format=%(objectname) %(refname)"], raiz))
  fs.writeFileSync(path.join(destino, "worktrees.txt"), git(["worktree", "list"], raiz))
  const soLocais = branchesSoLocais(raiz)
  fs.writeFileSync(path.join(destino, "branches-so-locais.txt"), soLocais.join("\n") + (soLocais.length ? "\n" : ""))
  const exclude = path.join(raiz, ".git", "info", "exclude")
  if (fs.existsSync(exclude)) fs.copyFileSync(exclude, path.join(destino, "info-exclude.txt"))
  return { branchesSoLocais: soLocais.length }
}

/**
 * O trabalho não commitado de cada worktree (inclusive o checkout principal): `alteracoes.patch`
 * (conferido: desfazê-lo encaixa no estado atual), `nao-rastreados.tar` e `HEAD.txt`. No checkout
 * principal os não rastreados já estão em `dados-locais/`, então não vão de novo no tar.
 */
export function coletarWip(raiz, destino) {
  const caminhos = git(["worktree", "list", "--porcelain"], raiz)
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .filter((p) => fs.existsSync(p))
  const salvos = []
  // realpath, não resolve: o git devolve o caminho REAL (/private/var/… no macOS), e um tmp passado
  // como /var/… nunca bateria — a mesma armadilha do smoke logado (ver CLAUDE.md).
  const raizReal = fs.realpathSync(raiz)
  for (const p of caminhos) {
    const principal = fs.realpathSync(p) === raizReal
    const status = git(["status", "--porcelain"], p)
    if (!status.trim()) continue
    const diff = git(["diff", "HEAD", "--binary"], p, { binario: true })
    // No checkout principal o não rastreado já está em `dados-locais/`: sem diff, nada a salvar aqui.
    if (principal && diff.length === 0) continue
    const nome = path.basename(p)
    const o = path.join(destino, nome)
    fs.mkdirSync(o, { recursive: true })
    const branch = git(["branch", "--show-current"], p).trim()
    const head = git(["rev-parse", "HEAD"], p).trim()
    fs.writeFileSync(path.join(o, "HEAD.txt"), `worktree: ${p}\nbranch:   ${branch}\nHEAD:     ${head}\n\n${status}`)
    const patch = path.join(o, "alteracoes.patch")
    fs.writeFileSync(patch, diff)
    if (diff.length > 0) git(["apply", "--check", "-R", "--binary", patch], p)
    if (!principal) {
      const lista = git(["ls-files", "--others", "--exclude-standard", "-z"], p)
      if (lista) {
        const r = spawnSync("tar", ["-cf", path.join(o, "nao-rastreados.tar"), "--null", "-T", "-"], { cwd: p, input: lista })
        if (r.status !== 0) throw new Error(`tar dos não rastreados de ${nome} falhou: ${(r.stderr || "").toString().trim()}`)
      }
    }
    salvos.push(nome)
  }
  return { worktrees: caminhos.length, comMudanca: salvos }
}

/** Os valores das chaves reais (`.env.local`, `.env.supabase-cloud`), para conferir que não vazaram. */
export function valoresSecretos(raiz) {
  const valores = []
  for (const arq of [".env.local", ".env.supabase-cloud"]) {
    const p = path.join(raiz, arq)
    if (!fs.existsSync(p)) continue
    for (const linha of fs.readFileSync(p, "utf8").split("\n")) {
      const m = linha.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!m || !/KEY|SECRET|PASSWORD|TOKEN|CLIENT_ID/.test(m[1])) continue
      const v = m[2].trim().replace(/^["']|["']$/g, "")
      if (v.length >= 12) valores.push({ chave: m[1], valor: v })
    }
  }
  return valores
}

/**
 * Arquivos da cópia que contêm o valor de uma chave real. Não lê pasta lacrada da revisão cega
 * (`LACRADO-NAO-ABRIR`): o lacre vale também para programa. Pula arquivo acima de 50 MB.
 */
export function procurarValores(dir, valores) {
  const achados = []
  const andar = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        if (!e.name.includes("LACRADO-NAO-ABRIR")) andar(r)
        continue
      }
      const p = path.join(dir, r)
      if (fs.statSync(p).size > 50e6) continue
      const buf = fs.readFileSync(p)
      for (const { chave, valor } of valores) if (buf.includes(valor)) achados.push({ rel: r, chave })
    }
  }
  andar("")
  return achados
}

/**
 * Monta a cópia em `staging`: `dados-locais/` (no mesmo caminho relativo do repositório), `git/`
 * (bundle + só locais) e `git/wip/<worktree>/`. Não toca o iCloud. Devolve o resumo.
 */
export function montarCopia({ raiz = ROOT, staging }) {
  const sel = selecionarCaminhos(git(["status", "--ignored", "--porcelain=v1", "-z"], raiz))
  const dados = path.join(staging, "dados-locais")
  for (const rel of sel.incluir) copiarComExclusao(raiz, rel, path.join(dados, rel))

  const pastaBackups = path.join(raiz, ".backups")
  const bk = selecionarBackups(fs.existsSync(pastaBackups) ? fs.readdirSync(pastaBackups) : [])
  for (const nome of bk.incluir) copiarComExclusao(raiz, `.backups/${nome}`, path.join(dados, ".backups", nome))

  const g = coletarGit(raiz, path.join(staging, "git"))
  const w = coletarWip(raiz, path.join(staging, "git", "wip"))
  return {
    incluidos: sel.incluir,
    excluidos: sel.excluidos,
    backups: bk,
    branchesSoLocais: g.branchesSoLocais,
    worktreesComMudanca: w.comMudanca,
  }
}

export function leiaMe({ stamp, resumo }) {
  const fora = EXCLUIDOS.map((e) => `- ${e.motivo}`).join("\n")
  const familiasFora = FAMILIAS.filter((f) => !f.copiaLocal).map((f) => `\`${f.id}\``).join(", ")
  return `# Cópia do que só existe no Mac — ${stamp}

Gerada sozinha pelo backup de domingo (\`scripts/backup-locais-icloud.mjs\`). É o trabalho do SatorIA
(animedb) que **não está no GitHub nem no backup do banco**. A senha deste DMG é a mesma dos backups
do banco: Keychain, serviço \`animedb-backup-icloud\` (também no app Senhas).

## O que tem aqui

| pasta | o que é |
|---|---|
| \`dados-locais/\` | tudo que o git ignora ou não rastreia na raiz do \`animedb/\`, no mesmo caminho (${resumo.incluidos.length} entradas) |
| \`dados-locais/.backups/\` | o "estado anterior" das correções na nuvem (${resumo.backups.incluir.length} entradas) — a única forma de desfazê-las |
| \`git/repo.bundle\` | o repositório inteiro; \`git/branches-so-locais.txt\` lista as ${resumo.branchesSoLocais} branch(es) que só existem no Mac |
| \`git/wip/<worktree>/\` | trabalho não commitado: \`alteracoes.patch\`, \`nao-rastreados.tar\`, \`HEAD.txt\` (${resumo.worktreesComMudanca.length} worktree(s)) |

⚠️ Pastas que começam com ponto (\`.gold\`, \`.pilot\`, \`.backups\`…) ficam ocultas no Finder: Cmd+Shift+. mostra.

## Como restaurar

\`\`\`bash
git clone git/repo.bundle animedb                     # todas as branches
ditto dados-locais/ animedb/                          # os dados locais, nos mesmos caminhos
git -C animedb worktree add ../<worktree> <commit do HEAD.txt>
git -C ../<worktree> apply --binary <cópia>/git/wip/<worktree>/alteracoes.patch
tar -xf <cópia>/git/wip/<worktree>/nao-rastreados.tar -C ../<worktree>
\`\`\`

## O que NÃO está aqui, de propósito

${fora}
- de \`.backups/\`, as famílias ${familiasFora} (dumps grandes, staging ou recriáveis; os dumps do banco
  vão em \`VibeMatch-backups/\`)

Chaves e senhas (\`.env*\`) nunca entram: num Mac novo, refaça-as nos painéis (Anthropic, Supabase,
MyAnimeList, OpenAI).
`
}
