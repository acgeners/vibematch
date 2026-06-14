/**
 * Barramento global de "refresh do chrome": pede aos elementos persistentes do
 * layout (badges da sidebar, saldo Anthropic, chip de conta) que se atualizem
 * sem reload da página.
 *
 * Esses chips são client components que buscam os próprios dados num `useEffect`
 * keyado em `pathname`. `router.refresh()` (chamado pelas mutações) e
 * `revalidatePath()` (nos server actions) só re-renderizam os Server Components
 * da rota atual — NÃO re-rodam esses fetches client. Então o chrome congela no
 * que carregou na última navegação até você navegar de novo ou recarregar.
 *
 * Solução: toda mutação que chama `router.refresh()` dispara também este evento
 * (via `useRefresh()` em `@/lib/use-refresh`), e os três chips o escutam.
 *
 * Dois modos, no MESMO evento:
 *   - `refreshChrome()` sem patch → `detail: null` = "re-busque tudo" (saldo,
 *     badges, conta). Comportamento original; toda mutação que não sabe o novo
 *     estado usa este modo.
 *   - `refreshChrome(patch)` → `detail: ChromePatch` = "estes campos mudaram por
 *     estes deltas". Os chips aplicam o delta LOCALMENTE (sem round-trip ao DB
 *     em Ohio, ~300ms/ida) e reconciliam depois pela navegação/TTL. Um chip que
 *     não reconhece nenhum campo do patch simplesmente ignora (não busca) — o
 *     patch é um sinal direcionado, não um "invalide tudo".
 */
export const CHROME_REFRESH_EVENT = "app:chrome-refresh"

/** Variação de contagem dos badges da sidebar (sinal, ex.: `aiEval: -1`). */
export interface ChromeBadgeDelta {
  aiEval?: number
  settings?: number
}

/**
 * Atualização otimista do chrome. Todos os campos são opcionais e ADITIVOS
 * (somam ao estado atual); ausência = "não mexa neste campo". `recalcPending` é
 * um override booleano (não um delta). Um patch vazio `{}` é tratado como
 * re-fetch (degrada pro comportamento sem-patch).
 */
export interface ChromePatch {
  /** Delta no saldo Anthropic restante em USD (negativo = gastou). */
  balanceDeltaUsd?: number
  /** Deltas nas contagens de badge. */
  badgeDelta?: ChromeBadgeDelta
  /** Novo valor de "há recálculo pendente" (override, não delta). */
  recalcPending?: boolean
}

// Janela de debounce do dispatch: colapsa rajadas (cliques rápidos, loops que
// chamam refresh() N vezes num tick) num único evento, em vez de fazer cada chip
// disparar um fetch por chamada. 100ms é imperceptível depois de uma mutação.
const REFRESH_DEBOUNCE_MS = 100
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// Acumuladores da janela de debounce. Um re-fetch (chamada sem patch) SUPERA
// patches acumulados — ele lê a verdade do servidor, tornando os deltas moot.
let pendingRefetch = false
let pendingPatch: ChromePatch | null = null

function mergePatch(into: ChromePatch, add: ChromePatch): void {
  if (add.balanceDeltaUsd != null) {
    into.balanceDeltaUsd = (into.balanceDeltaUsd ?? 0) + add.balanceDeltaUsd
  }
  if (add.badgeDelta) {
    const acc = (into.badgeDelta ??= {})
    if (add.badgeDelta.aiEval != null) acc.aiEval = (acc.aiEval ?? 0) + add.badgeDelta.aiEval
    if (add.badgeDelta.settings != null) acc.settings = (acc.settings ?? 0) + add.badgeDelta.settings
  }
  if (add.recalcPending != null) into.recalcPending = add.recalcPending
}

function isEmptyPatch(patch: ChromePatch): boolean {
  return (
    patch.balanceDeltaUsd == null &&
    patch.recalcPending == null &&
    (patch.badgeDelta == null ||
      (patch.badgeDelta.aiEval == null && patch.badgeDelta.settings == null))
  )
}

/**
 * Atualiza o chrome (badges + saldo + conta), com debounce de borda de saída.
 * Sem `patch` (ou patch vazio) → re-busca tudo. Com `patch` → aplica delta
 * otimista. No-op fora do browser.
 */
export function refreshChrome(patch?: ChromePatch): void {
  if (typeof window === "undefined") return

  if (patch && !isEmptyPatch(patch)) {
    mergePatch((pendingPatch ??= {}), patch)
  } else {
    // Sem patch = re-fetch; supera quaisquer patches da janela.
    pendingRefetch = true
  }

  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    const detail = pendingRefetch ? null : pendingPatch
    pendingRefetch = false
    pendingPatch = null
    window.dispatchEvent(new CustomEvent<ChromePatch | null>(CHROME_REFRESH_EVENT, { detail }))
  }, REFRESH_DEBOUNCE_MS)
}
