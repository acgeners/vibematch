"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useRefresh } from "@/lib/use-refresh"
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ChipInput } from "@/components/ui/chip-input"
import { GENRE_NAMES, TAG_GROUPS_CATALOG } from "@/lib/constants/tags"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { ExternalSearch } from "@/components/titles/external-search"
import { SynopsisPicker, normalizeSynopsisChoices } from "@/components/titles/synopsis-picker"
import type { SynopsisChoice } from "@/components/titles/synopsis-picker"
import { SourceSelectionStep } from "@/components/titles/source-selection-step"
import { WORK_UPDATED_EVENT } from "@/components/titles/update-progress-watcher"
import { fetchComicKClient, fetchAnimePlanetClient } from "@/lib/external/client-fetches"
import { updateWorkExternalData, refreshWorkExternalData } from "@/server/actions/works"
import { buildPlatformRatings } from "@/lib/external/auto-refresh"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { dedupeSynopsisEntries } from "@/lib/work-derived"
import { titleToSlug } from "@/lib/utils"
import type { ExternalSourceId, ExternalWorkData } from "@/lib/external/types"

/**
 * Barra de ações de cada passo. Fica GRUDADA no rodapé da área de rolagem: os
 * passos deste diálogo (sinopses, capas, tags, conflitos) crescem com o dado da
 * obra, e uma sinopse longa bastava pra empurrar o "Continuar" pra fora da tela.
 * O `bg-background` é obrigatório — sem ele o conteúdo rolaria POR TRÁS da barra
 * e apareceria através dela.
 */
const ACTION_BAR =
  "sticky bottom-0 z-10 flex justify-between gap-2 border-t bg-background pt-3 pb-2"

interface CurrentWork {
  title: string
  originalTitle?: string | null
  synopsis?: string | null
  coverUrl?: string | null
  publicationStatus?: string | null
  totalChapters?: number | null
  observations?: string | null
}

interface UpdateDataDialogProps {
  workId: string
  currentWork: CurrentWork
  // Capas já salvas na obra (todas, não só a primária). Mostradas no passo de
  // capas e mantidas por padrão. Quando ausente, cai pra currentWork.coverUrl.
  currentCovers?: SavedCover[]
  // Sinopses já salvas na obra. Entram no pool do passo de sinopses junto com as
  // das fontes — sem isto o save (delete + re-insert) apaga as suas.
  currentSynopses?: SavedSynopsis[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  // Chamado após salvar com sucesso. Quando fornecido, substitui a navegação
  // padrão (router.push/refresh) — o caller decide o que fazer (ex.: abrir a
  // obra em outra aba na revisão de importadas).
  onSaved?: (workId: string) => void
  // Quando true, o fluxo começa por um passo de CONFIRMAÇÃO DE FONTES (revalidação
  // com Comix/Mangago resolvidos por cross-ID) antes de rehidratar os dados — o
  // merge de "Revalidar fontes" + "Atualizar dados" numa ação só. Default false
  // (ex.: revisão de importadas segue direto pro refresh).
  withSourceStep?: boolean
}

interface FieldConflict {
  field: keyof CurrentWork
  label: string
  currentValue: string | null
  externalValue: string | null
}

function formatValue(value: string | number | null | undefined): string {
  if (value == null) return "—"
  return String(value)
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

function getConflicts(current: CurrentWork, external: ExternalWorkData): FieldConflict[] {
  const conflicts: FieldConflict[] = []

  const check = (
    field: keyof CurrentWork,
    label: string,
    currentVal: string | number | null | undefined,
    externalVal: string | number | null | undefined
  ) => {
    const cv = formatValue(currentVal)
    const ev = formatValue(externalVal)
    if (ev !== "—" && cv !== ev) {
      conflicts.push({ field, label, currentValue: cv === "—" ? null : cv, externalValue: ev })
    }
  }

  check("title", "Título", current.title, external.title)
  check("originalTitle", "Título original", current.originalTitle, external.originalTitle)
  check("synopsis", "Sinopse", current.synopsis, external.synopsis)
  check("coverUrl", "Capa (URL)", current.coverUrl, external.coverUrl)
  check("publicationStatus", "Status de publicação", current.publicationStatus, external.publicationStatus)
  check("totalChapters", "Capítulos totais", current.totalChapters, external.totalChapters)

  return conflicts
}

// SynopsisChoice + a invariante da principal moram no SynopsisPicker, que é
// compartilhado com o fluxo de criação (ExternalSearch).

/** Sinopse já salva na obra — entra no pool do passo junto com as das fontes. */
export interface SavedSynopsis {
  source: string
  text: string
  isPrimary: boolean
}

/**
 * Junta as sinopses JÁ SALVAS com as que a busca acabou de trazer, na mesma
 * lógica do `buildCoverPool`. Sem isto o passo listava só as novas e o save
 * (delete + re-insert) apagava as salvas — uma sinopse manual sua morria em
 * silêncio a cada "Atualizar dados".
 *
 * Dedup por TEXTO: a mesma sinopse volta da fonte a cada atualização, e sem isso
 * ela apareceria duas vezes (uma "já salva", uma "nova"). A salva vence — é ela
 * que carrega a sua curadoria (principal, texto editado).
 */
export function buildSynopsisPool(
  saved: SavedSynopsis[],
  external: Array<{ source: string; text: string }>
): SynopsisChoice[] {
  const pool: SynopsisChoice[] = []
  const seen = new Set<string>()
  const key = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ")

  for (const s of saved) {
    const text = (s.text ?? "").trim()
    if (!text || seen.has(key(text))) continue
    seen.add(key(text))
    pool.push({ source: s.source, text, included: true, isPrimary: s.isPrimary, saved: true })
  }
  // Obra sem nada salvo mantém o comportamento antigo: externas já vêm marcadas.
  const hasSaved = pool.length > 0
  for (const e of external) {
    const text = (e.text ?? "").trim()
    if (!text || seen.has(key(text))) continue
    seen.add(key(text))
    pool.push({ source: e.source, text, included: !hasSaved, isPrimary: false })
  }
  return normalizeSynopsisChoices(pool)
}

interface CoverChoice {
  // String (não ExternalSourceId): capas já salvas trazem o source do banco, que
  // pode não ser um ExternalSourceId conhecido. O servidor aceita source: string.
  source: string
  url: string
  included: boolean
  isPrimary: boolean
  // true = capa já salva na obra; false = capa nova vinda das fontes externas.
  saved: boolean
}

interface SavedCover {
  url: string
  source?: string | null
  isPrimary?: boolean
}

// Junta as capas já salvas com as capas externas num pool único de escolhas.
// Default = manter o estado atual: as salvas vêm incluídas (e o primário
// preservado); as externas vêm desmarcadas (o usuário escolhe quais adicionar).
// Quando a obra não tem capas salvas, as externas vêm incluídas (comportamento
// antigo: pegar as capas buscadas).
function buildCoverPool(
  externalCovers: Array<{ url: string; source: ExternalSourceId }>,
  saved: SavedCover[],
): CoverChoice[] {
  const hasSaved = saved.length > 0
  const byUrl = new Map<string, CoverChoice>()
  for (const c of saved) {
    if (!c.url) continue
    byUrl.set(c.url, {
      source: c.source ?? "atual",
      url: c.url,
      included: true,
      isPrimary: Boolean(c.isPrimary),
      saved: true,
    })
  }
  for (const c of externalCovers) {
    if (!c.url || byUrl.has(c.url)) continue
    byUrl.set(c.url, {
      source: c.source,
      url: c.url,
      included: !hasSaved,
      isPrimary: false,
      saved: false,
    })
  }
  const pool = [...byUrl.values()]
  // Garante exatamente um primário entre os incluídos.
  if (pool.some((c) => c.included) && !pool.some((c) => c.included && c.isPrimary)) {
    const firstIncluded = pool.find((c) => c.included)
    if (firstIncluded) firstIncluded.isPrimary = true
  }
  return pool
}

export function UpdateDataDialog({
  workId,
  currentWork,
  currentCovers,
  currentSynopses,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  onSaved,
  withSourceStep = false,
}: UpdateDataDialogProps) {
  const router = useRouter()
  const refresh = useRefresh()

  // Capas atuais da obra (passadas só pelo fluxo "Atualizar dados" da página da
  // obra). Quando ausente (ex.: revisão de importadas), savedCovers fica vazio e
  // o picker volta ao comportamento antigo: capas externas marcadas por padrão.
  const savedCovers: SavedCover[] = (currentCovers ?? []).filter((c) => c.url)
  // Idem capas: só o fluxo "Atualizar dados" da página da obra passa isto. Sem
  // ele o pool fica só com as externas (comportamento antigo).
  const savedSynopses: SavedSynopsis[] = (currentSynopses ?? []).filter((s) => s.text?.trim())
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = (v: boolean) => {
    if (!isControlled) setUncontrolledOpen(v)
    onOpenChange?.(v)
  }
  const [phase, setPhase] = useState<"sources" | "refreshing" | "search" | "synopses-pick" | "covers-pick" | "tags-pick" | "conflicts" | "saving">(
    withSourceStep ? "sources" : "refreshing"
  )
  const [pendingData, setPendingData] = useState<ExternalWorkData | null>(null)
  /** Nomes que a busca de fato usou nas fontes (título + variantes do retry). */
  const [searchQueries, setSearchQueries] = useState<string[]>([])
  const [conflicts, setConflicts] = useState<FieldConflict[]>([])
  const [resolutions, setResolutions] = useState<Record<string, "current" | "external">>({})
  const [synopsisChoices, setSynopsisChoices] = useState<SynopsisChoice[]>([])
  const [coverChoices, setCoverChoices] = useState<CoverChoice[]>([])
  const [coversNeedPick, setCoversNeedPick] = useState(false)
  // Passo de revisão de tags/gêneros (item 4A) — aditivo: revisa só o que veio das fontes.
  const [tagChoices, setTagChoices] = useState<string[]>([])
  const [genreChoices, setGenreChoices] = useState<string[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [activeRefineUrl, setActiveRefineUrl] = useState<string | null>(null)
  // Capa por link manual durante a seleção (mesmo recurso do CoversManager na edição).
  const [manualCoverUrl, setManualCoverUrl] = useState("")
  const [manualCoverError, setManualCoverError] = useState<string | null>(null)

  const addManualCover = () => {
    const trimmed = manualCoverUrl.trim()
    if (!trimmed) {
      setManualCoverError("URL obrigatória")
      return
    }
    if (!isHttpUrl(trimmed)) {
      setManualCoverError("URL precisa começar com http:// ou https://")
      return
    }
    if (coverChoices.some((c) => c.url === trimmed)) {
      setManualCoverError("Essa URL já está na lista")
      return
    }
    setManualCoverError(null)
    setCoverChoices((prev) => [
      ...prev,
      { source: "manual", url: trimmed, included: true, isPrimary: prev.length === 0, saved: false },
    ])
    setActiveRefineUrl(trimmed)
    setManualCoverUrl("")
  }

  const handleSelect = (data: ExternalWorkData) => {
    // Quando há múltiplas sinopses/capas vindas das fontes vinculadas, mostra
    // picker(s) antes do conflict resolver — passo separado pra cada tipo
    // (sinopses → capas) pra dar espaço pra galeria de capas em tamanho grande.
    const synopses = data.multiSynopses ?? []
    const externalCovers = data.multiCovers ?? []
    const pool = buildCoverPool(externalCovers, savedCovers)

    // Mostra o passo de capas quando há decisão real a tomar:
    //  - obra SEM capas salvas e várias externas → escolher entre elas (antigo);
    //  - obra COM capas salvas e ao menos uma capa externa NOVA → manter as
    //    atuais (default) e opcionalmente incluir as novas / remover atuais.
    // Quando o externo não traz nada novo, não há o que decidir → preserva.
    const savedUrls = new Set(savedCovers.map((c) => c.url))
    const newExternal = externalCovers.filter((c) => !savedUrls.has(c.url))
    const coversNeedPick =
      (savedCovers.length === 0 && externalCovers.length > 1) ||
      (savedCovers.length > 0 && newExternal.length > 0)

    setPendingData(data)
    setSynopsisChoices(buildSynopsisPool(savedSynopses, synopses))
    setCoverChoices(pool)
    setCoversNeedPick(coversNeedPick)
    setActiveRefineUrl(pool.find((c) => c.included)?.url ?? pool[0]?.url ?? null)
    setTagChoices(data.tags ?? [])
    setGenreChoices(data.genres ?? [])
    // Item 3: o passo de sinopse aparece SEMPRE (mesmo com 0-1 externa) pra você poder
    // digitar uma manual. Os passos de capa (se houver decisão) e de tags vêm depois.
    setPhase("synopses-pick")
  }

  const proceedToConflictsOrApply = (
    data: ExternalWorkData,
    preResolved: Record<string, "current" | "external"> = {}
  ) => {
    const detected = getConflicts(currentWork, data).filter((c) => !(c.field in preResolved))
    setPendingData(data)
    if (detected.length > 0) {
      const defaults: Record<string, "current" | "external"> = { ...preResolved }
      for (const c of detected) defaults[c.field] = "external"
      setResolutions(defaults)
      setConflicts(detected)
      setPhase("conflicts")
    } else {
      applyUpdate(data, preResolved)
    }
  }

  const finalizeChoicesAndProceed = () => {
    if (!pendingData) return
    const includedSynopses = synopsisChoices.filter((s) => s.included)
    const primarySynopsis = includedSynopses.find((s) => s.isPrimary) ?? includedSynopses[0]
    const orderedSynopses = primarySynopsis
      ? [primarySynopsis, ...includedSynopses.filter((s) => s !== primarySynopsis)]
      : includedSynopses
    const selectedSynopses = dedupeSynopsisEntries(orderedSynopses)

    // O usuário já escolheu sinopse/capa no multipick — não perguntar de novo
    // na tela de conflitos (que comparava só o campo single e dava a impressão
    // de que as outras escolhas estavam sendo descartadas).
    const preResolved: Record<string, "current" | "external"> = {}
    if (includedSynopses.length > 0) preResolved.synopsis = "external"

    const next: ExternalWorkData = {
      ...pendingData,
      synopsis: selectedSynopses.find((s) => s.isPrimary)?.text ?? selectedSynopses[0]?.text ?? pendingData.synopsis,
      multiSynopses: selectedSynopses.map((s) => ({ source: s.source as ExternalSourceId, text: s.text })),
      synopsisIsMerged: false,
    }

    // Capas: se a seleção final é idêntica às capas já salvas (mesmas URLs e
    // mesma primária), NÃO mexe nas capas — resolve como "current" pro server
    // preservar exatamente o que está salvo (sem delete/insert à toa). Caso
    // contrário, envia o conjunto escolhido (mantidas + novas, menos removidas).
    const includedCovers = coverChoices.filter((c) => c.included)
    const includedUrls = includedCovers.map((c) => c.url)
    const savedUrlSet = new Set(savedCovers.map((c) => c.url))
    const sameSet =
      includedUrls.length === savedUrlSet.size &&
      includedUrls.every((u) => savedUrlSet.has(u))
    const savedPrimary = savedCovers.find((c) => c.isPrimary)?.url ?? savedCovers[0]?.url
    const includedPrimary = (includedCovers.find((c) => c.isPrimary) ?? includedCovers[0])?.url
    const coversUnchanged = sameSet && includedPrimary === savedPrimary

    if (coversUnchanged) {
      preResolved.coverUrl = "current"
    } else {
      const primaryCover = includedCovers.find((c) => c.isPrimary) ?? includedCovers[0]
      next.coverUrl = primaryCover?.url ?? pendingData.coverUrl
      next.multiCovers = includedCovers.map((c) => ({ url: c.url, source: c.source as ExternalSourceId }))
      preResolved.coverUrl = "external"
    }

    // Tags/gêneros revisados no passo de tags (item 4A, aditivo). Vazios = nada é enviado
    // e o server preserva as tags existentes; não-vazios são ADICIONADOS (syncWorkTagsPartial).
    next.tags = tagChoices
    next.genres = genreChoices

    proceedToConflictsOrApply(next, preResolved)
  }

  const handleConfirmSynopses = () => {
    if (!pendingData) return
    // Vai pra galeria de capas só quando há decisão de capa a tomar; senão pula direto
    // pro passo de tags (as capas atuais são preservadas).
    if (coversNeedPick) {
      const initialUrl =
        coverChoices.find((c) => c.included && c.isPrimary)?.url ??
        coverChoices.find((c) => c.included)?.url ??
        coverChoices[0]?.url ??
        null
      setActiveRefineUrl(initialUrl)
      setPhase("covers-pick")
      return
    }
    setPhase("tags-pick")
  }

  const handleConfirmCovers = () => {
    if (!pendingData) return
    setPhase("tags-pick")
  }

  const handleConfirmTags = () => {
    if (!pendingData) return
    finalizeChoicesAndProceed()
  }

  const toggleCoverIncluded = (url: string) => {
    setCoverChoices((prev) => {
      const next = prev.map((c) => (c.url === url ? { ...c, included: !c.included } : c))
      const target = prev.find((c) => c.url === url)
      const targetNext = next.find((c) => c.url === url)
      if (target?.isPrimary && targetNext && !targetNext.included) {
        const fallback = next.find((c) => c.included)
        return next.map((c) => ({ ...c, isPrimary: fallback ? c.url === fallback.url : false }))
      }
      return next
    })
  }
  const setCoverPrimary = (url: string) => {
    setCoverChoices((prev) =>
      prev.map((c) => ({ ...c, isPrimary: c.url === url, included: c.url === url ? true : c.included }))
    )
  }
  const deleteCover = (url: string) => {
    setCoverChoices((prev) => {
      const removed = prev.find((c) => c.url === url)
      const remaining = prev.filter((c) => c.url !== url)
      if (removed?.isPrimary && remaining.length > 0) {
        const fallbackIdx = remaining.findIndex((c) => c.included)
        const promoteIdx = fallbackIdx >= 0 ? fallbackIdx : 0
        return remaining.map((c, i) => ({ ...c, isPrimary: i === promoteIdx }))
      }
      return remaining
    })
    if (activeRefineUrl === url) {
      const remaining = coverChoices.filter((c) => c.url !== url)
      setActiveRefineUrl(remaining[0]?.url ?? null)
    }
  }

  const allCoversIncluded = coverChoices.length > 0 && coverChoices.every((c) => c.included)
  const someCoversIncluded = coverChoices.some((c) => c.included)

  const toggleAllCovers = () => {
    setCoverChoices((prev) => {
      if (prev.every((c) => c.included)) {
        return prev.map((c) => ({ ...c, included: false, isPrimary: false }))
      }
      const hasPrimary = prev.some((c) => c.isPrimary)
      return prev.map((c, i) => ({
        ...c,
        included: true,
        isPrimary: hasPrimary ? c.isPrimary : i === 0,
      }))
    })
  }

  // `shouldApply` evita aplicar o resultado de um refresh obsoleto. Sem isso, o
  // double-invoke do StrictMode (dev) dispara dois fetches; o mais lento resolve
  // depois e chamava handleSelect de novo, jogando o usuário de "capas" de volta
  // pra "sinopses". Só a última invocação aplica.
  const runRefresh = async (shouldApply: () => boolean = () => true) => {
    setPhase("refreshing")
    try {
      const result = await refreshWorkExternalData(workId)
      if (!shouldApply()) return
      if (result.ok) {
        // ComicK e AnimePlanet têm rating buscado NO CLIENTE (o server-side é
        // bloqueado por Cloudflare, sobretudo o AnimePlanet). O refresh server-side
        // não os pega → busca aqui e mescla, pra ficar igual ao fluxo de criação.
        const enriched = await enrichWithClientRatings(result.data)
        if (!shouldApply()) return
        handleSelect(enriched)
        return
      }
      if (result.reason === "FORBIDDEN") {
        // Não cai no fallback de busca por título: o bloqueio é de permissão, e
        // buscar de novo só levaria ao mesmo "não pode gravar" lá na frente.
        toast.error(result.message ?? "Sem permissão para atualizar esta obra.")
        setPhase("sources")
        return
      }
      if (result.reason === "ALL_404") {
        toast.warning("Fontes externas indisponíveis para esta obra. Buscando por título...")
      }
      setPhase("search")
    } catch (err) {
      if (!shouldApply()) return
      const message = err instanceof Error ? err.message : String(err)
      console.error("[UpdateDataDialog] refresh failed:", message)
      toast.error(`Erro ao atualizar: ${message}`)
      setPhase("search")
    }
  }

  const handleOpen = async () => {
    setOpen(true)
    // Com o passo de fontes, o SourceSelectionStep carrega sozinho ao montar; o
    // refresh dos dados só roda depois da confirmação das fontes.
    if (withSourceStep) {
      setPhase("sources")
      return
    }
    await runRefresh()
  }

  // Quando controlado externamente, dispara o passo inicial ao abrir. Com o passo
  // de fontes, só entra em "sources"; senão faz o refresh (cujo cleanup cancela a
  // aplicação de um resultado obsoleto se o efeito re-rodar — StrictMode / deps).
  useEffect(() => {
    if (!(isControlled && open)) return
    if (withSourceStep) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("sources")
      return
    }
    let active = true
    void runRefresh(() => active)
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControlled, open])

  const applyUpdate = async (
    data: ExternalWorkData,
    fieldResolutions: Record<string, "current" | "external">
  ) => {
    setPhase("saving")
    // Returns the external value only if it's non-empty and user didn't explicitly keep current.
    // Returning undefined signals the server action to skip the field entirely (preserving DB value).
    const pick = (field: keyof CurrentWork, externalVal: string | null | undefined): string | undefined => {
      if (fieldResolutions[field] === "current") return undefined
      if (externalVal != null && externalVal !== "") return externalVal
      return undefined
    }

    const updates: Record<string, unknown> = {
      // title is always required — use external if available, otherwise keep current
      title: pick("title", data.title) ?? currentWork.title,
      platformRatings: buildPlatformRatings(data),
    }

    const originalTitle = pick("originalTitle", data.originalTitle)
    if (originalTitle !== undefined) updates.originalTitle = originalTitle

    const synopsis = pick("synopsis", data.synopsis)
    if (synopsis !== undefined) updates.synopsis = synopsis

    const coverUrl = pick("coverUrl", data.coverUrl)
    if (coverUrl !== undefined) updates.coverUrl = coverUrl

    // Multipick: quando o usuário escolheu várias capas/sinopses, envia a lista
    // completa pro server pra todas serem persistidas (não só a primária).
    if (data.multiCovers && data.multiCovers.length > 0 && fieldResolutions["coverUrl"] !== "current") {
      const primaryUrl = coverUrl ?? data.coverUrl ?? data.multiCovers[0]?.url
      updates.covers = data.multiCovers.map((c) => ({
        url: c.url,
        source: c.source,
        isPrimary: c.url === primaryUrl,
      }))
    }
    if (data.multiSynopses && data.multiSynopses.length > 0 && fieldResolutions["synopsis"] !== "current") {
      const selectedSynopses = dedupeSynopsisEntries(data.multiSynopses.map((s, index) => ({
        text: s.text,
        source: s.source,
        isPrimary: s.text === data.synopsis || (data.synopsis == null && index === 0),
      })))
      updates.synopses = selectedSynopses.map((s) => ({
        text: s.text,
        source: s.source,
        isPrimary: s.isPrimary,
      }))
    }

    const publicationStatus = pick("publicationStatus", data.publicationStatus)
    if (publicationStatus !== undefined) updates.publicationStatus = publicationStatus

    if (fieldResolutions["totalChapters"] !== "current" && data.totalChapters != null) {
      updates.totalChapters = data.totalChapters
    }

    // genres/tags: undefined = preserve existing; array = replace that category
    if ((data.genres?.length ?? 0) > 0) updates.genres = data.genres
    if ((data.tags?.length ?? 0) > 0) updates.tags = data.tags

    // Persiste IDs externos da fonte vinculada para que o próximo "Atualizar dados"
    // pegue o fast-path (sem busca por título nem AI).
    if (data.externalIds && Object.keys(data.externalIds).length > 0) {
      const cleaned: Record<string, string> = {}
      for (const [source, id] of Object.entries(data.externalIds)) {
        if (id) cleaned[source] = String(id)
      }
      if (Object.keys(cleaned).length > 0) updates.externalIds = cleaned
    }

    // Pré-preenche Observações com "Status in Country of Origin" do MU quando
    // a obra está em Hiatus E observações atual está vazia. Não sobrescreve
    // nota manual existente.
    const statusText = data.mangaUpdatesStatusText
    if (statusText) {
      const isHiatus =
        data.publicationStatus === "Hiatus" ||
        statusText.toLowerCase().includes("hiatus")
      const currentObs = (currentWork.observations ?? "").trim()
      if (isHiatus && !currentObs) {
        updates.observations = statusText
      }
    }

    let result: { data?: { id: string; slug?: string }; error?: string }
    try {
      // acquireReviews: colhe + persiste reviews das fontes confirmadas em
      // background (borda) — aparecem na página da obra sem esperar avaliação.
      result = await updateWorkExternalData(workId, updates, { acquireReviews: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`Erro ao atualizar: ${message}`)
      setPhase("conflicts")
      return
    }
    if (result.error) {
      toast.error(`Erro ao atualizar: ${result.error}`)
      setPhase("conflicts")
      return
    }

    toast.success("Dados atualizados com sucesso.")
    // Sinaliza pro UpdateProgressWatcher (na página da obra) que a aquisição de
    // reviews + enrich do Comix vai rodar em background — ele mostra o progresso e
    // avisa quando terminar. O flag (escopado por workId) cobre o caso de re-mount
    // (navegar pro slug novo); o evento acorda o watcher já montado quando o pós-save
    // é só refresh() na mesma página (que não re-monta o componente).
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(`vibematch:updating:${workId}`, String(Date.now()))
      window.dispatchEvent(new CustomEvent(WORK_UPDATED_EVENT, { detail: { workId } }))
    }
    setOpen(false)
    setPhase(withSourceStep ? "sources" : "refreshing")
    // Quando o caller trata o pós-save (ex.: abrir a obra em outra aba), não
    // navegamos a aba atual.
    if (onSaved) {
      onSaved(workId)
      return
    }
    // Se o título mudou, navega DIRETO pro slug canônico novo (devolvido pela
    // action). Navegar pelo UUID dependia do redirect() server-side de
    // /titles/{uuid} → slug, que FALHA numa navegação soft (RSC) e mostra
    // erro/404; só funcionava após reload. Ir direto no slug elimina o redirect
    // (mesmo padrão já adotado no work-form).
    const newTitle = typeof updates.title === "string" ? updates.title : null
    const newSlug = result.data?.slug ?? (newTitle ? titleToSlug(newTitle) : null)
    const titleChanged =
      newTitle != null && titleToSlug(currentWork.title) !== (newSlug ?? titleToSlug(newTitle))
    if (titleChanged && newSlug) {
      router.push(`/titles/${newSlug}`)
    } else {
      refresh()
    }
  }

  const handleConfirm = () => {
    if (!pendingData) return
    applyUpdate(pendingData, resolutions)
  }

  const handleClose = () => {
    setOpen(false)
    setPhase(withSourceStep ? "sources" : "refreshing")
    setPendingData(null)
    setConflicts([])
    setSynopsisChoices([])
    setCoverChoices([])
    setCoversNeedPick(false)
    setTagChoices([])
    setGenreChoices([])
    setPreviewUrl(null)
    setActiveRefineUrl(null)
    setManualCoverUrl("")
    setManualCoverError(null)
  }

  return (
    <>
      {!hideTrigger && (
        <Button variant="outline" size="sm" onClick={handleOpen}>
          <RefreshCw className="h-4 w-4" />
          Atualizar dados
        </Button>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
        {/* `sm:max-w-2xl` e não `max-w-2xl`: o DialogContent já traz `sm:max-w-lg`, e
            no CSS gerado as utilidades com variante `sm:` saem DEPOIS das puras —
            um `max-w-2xl` sem variante perdia em silêncio e o diálogo ficava 512px.
            Largura 2xl (672px) + `max-h-[95vh]` pra dar espaço à galeria de capas: o
            preview grande + a grade de miniaturas estouravam a altura antiga (90vh) e o
            passo da capa ficava cortado/rolando.
            Só header e barra de ações são fixos; o miolo é que rola (ver abaixo). */}
        <DialogContent className="flex max-h-[95vh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0 gap-1.5">
            <DialogTitle>Atualizar dados externos</DialogTitle>
            <p className="text-base font-semibold text-foreground">{currentWork.title}</p>
            <DialogDescription>
              {withSourceStep
                ? "Confirme as fontes e rebusque sinopse, capa, capítulos, avaliações, reviews e tags."
                : "Rebusca os dados nas fontes já vinculadas."}
            </DialogDescription>
            {searchQueries.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Buscado nas fontes como:{" "}
                {searchQueries.map((q, i) => (
                  <span key={q}>
                    {i > 0 && <span className="opacity-50"> · </span>}
                    <span className="font-mono text-foreground/80">{q}</span>
                  </span>
                ))}
              </p>
            )}
          </DialogHeader>

          {/* ÚNICA área de rolagem do diálogo. Antes quem rolava era o próprio
              DialogContent, e aí o cabeçalho E a linha de botões rolavam junto com
              o conteúdo: com sinopse longa o "Continuar" ficava fora da tela e o
              passo virava um beco sem saída. O `min-h-0` é o que permite o flex
              item encolher abaixo do conteúdo — sem ele o `overflow-y-auto` não
              tem o que rolar e o diálogo estoura a altura de novo.
              O `-mx-6 px-6` faz a barra grudada (sticky) sangrar até as bordas. */}
          <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">

          {/* Montado enquanto o diálogo está aberto (NÃO desmonta ao avançar pra
              sinopses/capas): assim o "Voltar" reexibe as MESMAS fontes já
              resolvidas e preserva as seleções, sem refazer a busca — o
              revalidateWorkSources roda uma vez só, no mount. Escondido nas outras
              fases. Fechar o diálogo → Radix desmonta o content → a próxima
              abertura busca de novo (comportamento atual preservado). */}
          {withSourceStep && (
            <div className={phase === "sources" ? undefined : "hidden"}>
              <SourceSelectionStep
                workId={workId}
                onQueriesResolved={setSearchQueries}
                confirmLabel="Continuar"
                onConfirm={() => {
                  void runRefresh()
                }}
                onCancel={handleClose}
              />
            </div>
          )}

          {phase === "refreshing" && (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p>Comparando dados externos...</p>
            </div>
          )}

          {phase === "search" && (
            <div className="pt-2">
              <ExternalSearch titleQuery={currentWork.title} onSelect={handleSelect} evaluateAi={false} checkDuplicates={false} />
            </div>
          )}

          {phase === "synopses-pick" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Marque quais incluir e qual é a <span className="text-foreground">Principal</span> — a
                Principal é a única que vai pro prompt da avaliação IA e pras features da Nota Prevista.
              </p>

              <SynopsisPicker
                choices={synopsisChoices}
                onChange={setSynopsisChoices}
                emptyHint="Esta obra não tem sinopse salva e nenhuma veio das fontes. Você pode escrever a sua abaixo."
              />

              <div className={ACTION_BAR}>
                {withSourceStep ? (
                  <Button variant="ghost" onClick={() => setPhase("sources")}>Voltar</Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                  <Button onClick={handleConfirmSynopses}>Continuar</Button>
                </div>
              </div>
            </div>
          )}

          {phase === "covers-pick" && (() => {
            const activeCover =
              coverChoices.find((c) => c.url === activeRefineUrl) ?? coverChoices[0] ?? null
            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  {/* As instruções de capa saíram: a UI já mostra o que está marcado. */}
                  <p className="text-sm text-muted-foreground">
                    {coverChoices.length === 0
                      ? "Nenhuma capa restante. Você pode continuar sem alterar a capa atual."
                      : ""}
                  </p>
                  {coverChoices.length > 0 && (
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs shrink-0">
                      <Checkbox
                        checked={allCoversIncluded ? true : someCoversIncluded ? "indeterminate" : false}
                        onCheckedChange={toggleAllCovers}
                      />
                      Selecionar todas
                    </label>
                  )}
                </div>

                {activeCover && (
                  <div className="space-y-3">
                    <div className="relative mx-auto w-full max-w-xs aspect-[2/3] overflow-hidden rounded-lg border bg-muted shadow-sm">
                      <Image
                        src={getCoverImageSrc(activeCover.url)}
                        alt=""
                        fill
                        sizes="(max-width: 640px) 90vw, 384px"
                        unoptimized
                        className="object-contain"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={activeCover.saved ? "secondary" : "default"}
                          className="text-[11px]"
                        >
                          {activeCover.saved ? "Atual" : "Nova"}
                        </Badge>
                        <Badge variant="outline" className="text-[11px]">{activeCover.source}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <Checkbox
                            checked={activeCover.included}
                            onCheckedChange={() => toggleCoverIncluded(activeCover.url)}
                          />
                          Incluir
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="cover-primary-pick"
                            checked={activeCover.isPrimary}
                            onChange={() => setCoverPrimary(activeCover.url)}
                            className="accent-primary"
                          />
                          Principal
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteCover(activeCover.url)}
                          aria-label="Excluir esta capa"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Excluir
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 justify-center">
                  {coverChoices.map((c) => {
                    const isActive = c.url === activeCover?.url
                    return (
                      <div key={c.url} className="group/cover relative h-20 w-14">
                        <button
                          type="button"
                          onClick={() => setActiveRefineUrl(c.url)}
                          className={`absolute inset-0 overflow-hidden rounded border transition-all ${
                            isActive
                              ? "border-primary ring-2 ring-primary/40"
                              : c.included
                                ? "border-primary/40"
                                : "border-muted opacity-60 hover:opacity-100"
                          }`}
                          title={c.source}
                        >
                          <Image
                            src={getCoverImageSrc(c.url)}
                            alt=""
                            fill
                            sizes="56px"
                            unoptimized
                            className="object-cover"
                          />
                          {c.included && (
                            <span className="absolute top-0.5 left-0.5 rounded bg-emerald-500 px-1 text-[8px] font-semibold text-white">
                              ✓
                            </span>
                          )}
                          {c.isPrimary && (
                            <span className="absolute top-0.5 right-0.5 rounded bg-primary px-1 text-[8px] font-semibold text-primary-foreground">
                              P
                            </span>
                          )}
                          {!c.saved && (
                            <span className="absolute bottom-0.5 left-0.5 rounded bg-blue-500 px-1 text-[8px] font-semibold text-white">
                              nova
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCover(c.url)}
                          aria-label="Excluir esta capa"
                          title="Excluir"
                          className="absolute bottom-0.5 right-0.5 z-10 rounded bg-black/60 p-0.5 text-white opacity-0 transition-all group-hover/cover:opacity-100 hover:bg-destructive focus:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>

                <div className="space-y-1.5 rounded-md border border-dashed p-2">
                  <p className="text-[11px] text-muted-foreground">Adicionar capa por link manual</p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="url"
                      value={manualCoverUrl}
                      onChange={(e) => { setManualCoverUrl(e.target.value); if (manualCoverError) setManualCoverError(null) }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManualCover() } }}
                      placeholder="https://..."
                      className="h-8 text-xs"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={addManualCover} disabled={!manualCoverUrl.trim()} className="shrink-0 gap-1">
                      <Plus className="h-3.5 w-3.5" /> Adicionar
                    </Button>
                  </div>
                  {manualCoverError && <p className="text-[11px] text-destructive">{manualCoverError}</p>}
                </div>

                <div className={ACTION_BAR}>
                  {/* Sinopses vem sempre antes das capas → Voltar sempre volta pra lá. */}
                  <Button variant="ghost" onClick={() => setPhase("synopses-pick")}>Voltar</Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                    <Button onClick={handleConfirmCovers}>Continuar</Button>
                  </div>
                </div>
              </div>
            )
          })()}

          {phase === "tags-pick" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Tags e gêneros que vieram das fontes — revise antes de adicionar à obra.
              </p>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Gêneros</label>
                <ChipInput
                  value={genreChoices}
                  onChange={setGenreChoices}
                  suggestions={GENRE_NAMES}
                  restrictToSuggestions
                  showSuggestionMenu={false}
                  placeholder="Digite um gênero válido…"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tags</label>
                <ChipInput
                  value={tagChoices}
                  onChange={setTagChoices}
                  suggestionGroups={TAG_GROUPS_CATALOG}
                  groups={TAG_GROUPS_CATALOG.map((grp) => ({
                    label: grp.label,
                    values: tagChoices.filter((t) => grp.values.includes(t)),
                  })).filter((g) => g.values.length > 0)}
                  placeholder="Digite para buscar tag… (várias de uma vez separadas por , ou ;)"
                />
              </div>

              <p className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-muted-foreground">
                Aditivo: você revisa só o que veio das fontes. As tags que já existem na obra não
                são tocadas. Pra remover tags existentes, use a página de edição da obra.
              </p>

              <div className={ACTION_BAR}>
                <Button
                  variant="ghost"
                  onClick={() => setPhase(coversNeedPick ? "covers-pick" : "synopses-pick")}
                >
                  Voltar
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                  <Button onClick={handleConfirmTags}>Continuar</Button>
                </div>
              </div>
            </div>
          )}

          {phase === "conflicts" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Os campos abaixo diferem dos dados atuais. Escolha qual versão manter:
              </p>
              {conflicts.map((c) => (
                <div key={c.field} className="space-y-1.5">
                  <p className="text-sm font-medium">{c.label}</p>
                  <div className="space-y-1">
                    {([
                      { key: "external", label: "Externo", value: c.externalValue },
                      { key: "current", label: "Atual", value: c.currentValue },
                    ] as const).map(({ key, label, value }) => (
                      <label
                        key={key}
                        className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                          resolutions[c.field] === key ? "border-primary bg-primary/5" : "hover:bg-accent/50"
                        }`}
                      >
                        <input
                          type="radio"
                          name={c.field}
                          checked={resolutions[c.field] === key}
                          onChange={() => setResolutions((prev) => ({ ...prev, [c.field]: key }))}
                          className="mt-0.5 accent-primary shrink-0"
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          <Badge variant="outline" className="text-[11px] py-0 mr-1.5">{label}</Badge>
                          <span className="break-all">{value ?? "—"}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className={ACTION_BAR}>
                {/* O passo de tags vem sempre logo antes dos conflitos. */}
                <Button variant="ghost" onClick={() => setPhase("tags-pick")}>
                  Voltar
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                  <Button onClick={handleConfirm}>Confirmar e salvar</Button>
                </div>
              </div>
            </div>
          )}

          {phase === "saving" && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Salvando dados...
            </div>
          )}

          </div>

          {previewUrl && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 cursor-zoom-out"
              onClick={() => setPreviewUrl(null)}
              role="button"
              aria-label="Fechar visualização"
            >
              <div className="relative w-full max-w-md aspect-[2/3]">
                <Image
                  src={getCoverImageSrc(previewUrl)}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 90vw, 480px"
                  unoptimized
                  className="object-contain"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Enriquece os dados do refresh com os ratings de ComicK e AnimePlanet buscados
 * NO CLIENTE (`client-fetches.ts`). Necessário porque o refresh server-side não os
 * pega — o AnimePlanet é bloqueado por Cloudflare no servidor e o ComicK é instável
 * server-side. É o mesmo que o fluxo de criação faz em `proceedWithCandidate`, então
 * uma obra atualizada passa a ter as MESMAS notas de uma criada agora. Fail-soft.
 */
async function enrichWithClientRatings(data: ExternalWorkData): Promise<ExternalWorkData> {
  const comickHid = data.externalIds?.comick
  const apSlug = data.externalIds?.animeplanet
  if (!comickHid && !apSlug) return data
  const [cmx, ap] = await Promise.all([
    comickHid ? fetchComicKClient(data.title, comickHid).catch(() => null) : Promise.resolve(null),
    apSlug ? fetchAnimePlanetClient(data.title, apSlug).catch(() => null) : Promise.resolve(null),
  ])
  const next: ExternalWorkData = { ...data }
  if (cmx?.rating != null) next.cmxRating = cmx.rating
  if (cmx?.votes != null) next.cmxVotes = cmx.votes
  if (ap?.rating != null) next.apRating = ap.rating
  if (ap?.votes != null) next.apVotes = ap.votes
  return next
}

