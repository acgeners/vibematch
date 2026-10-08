import "server-only"
import { execFileSync } from "node:child_process"

/**
 * DE QUAL CÓDIGO vem uma chamada paga — e a guarda que recusa pagar na NUVEM a partir de código
 * que não é o canônico. Consumida por `createLoggedMessage` (lib/ai/anthropic-client.ts), o ponto
 * único por onde toda chamada Anthropic do app passa, ANTES de chamar o provider.
 *
 * ── O incidente que ela existe para impedir (26–27/09/2026) ─────────────────────────────────
 * 25 obras foram avaliadas e gravadas na nuvem com `prompt_version = v31` a partir do `npm run
 * dev` de um checkout numa branch experimental NÃO mergeada, com arquivos rastreados modificados.
 * O `.env.local` aponta o app para a nuvem por desenho, e nenhuma camada perguntava de onde o
 * código vinha: `ensureAdmin` e `exigirCriteriosNoBanco` passaram, o provider cobrou, a avaliação
 * foi persistida. O código era equivalente ao canônico por sorte, não por garantia.
 *
 * ── A regra ─────────────────────────────────────────────────────────────────────────────────
 * Só entra quando o processo está FORA do Fly E o alvo do banco é a NUVEM. Aí exige código
 * canônico: nenhum arquivo RASTREADO modificado, e HEAD contido na ref LOCAL `origin/main`.
 *
 *   · Fly → permite: produção só recebe `origin/main`, pelo `deploy.sh`.
 *   · banco local → permite: nada é gravado onde leitores veem.
 *   · arquivos NÃO rastreados → não bloqueiam (o checkout de trabalho vive cheio deles, e um
 *     arquivo novo só entra no bundle se algum rastreado o importar — e aí este já está sujo).
 *   · branch ≠ main NÃO bloqueia por si: branch já mergeada tem HEAD dentro de `origin/main`.
 *   · git indeterminável, ou `origin/main` ausente → BLOQUEIA (fail closed): não dá para provar
 *     que o código é canônico, e o erro caro é pagar.
 *
 * ⚠️ `origin/main` é a ref LOCAL — não prova o estado do GitHub. Defasada, ela recusa código que
 * já foi mergeado; a saída é `git fetch`, nunca desligar a guarda.
 *
 * ── O override ──────────────────────────────────────────────────────────────────────────────
 * `PAID_CLOUD_NONCANONICAL_REASON="<motivo>"` permite DELIBERADAMENTE uma chamada não canônica
 * (um piloto numa branch de experimento, por exemplo). Não é um liga/desliga: sem motivo não há
 * override, e com motivo a chamada segue marcada como não canônica, com aviso e com o motivo
 * gravado na proveniência.
 *
 * ── O recálculo ─────────────────────────────────────────────────────────────────────────────
 * A mesma regra de canonicidade decide o recálculo da nuvem (`decideRecalcCloudRun`, aplicada em
 * `server/recalc/code-guard.ts`), com override PRÓPRIO (`RECALC_CLOUD_NONCANONICAL_REASON`). Os
 * dois overrides não se substituem: cada um só vale para a sua operação.
 */

export type CodeRuntime = "fly" | "local"

/** O que a sonda de git conseguiu saber. `ok: false` = indeterminado (fail closed). */
export type GitProbe =
  | {
      ok: true
      sha: string
      /** `null` em detached HEAD. */
      branch: string | null
      /** Só arquivos RASTREADOS. Não rastreados não contam. */
      dirtyTracked: boolean
      /** `null` = a ref local `origin/main` não existe. */
      inOriginMain: boolean | null
    }
  | { ok: false; error: string }

/** O que vai para `ai_api_calls.metadata.code`. */
export interface CodeProvenance {
  runtime: CodeRuntime
  target: "cloud" | "local"
  sha: string | null
  branch: string | null
  dirty: boolean | null
  /** `null` = indeterminado (ref ausente ou git indisponível). */
  in_origin_main: boolean | null
  canonical: boolean | null
  override_reason?: string
  git_error?: string
}

/** A decisão de uma operação sensível contra a nuvem (chamada paga ou recálculo). */
export type CodeGateDecision =
  | { allow: true; basis: "fly" | "local_db" | "canonical" | "override"; provenance: CodeProvenance }
  | { allow: false; message: string; provenance: CodeProvenance }

export type PaidCallDecision = CodeGateDecision

export const OVERRIDE_ENV = "PAID_CLOUD_NONCANONICAL_REASON"

/** Motivo do override, ou `null` quando não há override (ausente, vazio ou só espaço). */
export function normalizeOverride(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim()
  return v.length > 0 ? v : null
}

/** A decisão. Pura: tudo que ela sabe do mundo chega pelos argumentos. */
export function decidePaidCloudCall(input: {
  onFly: boolean
  localDb: boolean
  /** Só é consultada quando a regra entra (fora do Fly + nuvem). */
  git: GitProbe | null
  override: string | null
}): PaidCallDecision {
  const target = input.localDb ? "local" : "cloud"
  if (input.onFly) {
    return { allow: true, basis: "fly", provenance: vazio("fly", target) }
  }
  if (input.localDb) {
    return { allow: true, basis: "local_db", provenance: vazio("local", target) }
  }

  const provenance = provenanceFromGit(input.git, target)

  if (provenance.canonical === true) return { allow: true, basis: "canonical", provenance }

  if (input.override) {
    return { allow: true, basis: "override", provenance: { ...provenance, override_reason: input.override } }
  }
  return { allow: false, message: mensagemDeBloqueio(provenance), provenance }
}

/**
 * A MESMA regra de canonicidade, para o RECÁLCULO — que é outra autorização. Ele não é pago, mas
 * regrava os scores do catálogo inteiro na nuvem e dispara sozinho (basta abrir uma página com
 * pendência), então um checkout experimental o rodaria sem ninguém pedir. Precedente: 02–03/10/2026,
 * recálculos de uma branch defasada regravaram a Nota Prevista do catálogo.
 *
 * 🔴 O `override` que chega aqui é o do RECÁLCULO (`RECALC_CLOUD_NONCANONICAL_REASON`, lido em
 * `server/recalc/code-guard.ts`), nunca o das chamadas pagas: autorizar um experimento pago não
 * autoriza regravar o catálogo, e vice-versa.
 *
 * Diferença deliberada para a decisão paga: fora do Fly, o git é registrado sempre que foi lido —
 * também no banco local —, porque esta proveniência vai para o job e é ela que diz de onde veio um
 * recálculo. A DECISÃO não muda: banco local continua liberado.
 */
export function decideRecalcCloudRun(input: {
  onFly: boolean
  localDb: boolean
  git: GitProbe | null
  override: string | null
}): CodeGateDecision {
  const target = input.localDb ? "local" : "cloud"
  if (input.onFly) {
    return { allow: true, basis: "fly", provenance: vazio("fly", target) }
  }
  if (input.localDb) {
    return { allow: true, basis: "local_db", provenance: input.git ? provenanceFromGit(input.git, target) : vazio("local", target) }
  }

  const provenance = provenanceFromGit(input.git, target)
  if (provenance.canonical === true) return { allow: true, basis: "canonical", provenance }

  if (input.override) {
    return { allow: true, basis: "override", provenance: { ...provenance, override_reason: input.override } }
  }
  return { allow: false, message: mensagemDeRecalcBloqueado(provenance), provenance }
}

function vazio(runtime: CodeRuntime, target: "cloud" | "local"): CodeProvenance {
  return { runtime, target, sha: null, branch: null, dirty: null, in_origin_main: null, canonical: null }
}

/** Proveniência de um processo LOCAL a partir da sonda. Git indeterminado ⇒ `canonical: null` (fail closed). */
function provenanceFromGit(git: GitProbe | null, target: "cloud" | "local"): CodeProvenance {
  return git?.ok
    ? {
        runtime: "local",
        target,
        sha: git.sha,
        branch: git.branch,
        dirty: git.dirtyTracked,
        in_origin_main: git.inOriginMain,
        canonical: git.dirtyTracked === false && git.inOriginMain === true,
      }
    : { ...vazio("local", target), git_error: git?.ok === false ? git.error : "git não consultado" }
}

function ondeEsta(p: CodeProvenance): string {
  return `${p.branch ?? "(detached)"} @ ${p.sha ? p.sha.slice(0, 7) : "?"}`
}

function porqueNaoCanonico(p: CodeProvenance): string {
  if (p.git_error) return `não deu para ler o estado do git (${p.git_error})`
  if (p.in_origin_main === null) return "a ref local origin/main não existe"
  if (p.dirty && p.in_origin_main === false) return "há arquivos rastreados modificados E o HEAD não está em origin/main"
  if (p.dirty) return "há arquivos rastreados modificados"
  return "o HEAD não está contido em origin/main (ref local — se acabou de mergear, rode `git fetch` e tente de novo)"
}

function mensagemDeBloqueio(p: CodeProvenance): string {
  return (
    `Chamada paga RECUSADA antes do provider: este processo local está apontado para o banco da NUVEM ` +
    `e o código não é o canônico — ${porqueNaoCanonico(p)}. Checkout: ${ondeEsta(p)}. ` +
    `Rode a partir de um checkout limpo contido em origin/main, aponte o banco para o local, ` +
    `ou, se o experimento for deliberado, defina ${OVERRIDE_ENV}="<motivo>".`
  )
}

/** Mensagem de UI: diz o que fazer e NÃO oferece o override — ele é para experimento deliberado. */
function mensagemDeRecalcBloqueado(p: CodeProvenance): string {
  return (
    `Recálculo da nuvem BLOQUEADO: este checkout local não está no código canônico — ` +
    `${porqueNaoCanonico(p)}. Checkout: ${ondeEsta(p)}. Nada foi calculado nem gravado, e o ` +
    `recálculo continua pendente. Rode-o a partir de um checkout limpo contido em origin/main ` +
    `(código já mergeado).`
  )
}

function git(args: string[], cwd: string): { status: number; out: string } {
  try {
    // `--no-optional-locks`: a sonda só LÊ — sem ele, `git status` pode reescrever o índice.
    const out = execFileSync("git", ["--no-optional-locks", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
    })
    return { status: 0, out: out.trim() }
  } catch (err) {
    const status = typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : -1
    return { status, out: "" }
  }
}

/** Lê o estado do checkout do processo (`cwd` só existe para teste). Sem rede: só refs e índice locais. */
export function probeGit(cwd: string = process.cwd()): GitProbe {
  const head = git(["rev-parse", "--verify", "HEAD"], cwd)
  if (head.status !== 0 || !/^[0-9a-f]{40}$/.test(head.out)) return { ok: false, error: "HEAD indeterminado" }
  const branchRes = git(["symbolic-ref", "--short", "-q", "HEAD"], cwd)
  const branch = branchRes.status === 0 && branchRes.out ? branchRes.out : null
  const status = git(["status", "--porcelain", "--untracked-files=no"], cwd)
  if (status.status !== 0) return { ok: false, error: "git status falhou" }
  const ref = git(["rev-parse", "--verify", "-q", "refs/remotes/origin/main"], cwd)
  let inOriginMain: boolean | null = null
  if (ref.status === 0) {
    const anc = git(["merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main"], cwd)
    if (anc.status === 0) inOriginMain = true
    else if (anc.status === 1) inOriginMain = false
    else return { ok: false, error: "merge-base falhou" }
  }
  return { ok: true, sha: head.out, branch, dirtyTracked: status.out.length > 0, inOriginMain }
}
