"use client"

/**
 * "Quantas obras" de um lote (pedido de 16/11/2026). Vazio = todas. Os alvos chegam ordenados da
 * checagem mais antiga para a mais recente, então N = as N que mais precisam (`firstN`).
 */
export function BatchSizeInput({
  value,
  onChange,
  total,
  disabled,
}: {
  value: number | null
  onChange: (n: number | null) => void
  total: number
  disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      Quantas
      <input
        type="number"
        min={1}
        max={total}
        inputMode="numeric"
        value={value ?? ""}
        placeholder={`todas (${total})`}
        disabled={disabled}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange(Number.isFinite(n) && n > 0 ? Math.min(n, total) : null)
        }}
        aria-label="Quantas obras rodar (vazio = todas)"
        className="h-8 w-24 rounded-md border border-border/70 bg-background/60 px-2 text-sm tabular-nums text-foreground outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
      />
    </label>
  )
}
