import { cn } from "@/lib/utils"

/** Encurta "claude-sonnet-4-6" → "sonnet-4-6" e tira sufixo de data. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "")
}

export function ModelPill({ model }: { model: string }) {
  return (
    <span
      className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-muted-foreground"
      title={model}
    >
      {shortModel(model)}
    </span>
  )
}

const ADMIN_WORKLOADS = new Set(["admin", "experiment"])

export function WorkloadPill({ workload }: { workload: string }) {
  const isAdmin = ADMIN_WORKLOADS.has(workload)
  const isUnknown = workload === "unknown"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold",
        isUnknown
          ? "bg-muted/50 text-muted-foreground"
          : isAdmin
            ? "bg-violet-500/12 text-violet-600 dark:text-violet-300"
            : "bg-primary/10 text-primary",
      )}
    >
      {workload}
    </span>
  )
}

export function StatusPill({ status }: { status: "success" | "error" }) {
  return status === "success" ? (
    <span className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
      ok
    </span>
  ) : (
    <span className="inline-flex items-center rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
      erro
    </span>
  )
}

export function CachePill() {
  return (
    <span className="inline-flex items-center rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
      cache
    </span>
  )
}
