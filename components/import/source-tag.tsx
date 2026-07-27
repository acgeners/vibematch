import { cn } from "@/lib/utils"

// Cor por fonte. Borda colorida usa `ring` (o reset `*{border-color}` do TW v4
// mata `border-<cor>` — ver CLAUDE.md).
const META: Record<
  string,
  { label: string; dot: string; text: string; ring: string; bg: string }
> = {
  anilist: {
    label: "AniList",
    dot: "bg-sky-500",
    text: "text-sky-700 dark:text-sky-300",
    ring: "ring-sky-500/30",
    bg: "bg-sky-500/10",
  },
  myanimelist: {
    label: "MyAnimeList",
    dot: "bg-indigo-500",
    text: "text-indigo-700 dark:text-indigo-300",
    ring: "ring-indigo-500/30",
    bg: "bg-indigo-500/10",
  },
  mangaupdates: {
    label: "MangaUpdates",
    dot: "bg-orange-500",
    text: "text-orange-700 dark:text-orange-300",
    ring: "ring-orange-500/30",
    bg: "bg-orange-500/10",
  },
  animeplanet: {
    label: "Anime-Planet",
    dot: "bg-teal-500",
    text: "text-teal-700 dark:text-teal-300",
    ring: "ring-teal-500/30",
    bg: "bg-teal-500/10",
  },
  titles: {
    label: "Lista de títulos",
    dot: "bg-slate-500",
    text: "text-slate-700 dark:text-slate-300",
    ring: "ring-slate-500/30",
    bg: "bg-slate-500/10",
  },
}

export function SourceTag({
  source,
  fallback = "Planilha",
  className,
}: {
  source: string | null
  fallback?: string
  className?: string
}) {
  const meta = source ? META[source] : undefined
  if (!meta) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border",
          className
        )}
      >
        {source ?? fallback}
      </span>
    )
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        meta.text,
        meta.ring,
        meta.bg,
        className
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  )
}
