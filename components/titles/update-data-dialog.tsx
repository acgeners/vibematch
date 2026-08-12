"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useRefresh } from "@/lib/use-refresh"
import { Archive, Check, ChevronRight, Plus, RefreshCw, RotateCcw, SkipForward, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
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
import { cleanSynopsisText, dedupeByMeaning } from "@/lib/synopsis-text"
import { cn, titleToSlug } from "@/lib/utils"
import { ScopedTaskStrip, useScopedGuard } from "@/components/tasks/scoped-task"
import { sourceLabel } from "@/lib/external/source-labels"
import type { ExternalSourceId, ExternalWorkData, FieldValueProvenance } from "@/lib/external/types"

/**
 * Barra de ações de cada passo. Fica GRUDADA no rodapé da área de rolagem: os
 * passos deste diálogo (sinopses, capas, conflitos) crescem com o dado da
 * obra, e uma sinopse longa bastava pra empurrar o "Continuar" pra fora da tela.
 * O `bg-background` é obrigatório — sem ele o conteúdo rolaria POR TRÁS da barra
 * e apareceria através dela.
 */
const ACTION_BAR =
  "sticky bottom-0 z-10 flex justify-between gap-2 border-t bg-background pt-3 pb-2"

/**
 * Indicador de progresso dos 3 passos do diálogo — puramente visual (não navega:
 * pular direto pra "Conflitos" exigiria dados que só existem depois de confirmar
 * os passos anteriores). Some fora deles (fontes/busca/salvando).
 */
const STEP_ORDER = ["synopses-pick", "covers-pick", "conflicts"] as const
const STEP_LABELS: Record<(typeof STEP_ORDER)[number], string> = {
  "synopses-pick": "Sinopses",
  "covers-pick": "Capas",
  conflicts: "Conflitos",
}

function DialogStepper({ phase }: { phase: string }) {
  const currentIdx = STEP_ORDER.indexOf(phase as (typeof STEP_ORDER)[number])
  if (currentIdx < 0) return null
  return (
    <nav aria-hidden="true" className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-6 pb-3 text-xs">
      {STEP_ORDER.map((step, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        return (
          <div key={step} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                active
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {done ? <Check className="h-2.5 w-2.5" /> : i + 1}
            </span>
            <span className={cn("font-medium", active ? "text-foreground" : "text-muted-foreground")}>
              {STEP_LABELS[step]}
            </span>
            {i < STEP_ORDER.length - 1 && <span className="mx-1 h-px w-4 bg-border" aria-hidden="true" />}
          </div>
        )
      })}
    </nav>
  )
}

interface CurrentWork {
  title: string
  originalTitle?: string | null
  synopsis?: string | null
  coverUrl?: string | null
  publicationStatus?: string | null
  totalChapters?: number | null
  observations?: string | null
}

/** Estado de cada obra da fila, na ordem em que ela foi montada. */
export type ReviewQueueMark = "done" | "skipped" | "current" | "todo"

/**
 * Contexto da revisão EM SEQUÊNCIA (fila da /import). Quando presente, o diálogo
 * ganha uma faixa no topo com a posição, o progresso e as saídas da fila —
 * o resto do fluxo (sinopses/capas/conflitos) é idêntico ao de uma revisão avulsa.
 * Quem controla o cursor é o caller: aqui só emitimos `onSkip`/`onAbort`.
 */
export interface ReviewQueueContext {
  /** Índice 0-based da obra atual. */
  index: number
  total: number
  /** Título da próxima obra; null quando esta é a última. */
  nextTitle: string | null
  marks: ReviewQueueMark[]
  onSkip: () => void
  onAbort: () => void
}

interface UpdateDataDialogProps {
  workId: string
  currentWork: CurrentWork
  // Capas já salvas na obra (todas, não só a primária). Mostradas no passo de
  // capas e mantidas por padrão. Quando ausente, cai pra currentWork.coverUrl.
  currentCovers?: SavedCover[]
  // Capas apagadas na edição (migration 163). Não entram no pool de escolha —
  // o servidor também as descarta. Mas aparecem numa seção "Arquivadas (N)" no
  // passo de capas, de onde podem ser RESTAURADAS pra esta atualização (o server
  // então as tira do arquivo — ver `restoredCoverUrls` em updateWorkExternalData).
  archivedCovers?: Array<{ url: string; source?: string | null }>
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
  // Revisão em sequência: mostra a faixa da fila no topo (posição, progresso,
  // "pular esta" e "encerrar fila"). Ausente = revisão avulsa, sem faixa nenhuma.
  queue?: ReviewQueueContext
  // Quando true, o fluxo começa por um passo de CONFIRMAÇÃO DE FONTES (revalidação
  // com Comix/Mangago resolvidos por cross-ID) antes de rehidratar os dados — o
  // merge de "Revalidar fontes" + "Atualizar dados" numa ação só. Default false
  // (ex.: revisão de importadas segue direto pro refresh).
  withSourceStep?: boolean
}

/**
 * Uma opção EXTERNA do passo de conflitos: um valor distinto e quem o reportou.
 * `sources` vazio = o merge herdou o valor do candidato da busca, sem fonte
 * hidratada atribuível → a UI cai no rótulo genérico "Externo".
 */
interface ExternalChoice {
  /** Chave do radio: "ext:0", "ext:1"… "current" é o outro valor possível. */
  key: ResolutionValue
  sources: ExternalSourceId[]
  display: string
  value: string | number
}

interface FieldConflict {
  field: keyof CurrentWork
  label: string
  currentValue: string | null
  /** Sempre ≥ 1: a primeira é o valor que venceu o merge. */
  externalChoices: ExternalChoice[]
}

/**
 * Decisão do usuário por campo. Tudo que NÃO é "current" significa "usar o externo" —
 * é assim que `applyUpdate` sempre leu isto, e continua lendo. O que mudou é que
 * "ext:N" também diz QUAL dos valores externos, resolvido antes do save.
 */
type ResolutionValue = "current" | "external" | `ext:${number}`

function formatValue(value: string | number | null | undefined): string {
  if (value == null) return "—"
  return String(value)
}

/** Rótulo das fontes de uma opção. Sem fonte atribuível volta ao "Externo" de antes. */
function choiceLabel(choice: ExternalChoice): string[] {
  if (choice.sources.length === 0) return ["Externo"]
  return choice.sources.map(sourceLabel)
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Monta o passo de conflitos: para cada campo em que o externo difere do salvo, UMA
 * LINHA POR VALOR DISTINTO — não por fonte. Fontes que concordam dividem a linha
 * ("MangaUpdates AniList · Completo"), e fonte que concorda com o valor salvo não vira
 * linha nenhuma: escolhê-la e escolher "Atual" dariam exatamente o mesmo resultado.
 *
 * A primeira opção é SEMPRE o valor que venceu o merge (o pré-selecionado, como antes).
 * Ele é injetado a partir do próprio `external[field]` e não da procedência, porque o
 * merge tem fallbacks que a procedência não enxerga (`originalTitle` pode vir do
 * candidato da busca) — assim a lista nunca deixa de conter o que de fato será salvo.
 */
function getConflicts(current: CurrentWork, external: ExternalWorkData): FieldConflict[] {
  const conflicts: FieldConflict[] = []

  const check = (
    field: keyof CurrentWork,
    label: string,
    currentVal: string | number | null | undefined,
    externalVal: string | number | null | undefined,
    /** Demais valores que as fontes reportaram para este campo. */
    alternatives: FieldValueProvenance[] = [],
  ) => {
    const cv = formatValue(currentVal)
    const ev = formatValue(externalVal)
    if (ev === "—" || cv === ev || externalVal == null) return

    const sourcesFor = (value: string | number): ExternalSourceId[] =>
      alternatives.find((entry) => String(entry.value) === String(value))?.sources ?? []

    const byDisplay = new Map<string, Omit<ExternalChoice, "key">>()
    const push = (value: string | number) => {
      const display = formatValue(value)
      // Valor idêntico ao salvo não vira opção externa — seria um clone do "Atual".
      if (display === cv || byDisplay.has(display)) return
      byDisplay.set(display, { sources: sourcesFor(value), display, value })
    }

    push(externalVal)
    for (const entry of alternatives) push(entry.value)

    const externalChoices: ExternalChoice[] = [...byDisplay.values()].map((choice, i) => ({
      ...choice,
      key: `ext:${i}`,
    }))
    conflicts.push({ field, label, currentValue: cv === "—" ? null : cv, externalChoices })
  }

  const provenance = external.fieldProvenance ?? {}
  // Sinopse e capa não têm procedência escalar (o texto/URL viaja em multiSynopses/
  // multiCovers) — a fonte sai dali. Na prática ambas já foram decididas nos passos
  // anteriores e raramente chegam aqui.
  const synopsisAlternatives: FieldValueProvenance[] = (external.multiSynopses ?? []).map((s) => ({
    value: s.text,
    sources: [s.source],
  }))
  const coverAlternatives: FieldValueProvenance[] = (external.multiCovers ?? []).map((c) => ({
    value: c.url,
    sources: [c.source],
  }))

  check("title", "Título", current.title, external.title, provenance.title)
  check("originalTitle", "Título original", current.originalTitle, external.originalTitle, provenance.originalTitle)
  check("synopsis", "Sinopse", current.synopsis, external.synopsis, synopsisAlternatives)
  check("coverUrl", "Capa (URL)", current.coverUrl, external.coverUrl, coverAlternatives)
  check("publicationStatus", "Status de publicação", current.publicationStatus, external.publicationStatus, provenance.publicationStatus)
  check("totalChapters", "Capítulos totais", current.totalChapters, external.totalChapters, provenance.totalChapters)

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
 * Dedup pelo SIGNIFICADO (`@/lib/synopsis-text`), não por igualdade de string: a
 * mesma sinopse volta da fonte a cada atualização com uma vírgula a mais ou um bloco
 * "Original Novel:" no fim, e a chave exata que morava aqui a listava de novo como
 * "nova". A salva vem primeiro e por isso vence — é ela que carrega a sua curadoria
 * (principal, texto editado).
 *
 * O texto também passa pela LIMPEZA aqui, e não só no gravador: a tela precisa
 * mostrar o que vai ser salvo. Isso é o que descontamina o que já está no banco —
 * cada "Atualizar dados" regrava a versão limpa da linha antiga.
 */
export function buildSynopsisPool(
  saved: SavedSynopsis[],
  external: Array<{ source: string; text: string }>
): SynopsisChoice[] {
  // Obra sem nada salvo mantém o comportamento antigo: externas já vêm marcadas.
  const hasSaved = saved.some((s) => (s.text ?? "").trim())
  const candidates: SynopsisChoice[] = [
    ...saved.map((s) => ({
      source: s.source,
      text: cleanSynopsisText(s.text),
      included: true,
      isPrimary: s.isPrimary,
      saved: true,
    })),
    ...external.map((e) => ({
      source: e.source,
      text: cleanSynopsisText(e.text),
      included: !hasSaved,
      isPrimary: false,
    })),
  ].filter((c) => c.text.length > 0)

  return normalizeSynopsisChoices(dedupeByMeaning(candidates, (c) => c.text))
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
  archivedUrls: Set<string> = new Set(),
): CoverChoice[] {
  const hasSaved = saved.length > 0
  const byUrl = new Map<string, CoverChoice>()
  for (const c of saved) {
    if (!c.url || archivedUrls.has(c.url)) continue
    byUrl.set(c.url, {
      source: c.source ?? "atual",
      url: c.url,
      included: true,
      isPrimary: Boolean(c.isPrimary),
      saved: true,
    })
  }
  for (const c of externalCovers) {
    if (!c.url || byUrl.has(c.url) || archivedUrls.has(c.url)) continue
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
  archivedCovers,
  currentSynopses,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  onSaved,
  queue,
  withSourceStep = false,
}: UpdateDataDialogProps) {
  const router = useRouter()
  const refresh = useRefresh()

  // Capas atuais da obra (passadas só pelo fluxo "Atualizar dados" da página da
  // obra). Quando ausente (ex.: revisão de importadas), savedCovers fica vazio e
  // o picker volta ao comportamento antigo: capas externas marcadas por padrão.
  const archivedList = archivedCovers ?? []
  const archivedUrlSet = new Set(archivedList.map((a) => a.url))
  const savedCovers: SavedCover[] = (currentCovers ?? []).filter(
    (c) => c.url && !archivedUrlSet.has(c.url),
  )
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
  const [phase, setPhase] = useState<"sources" | "refreshing" | "search" | "synopses-pick" | "covers-pick" | "conflicts" | "saving">(
    withSourceStep ? "sources" : "refreshing"
  )
  const [pendingData, setPendingData] = useState<ExternalWorkData | null>(null)
  /** Nomes que a busca de fato usou nas fontes (título + variantes do retry). */
  const [searchQueries, setSearchQueries] = useState<string[]>([])
  const [conflicts, setConflicts] = useState<FieldConflict[]>([])
  const [resolutions, setResolutions] = useState<Record<string, ResolutionValue>>({})
  const [synopsisChoices, setSynopsisChoices] = useState<SynopsisChoice[]>([])
  const [coverChoices, setCoverChoices] = useState<CoverChoice[]>([])
  const [coversNeedPick, setCoversNeedPick] = useState(false)
  const [showArchivedCovers, setShowArchivedCovers] = useState(false)
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
    // Capa arquivada some do pool aqui — e a contagem de "novidades" abaixo usa a
    // MESMA lista filtrada, senão o passo de capas abriria só pra mostrar nada.
    const externalCovers = (data.multiCovers ?? []).filter((c) => !archivedUrlSet.has(c.url))
    const pool = buildCoverPool(externalCovers, savedCovers, archivedUrlSet)

    // Mostra o passo de capas quando há decisão real a tomar:
    //  - obra SEM capas salvas e várias externas → escolher entre elas (antigo);
    //  - obra COM capas salvas e ao menos uma capa externa NOVA → manter as
    //    atuais (default) e opcionalmente incluir as novas / remover atuais.
    //  - existem capas ARQUIVADAS → o passo precisa abrir pra você poder
    //    restaurá-las; sem isto, a obra cujas externas estão TODAS arquivadas
    //    (o caso que motivou a feature) pularia o passo e a seção ficaria fora de
    //    alcance. A contagem é a do arquivo — não das externas, que já saíram.
    // Quando o externo não traz nada novo E não há arquivada, não há o que decidir.
    const savedUrls = new Set(savedCovers.map((c) => c.url))
    const newExternal = externalCovers.filter((c) => !savedUrls.has(c.url))
    const coversNeedPick =
      (savedCovers.length === 0 && externalCovers.length > 1) ||
      (savedCovers.length > 0 && newExternal.length > 0) ||
      archivedList.length > 0

    setPendingData(data)
    setSynopsisChoices(buildSynopsisPool(savedSynopses, synopses))
    setCoverChoices(pool)
    setCoversNeedPick(coversNeedPick)
    setActiveRefineUrl(pool.find((c) => c.included)?.url ?? pool[0]?.url ?? null)
    // Item 3: o passo de sinopse aparece SEMPRE (mesmo com 0-1 externa) pra você poder
    // digitar uma manual. O passo de capa (se houver decisão) vem depois.
    setPhase("synopses-pick")
  }

  const proceedToConflictsOrApply = (
    data: ExternalWorkData,
    preResolved: Record<string, ResolutionValue> = {}
  ) => {
    const detected = getConflicts(currentWork, data).filter((c) => !(c.field in preResolved))
    setPendingData(data)
    if (detected.length > 0) {
      const defaults: Record<string, ResolutionValue> = { ...preResolved }
      // Default segue no externo (comportamento de antes) — e agora é a primeira
      // opção da lista, que é justamente o valor que venceu o merge.
      for (const c of detected) defaults[c.field] = c.externalChoices[0]?.key ?? "external"
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
    const preResolved: Record<string, ResolutionValue> = {}
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

    // Tags/gêneros seguem direto das fontes (via `...pendingData`), sem revisão manual.
    // Aditivo: vazios = nada é enviado e o server preserva as tags existentes; não-vazios
    // são ADICIONADOS (syncWorkTagsPartial), nunca removem o que já existe na obra.
    proceedToConflictsOrApply(next, preResolved)
  }

  const handleConfirmSynopses = () => {
    if (!pendingData) return
    // Vai pra galeria de capas só quando há decisão de capa a tomar; senão finaliza
    // direto (as capas atuais são preservadas).
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
    finalizeChoicesAndProceed()
  }

  const handleConfirmCovers = () => {
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
  // Traz uma capa arquivada de volta pra ESTA atualização. Ela entra no pool como
  // incluída; a seção "Arquivadas" some com ela porque a lista exibida é derivada
  // (arquivadas MENOS o que já está no pool). O desarquivar durável acontece no
  // save: applyResolutions manda `restoredCoverUrls` e o server tira do arquivo.
  const restoreArchivedCover = (entry: { url: string; source?: string | null }) => {
    setCoverChoices((prev) => {
      if (prev.some((c) => c.url === entry.url)) return prev
      return [
        ...prev,
        { source: entry.source ?? "atual", url: entry.url, included: true, isPrimary: false, saved: false },
      ]
    })
    setActiveRefineUrl(entry.url)
  }
  // Exibidas = arquivadas que ainda NÃO estão no pool. Restaurar tira daqui;
  // excluir uma restaurada (deleteCover) faz ela reaparecer — sem estado extra.
  const archivedForDisplay = archivedList.filter(
    (a) => !coverChoices.some((c) => c.url === a.url),
  )
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
    fieldResolutions: Record<string, ResolutionValue>
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
      // Capas que estavam arquivadas e o usuário restaurou (estão em `covers` mas
      // ainda no arquivo). O server precisa tirá-las de work_cover_archive ANTES do
      // syncExternalCovers, senão o filtro delas as barraria de novo — restaurar
      // não pegaria. Só as que de fato entram: restaurar e depois excluir não conta.
      const restored = data.multiCovers.filter((c) => archivedUrlSet.has(c.url)).map((c) => c.url)
      if (restored.length > 0) updates.restoredCoverUrls = restored
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

    // O "Status in Country of Origin" do MU é fato da OBRA e vai pra coluna dela; o servidor
    // deriva o tipo de hiato a partir dele (migration 183). Isto escrevia `observations`, que
    // mora em `user_work_state` — a nota da obra caía na linha de quem clicou em "Atualizar
    // dados", e só se ela estivesse vazia. As duas ressalvas ("só em Hiatus", "só se vazio")
    // existiam por causa desse lugar errado e saíram junto com ele.
    if (data.mangaUpdatesStatusText) {
      updates.publicationStatusNote = data.mangaUpdatesStatusText
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
    // O merge escolheu um valor por campo; se o usuário preferiu OUTRA fonte, o dado
    // que vai pro save tem que carregar o valor dela — `applyUpdate` lê de `data`,
    // não das opções. Sem este patch, escolher "MangaUpdates · 50" salvaria o 1 do
    // MangaDex em silêncio (a resolução não-"current" só dizia "use o externo").
    const patched: ExternalWorkData = { ...pendingData }
    for (const conflict of conflicts) {
      const resolution = resolutions[conflict.field]
      if (!resolution || resolution === "current") continue
      const chosen = conflict.externalChoices.find((choice) => choice.key === resolution)
      if (!chosen) continue
      // Sinopse: manter `multiSynopses` coerente com a escolha, senão o gravador
      // reinsere a lista antiga e a principal volta a ser a do merge.
      if (conflict.field === "synopsis") {
        patched.synopsis = String(chosen.value)
        const source = chosen.sources[0]
        if (source) patched.multiSynopses = [{ source, text: String(chosen.value) }]
        continue
      }
      if (conflict.field === "coverUrl") {
        patched.coverUrl = String(chosen.value)
        const source = chosen.sources[0]
        if (source) patched.multiCovers = [{ url: String(chosen.value), source }]
        continue
      }
      ;(patched as unknown as Record<string, unknown>)[conflict.field] = chosen.value
    }
    applyUpdate(patched, resolutions)
  }

  // Request-scoped: a busca em 8 fontes devolve o diff PRA TELA — nada é gravado
  // até você escolher e salvar. Modal, então a porta de saída é fechar (Cancelar
  // · Esc · clicar fora); o scrim do Radix já impede o clique no link da barra,
  // por isso sem `guardNavigation`. Ver components/tasks/scoped-task.tsx.
  const { guard, guardDialog, elapsed } = useScopedGuard({
    running: phase === "refreshing",
    title: "Fechar agora perde a busca",
    what: "Atualizar dados",
    confirmLabel: "Fechar mesmo assim",
  })

  const handleClose = () => {
    setOpen(false)
    setPhase(withSourceStep ? "sources" : "refreshing")
    setPendingData(null)
    setConflicts([])
    setSynopsisChoices([])
    setCoverChoices([])
    setCoversNeedPick(false)
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

      <Dialog open={open} onOpenChange={(v) => { if (!v) guard(handleClose) }}>
        {guardDialog}
        {/* `sm:max-w-2xl` e não `max-w-2xl`: o DialogContent já traz `sm:max-w-lg`, e
            no CSS gerado as utilidades com variante `sm:` saem DEPOIS das puras —
            um `max-w-2xl` sem variante perdia em silêncio e o diálogo ficava 512px.
            Largura 2xl (672px) + `max-h-[95vh]` pra dar espaço à galeria de capas: o
            preview grande + a grade de miniaturas estouravam a altura antiga (90vh) e o
            passo da capa ficava cortado/rolando.
            Só header e barra de ações são fixos; o miolo é que rola (ver abaixo). */}
        <DialogContent className="flex max-h-[95vh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0 flex-row items-start gap-3 text-left">
            {currentWork.coverUrl && (
              <div className="relative hidden h-16 w-11 shrink-0 overflow-hidden rounded-lg border bg-muted shadow-sm sm:block">
                <Image
                  src={getCoverImageSrc(currentWork.coverUrl)}
                  alt=""
                  fill
                  sizes="44px"
                  unoptimized
                  className="object-cover"
                />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Atualizar dados externos
              </DialogTitle>
              <p className="truncate text-lg font-semibold text-foreground">{currentWork.title}</p>
              <DialogDescription className="text-xs">
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
            </div>
          </DialogHeader>

          <DialogStepper phase={phase} />

          {/* Faixa da fila (revisão em sequência). Fica FORA da área de rolagem —
              as saídas da fila ("pular", "encerrar") têm que estar acessíveis em
              qualquer passo, inclusive durante o "Comparando dados externos...".
              O `-mx-6 px-6` sangra até as bordas, igual à barra de ações. */}
          {queue && (
            <div className="-mx-6 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-y bg-primary/12 px-6 py-2 text-xs">
              <span className="font-semibold tabular-nums">
                Fila · {queue.index + 1} de {queue.total}
              </span>
              <div className="flex items-center gap-1" aria-hidden="true">
                {queue.marks.map((mark, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1 w-4 rounded-full",
                      mark === "done" && "bg-emerald-500",
                      mark === "skipped" && "bg-muted-foreground/60",
                      mark === "current" && "bg-primary",
                      mark === "todo" && "bg-muted-foreground/25",
                    )}
                  />
                ))}
              </div>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {queue.nextTitle ? `próxima: ${queue.nextTitle}` : "última da fila"}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={queue.onSkip}>
                  <SkipForward className="h-3.5 w-3.5" /> Pular esta
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={queue.onAbort}>
                  Encerrar fila
                </Button>
              </div>
            </div>
          )}

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
            <div className="py-4">
              <ScopedTaskStrip
                running
                elapsed={elapsed}
                label="Comparando dados de 8 fontes externas…"
                note="Fique nesta tela. O resultado aparece aqui e não fica salvo — fechando, você precisa rodar de novo."
              />
            </div>
          )}

          {phase === "search" && (
            <div className="pt-2">
              <ExternalSearch titleQuery={currentWork.title} onSelect={handleSelect} evaluateAi={false} checkDuplicates={false} />
            </div>
          )}

          {phase === "synopses-pick" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Marque quais incluir e qual é a <span className="font-medium text-foreground">Principal</span> — a
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
                            <span className="absolute top-0.5 left-0.5 rounded bg-primary/90 px-1 text-[8px] font-semibold text-primary-foreground">
                              ✓
                            </span>
                          )}
                          {c.isPrimary && (
                            <span className="absolute top-0.5 right-0.5 rounded bg-primary px-1 text-[8px] font-semibold text-primary-foreground">
                              P
                            </span>
                          )}
                          {!c.saved && (
                            <span className="absolute bottom-0.5 left-0.5 rounded bg-accent px-1 text-[8px] font-semibold text-accent-foreground">
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

                {archivedForDisplay.length > 0 && (
                  <div className="rounded-md border border-dashed p-2">
                    <button
                      type="button"
                      onClick={() => setShowArchivedCovers((s) => !s)}
                      aria-expanded={showArchivedCovers}
                      className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight
                        className={`h-3 w-3 transition-transform ${showArchivedCovers ? "rotate-90" : ""}`}
                      />
                      <Archive className="h-3.5 w-3.5" />
                      Arquivadas ({archivedForDisplay.length})
                    </button>

                    {showArchivedCovers && (
                      <div className="mt-2 space-y-2">
                        <p className="text-[11px] text-muted-foreground">
                          Você arquivou estas capas — por isso a busca não as trouxe. Clique em{" "}
                          <strong>Restaurar</strong> pra incluir uma nesta atualização.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {archivedForDisplay.map((a) => (
                            <div key={a.url} className="w-14">
                              <div className="relative h-20 w-14 overflow-hidden rounded border opacity-60 transition-opacity hover:opacity-100">
                                <Image
                                  src={getCoverImageSrc(a.url)}
                                  alt=""
                                  fill
                                  sizes="56px"
                                  unoptimized
                                  className="object-cover grayscale"
                                />
                                <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[8px] font-semibold text-white/90">
                                  🗄 {a.source || "—"}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => restoreArchivedCover(a)}
                                className="mt-1 flex w-full items-center justify-center gap-1 rounded border bg-muted px-1 py-0.5 text-[10px] font-medium hover:border-emerald-500/50 hover:bg-emerald-500/10"
                              >
                                <RotateCcw className="h-2.5 w-2.5" />
                                Restaurar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

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

          {phase === "conflicts" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Os campos abaixo diferem dos dados atuais. Escolha qual versão manter:
              </p>
              {conflicts.map((c) => {
                // Uma linha por VALOR distinto: as externas (nomeadas pela fonte que as
                // reportou) e o "Atual". Fonte que concorda com o salvo não vira linha —
                // `getConflicts` já a descartou, porque escolhê-la não mudaria nada.
                const rows = [
                  ...c.externalChoices.map((choice) => ({
                    key: choice.key,
                    labels: choiceLabel(choice),
                    isCurrent: false,
                    value: choice.display,
                  })),
                  { key: "current" as const, labels: ["Atual"], isCurrent: true, value: c.currentValue ?? "—" },
                ]
                return (
                  <div key={c.field} className="space-y-2">
                    <p className="text-sm font-semibold">{c.label}</p>
                    <div className="space-y-1.5">
                      {rows.map(({ key, labels, isCurrent, value }) => (
                        <label
                          key={key}
                          className={cn(
                            "flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors",
                            resolutions[c.field] === key
                              ? "ring-1 ring-inset ring-primary/50 bg-primary/5"
                              : "hover:bg-accent/50"
                          )}
                        >
                          <input
                            type="radio"
                            name={c.field}
                            checked={resolutions[c.field] === key}
                            onChange={() => setResolutions((prev) => ({ ...prev, [c.field]: key }))}
                            className="mt-0.5 accent-primary shrink-0"
                          />
                          <span className="min-w-0 flex-1 text-sm">
                            {labels.map((label) => (
                              <Badge
                                key={label}
                                variant={isCurrent ? "secondary" : "outline"}
                                className="text-[11px] py-0 mr-1.5"
                              >
                                {label}
                              </Badge>
                            ))}
                            <span className="break-all">{value}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
              <div className={ACTION_BAR}>
                <Button
                  variant="ghost"
                  onClick={() => setPhase(coversNeedPick ? "covers-pick" : "synopses-pick")}
                >
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

