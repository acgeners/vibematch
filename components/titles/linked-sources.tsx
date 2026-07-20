import { Check, Info } from "lucide-react"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { PLATFORMS } from "@/types/domain"
import { cn } from "@/lib/utils"

// Fontes que uma obra pode ter vinculadas (work_external_ids). "outros" é um
// catch-all, não uma fonte real de vínculo — fica de fora do universo.
const LINKABLE_SOURCES = PLATFORMS.filter((s) => s !== "outros")

/**
 * Bloco discreto da barra lateral: quais fontes externas estão vinculadas à obra
 * (verde + ✓) e quais faltam (contorno tracejado, apagadas). Vinculadas primeiro,
 * cada bloco na ordem canônica das fontes. Um vínculo faltante NÃO significa erro
 * — a obra pode simplesmente não existir naquela fonte; por isso a dica é suave.
 *
 * `externalIds` = mapa `{ source: external_id }` dos vínculos ACEITOS
 * (getWorkExternalIds). A presença da chave é o que conta como "vinculada".
 */
export function LinkedSources({ externalIds }: { externalIds: Record<string, string> }) {
  const linked = LINKABLE_SOURCES.filter((s) => externalIds[s])
  const missing = LINKABLE_SOURCES.filter((s) => !externalIds[s])
  const ordered = [...linked, ...missing]

  return (
    <div className="rounded-md border border-border/50 bg-card/25 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/80">
          Fontes
        </span>
        <span className="text-[9px] font-semibold tabular-nums text-muted-foreground/80">
          {linked.length} de {LINKABLE_SOURCES.length}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {ordered.map((source) => {
          const on = Boolean(externalIds[source])
          const label = PLATFORM_LABELS[source] ?? source
          return (
            <span
              key={source}
              title={
                on
                  ? `${label} — fonte vinculada`
                  : `${label} — não vinculada. "Atualizar dados" pode vinculá-la (a obra pode não existir nessa fonte).`
              }
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap",
                on
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-dashed border-border text-muted-foreground/60",
              )}
            >
              {on && <Check className="size-2.5 shrink-0" />}
              {label}
            </span>
          )
        })}
      </div>

      {missing.length > 0 && (
        <p
          className="mt-1.5 flex items-center gap-1 text-[9px] leading-snug text-muted-foreground/60"
          title="“Atualizar dados” tenta vincular as fontes tracejadas (a obra pode não existir nessas fontes)."
        >
          <Info className="size-2.5 shrink-0 text-amber-500/80" />
          Tracejadas: sem vínculo
        </p>
      )}
    </div>
  )
}
