import { execFileSync } from "node:child_process"

/**
 * A sonda de git e o predicado de CHECKOUT CANÔNICO — sem `server-only` e em JS puro, porque têm dois
 * consumidores: as guardas do app (`lib/ai/code-provenance.ts`, que a reexporta) e o lançador local
 * `scripts/start-standalone.mjs`, que roda no Node cru e não carrega TypeScript nem `server-only`.
 * Uma régua só para os dois — a regra está documentada em `code-provenance.ts`.
 */

function git(args, cwd) {
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
    const status = typeof err?.status === "number" ? err.status : -1
    return { status, out: "" }
  }
}

/**
 * Lê o estado do checkout do processo (`cwd` só existe para teste). Sem rede: só refs e índice locais.
 * @param {string} [cwd]
 * @returns {import("./code-provenance").GitProbe}
 */
export function probeGit(cwd = process.cwd()) {
  const head = git(["rev-parse", "--verify", "HEAD"], cwd)
  if (head.status !== 0 || !/^[0-9a-f]{40}$/.test(head.out)) return { ok: false, error: "HEAD indeterminado" }
  const branchRes = git(["symbolic-ref", "--short", "-q", "HEAD"], cwd)
  const branch = branchRes.status === 0 && branchRes.out ? branchRes.out : null
  const status = git(["status", "--porcelain", "--untracked-files=no"], cwd)
  if (status.status !== 0) return { ok: false, error: "git status falhou" }
  const ref = git(["rev-parse", "--verify", "-q", "refs/remotes/origin/main"], cwd)
  let inOriginMain = null
  let atOriginMain = null
  if (ref.status === 0) {
    atOriginMain = ref.out === head.out
    const anc = git(["merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main"], cwd)
    if (anc.status === 0) inOriginMain = true
    else if (anc.status === 1) inOriginMain = false
    else return { ok: false, error: "merge-base falhou" }
  }
  return { ok: true, sha: head.out, branch, dirtyTracked: status.out.length > 0, inOriginMain, atOriginMain }
}

/**
 * CHECKOUT CANÔNICO: nenhum arquivo rastreado modificado E o HEAD exatamente na ref local
 * `origin/main`. Git indeterminado ou ref ausente ⇒ `false` (fail closed).
 * @param {import("./code-provenance").GitProbe | null | undefined} probe
 * @returns {boolean}
 */
export function isCanonicalCheckout(probe) {
  return probe?.ok === true && probe.dirtyTracked === false && probe.atOriginMain === true
}
