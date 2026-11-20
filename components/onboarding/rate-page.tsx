"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  deckSwipeAction,
  getOnboardingDeckAction,
  removeOnboardingWorkAction,
  setOnboardingReadingAction,
} from "@/server/actions/onboarding"
import { saveQuickScore } from "@/server/actions/quick-score"
import { DeckStack, SWIPE_OUT_CLASS } from "@/components/onboarding/deck-stack"
import type { SwipeKind } from "@/components/onboarding/deck-stack"
import { DeckButtons } from "@/components/onboarding/deck-buttons"
import { RateRow } from "@/components/onboarding/rate-row"
import { EnsoRing, EnsoTitle } from "@/components/onboarding/enso"
import { ENSO_GOAL } from "@/lib/onboarding/enso"
import { readingLock } from "@/lib/onboarding/reading-lock"
import type { ReadingKind } from "@/lib/onboarding/reading-lock"
import type { OnboardingDeckWork } from "@/server/queries/onboarding-deck"
import shared from "./onboarding.module.css"
import s from "./rate-page.module.css"

type DeckStatus = "loading" | "ready" | "error"

/**
 * A página "Dar notas": à esquerda o deck das boas-vindas (as mais lidas nos gêneros que a pessoa
 * escolheu, sem o que ela já marcou); à direita o ensō e a lista "Já li, falta a nota". Marcar
 * "Já li" no deck põe a obra no topo da lista. As peças são as mesmas das boas-vindas.
 */
export function RatePage({
  lovedLabels,
  initialUnrated,
  ratedCount,
}: {
  lovedLabels: string[]
  initialUnrated: OnboardingDeckWork[]
  /** Obras com nota da pessoa ao abrir a página (as desta lista não têm). */
  ratedCount: number
}) {
  const [deckStatus, setDeckStatus] = useState<DeckStatus>("loading")
  const [deck, setDeck] = useState<OnboardingDeckWork[]>([])
  const [deckPos, setDeckPos] = useState(0)
  const [outClass, setOutClass] = useState("")
  const [stamp, setStamp] = useState<{ kind: SwipeKind; key: number } | null>(null)
  const [history, setHistory] = useState<{ work: OnboardingDeckWork; kind: SwipeKind }[]>([])
  const swiping = useRef(false)
  const [quick, setQuick] = useState<Map<string, number>>(new Map())
  const [reading, setReading] = useState<Map<string, { kind: ReadingKind; chapters: number | null }>>(new Map())
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  const loadDeck = useCallback(async () => {
    setDeckStatus("loading")
    const res = await getOnboardingDeckAction(lovedLabels)
    if (res.ok) {
      setDeck(res.works)
      setDeckPos(0)
      setHistory([])
      setDeckStatus("ready")
    } else {
      console.error("[dar notas] deck:", res.error)
      setDeckStatus("error")
    }
  }, [lovedLabels])

  useEffect(() => {
    // Carga inicial: a ação devolve o deck e o estado é gravado quando ela volta.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDeck()
  }, [loadDeck])

  const current = deck[deckPos] ?? null
  const behind = [deck[deckPos + 2], deck[deckPos + 1]]

  // A lista: o que acabou de ser marcado "Já li" (o mais novo primeiro) e depois o que já estava lido.
  const marked = useMemo(
    () =>
      history
        .filter((h) => h.kind === "read")
        .map((h) => h.work)
        .reverse(),
    [history],
  )
  const list = useMemo(() => {
    const seen = new Set(marked.map((w) => w.id))
    const rest = initialUnrated.filter((w) => !seen.has(w.id))
    return [...marked.map((w) => ({ work: w, fresh: true })), ...rest.map((w) => ({ work: w, fresh: false }))].filter(
      ({ work }) => !removed.has(work.id),
    )
  }, [marked, initialUnrated, removed])
  const readingOf = (id: string) => reading.get(id) ?? { kind: "terminei" as ReadingKind, chapters: null }
  const counted = list.filter(({ work }) => {
    if (!quick.has(work.id)) return false
    const r = readingOf(work.id)
    return !readingLock(r.kind, r.chapters, work.totalChapters).locked
  }).length
  const total = ratedCount + counted
  const lit = total >= ENSO_GOAL
  const withoutScore = list.length - counted

  const swipe = useCallback(
    (kind: SwipeKind) => {
      if (!current || swiping.current) return
      swiping.current = true
      setStamp({ kind, key: Date.now() })
      setOutClass(SWIPE_OUT_CLASS[kind])
      setHistory((h) => [...h, { work: current, kind }])
      void deckSwipeAction(current.id, kind).then((r) => {
        if (!r.ok) console.error("[dar notas] swipe:", r.error)
      })
      window.setTimeout(() => {
        setDeckPos((p) => p + 1)
        setOutClass("")
        swiping.current = false
      }, 200)
    },
    [current],
  )

  const forget = (id: string) => {
    setQuick((m) => {
      const next = new Map(m)
      next.delete(id)
      return next
    })
    setReading((m) => {
      const next = new Map(m)
      next.delete(id)
      return next
    })
  }

  const undo = () => {
    const last = history[history.length - 1]
    if (!last || swiping.current) return
    setHistory((h) => h.slice(0, -1))
    setDeckPos((p) => Math.max(0, p - 1))
    setStamp(null)
    forget(last.work.id)
    setRemoved((r) => {
      const next = new Set(r)
      next.delete(last.work.id)
      return next
    })
    void removeOnboardingWorkAction(last.work.id).then((r) => {
      if (!r.ok) console.error("[dar notas] desfazer:", r.error)
    })
  }

  // ← dispensa, ↓ já li, → quero ler — fora de campo e da sinopse aberta (as setas rolam o texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !current) return
      const alvo = e.target instanceof HTMLElement ? e.target : null
      if (alvo?.closest("input, textarea, select, button, a, [contenteditable='true'], [data-keys-own]")) return
      const kind: SwipeKind | null =
        e.key === "ArrowLeft" ? "dismiss" : e.key === "ArrowDown" ? "read" : e.key === "ArrowRight" ? "love" : null
      if (!kind) return
      e.preventDefault()
      swipe(kind)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [current, swipe])

  const rate = (id: string, value: number) => {
    const removing = quick.get(id) === value
    setQuick((m) => {
      const next = new Map(m)
      if (removing) next.delete(id)
      else next.set(id, value)
      return next
    })
    void saveQuickScore(id, removing ? null : value).then((r) => {
      if (!r.ok) console.error("[dar notas] nota:", r.error)
    })
  }
  const changeReading = (id: string, kind: ReadingKind, chapters: number | null) => {
    setReading((m) => new Map(m).set(id, { kind, chapters }))
    void setOnboardingReadingAction(id, kind, chapters, quick.get(id) ?? null).then((r) => {
      if (!r.ok) console.error("[dar notas] leitura:", r.error)
    })
  }
  const removeWork = (id: string) => {
    setRemoved((r) => new Set(r).add(id))
    forget(id)
    void removeOnboardingWorkAction(id).then((r) => {
      if (!r.ok) console.error("[dar notas] remover:", r.error)
    })
  }

  const loved = history.filter((h) => h.kind === "love").length
  const dismissed = history.filter((h) => h.kind === "dismiss").length

  return (
    <div className={s.page}>
      <Link href="/" className={s.back}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Início
      </Link>
      <p className={s.eyebrow}>Dar notas</p>
      <h1 className={s.title}>Dar notas ao que você já leu</h1>
      <p className={s.sub}>
        O mesmo deck das boas-vindas, com as obras mais lidas nos gêneros que você escolheu. <b>“Quero ler”</b>{" "}
        guarda o que te interessa.
      </p>

      {lit && (
        <div className={`${shared.glass} ${s.ready}`}>
          <div className={s.readyText}>
            <div className={s.readyTitle}>A Nota Prevista ligou.</div>
            <div className={s.muted}>
              O Ranking e o “Pra você hoje” passam a ordenar pelo seu gosto. Mais notas continuam deixando a
              previsão mais precisa.
            </div>
          </div>
          <Link href="/ranking" className={s.cta}>
            Ver o ranking →
          </Link>
        </div>
      )}

      <div className={s.layout}>
        <section aria-labelledby="dn-deck" className={s.deckCol}>
          <h2 id="dn-deck" className={s.h2}>
            Você leu alguma destas?
          </h2>
          <p className={s.muted}>Marque as que você já leu, inteiras ou em parte: elas recebem nota na lista ao lado.</p>
          {current && (
            <p className={s.counter}>
              obra {deckPos + 1} de {deck.length}
            </p>
          )}
          {deckStatus === "loading" ? (
            <p className={s.counter}>montando o deck…</p>
          ) : deckStatus === "error" ? (
            <div className={`${shared.glass} ${s.note}`}>
              <p>
                Não consegui montar o deck agora.{" "}
                <button type="button" className={s.inlineButton} onClick={() => void loadDeck()}>
                  Tentar de novo
                </button>
              </p>
            </div>
          ) : current ? (
            <DeckStack current={current} behind={behind} outClass={outClass} stamp={stamp} titleAs="h3" />
          ) : (
            <div className={`${shared.glass} ${s.note}`}>
              <p className={s.noteTitle}>Acabaram as sugestões</p>
              <p>
                {marked.length} já lidas, {loved} quero ler, {dismissed} dispensadas.{" "}
                <button type="button" className={s.inlineButton} onClick={() => void loadDeck()}>
                  Mostrar mais obras
                </button>
              </p>
            </div>
          )}
          {deckStatus === "ready" && deck.length > 0 && (
            <DeckButtons onSwipe={swipe} onUndo={undo} canUndo={history.length > 0} />
          )}
        </section>

        <div className={s.rightCol}>
          <aside aria-label="Progresso da Nota Prevista" className={`${shared.glass} ${s.enso}`}>
            <EnsoRing rated={total} withNumber />
            <div className={s.ensoText}>
              <EnsoTitle align="start" />
              <p className={s.muted}>
                {lit
                  ? "Fechado: a Nota Prevista está ligada. Cada nota a mais deixa a previsão mais precisa."
                  : `Faltam ${ENSO_GOAL - total}. Até os ${ENSO_GOAL}, o Alinhamento (as tags que você escolheu) ordena suas listas.`}
              </p>
            </div>
          </aside>

          <section aria-labelledby="dn-lidas" className={`${shared.glass} ${s.list}`}>
            <div className={s.listHead}>
              <h2 id="dn-lidas" className={s.listTitle}>
                Já li, falta a nota
              </h2>
              <span className={s.listCount}>
                {list.length === 0 ? "0" : withoutScore === 0 ? "todas com nota" : `${withoutScore} sem nota`}
              </span>
            </div>
            {list.length === 0 ? (
              <p className={s.empty}>
                Nada por enquanto. Marque <b>“Já li”</b> nas obras do deck que você conhece. Obra que você marcar como
                lida em qualquer lugar do app também aparece aqui.
              </p>
            ) : (
              list.map(({ work, fresh }) => {
                const r = readingOf(work.id)
                return (
                  <RateRow
                    key={work.id}
                    work={work}
                    score={quick.get(work.id)}
                    kind={r.kind}
                    chapters={r.chapters}
                    badge={fresh ? { kind: "fresh", label: "DO DECK, AGORA" } : null}
                    onRate={(v) => rate(work.id, v)}
                    onReading={(kind, chapters) => changeReading(work.id, kind, chapters)}
                    onRemove={() => removeWork(work.id)}
                  />
                )
              })
            )}
          </section>

          <p className={s.importLine}>
            Tem lista em outro site? <Link href="/import">Importar</Link> — as obras chegam com nota e já contam no ensō.
          </p>
        </div>
      </div>
    </div>
  )
}
