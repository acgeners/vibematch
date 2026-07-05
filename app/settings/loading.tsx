// Esqueleto do CONTEÚDO (a sub-nav de tópicos vem do layout). Espelha o
// cabeçalho do grupo + a pilha de cards enquanto a rota carrega.
export default function SettingsLoading() {
  return (
    <div className="w-full max-w-5xl">
      <div className="mb-6 flex items-center gap-3.5">
        <div className="size-12 shrink-0 animate-pulse rounded-xl bg-muted" />
        <div className="space-y-2">
          <div className="h-6 w-52 animate-pulse rounded bg-muted" />
          <div className="h-3 w-36 animate-pulse rounded bg-muted/60" />
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/55 p-5 pl-6"
          >
            <div className="absolute inset-y-0 left-0 w-1 bg-muted" />
            <div className="flex items-start gap-3.5">
              <div className="size-11 shrink-0 animate-pulse rounded-xl bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-full animate-pulse rounded bg-muted/60" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-muted/60" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
