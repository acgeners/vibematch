"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Check, ChevronDown, Loader2, Minus, Plus } from "lucide-react"
import { toast } from "sonner"

import { useRefresh } from "@/lib/use-refresh"
import { cn, readingProgressPercent } from "@/lib/utils"
import { PersonalStatusBadge } from "@/components/ui/status-badge"
import { SynopsisQualityPicker } from "@/components/titles/synopsis-quality-picker"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useWorkStatusGate } from "@/components/titles/work-status-gate"
import { setReadingStatusForWorks, setChaptersRead } from "@/server/actions/works"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { isTerminalPersonalStatus } from "@/lib/constants/status-lookups"
import { chapterCeiling, clampChaptersRead, evaluateReadingCoherence } from "@/lib/reading/status-coherence"
import { PERSONAL_STATUSES } from "@/types/domain"
import type { WorkStatusValues } from "@/lib/validations/work.schema"

/**
 * Controles rápidos da faixa de stats da página da obra: trocar o status de leitura, os
 * capítulos lidos e o Interesse ♥ sem abrir "Meu Status" — exceto quando o próprio atalho
 * decide que vale a pena abrir (ver `GATE_THRESHOLD_PCT` abaixo).
 *
 * A faixa é PERSISTENTE (fica fora do `<TabsContent>`), então os atalhos valem nas 5
 * abas — não só na Visão Geral.
 *
 * ⚠️ Estes campos vão por caminhos DIFERENTES no servidor, e é de propósito:
 *  - status    → `setReadingStatusForWorks` (só `personal_status_id`, sem tocar em capítulos,
 *                notas ou observações — o form completo continua sendo o lugar disso);
 *  - capítulos → `setChaptersRead` (só `chapters_read` + `last_read_at` quando cresce — a
 *                mesma action do stepper de /reading, sem promover status);
 *  - ♥         → `setSynopsisQualityAction`, que é feature do Ridge e marca recálculo pendente.
 * Todos usam o MESMO gate (`ensureReadingStateWriter`): dado pessoal, qualquer usuário
 * logado. O que é restrito é PREVER o interesse por IA, não declará-lo.
 *
 * Gate pro diálogo "Meu Status" (`useWorkStatusGate`): status terminal (Finished/Dropped,
 * `isTerminalPersonalStatus`) ou capítulos lidos cruzando `GATE_THRESHOLD_PCT` do total abrem
 * o diálogo sozinhos, com os valores que acabaram de mudar — pra puxar quem "formou opinião"
 * de leitura pra avaliação completa (nota, atributos, "Como foi pra você"), sem exigir que ela
 * ache o botão "Status" por conta própria.
 */
const GATE_THRESHOLD_PCT = 20

/** Mesmo layout das demais células da faixa — mantido em sincronia com app/catalog/[id]/page.tsx. */
const CELL_CLASS = "flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5"
const LABEL_CLASS =
  "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"

const STATUS_INFO_BY_NAME = Object.fromEntries(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info]),
)

export interface QuickChaptersCellProps {
  workId: string
  /** `works.total_chapters` — curadoria, não editável aqui. */
  totalChapters: number | null
  /** `chapters_read` de quem está vendo (Fatia 1: mistura dono/leitor conforme a sessão). */
  chaptersRead: number | null
  /** `works.publication_status_id` — decide se chegar ao fim sugere "Finished". */
  publicationStatusId?: number | null
  /** Status pessoal atual, pra saber se a sugestão de fim ainda faz sentido. */
  personalStatusId?: number | null
  /** false ⇒ visitante anônimo ou sem sessão: mostra o texto estático, sem afordância de clique. */
  canEdit: boolean
}

export function QuickChaptersCell({
  workId,
  totalChapters,
  chaptersRead,
  publicationStatusId = null,
  personalStatusId = null,
  canEdit,
}: QuickChaptersCellProps) {
  const { requestOpen } = useWorkStatusGate()
  const refresh = useRefresh()
  const [, startTransition] = useTransition()
  const [read, setRead] = useState(chaptersRead ?? 0)
  const [syncedProp, setSyncedProp] = useState(chaptersRead)
  /** Texto do campo enquanto está sendo digitado; null = não está em edição. */
  const [draft, setDraft] = useState<string | null>(null)
  /** Aviso do clamp ("digitou 40, o catálogo conhece 26"), some no próximo toque. */
  const [clampedFrom, setClampedFrom] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * O progresso ("12 / 73" e a barra) só existe quando o status ACOMPANHA progresso.
   *
   * 🔴 A régua vem do banco (`personal_status.tracks_progress`), nunca de uma lista de
   * nomes: hoje os quatro sem progresso são Want to Read, Untracked, Not Now e
   * Not Interested — todos casos de "ainda não comecei / não vou começar", em que "0 / 73"
   * não é informação, é ruído que ainda por cima parece leitura abandonada. Um status novo
   * no Supabase entra na régua sozinho; uma lista fixa aqui erraria calada.
   *
   * ⚠️ Sem status (obra nunca tocada) também não mostra progresso — é o mesmo caso de
   * "não comecei", e `personalStatusId` é null antes do primeiro toque.
   *
   * O popover de edição continua inteiro: é por ele que se começa a acompanhar, e escrever
   * capítulo promove o status pra Reading (`promotedStatus`), que devolve o "12 / 73".
   */
  const showsProgress = personalStatusId != null
    ? (PERSONAL_STATUSES_BY_ID[personalStatusId]?.tracksProgress ?? false)
    : false

  // Mesmo padrão "adjust during render" do QuickStatusCell — ver o comentário lá.
  if (chaptersRead !== syncedProp) {
    setSyncedProp(chaptersRead)
    setRead(chaptersRead ?? 0)
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  if (!canEdit) {
    const total = totalChapters != null && totalChapters > 0 ? totalChapters : null
    const readDisplay =
      showsProgress && chaptersRead != null && chaptersRead > 0 ? chaptersRead : null
    const text =
      readDisplay != null && total != null
        ? `${readDisplay} / ${total} capítulos`
        : total != null
          ? `${total} capítulos`
          : readDisplay != null
            ? `${readDisplay} capítulos lidos`
            : null
    if (!text) return null
    return (
      <div className={CELL_CLASS}>
        <span className={LABEL_CLASS}>Capítulos</span>
        <span className="text-sm font-mono font-semibold text-foreground">{text}</span>
      </div>
    )
  }

  const persist = (value: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const res = await setChaptersRead(workId, value)
        if (res && "error" in res && res.error) {
          toast.error("Não salvou os capítulos", { description: res.error })
          setRead(chaptersRead ?? 0) // reverte pro persistido
          return
        }
        // A escrita pode ter PROMOVIDO o status ("não comecei" + progresso ⇒ Reading, em
        // status-coherence.ts). Quem exibe o status é a célula vizinha, alimentada por props
        // do servidor — sem este refresh ela seguiria mostrando "Untracked" até a próxima
        // navegação. Só quando promoveu: refresh a cada capítulo seria round-trip à toa.
        if (res && "data" in res && res.data?.promotedStatus) refresh()
      })
    }, 500)
  }

  /**
   * Único caminho de escrita da célula (setas e digitação passam por aqui), com os dois
   * gates que abrem "Meu Status" sozinho — sempre de forma otimista, sem esperar o servidor.
   */
  const applyValue = (next: number) => {
    const previous = read
    if (next === previous) return
    setRead(next)
    persist(next)

    if (next <= previous) return // corrigir um número pra baixo não abre nada

    // 1) Cruzou o limiar de leitura → a pessoa já formou opinião, puxa pra avaliação.
    if (totalChapters && totalChapters > 0) {
      const prevPct = (previous / totalChapters) * 100
      const nextPct = (next / totalChapters) * 100
      if (prevPct <= GATE_THRESHOLD_PCT && nextPct > GATE_THRESHOLD_PCT) {
        requestOpen({ chapters_read: next })
        return
      }
    }

    // 2) Chegou ao último capítulo de uma obra CONCLUÍDA → convida a marcar "Finished".
    // Convite, não correção: quem decide é o banner dentro do diálogo, nada muda sozinho.
    const issue = evaluateReadingCoherence({
      personalStatus: personalStatusId,
      publicationStatusId,
      chaptersRead: next,
      totalChapters,
    })
    if (issue?.kind === "finish-suggested") requestOpen({ chapters_read: next })
  }

  // Teto = maior entre o total do catálogo e o que já está lido. A /reading marca "até o último
  // lançado" pela checagem externa, então 132 lidos numa obra que o catálogo diz ter 120 é um
  // estado REAL — e limitar no total puxaria o número pra baixo no primeiro clique daqui.
  const ceiling = chapterCeiling(totalChapters, chaptersRead)

  const bump = (delta: number) => {
    setClampedFrom(null)
    setDraft(null)
    applyValue(clampChaptersRead(read + delta, ceiling).value)
  }

  /** Enter/blur: valida o que foi digitado, limita ao teto e explica quando limitou. */
  const commitDraft = () => {
    if (draft === null) return
    const typed = draft.trim()
    setDraft(null)
    if (typed === "") return // campo esvaziado = desistiu, mantém o valor atual
    const { value, requested, clamped } = clampChaptersRead(Number(typed), ceiling)
    setClampedFrom(clamped ? requested : null)
    applyValue(value)
  }

  const cancelDraft = () => {
    setDraft(null)
    setClampedFrom(null)
  }

  // Enquanto digita, a % e a barra seguem o número do campo — o retorno visual é o que
  // diz "entendi 18", antes mesmo de salvar.
  const previewed = draft !== null && draft.trim() !== "" ? Number(draft) : read
  const shown = Number.isFinite(previewed) ? clampChaptersRead(previewed, ceiling).value : read
  const pct = totalChapters && totalChapters > 0 ? readingProgressPercent(shown, totalChapters) : null
  /** No editor, progresso aparece também assim que o número sai do zero (ver abaixo). */
  const progressInPopover = showsProgress || shown > 0

  return (
    <div className={CELL_CLASS}>
      <span className={LABEL_CLASS}>Capítulos</span>
      <Popover>
        <PopoverTrigger
          className="group -mx-1 flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-foreground/5"
          aria-label="Editar capítulos lidos"
          title="Editar capítulos lidos"
        >
          <span className="font-mono text-sm font-semibold text-foreground">
            {totalChapters ? (showsProgress ? `${read} / ${totalChapters}` : totalChapters) : read}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" />
        </PopoverTrigger>
        <PopoverContent align="center" className="w-60 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Capítulos lidos
          </p>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 items-center rounded-lg border border-border/80">
              <button
                type="button"
                onClick={() => bump(-1)}
                disabled={read <= 0}
                aria-label="Diminuir capítulos lidos"
                className="grid h-8 w-7 place-items-center rounded-l-lg text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                <Minus className="size-3.5" />
              </button>
              {/* Digitável: ir de 3 pra 47 não pode custar 44 cliques. `text` + inputMode
                  numérico em vez de `type="number"` — o spinner nativo brigaria com as setas
                  ao lado, e o Firefox aceita "e"/"-" num campo numérico. */}
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                aria-label="Capítulos lidos"
                value={draft ?? String(read)}
                onFocus={(e) => {
                  setDraft(String(read))
                  e.currentTarget.select()
                }}
                onChange={(e) => {
                  setDraft(e.target.value.replace(/\D/g, ""))
                  setClampedFrom(null)
                }}
                onBlur={commitDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    commitDraft()
                    e.currentTarget.blur()
                  } else if (e.key === "Escape") {
                    e.preventDefault()
                    cancelDraft()
                    e.currentTarget.blur()
                  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault()
                    bump(e.key === "ArrowUp" ? 1 : -1)
                  }
                }}
                className="min-w-9 w-12 rounded bg-transparent px-1 text-center font-mono text-base font-bold leading-none text-foreground outline-none focus:bg-primary/10 focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => bump(1)}
                disabled={ceiling != null && read >= ceiling}
                aria-label="Aumentar capítulos lidos"
                className="grid h-8 w-7 place-items-center rounded-r-lg text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            {totalChapters ? (
              <>
                <span className="font-mono text-sm text-muted-foreground">/ {totalChapters}</span>
                {/* A % e a barra acompanham o mesmo critério do gatilho — mas voltam assim que
                    o número sai do zero, mesmo antes de salvar: é o retorno visual que diz
                    "entendi 18", e escrever capítulo promove o status pra Reading. */}
                {progressInPopover && (
                  <span className="ml-auto font-mono text-xs font-bold text-primary">{pct}%</span>
                )}
              </>
            ) : null}
          </div>
          {totalChapters ? (
            <>
              {progressInPopover && (
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.min(100, pct ?? 0)}%` }}
                  />
                </div>
              )}
              {clampedFrom != null ? (
                // Corrigir o número em silêncio vira "o app comeu o que eu digitei". Diz o
                // que recebeu e o que fez — e nomeia o catálogo como origem do teto.
                <p className="mt-2.5 border-t border-amber-500/30 pt-2.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                  Você digitou {clampedFrom}. O catálogo conhece {totalChapters} capítulos — ajustei
                  pro máximo.
                </p>
              ) : (
                <p className="mt-2.5 border-t border-border/60 pt-2.5 text-[11px] leading-snug text-muted-foreground">
                  {draft !== null ? (
                    <>
                      <b>Enter</b> salva · <b>Esc</b> cancela
                    </>
                  ) : (
                    <>
                      Passar de {GATE_THRESHOLD_PCT}% dos capítulos abre <b>Meu Status</b>{" "}
                      automaticamente pra completar a avaliação.
                    </>
                  )}
                </p>
              )}
            </>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}

export interface QuickStatusCellProps {
  workId: string
  /** Status atual (`works.personal_status_id`), ou null quando a obra nunca foi tocada. */
  statusId: number | null
  /** `works.publication_status_id` — o outro lado da checagem de coerência. */
  publicationStatusId?: number | null
  chaptersRead?: number | null
  totalChapters?: number | null
  /** false ⇒ visitante anônimo: mostra o badge estático, sem afordância de clique. */
  canEdit: boolean
}

export function QuickStatusCell({
  workId,
  statusId,
  publicationStatusId = null,
  chaptersRead = null,
  totalChapters = null,
  canEdit,
}: QuickStatusCellProps) {
  const refresh = useRefresh()
  const { requestOpen } = useWorkStatusGate()
  const [pending, startTransition] = useTransition()
  const [current, setCurrent] = useState<number | null>(statusId)
  const [syncedProp, setSyncedProp] = useState<number | null>(statusId)

  // O servidor é a verdade: quando o revalidate chega, o otimista cede o lugar. Ajuste
  // DURANTE o render (padrão oficial do React), não em `useEffect` — o efeito repintaria a
  // tela com o valor velho antes de corrigir. Semeado com o valor inicial de propósito: com
  // `null` aqui, a comparação dispararia já na renderização de HIDRATAÇÃO.
  if (statusId !== syncedProp) {
    setSyncedProp(statusId)
    setCurrent(statusId)
  }

  if (!canEdit) {
    return (
      <div className={CELL_CLASS}>
        <span className={LABEL_CLASS}>Pessoal</span>
        <PersonalStatusBadge statusId={statusId} />
      </div>
    )
  }

  const currentName = current != null ? PERSONAL_STATUSES_BY_ID[current]?.status : null

  // "Terminei" numa obra que ainda está saindo. O selo é PERSISTENTE de propósito: o banner do
  // diálogo pode ser fechado sem decidir nada, e aí a contradição sumiria da tela mas continuaria
  // no banco. Usa `current` (o otimista), então aparece no mesmo clique que a criou.
  const issue = evaluateReadingCoherence({
    personalStatus: current,
    publicationStatusId,
    chaptersRead,
    totalChapters,
  })
  const incoherent = issue?.kind === "finished-while-publishing" ? issue : null

  const pick = (name: string) => {
    const nextId = STATUS_INFO_BY_NAME[name]?.id ?? null
    if (nextId == null || nextId === current) return
    const previous = current
    setCurrent(nextId) // otimista: o badge troca no clique, não depois do round-trip
    // Status terminal (Finished/Dropped) = leitura encerrou → abre "Meu Status" pra completar
    // nota/atributos. Dispara junto do otimista (não espera o servidor) — mesmo timing do
    // gate de capítulos em QuickChaptersCell, e a mesma lógica de reverter no erro cobre o
    // raro caso de a escrita falhar com o diálogo já aberto.
    if (isTerminalPersonalStatus(nextId)) {
      requestOpen({ personal_status: name as WorkStatusValues["personal_status"], personal_status_id: nextId })
    }
    startTransition(async () => {
      const res = await setReadingStatusForWorks([workId], name)
      if (res && "error" in res && res.error) {
        setCurrent(previous)
        toast.error("Não deu pra mudar o status", { description: res.error })
        return
      }
      toast.success(`Status: ${name}`)
      refresh()
    })
  }

  return (
    <div className={CELL_CLASS}>
      <span className={LABEL_CLASS}>Pessoal</span>
      <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="group -mx-1 flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-foreground/5"
          disabled={pending}
          aria-label="Mudar status de leitura"
          title="Mudar status de leitura"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <PersonalStatusBadge statusId={current} />
          )}
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="max-h-[min(22rem,60vh)] w-64 overflow-y-auto">
          {PERSONAL_STATUSES.map((name) => {
            const info = STATUS_INFO_BY_NAME[name]
            const active = name === currentName
            return (
              <DropdownMenuItem
                key={name}
                onSelect={() => pick(name)}
                className={cn("gap-2", active && "bg-primary/10 font-semibold")}
                title={info?.descriptionPt ?? undefined}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: info?.color ?? "var(--muted-foreground)" }}
                />
                <span aria-hidden className="w-4 shrink-0 text-center">
                  {info?.symbol}
                </span>
                <span className="min-w-0 truncate">{name}</span>
                {active && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {incoherent && (
        <button
          type="button"
          onClick={() => requestOpen()}
          aria-label="Ver aviso: obra ainda em publicação"
          title={`Obra ainda em publicação (${incoherent.publicationStatus})${
            incoherent.totalChapters ? ` — você leu ${incoherent.chaptersRead} de ${incoherent.totalChapters}` : ""
          }. Clique pra resolver.`}
          className="grid size-4 shrink-0 place-items-center rounded-full border border-amber-500/40 bg-amber-500/15 text-[10px] font-extrabold leading-none text-amber-600 transition-colors hover:bg-amber-500/25 focus-visible:outline-2 focus-visible:outline-ring dark:text-amber-400"
        >
          !
        </button>
      )}
      </div>
    </div>
  )
}

export interface QuickInterestCellProps {
  workId: string
  /** Interesse manual atual (♥..♥♥♥♥), ou null quando não avaliado. */
  value: string | null
  /** `synopsis_quality_source === "prediction_applied"` ⇒ mostra o selo ✨. */
  fromPrediction: boolean
  canEdit: boolean
}

export function QuickInterestCell({
  workId,
  value,
  fromPrediction,
  canEdit,
}: QuickInterestCellProps) {
  return (
    <div className={CELL_CLASS}>
      <span className={LABEL_CLASS}>Interesse</span>
      {canEdit ? (
        <SynopsisQualityPicker
          workId={workId}
          value={value}
          fromPrediction={fromPrediction}
          subtleClear
        />
      ) : value ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-300">
          {value}
        </span>
      ) : (
        <span
          className="font-mono text-sm font-semibold text-muted-foreground"
          title="Interesse na sinopse ainda não informado"
        >
          —
        </span>
      )}
    </div>
  )
}
