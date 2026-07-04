"use client"

import { createContext, useCallback, useContext, useRef, useState } from "react"
import { Coins } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CostSummary } from "./cost-summary"
import type { CostStep } from "./cost-summary"
import {
  previewCost,
  formatUsd,
  formatUsdExact,
  shortModelName,
  DEFAULT_SUPPRESS_THRESHOLD_USD,
} from "@/lib/cost-preview/catalog"
import type { CostActionId, CostPreview } from "@/lib/cost-preview/catalog"

/**
 * Confirmação bloqueante de custo, imperativa e global.
 *
 * Uso: `const confirmCost = useCostConfirm()`, então
 * `if (!(await confirmCost({ action: "deep_dive" }))) return` antes de disparar
 * a ação paga. Resolve `true` = seguir, `false` = cancelou. O popup é sempre um
 * modal central (nunca canto inferior); nunca renderiza no lugar de um toast.
 *
 * Opt-out: o usuário pode marcar "não avisar abaixo de $X"; a partir daí ações
 * cujo TETO ≤ X seguem direto sem popup (persistido em localStorage).
 */

const STORAGE_KEY = "satoria.cost-confirm.suppress-below-usd"

function readSuppressThreshold(): number | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function writeSuppressThreshold(v: number | null): void {
  if (typeof window === "undefined") return
  try {
    if (v == null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, String(v))
  } catch {
    // localStorage indisponível (modo privado etc.) — opt-out apenas não persiste.
  }
}

export interface CostConfirmRequest {
  /** Ação do catálogo (custo/tempo derivados). Omita se passar `estimate`. */
  action?: CostActionId
  /** Itens processados (lote). Default 1. */
  scale?: number
  /**
   * Estimativa explícita (ex.: números reais de um dry-run), no lugar do catálogo.
   */
  estimate?: {
    likelyUsd: number
    upperBoundUsd: number
    etaSeconds: number
    model?: string
    background?: boolean
    scale?: number
    note?: string
  }
  /** Override do título do popup. */
  title?: string
  /** Override da descrição. */
  description?: string
  /** Override do rótulo do botão de confirmar (o custo é anexado automaticamente). */
  confirmLabel?: string
  /** Passos de cascata a itemizar. */
  steps?: CostStep[]
}

type ConfirmFn = (req: CostConfirmRequest) => Promise<boolean>

const CostConfirmContext = createContext<ConfirmFn | null>(null)

export function useCostConfirm(): ConfirmFn {
  const ctx = useContext(CostConfirmContext)
  if (!ctx) {
    throw new Error("useCostConfirm precisa estar dentro de <CostConfirmProvider>")
  }
  return ctx
}

function buildPreview(req: CostConfirmRequest): CostPreview {
  if (req.estimate) {
    return {
      label: req.title ?? "Ação de IA",
      model: req.estimate.model ?? "",
      likelyUsd: req.estimate.likelyUsd,
      upperBoundUsd: req.estimate.upperBoundUsd,
      etaSeconds: req.estimate.etaSeconds,
      background: req.estimate.background ?? true,
      note: req.estimate.note,
      scale: req.estimate.scale ?? 1,
    }
  }
  if (req.action) return previewCost(req.action, req.scale)
  // Fallback defensivo: sem action nem estimate, trata como custo desconhecido.
  return {
    label: "Ação de IA",
    model: "",
    likelyUsd: 0,
    upperBoundUsd: Number.POSITIVE_INFINITY,
    etaSeconds: 0,
    background: true,
    scale: 1,
  }
}

function defaultTitle(preview: CostPreview, req: CostConfirmRequest): string {
  if (req.title) return req.title
  if (preview.scale > 1) return `${preview.label} — ${preview.scale} itens?`
  return `${preview.label}?`
}

function defaultDescription(preview: CostPreview, req: CostConfirmRequest): string {
  if (req.description) return req.description
  const model = preview.model ? shortModelName(preview.model) : null
  const modelPart = model ? ` (Claude ${model})` : ""
  return preview.scale > 1
    ? `Uma chamada${modelPart} por item, processadas em fila. Consome seu saldo Anthropic.`
    : `Chama a Claude API${modelPart}. Consome seu saldo Anthropic.`
}

interface PendingState {
  req: CostConfirmRequest
  preview: CostPreview
}

export function CostConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null)
  const [suppressChecked, setSuppressChecked] = useState(false)
  const resolverRef = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((req) => {
    const preview = buildPreview(req)
    const threshold = readSuppressThreshold()
    // Opt-out: teto ≤ limiar silenciado → segue direto, sem popup.
    if (threshold != null && preview.upperBoundUsd <= threshold) {
      return Promise.resolve(true)
    }
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setSuppressChecked(false)
      setPending({ req, preview })
    })
  }, [])

  const settle = useCallback(
    (ok: boolean) => {
      if (ok && suppressChecked) writeSuppressThreshold(DEFAULT_SUPPRESS_THRESHOLD_USD)
      resolverRef.current?.(ok)
      resolverRef.current = null
      setPending(null)
    },
    [suppressChecked],
  )

  const preview = pending?.preview ?? null
  const req = pending?.req ?? null
  const canSuppress =
    preview != null && preview.upperBoundUsd <= DEFAULT_SUPPRESS_THRESHOLD_USD

  return (
    <CostConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open) settle(false)
        }}
      >
        {pending && preview && req && (
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Coins />
              </AlertDialogMedia>
              <AlertDialogTitle>{defaultTitle(preview, req)}</AlertDialogTitle>
              <AlertDialogDescription>
                {defaultDescription(preview, req)}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <CostSummary preview={preview} steps={req.steps} />

            {canSuppress && (
              <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={suppressChecked}
                  onChange={(e) => setSuppressChecked(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Não avisar de novo para ações abaixo de{" "}
                <span className="font-medium text-foreground">
                  {formatUsdExact(DEFAULT_SUPPRESS_THRESHOLD_USD)}
                </span>
              </label>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => settle(false)}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => settle(true)}>
                {req.confirmLabel ?? "Confirmar"} · {formatUsd(preview.likelyUsd)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </CostConfirmContext.Provider>
  )
}
