"use client"

import { useState } from "react"
import Image from "next/image"
import { ImageOff, Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import {
  revalidateWorkSources,
  saveWorkSourceSelections,
  type SourceCandidateOption,
  type SourceSelectionInput,
} from "@/server/actions/external"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { ExternalSourceId } from "@/lib/external/types"

interface RevalidateSourcesDialogProps {
  workId: string
}

const SOURCE_LABEL: Record<string, string> = {
  anilist: "AniList",
  mangaupdates: "MangaUpdates",
  myanimelist: "MyAnimeList",
  kitsu: "Kitsu",
  mangadex: "MangaDex",
  comick: "ComicK",
  animeplanet: "AnimePlanet",
  comix: "Comix",
}

// "rejected" representa o estado "nenhum match válido pra essa fonte".
type SelectionValue = string | "rejected" | "none"

export function RevalidateSourcesDialog({ workId }: RevalidateSourcesDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState<string>("")
  const [candidatesPerSource, setCandidatesPerSource] = useState<
    Partial<Record<ExternalSourceId, SourceCandidateOption[]>>
  >({})
  const [selection, setSelection] = useState<Partial<Record<ExternalSourceId, SelectionValue>>>({})
  const [brokenCovers, setBrokenCovers] = useState<Set<string>>(new Set())

  const handleOpen = async () => {
    setOpen(true)
    setLoading(true)
    try {
      const result = await revalidateWorkSources(workId)
      if (result.error || !result.data) {
        toast.error(result.error ?? "Falha ao buscar candidatos")
        setOpen(false)
        return
      }
      setQuery(result.data.query)
      setCandidatesPerSource(result.data.candidatesPerSource)

      // Constrói estado inicial: prioriza candidato escolhido atual, depois marca top match.
      const initialSelection: Partial<Record<ExternalSourceId, SelectionValue>> = {}
      const allSources = new Set<ExternalSourceId>([
        ...(Object.keys(result.data.candidatesPerSource) as ExternalSourceId[]),
        ...result.data.currentSelections.map((s) => s.source),
      ])
      for (const source of allSources) {
        const current = result.data.currentSelections.find((s) => s.source === source)
        if (current?.isRejected) {
          initialSelection[source] = "rejected"
        } else if (current?.externalId) {
          initialSelection[source] = current.externalId
        } else {
          // Sem seleção atual: deixar "none" pro user escolher
          initialSelection[source] = "none"
        }
      }
      setSelection(initialSelection)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado")
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: SourceSelectionInput[] = Object.entries(selection).flatMap(
        ([source, value]): SourceSelectionInput[] => {
          if (value === "none") return [] // sem linha (volta a "não avaliada")
          if (value === "rejected") {
            return [{ source: source as ExternalSourceId, externalId: null, isRejected: true }]
          }
          return [{ source: source as ExternalSourceId, externalId: value as string, isRejected: false }]
        }
      )
      const result = await saveWorkSourceSelections(workId, payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Seleção de fontes salva. Atualize os dados pra rehidratar com as novas fontes.")
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const setSourceSelection = (source: ExternalSourceId, value: SelectionValue) => {
    setSelection((prev) => ({ ...prev, [source]: value }))
  }

  const allSources = Array.from(
    new Set([
      ...(Object.keys(candidatesPerSource) as ExternalSourceId[]),
      ...(Object.keys(selection) as ExternalSourceId[]),
    ])
  ).sort()

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? handleOpen() : setOpen(false))}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShieldCheck className="h-4 w-4" />
          Revalidar fontes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revalidar fontes externas</DialogTitle>
          <DialogDescription>
            Confirme ou troque os matches por fonte. Reviews/dados de fontes marcadas como
            &quot;nenhum&quot; ou &quot;rejeitada&quot; não entram na próxima avaliação.
            {query && (
              <span className="block mt-1 text-xs">
                Busca usada: <span className="font-mono">{query}</span>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {allSources.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum candidato encontrado em nenhuma fonte.
              </p>
            )}
            {allSources.map((source) => {
              const candidates = candidatesPerSource[source] ?? []
              const value = selection[source] ?? "none"
              return (
                <div key={source} className="rounded-md border p-3 space-y-2">
                  <p className="text-sm font-medium">{SOURCE_LABEL[source] ?? source}</p>
                  {candidates.length === 0 ? (
                    <p className="text-xs italic text-muted-foreground">
                      Nenhum match encontrado nessa fonte.
                    </p>
                  ) : (
                    candidates.map((c) => {
                      const checked = value === c.externalId
                      return (
                        <label
                          key={c.externalId}
                          className={`flex items-start gap-3 rounded-md border p-2 cursor-pointer transition-colors ${
                            checked ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`source-${source}`}
                            checked={checked}
                            onChange={() => setSourceSelection(source, c.externalId)}
                            className="mt-1.5"
                          />
                          <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded border bg-muted">
                            {c.coverUrl && !brokenCovers.has(c.coverUrl) ? (
                              <Image
                                src={c.coverUrl}
                                alt=""
                                fill
                                sizes="48px"
                                unoptimized
                                className="object-cover"
                                onError={() =>
                                  setBrokenCovers((prev) => {
                                    const next = new Set(prev)
                                    next.add(c.coverUrl!)
                                    return next
                                  })
                                }
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                <ImageOff className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium line-clamp-2">{c.title}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              match {Math.round(c.matchScore * 100)}%
                              {c.year ? ` · ${c.year}` : ""}
                              {c.chapters ? ` · ${c.chapters} cap.` : ""}
                            </p>
                          </div>
                        </label>
                      )
                    })
                  )}
                  <label
                    className={`flex items-center gap-3 rounded-md border p-2 cursor-pointer transition-colors ${
                      value === "rejected"
                        ? "border-rose-500/60 bg-rose-500/15 text-rose-700 dark:text-rose-200"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`source-${source}`}
                      checked={value === "rejected"}
                      onChange={() => setSourceSelection(source, "rejected")}
                    />
                    <span className="text-xs">
                      Nenhum match válido — ignorar esta fonte
                    </span>
                  </label>
                  <label
                    className={`flex items-center gap-3 rounded-md border p-2 cursor-pointer transition-colors ${
                      value === "none"
                        ? "border-amber-500/60 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`source-${source}`}
                      checked={value === "none"}
                      onChange={() => setSourceSelection(source, "none")}
                    />
                    <span className="text-xs">
                      Não decidir agora (refazer busca depois)
                    </span>
                  </label>
                </div>
              )
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? "Salvando..." : "Salvar seleção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
