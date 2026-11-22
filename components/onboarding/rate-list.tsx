"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import { removeOnboardingWorkAction, setOnboardingStatusAction } from "@/server/actions/onboarding"
import { saveQuickScore } from "@/server/actions/quick-score"
import { RateRow } from "@/components/onboarding/rate-row"
import type { RateRowBadge } from "@/components/onboarding/rate-row"
import { UNTRACKED_PERSONAL_STATUS } from "@/lib/constants/status-lookups"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import {
  chaptersAfterStatus,
  isRateListStatus,
  LOCKED_GROUP_HINT,
  RATE_MENU_STATUSES,
  rateLock,
} from "@/lib/onboarding/rate-status"
import type { RateListWork } from "@/lib/onboarding/rate-status"
import type { PersonalStatus } from "@/types/domain"
import s from "./onboarding.module.css"

/** Uma obra da tela de notas: a obra, se veio do deck AGORA, e a etiqueta de origem. */
export interface RateListItem {
  work: RateListWork
  fresh: boolean
  badge: RateRowBadge | null
}

type RowState = { status: PersonalStatus; chapters: number | null }

/** Obra que saiu da lista nesta visita, com o que o "Desfazer" precisa para voltar. */
type Gone = { kind: "trash" | "status"; fresh: boolean; status: PersonalStatus; prev: RowState; score: number | null }

/**
 * O estado da tela de notas (boas-vindas e "Dar notas"): as notas dadas aqui, as trocas de status e
 * capítulo, e as obras que saíram pela lixeira ou pelo Want to Read.
 *
 * Duas regras que se pagam caro se forem esquecidas:
 * - **o grupo de cada obra sai do estado GRAVADO**, não do editado: obra que destrava no grupo das
 *   travadas fica no lugar até a página recarregar. Linha que pula de lugar enquanto se mexe nela
 *   faz a pessoa perder a obra de vista.
 * - **a lixeira não apaga o que já existia**: na obra marcada no deck agora ela desfaz a marcação
 *   (a obra volta ao deck); na que já estava na lista ela grava Untracked, e o ♥ de interesse, os
 *   capítulos e as datas continuam. Apagar a linha inteira levaria isso junto.
 */
export function useRateList(items: RateListItem[], logTag: string) {
  const [quick, setQuick] = useState<Map<string, number>>(new Map())
  const [edits, setEdits] = useState<Map<string, RowState>>(new Map())
  const [gone, setGone] = useState<Map<string, Gone>>(new Map())

  const stateOf = (w: RateListWork): RowState => edits.get(w.id) ?? { status: w.status, chapters: w.chaptersRead }
  const lockedNow = (w: RateListWork) => {
    const st = stateOf(w)
    return rateLock(st.status, st.chapters, w.totalChapters).locked
  }
  /** O grupo pelo estado gravado (ver o comentário acima). */
  const inLockedGroup = (w: RateListWork) => rateLock(w.status, w.chaptersRead, w.totalChapters).locked

  const live = items.filter((i) => !gone.has(i.work.id))
  const isCounted = (i: RateListItem) => quick.has(i.work.id) && !lockedNow(i.work)
  /** Notas desta tela que contam: dadas aqui, em obra que ficou na lista e com a escala liberada. */
  const counted = live.filter(isCounted).length
  /** As da lista principal ainda sem nota (o "N sem nota" do cabeçalho). */
  const withoutScore = live.filter((i) => !inLockedGroup(i.work) && !isCounted(i)).length
  /** Para o ensō (`rateCoverage`), pelo estado de AGORA: sem nota com a escala liberada, e travadas. */
  const waiting = live.filter((i) => !lockedNow(i.work) && !quick.has(i.work.id)).length
  const early = live.filter((i) => lockedNow(i.work)).length

  const log = (what: string) => (r: { ok: boolean; error?: string }) => {
    if (!r.ok) console.error(`[${logTag}] ${what}:`, r.error)
  }
  const persist = (id: string, status: PersonalStatus, chapters: number | null, score: number | null) => {
    void setOnboardingStatusAction(id, status, chapters, score).then(log("status"))
  }

  const rate = (id: string, value: number) => {
    // Efeito FORA do updater: action dentro do setState roda durante o render.
    const removing = quick.get(id) === value
    setQuick((m) => {
      const next = new Map(m)
      if (removing) next.delete(id)
      else next.set(id, value)
      return next
    })
    void saveQuickScore(id, removing ? null : value).then(log("nota"))
  }

  const setStatus = (item: RateListItem, status: PersonalStatus) => {
    const w = item.work
    const cur = stateOf(w)
    if (status === cur.status) return
    const score = quick.get(w.id) ?? null
    if (!isRateListStatus(status)) {
      // Want to Read: a obra sai da lista, com "Desfazer". O servidor tira a nota (não dá para avaliar).
      setGone((m) => new Map(m).set(w.id, { kind: "status", fresh: item.fresh, status, prev: cur, score }))
      persist(w.id, status, cur.chapters, score)
      return
    }
    const chapters = chaptersAfterStatus(status, cur.chapters, w.totalChapters)
    setEdits((m) => new Map(m).set(w.id, { status, chapters }))
    persist(w.id, status, chapters, score)
  }

  const setChapters = (item: RateListItem, chapters: number | null) => {
    const cur = stateOf(item.work)
    if (chapters === cur.chapters) return
    setEdits((m) => new Map(m).set(item.work.id, { status: cur.status, chapters }))
    persist(item.work.id, cur.status, chapters, quick.get(item.work.id) ?? null)
  }

  const trash = (item: RateListItem) => {
    const id = item.work.id
    const cur = stateOf(item.work)
    const score = quick.get(id) ?? null
    const status = item.fresh ? cur.status : UNTRACKED_PERSONAL_STATUS
    setGone((m) => new Map(m).set(id, { kind: "trash", fresh: item.fresh, status, prev: cur, score }))
    if (item.fresh) void removeOnboardingWorkAction(id).then(log("lixeira"))
    else persist(id, UNTRACKED_PERSONAL_STATUS, cur.chapters, score)
  }

  /** "Desfazer": o status, o capítulo e a nota de antes voltam, na tela e no banco. */
  const restore = (item: RateListItem) => {
    const id = item.work.id
    const g = gone.get(id)
    if (!g) return
    setGone((m) => {
      const next = new Map(m)
      next.delete(id)
      return next
    })
    setEdits((m) => new Map(m).set(id, g.prev))
    persist(id, g.prev.status, g.prev.chapters, g.score)
  }

  /** "Desfazer última" do deck: a obra some da lista sem deixar rastro aqui (o deck apaga a linha). */
  const forget = (id: string) => {
    const drop = <V,>(m: Map<string, V>) => {
      if (!m.has(id)) return m
      const next = new Map(m)
      next.delete(id)
      return next
    }
    setQuick(drop)
    setEdits(drop)
    setGone(drop)
  }

  return {
    quick,
    gone,
    counted,
    withoutScore,
    waiting,
    early,
    stateOf,
    inLockedGroup,
    isGone: (id: string) => gone.has(id),
    rate,
    setStatus,
    setChapters,
    trash,
    restore,
    forget,
  }
}

export type RateListControl = ReturnType<typeof useRateList>

const STATUS_INFO_BY_NAME = Object.fromEntries(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info]),
)

function goneText(g: Gone): string {
  if (g.kind === "status") return `agora é ${g.status} e saiu desta lista.`
  if (g.fresh) return "saiu desta lista e volta a aparecer no deck."
  return `saiu desta lista e da Minha lista (${UNTRACKED_PERSONAL_STATUS}). O ♥ de interesse e o histórico continuam guardados.`
}

/**
 * A lista de notas: as obras que dá para avaliar e, num grupo FECHADO no fim, as que ainda não dá
 * (em andamento, abaixo de 20% ou sem capítulo). Obra que saiu nesta visita vira uma linha com
 * "Desfazer" no mesmo lugar.
 */
export function RateList({
  items,
  ctl,
  empty,
  groupByStatus = false,
}: {
  items: RateListItem[]
  ctl: RateListControl
  empty: ReactNode
  /**
   * Separa a lista principal por status, na ordem do menu. O grupo sai do status GRAVADO (o de quando
   * a página abriu), como o grupo das travadas: trocar o status não tira a obra de vista.
   */
  groupByStatus?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return <>{empty}</>

  const main = items.filter((i) => !ctl.inLockedGroup(i.work))
  const locked = items.filter((i) => ctl.inLockedGroup(i.work))
  const lockedLive = locked.filter((i) => !ctl.isGone(i.work.id)).length

  const renderItem = (item: RateListItem) => {
    const g = ctl.gone.get(item.work.id)
    if (g) {
      return (
        <div key={item.work.id} className={s.gone}>
          {item.work.title} {goneText(g)}{" "}
          <button type="button" onClick={() => ctl.restore(item)}>
            Desfazer
          </button>
        </div>
      )
    }
    const st = ctl.stateOf(item.work)
    return (
      <RateRow
        key={item.work.id}
        work={item.work}
        status={st.status}
        chapters={st.chapters}
        score={ctl.quick.get(item.work.id)}
        badge={item.badge}
        onRate={(v) => ctl.rate(item.work.id, v)}
        onStatus={(next) => ctl.setStatus(item, next)}
        onChapters={(n) => ctl.setChapters(item, n)}
        onTrash={() => ctl.trash(item)}
      />
    )
  }

  const renderMain = () => {
    if (!groupByStatus) return main.map(renderItem)
    return RATE_MENU_STATUSES.map((status) => {
      const inGroup = main.filter((i) => i.work.status === status)
      if (inGroup.length === 0) return null
      const info = STATUS_INFO_BY_NAME[status]
      return (
        <section key={status} aria-label={status}>
          <div className={s.statusGroup}>
            <span style={{ color: info?.color }}>
              <span aria-hidden="true">{info?.symbol}</span> {status}
            </span>
            <span className={s.statusGroupCount}>{inGroup.filter((i) => !ctl.isGone(i.work.id)).length}</span>
          </div>
          {inGroup.map(renderItem)}
        </section>
      )
    })
  }

  return (
    <>
      {renderMain()}
      {locked.length > 0 && (
        <div className={s.group} data-open={open}>
          <button
            type="button"
            className={s.groupHead}
            aria-expanded={open}
            aria-controls="nota-em-andamento"
            onClick={() => setOpen((o) => !o)}
          >
            <svg className={s.groupTri} viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className={s.groupText}>
              <span className={s.groupTitle}>Em andamento · {lockedLive}</span>
              <span className={s.groupSub}>{LOCKED_GROUP_HINT}</span>
            </span>
          </button>
          <div id="nota-em-andamento" hidden={!open}>
            {open && locked.map(renderItem)}
          </div>
        </div>
      )}
    </>
  )
}
