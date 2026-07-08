"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { ImageOff, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  revalidateWorkSources,
  saveWorkSourceSelections,
  type SourceCandidateOption,
  type SourceSelectionInput,
} from "@/server/actions/external"
import { setComixHidManually, isComixAutoResolveAvailable } from "@/server/actions/comix-resolver"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getCoverImageSrc } from "@/lib/image-proxy"
import type { ExternalSourceId } from "@/lib/external/types"

const SOURCE_LABEL: Record<string, string> = {
  anilist: "AniList",
  mangaupdates: "MangaUpdates",
  myanimelist: "MyAnimeList",
  kitsu: "Kitsu",
  mangadex: "MangaDex",
  comick: "ComicK",
  animeplanet: "AnimePlanet",
  comix: "Comix",
  mangago: "Mangago",
}

// "rejected" = "nenhum match válido pra essa fonte".
type SelectionValue = string | "rejected" | "none"

interface SourceSelectionStepProps {
  workId: string
  /** Chamado após as seleções serem salvas com sucesso (o caller decide o próximo passo). */
  onConfirm: () => void
  onCancel: () => void
  /** Rótulo do botão de confirmar (ex.: "Continuar" no fluxo unificado, "Salvar seleção" avulso). */
  confirmLabel?: string
}

/**
 * Passo de confirmação/correção das fontes externas de uma obra. Reutilizado pelo
 * "Atualizar dados" unificado (1º passo) e pelo dialog avulso de revalidação. Carrega
 * candidatos por fonte via `revalidateWorkSources` (que já resolve Comix/Mangago por
 * cross-ID), deixa o usuário confirmar/trocar/rejeitar cada match e persiste em
 * `work_external_ids`. Com o auto-resolve da Comix ligado, esconde o campo de hid manual.
 */
export function SourceSelectionStep({ workId, onConfirm, onCancel, confirmLabel = "Continuar" }: SourceSelectionStepProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [candidatesPerSource, setCandidatesPerSource] = useState<
    Partial<Record<ExternalSourceId, SourceCandidateOption[]>>
  >({})
  const [selection, setSelection] = useState<Partial<Record<ExternalSourceId, SelectionValue>>>({})
  const [brokenCovers, setBrokenCovers] = useState<Set<string>>(new Set())
  const [manualHid, setManualHid] = useState("")
  const [savingManual, setSavingManual] = useState(false)
  // Auto-resolve da Comix disponível (sidecar)? Com ele ligado, a Comix já vem
  // resolvida por cross-ID → escondemos o campo de hid manual.
  const [comixAutoResolve, setComixAutoResolve] = useState(false)

  useEffect(() => {
    isComixAutoResolveAvailable()
      .then(setComixAutoResolve)
      .catch(() => setComixAutoResolve(false))
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      try {
        const result = await revalidateWorkSources(workId)
        if (!active) return
        if (result.error || !result.data) {
          toast.error(result.error ?? "Falha ao buscar candidatos")
          onCancel()
          return
        }
        setQuery(result.data.query)
        setCandidatesPerSource(result.data.candidatesPerSource)
        const initialSelection: Partial<Record<ExternalSourceId, SelectionValue>> = {}
        const allSourceIds = new Set<ExternalSourceId>([
          ...(Object.keys(result.data.candidatesPerSource) as ExternalSourceId[]),
          ...result.data.currentSelections.map((s) => s.source),
        ])
        for (const source of allSourceIds) {
          const current = result.data.currentSelections.find((s) => s.source === source)
          if (current?.isRejected) initialSelection[source] = "rejected"
          else if (current?.externalId) initialSelection[source] = current.externalId
          else initialSelection[source] = "none"
        }
        setSelection(initialSelection)
      } catch (err) {
        if (!active) return
        toast.error(err instanceof Error ? err.message : "Erro inesperado")
        onCancel()
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId])

  const setSourceSelection = (source: ExternalSourceId, value: SelectionValue) => {
    setSelection((prev) => ({ ...prev, [source]: value }))
  }

  const handleConfirm = async () => {
    setSaving(true)
    try {
      const payload: SourceSelectionInput[] = Object.entries(selection).flatMap(
        ([source, value]): SourceSelectionInput[] => {
          if (value === "none") return []
          if (value === "rejected") return [{ source: source as ExternalSourceId, externalId: null, isRejected: true }]
          return [{ source: source as ExternalSourceId, externalId: value as string, isRejected: false }]
        }
      )
      const result = await saveWorkSourceSelections(workId, payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      onConfirm()
    } finally {
      setSaving(false)
    }
  }

  // Preenchimento manual da Comix (fallback quando o auto-resolve está desligado):
  // valida via SSR token-free e injeta como candidato selecionado.
  const handleManualComix = async () => {
    const hidOrUrl = manualHid.trim()
    if (!hidOrUrl) return
    setSavingManual(true)
    try {
      const res = await setComixHidManually({ workId, hidOrUrl })
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao validar o hid da Comix.")
        return
      }
      toast.success(`Comix vinculada: "${res.title}"`)
      if (res.hid) {
        const hid = res.hid
        setCandidatesPerSource((prev) => {
          const others = (prev.comix ?? []).filter((c) => c.externalId !== hid)
          const candidate: SourceCandidateOption = {
            externalId: hid,
            title: res.title ?? hid,
            coverUrl: res.coverUrl ?? null,
            matchScore: 1,
            synopsis: res.synopsis ?? null,
            year: res.year ?? null,
            chapters: res.chapters ?? null,
          }
          return { ...prev, comix: [candidate, ...others] }
        })
        setSourceSelection("comix" as ExternalSourceId, hid)
      }
      setManualHid("")
    } finally {
      setSavingManual(false)
    }
  }

  const allSourceIds = Array.from(
    new Set([
      ...(Object.keys(candidatesPerSource) as ExternalSourceId[]),
      ...(Object.keys(selection) as ExternalSourceId[]),
      "comix" as ExternalSourceId,
    ])
  ).sort()

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p>Resolvendo fontes (AniList/MU/Comix/Mangago…)…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Confirme ou troque os matches por fonte. Fontes marcadas como &quot;nenhum&quot; ou
        &quot;rejeitada&quot; não entram na atualização.
        {query && (
          <span className="block mt-1 text-xs">
            Busca usada: <span className="font-mono">{query}</span>
          </span>
        )}
      </p>

      {allSourceIds.map((source) => {
        const candidates = candidatesPerSource[source] ?? []
        const value = selection[source] ?? "none"
        return (
          <div key={source} className="rounded-md border p-3 space-y-2">
            <p className="text-sm font-medium">{SOURCE_LABEL[source] ?? source}</p>
            {candidates.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">Nenhum match encontrado nessa fonte.</p>
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
                          src={getCoverImageSrc(c.coverUrl)}
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
                      <p className="text-[11px] text-muted-foreground mt-0.5">
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
              <span className="text-xs">Nenhum match válido — ignorar esta fonte</span>
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
              <span className="text-xs">Não decidir agora</span>
            </label>

            {source === "comix" && !comixAutoResolve && (
              <div className="mt-1 space-y-1.5 rounded-md border border-dashed border-border p-2">
                <p className="text-[11px] text-muted-foreground">
                  Não achou? Cole o hid (ex.: <span className="font-mono">003kd</span>) ou a URL da comix.to.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    value={manualHid}
                    onChange={(e) => setManualHid(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleManualComix()
                    }}
                    placeholder="hid ou URL da comix.to"
                    disabled={savingManual}
                    className="h-8 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleManualComix()}
                    disabled={savingManual || !manualHid.trim()}
                  >
                    {savingManual ? <Loader2 className="size-3.5 animate-spin" /> : "Validar e adicionar"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={() => void handleConfirm()} disabled={loading || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmLabel}
        </Button>
      </div>
    </div>
  )
}
