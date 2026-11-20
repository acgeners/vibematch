"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { setHideAdultContent, setHideAvoidedTags } from "@/server/actions/settings"
import {
  saveOnboardingTastes,
  getOnboardingDeckAction,
  deckSwipeAction,
  getOnboardingProgressAction,
  getWelcomeImportStateAction,
  setOnboardingReadingAction,
  removeOnboardingWorkAction,
  searchOnboardingTagsAction,
} from "@/server/actions/onboarding"
import type { OnboardingTagHit } from "@/server/actions/onboarding"
import { saveQuickScore } from "@/server/actions/quick-score"
import { ExternalListImport } from "@/components/import/external-list-import"
import type { ImportMethod } from "@/components/import/external-list-import"
import { CoverImage } from "@/components/ui/cover-image"
import { LogoMark } from "@/components/ui/logo-mark"
import { DeckStack, SWIPE_OUT_CLASS } from "@/components/onboarding/deck-stack"
import type { SwipeKind } from "@/components/onboarding/deck-stack"
import { DeckButtons } from "@/components/onboarding/deck-buttons"
import { RateRow } from "@/components/onboarding/rate-row"
import { EnsoRing, EnsoTitle } from "@/components/onboarding/enso"
import { LOVED_CHIPS, VETO_CHIPS, MIN_LOVED } from "@/lib/onboarding/chips"
import { ENSO_GOAL } from "@/lib/onboarding/enso"
import { readingLock } from "@/lib/onboarding/reading-lock"
import type { ReadingKind } from "@/lib/onboarding/reading-lock"
import { AGE_CONFIRM } from "@/lib/onboarding/age-confirm"
import type { ExternalListSource } from "@/lib/import/external-list/types"
import type { OnboardingDeckWork } from "@/server/queries/onboarding-deck"
import type { WelcomeCover } from "@/server/queries/welcome-covers"
import styles from "./welcome.module.css"

const STEP_NAMES = ["Boas-vindas", "Catálogo", "Gosto", "Lista", "Deck", "Notas", "Pronto"]
const TOTAL_STEPS = STEP_NAMES.length
const STEP = { welcome: 0, adult: 1, tastes: 2, list: 3, deck: 4, notes: 5, done: 6 } as const
/** O kanji só aparece onde nada passa por cima dele (decidido no mockup de 19/11/2026). */
const KANJI_STEPS = new Set<number>([STEP.welcome, STEP.done])

// Partículas com semente fixa: o mesmo desenho no servidor e no navegador (sem quebrar a hidratação).
const PARTICLES = (() => {
  let s = 7
  const r = () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
  return Array.from({ length: 46 }, () => {
    const size = `${(1 + r() * 2.2).toFixed(1)}px`
    return {
      left: `${(r() * 100).toFixed(1)}%`,
      top: `${(r() * 100).toFixed(1)}%`,
      size,
      delay: `${(r() * -9).toFixed(1)}s`,
      duration: `${(6 + r() * 8).toFixed(1)}s`,
    }
  })
})()

/** Leque da 1ª tela, em % da caixa (640 × 330 no mockup): encolhe junto em tela estreita. */
const FAN = [
  { cover: 3, left: "0%", top: "17.6%", width: "21.9%", rotate: -11, z: 1, delay: "-1s" },
  { cover: 1, left: "15%", top: "9.1%", width: "25.6%", rotate: -5, z: 2, delay: "-3s" },
  { cover: 0, left: "34.4%", top: "0%", width: "31.25%", rotate: 0, z: 3, delay: "-5s" },
  { cover: 2, left: "59.4%", top: "9.1%", width: "25.6%", rotate: 5, z: 2, delay: "-2s" },
  { cover: 4, left: "78.1%", top: "17.6%", width: "21.9%", rotate: 11, z: 1, delay: "-4s" },
]

/** Blocos de cor de antes: os exemplos da tela de conforto quando não há capa. */
const SHELF_COLORS = [
  "linear-gradient(155deg,#3E5C9A,#8E5FA8)",
  "linear-gradient(155deg,#2F6B63,#5FA88C)",
  "linear-gradient(155deg,#41537E,#7A9BD6)",
]

interface SourceTile {
  id: string
  name: string
  mark: string
  color: string
  how: string
  method: ImportMethod
  source?: ExternalListSource
}
const SOURCE_TILES: SourceTile[] = [
  { id: "anilist", name: "AniList", mark: "AL", color: "#2b6cd6", how: "pelo seu nome de usuário", method: "anilist" },
  { id: "mal", name: "MyAnimeList", mark: "MAL", color: "#2e51a2", how: "arquivo exportado (.json)", method: "file", source: "myanimelist" },
  { id: "mu", name: "MangaUpdates", mark: "MU", color: "#b5651d", how: "arquivo exportado (.json)", method: "file", source: "mangaupdates" },
  { id: "ap", name: "Anime-Planet", mark: "AP", color: "#c2410c", how: "arquivo exportado (.xml.gz)", method: "file", source: "animeplanet" },
  { id: "titles", name: "Colar títulos", mark: "Aa", color: "#475569", how: "um título por linha", method: "titles" },
]

type DeckStatus = "idle" | "loading" | "ready" | "error"

/** O que a lista importada nesta visita trouxe (`getWelcomeImportStateAction`). */
interface ImportState {
  ratedCount: number
  importedRatedCount: number
  unrated: OnboardingDeckWork[]
  sourceLabel: string | null
}

/** Algum chip vira preferência de tag? Só aí as listas ordenam pelo Alinhamento antes das 20 notas. */
function declaresTags(loved: Iterable<string>, vetos: Iterable<string>): boolean {
  if ([...vetos].length > 0) return true
  const withTag = new Set(LOVED_CHIPS.filter((c) => c.tag).map((c) => c.label))
  return [...loved].some((l) => withTag.has(l))
}

export function WelcomeFlow({
  displayName,
  initialLoved,
  initialVetos,
  initialHideAdult,
  initialHideAvoided,
  covers = [],
  adultCover = null,
  startedAt,
}: {
  displayName: string | null
  /** Os chips como estão gravados (quem volta às boas-vindas). */
  initialLoved: string[]
  initialVetos: string[]
  /** `null` = nunca escolheu. */
  initialHideAdult: boolean | null
  /** "Esconder as obras com tags que evito" como está gravado (migration 227). */
  initialHideAvoided: boolean
  /** Capas das obras mais votadas, não adultas (`getWelcomeCovers`). */
  covers?: WelcomeCover[]
  /** A obra adulta mais votada, para o exemplo 18+ (borrada até confirmar a idade). */
  adultCover?: WelcomeCover | null
  /** Hora do servidor em que a página abriu: o que a lista importada gravar depois é "desta vez". */
  startedAt: string
}) {
  const router = useRouter()
  const [step, setStep] = useState<number>(STEP.welcome)
  const [busy, setBusy] = useState(false)

  // tela 2 — "Ocultar" vem marcado: ver conteúdo adulto exige escolher "Mostrar tudo" e confirmar a idade.
  const [hideAdult, setHideAdult] = useState<boolean>(initialHideAdult ?? true)
  const [ageOk, setAgeOk] = useState(initialHideAdult === false)
  const [askAge, setAskAge] = useState(false)
  // tela 3
  const [loved, setLoved] = useState<Set<string>>(() => new Set(initialLoved))
  const [vetos, setVetos] = useState<Set<string>>(() => new Set(initialVetos))
  // Escolha EXPLÍCITA da pessoa: nada liga sozinho por ela ter vetado algo.
  const [hideAvoided, setHideAvoided] = useState(initialHideAvoided)
  const savedHideAvoided = useRef(initialHideAvoided)
  // Tags achadas em "Procurar outras tags" (nomes em inglês), com a stance escolhida.
  const [extras, setExtras] = useState<Map<string, OnboardingTagHit & { stance: "love" | "avoid" }>>(new Map())
  const [tagQuery, setTagQuery] = useState("")
  const [tagHits, setTagHits] = useState<OnboardingTagHit[] | null>(null)
  const hasVeto = vetos.size > 0 || Array.from(extras.values()).some((e) => e.stance === "avoid")
  // O que está GRAVADO decide a ordem das listas — não o que está marcado na tela e foi pulado.
  const [declared, setDeclared] = useState(() => declaresTags(initialLoved, initialVetos))
  // tela 4 — a lista vem ANTES do deck: o deck pula o que ela trouxe
  const [tile, setTile] = useState<SourceTile | null>(null)
  const [imported, setImported] = useState<ImportState | null>(null)
  // tela 5
  const [deckStatus, setDeckStatus] = useState<DeckStatus>("idle")
  const [deck, setDeck] = useState<OnboardingDeckWork[]>([])
  const [deckPos, setDeckPos] = useState(0)
  const [outClass, setOutClass] = useState("")
  const [stamp, setStamp] = useState<{ kind: SwipeKind; key: number } | null>(null)
  // O que o "Desfazer última" volta, carta por carta.
  const [history, setHistory] = useState<{ work: OnboardingDeckWork; kind: SwipeKind }[]>([])
  const swiping = useRef(false)
  // tela 6
  const [baseRated, setBaseRated] = useState(0)
  const [quick, setQuick] = useState<Map<string, number>>(new Map())
  const [reading, setReading] = useState<Map<string, { kind: ReadingKind; chapters: number | null }>>(new Map())
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [confirmFew, setConfirmFew] = useState(false)

  const first = displayName?.trim().split(/\s+/)[0] ?? null
  const goTo = useCallback((i: number) => setStep(Math.max(0, Math.min(TOTAL_STEPS - 1, i))), [])

  // As lidas da tela de notas: as marcadas no deck (frescas na memória) e depois as que a lista trouxe sem nota.
  const deckRead = useMemo(
    () => history.filter((h) => h.kind === "read" && !removed.has(h.work.id)).map((h) => h.work),
    [history, removed],
  )
  const toRate = useMemo(() => {
    const seen = new Set(deckRead.map((w) => w.id))
    const fromList = (imported?.unrated ?? []).filter((w) => !seen.has(w.id) && !removed.has(w.id))
    return [...deckRead.map((w) => ({ work: w, fromList: false })), ...fromList.map((w) => ({ work: w, fromList: true }))]
  }, [deckRead, imported, removed])
  const readingOf = (id: string) => reading.get(id) ?? { kind: "terminei" as ReadingKind, chapters: null }
  // Nota que conta: dada aqui e não travada (a travada fica guardada só na tela, para voltar se liberar).
  const countedHere = toRate.filter(({ work }) => {
    if (!quick.has(work.id)) return false
    const r = readingOf(work.id)
    return !readingLock(r.kind, r.chapters, work.totalChapters).locked
  }).length
  const ratedTotal = baseRated + countedHere
  const lit = ratedTotal >= ENSO_GOAL
  // Placar do deck: "já lidas" = as que já têm nota + as que a lista trouxe sem nota + as marcadas no deck.
  const readSoFar = (imported?.ratedCount ?? 0) + (imported?.unrated.length ?? 0) + deckRead.length
  const importedTotal = (imported?.importedRatedCount ?? 0) + (imported?.unrated.length ?? 0)
  const fromListLabel = imported?.sourceLabel ? `da sua lista do ${imported.sourceLabel}` : "da sua lista"

  // ── transições que gravam ─────────────────────────────────────────────
  const leaveAdult = async () => {
    setBusy(true)
    try {
      const res = await setHideAdultContent(hideAdult)
      if (res.error) console.error("[bem-vindo] conteúdo adulto:", res.error)
      goTo(STEP.tastes)
    } finally {
      setBusy(false)
    }
  }

  const leaveTastes = async () => {
    setBusy(true)
    try {
      const save = await saveOnboardingTastes(
        Array.from(loved),
        Array.from(vetos),
        Array.from(extras.values()).map((e) => ({ tagId: e.id, stance: e.stance })),
      )
      if (!save.ok) console.error("[bem-vindo] gostos:", save.error)
      else setDeclared(declaresTags(loved, vetos) || extras.size > 0)
      // Só com veto marcado: a escolha só aparece na tela nesse caso, e o que não se viu não se grava.
      if (hasVeto && hideAvoided !== savedHideAvoided.current) {
        const pref = await setHideAvoidedTags(hideAvoided)
        if (pref.error) console.error("[bem-vindo] esconder evitadas:", pref.error)
        else savedHideAvoided.current = hideAvoided
      }
      goTo(STEP.list)
    } finally {
      setBusy(false)
    }
  }

  // O deck é montado ao SAIR da lista: o que ela trouxe já tem estado, e o deck só oferece obra sem estado.
  const loadDeck = async () => {
    setDeckStatus("loading")
    const res = await getOnboardingDeckAction(Array.from(loved))
    if (res.ok) {
      setDeck(res.works)
      setDeckPos(0)
      setHistory([])
      setDeckStatus("ready")
    } else {
      console.error("[bem-vindo] deck:", res.error)
      setDeckStatus("error")
    }
  }

  const leaveList = async () => {
    setBusy(true)
    try {
      const res = await getWelcomeImportStateAction(startedAt)
      if (res.ok) {
        setImported({
          ratedCount: res.ratedCount,
          importedRatedCount: res.importedRatedCount,
          unrated: res.unrated,
          sourceLabel: res.sourceLabel,
        })
      } else console.error("[bem-vindo] lista:", res.error)
      goTo(STEP.deck)
      await loadDeck()
    } finally {
      setBusy(false)
    }
  }

  const enterNotes = async () => {
    // Sem obra para avaliar, a tela de notas estaria vazia: segue direto para o fim.
    if (toRate.length === 0) {
      goTo(STEP.done)
      return
    }
    setBusy(true)
    try {
      // As notas desta tela entram no medidor por `quick`: o servidor conta só as OUTRAS, senão
      // voltar aqui (ou "Rever o fluxo") somava duas vezes as já dadas.
      const res = await getOnboardingProgressAction(Array.from(quick.keys()))
      if (res.ok) setBaseRated(res.ratedCount)
      goTo(STEP.notes)
    } finally {
      setBusy(false)
    }
  }

  // ── deck ──────────────────────────────────────────────────────────────
  const current = deck[deckPos] ?? null
  const behind = [deck[deckPos + 2], deck[deckPos + 1]]

  const swipe = useCallback(
    (kind: SwipeKind) => {
      if (!current || swiping.current) return
      swiping.current = true
      setStamp({ kind, key: Date.now() })
      setOutClass(SWIPE_OUT_CLASS[kind])
      setHistory((h) => [...h, { work: current, kind }])
      void deckSwipeAction(current.id, kind).then((r) => {
        if (!r.ok) console.error("[bem-vindo] swipe:", r.error)
      })
      window.setTimeout(() => {
        setDeckPos((p) => p + 1)
        setOutClass("")
        swiping.current = false
      }, 200)
    },
    [current],
  )

  // "Desfazer última": a carta volta e a marcação sai do banco (a linha inteira, como antes do toque).
  const undo = () => {
    const last = history[history.length - 1]
    if (!last || swiping.current) return
    setHistory((h) => h.slice(0, -1))
    setDeckPos((p) => Math.max(0, p - 1))
    setStamp(null)
    setQuick((m) => {
      const next = new Map(m)
      next.delete(last.work.id)
      return next
    })
    setReading((m) => {
      const next = new Map(m)
      next.delete(last.work.id)
      return next
    })
    setRemoved((r) => {
      const next = new Set(r)
      next.delete(last.work.id)
      return next
    })
    void removeOnboardingWorkAction(last.work.id).then((r) => {
      if (!r.ok) console.error("[bem-vindo] desfazer:", r.error)
    })
  }

  // Teclado: Enter começa; no deck, ← dispensa, ↓ já li, → quero ler. Fora de campo de texto,
  // de botão em foco (Enter ali já é o clique dele) e da sinopse aberta (as setas rolam o texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const alvo = e.target instanceof HTMLElement ? e.target : null
      if (alvo?.closest("input, textarea, select, [contenteditable='true'], [data-keys-own]")) return
      if (step === STEP.welcome && e.key === "Enter" && !alvo?.closest("button, a")) {
        e.preventDefault()
        goTo(STEP.adult)
        return
      }
      if (step !== STEP.deck || !current) return
      const kind: SwipeKind | null =
        e.key === "ArrowLeft" ? "dismiss" : e.key === "ArrowDown" ? "read" : e.key === "ArrowRight" ? "love" : null
      if (!kind) return
      e.preventDefault()
      swipe(kind)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [step, current, swipe, goTo])

  // ── tela de notas ─────────────────────────────────────────────────────
  const rate = (workId: string, value: number) => {
    // Efeito FORA do updater: action dentro do setState roda durante o render e o
    // React reclama ("Cannot update Router while rendering WelcomeFlow").
    const removing = quick.get(workId) === value
    setQuick((m) => {
      const next = new Map(m)
      if (removing) next.delete(workId)
      else next.set(workId, value)
      return next
    })
    void saveQuickScore(workId, removing ? null : value).then((r) => {
      if (!r.ok) console.error("[bem-vindo] nota:", r.error)
    })
  }

  // O servidor reaplica a nota depois de trocar o status: travada sai do banco, liberada volta.
  const changeReading = (workId: string, kind: ReadingKind, chapters: number | null) => {
    setReading((m) => new Map(m).set(workId, { kind, chapters }))
    void setOnboardingReadingAction(workId, kind, chapters, quick.get(workId) ?? null).then((r) => {
      if (!r.ok) console.error("[bem-vindo] leitura:", r.error)
    })
  }

  const removeWork = (workId: string) => {
    setRemoved((r) => new Set(r).add(workId))
    setQuick((m) => {
      const next = new Map(m)
      next.delete(workId)
      return next
    })
    void removeOnboardingWorkAction(workId).then((r) => {
      if (!r.ok) console.error("[bem-vindo] remover:", r.error)
    })
  }

  const finishNotes = () => {
    if (!lit) setConfirmFew(true)
    else goTo(STEP.done)
  }

  const lovedList = useMemo(() => Array.from(loved), [loved])
  const vetoList = useMemo(() => Array.from(vetos), [vetos])
  const lovedCount = history.filter((h) => h.kind === "love").length
  const dismissedCount = history.filter((h) => h.kind === "dismiss").length

  const markExtra = (hit: OnboardingTagHit, stance: "love" | "avoid") => {
    setExtras((m) => {
      const next = new Map(m)
      if (next.get(hit.id)?.stance === stance) next.delete(hit.id)
      else next.set(hit.id, { ...hit, stance })
      return next
    })
  }

  // Busca com espera curta: uma consulta por pausa na digitação, não por tecla.
  useEffect(() => {
    const q = tagQuery.trim()
    if (q.length < 2) return
    let alive = true
    const t = window.setTimeout(() => {
      void searchOnboardingTagsAction(q).then((r) => {
        if (!alive) return
        if (r.ok) setTagHits(r.tags)
        else console.error("[bem-vindo] busca de tags:", r.error)
      })
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [tagQuery])

  // Com menos de 2 letras não há busca: a lista some (o resultado anterior não vale para o termo de agora).
  const visibleHits = tagQuery.trim().length >= 2 ? tagHits : null

  const toggle = (set: Set<string>, apply: (s: Set<string>) => void, v: string) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    apply(next)
  }

  // Botão "pular" do topo, com o que ele faz em cada tela. Sem ele na tela 2 (pular ali era mostrar
  // tudo sem a pessoa ter escolhido) e onde o rodapé já tem a saída (lista, deck, notas).
  const skip: { label: string; run: () => void } | null =
    step === STEP.welcome
      ? { label: "Pular por agora", run: () => router.push("/") }
      : step === STEP.tastes
        ? { label: "Pular", run: () => goTo(STEP.list) }
        : null

  const choices = loved.size + vetos.size + extras.size
  const stripCovers = covers.length >= 3 ? [covers[0], covers[1], covers[2]] : null

  // O rodapé de cada tela: o botão de seguir fica no MESMO lugar em todas (menos a última, que tem os
  // destinos dela). Quando seguir pula algo, o botão e o selo acima dele dizem o quê — sem bloquear.
  const nothingToRate = toRate.length === 0
  const footer: {
    primary: string
    run: () => void
    disabled?: boolean
    secondary?: { label: string; run: () => void }
    note?: string
  } | null =
    step === STEP.welcome
      ? { primary: "Começar →", run: () => goTo(STEP.adult) }
      : step === STEP.adult
        ? { primary: "Continuar →", run: () => void leaveAdult() }
        : step === STEP.tastes
          ? {
              primary: loved.size >= MIN_LOVED ? `Continuar com ${choices} escolhas →` : "Continuar →",
              run: () => void leaveTastes(),
              disabled: loved.size < MIN_LOVED,
            }
          : step === STEP.list
            ? {
                primary: "Continuar →",
                run: () => void leaveList(),
                secondary: { label: "Não tenho lista", run: () => void leaveList() },
              }
            : step === STEP.deck
              ? nothingToRate
                ? {
                    primary: "Seguir sem marcar nenhuma →",
                    run: () => void enterNotes(),
                    note:
                      readSoFar >= ENSO_GOAL
                        ? "Nenhuma obra para avaliar agora."
                        : "Sem obras lidas, a Nota Prevista começa desligada.",
                  }
                : { primary: "Já marquei o bastante →", run: () => void enterNotes() }
              : step === STEP.notes
                ? countedHere === 0
                  ? {
                      primary: "Concluir sem notas →",
                      run: finishNotes,
                      note: lit
                        ? "Dá para avaliar depois, em cada obra."
                        : "Sem notas, a Nota Prevista começa desligada. Dá para avaliar depois.",
                    }
                  : { primary: "Concluir →", run: finishNotes }
                : null

  // Com conteúdo adulto, o exemplo ganha uma 4ª capa marcada 18+, borrada até a pessoa confirmar a idade;
  // sem ele, ficam só as 3 obras, como a pessoa vai ver de fato (nada de buraco no lugar da que saiu).
  const renderStrip = (withAdult: boolean) => (
    <span className={styles.strip} aria-hidden="true">
      {(withAdult ? [0, 1, "slot", 2] : [0, 1, 2]).map((k) =>
        k === "slot" ? (
          <span key="slot" className={`${styles.stripCover} ${styles.stripAdult}`}>
            {adultCover && (
              <span className={styles.stripAdultArt} data-blur={!ageOk}>
                <CoverImage urls={adultCover.coverUrls} className="size-full object-cover" />
              </span>
            )}
            <span className={styles.badge18}>18+</span>
          </span>
        ) : (
          <span
            key={k}
            className={styles.stripCover}
            style={stripCovers ? undefined : { background: SHELF_COLORS[k as number] }}
          >
            {stripCovers && <CoverImage urls={stripCovers[k as number].coverUrls} className="size-full object-cover" />}
          </span>
        ),
      )}
    </span>
  )

  const chooseAdult = (hide: boolean) => {
    // "Mostrar tudo" pede a idade antes (uma vez só): até confirmar, nada é escolhido.
    if (!hide && !ageOk) {
      setAskAge(true)
      return
    }
    setHideAdult(hide)
  }

  return (
    <div className={styles.page}>
      <div className={styles.sky} aria-hidden="true">
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className={styles.particle}
            style={{
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              animationDelay: p.delay,
              animationDuration: p.duration,
            }}
          />
        ))}
        {KANJI_STEPS.has(step) && <span className={styles.kanji}>悟</span>}
      </div>

      <header className={styles.top}>
        <div>
          {step > 0 && (
            <button type="button" className={styles.back} onClick={() => goTo(step - 1)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Voltar
            </button>
          )}
        </div>
        <nav aria-label={`Passo ${step + 1} de ${TOTAL_STEPS}`} className={`${styles.glass} ${styles.progress}`}>
          {STEP_NAMES.map((name, i) =>
            // Só os passos de TRÁS são clicáveis: ir para a frente pela barra pularia o que grava
            // (a escolha de 18+, os gostos, a lista, o deck).
            i < step ? (
              <button
                key={name}
                type="button"
                className={`${styles.seg} ${styles.segDone}`}
                aria-label={`Ir para o passo ${i + 1}: ${name}`}
                onClick={() => goTo(i)}
              />
            ) : (
              <span
                key={name}
                className={`${styles.seg} ${i === step ? styles.segNow : ""}`}
                aria-current={i === step ? "step" : undefined}
              />
            ),
          )}
        </nav>
        <div className={styles.topEnd}>
          {skip && (
            <button type="button" className={`${styles.glass} ${styles.skip}`} onClick={skip.run}>
              {skip.label}
            </button>
          )}
        </div>
      </header>

      <main className={styles.main}>
        {/* ── 1 · boas-vindas ── */}
        {step === STEP.welcome && (
          <section className={styles.step} style={{ paddingTop: 6 }}>
            {covers.length > 0 && (
              <div className={styles.fan} aria-hidden="true">
                <div className={styles.fanGlow} />
                {FAN.filter((f) => covers[f.cover]).map((f) => (
                  <span
                    key={f.cover}
                    className={styles.fanSlot}
                    style={{ left: f.left, top: f.top, width: f.width, zIndex: f.z, transform: `rotate(${f.rotate}deg)` }}
                  >
                    <span className={styles.fanCover} style={{ animationDelay: f.delay }}>
                      <CoverImage urls={covers[f.cover].coverUrls} className="size-full object-cover" loading="eager" />
                    </span>
                  </span>
                ))}
              </div>
            )}
            <span className={styles.lotus}>
              <LogoMark tile={false} className="size-16" />
            </span>
            <p className={styles.eyebrow} style={{ marginTop: 14 }}>
              {first ? `Boas-vindas, ${first}` : "Boas-vindas"}
            </p>
            <h1 className={`${styles.title} ${styles.titleXl} ${styles.welcomeTitle}`}>
              Seu próximo favorito já existe.
              <br />
              <span className={styles.grad}>Vamos encontrá-lo.</span>
            </h1>
            <p className={`${styles.sub} ${styles.welcomeSub}`}>
              A SatorIA recomenda pelo <em>seu</em> gosto, não pela média da multidão. Um minuto e meio, e
              ela já começa a te conhecer.
            </p>
          </section>
        )}

        {/* ── 2 · conteúdo adulto ── */}
        {step === STEP.adult && (
          <section className={styles.step} style={{ paddingTop: 40 }}>
            <p className={styles.eyebrow}>Seu catálogo</p>
            <h1 className={styles.title}>Quer ver obras com conteúdo adulto?</h1>
            <p className={styles.sub}>
              Isso decide o que aparece nas próximas telas. Dá para mudar quando quiser em Preferências.
            </p>
            <div className={styles.options} data-chosen>
              {(
                [
                  {
                    hide: false,
                    title: "Mostrar tudo",
                    text: "O catálogo inteiro, sem filtro. Obras com conteúdo adulto aparecem marcadas com 18+.",
                  },
                  {
                    hide: true,
                    title: "Ocultar obras com conteúdo adulto",
                    text: "Elas somem das listas, da busca e das recomendações.",
                  },
                ] as const
              ).map((o) => (
                <button
                  key={o.title}
                  type="button"
                  className={`${styles.glass} ${styles.option}`}
                  aria-pressed={hideAdult === o.hide}
                  onClick={() => chooseAdult(o.hide)}
                >
                  <span className={styles.radio} aria-hidden="true">
                    {hideAdult === o.hide && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#04101f" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                  {renderStrip(!o.hide)}
                  <span className={styles.optionTitle}>{o.title}</span>
                  <span className={styles.optionText}>{o.text}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── 3 · gostos ── */}
        {step === STEP.tastes && (
          <section className={styles.step} style={{ paddingTop: 30 }}>
            <p className={styles.eyebrow}>Seu gosto</p>
            <h1 className={styles.title}>O que você ama — e o que te faz largar?</h1>
            <p className={styles.sub}>
              Escolha pelo menos três; o resto a IA aprende sozinha. Isso já muda a ordem das suas listas,
              antes de qualquer nota.
            </p>
            <div className={styles.panels}>
              <div className={`${styles.glass} ${styles.panel}`}>
                <div className={styles.panelHead}>
                  <span className={styles.panelLove}>Eu amo</span>
                  <span className={styles.panelWhy}>escolha pelo menos três</span>
                </div>
                <div className={styles.chips}>
                  {LOVED_CHIPS.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      className={styles.chip}
                      aria-pressed={loved.has(c.label)}
                      onClick={() => toggle(loved, setLoved, c.label)}
                    >
                      {c.label}
                    </button>
                  ))}
                  {Array.from(extras.values())
                    .filter((e) => e.stance === "love")
                    .map((e) => (
                      <button key={e.id} type="button" className={styles.chipExtra} aria-label={`Tirar ${e.name}`} onClick={() => markExtra(e, "love")}>
                        ♥ {e.name} <span aria-hidden="true">×</span>
                      </button>
                    ))}
                </div>
              </div>
              <div className={`${styles.glass} ${styles.panel}`}>
                <div className={styles.panelHead}>
                  <span className={styles.panelVeto}>Eu evito</span>
                  <span className={styles.panelWhy}>opcional · saem do deck logo adiante</span>
                </div>
                <div className={styles.chips}>
                  {VETO_CHIPS.map((v) => (
                    <button
                      key={v.label}
                      type="button"
                      className={`${styles.chip} ${styles.chipVeto}`}
                      aria-pressed={vetos.has(v.label)}
                      onClick={() => toggle(vetos, setVetos, v.label)}
                    >
                      {v.label}
                    </button>
                  ))}
                  {Array.from(extras.values())
                    .filter((e) => e.stance === "avoid")
                    .map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        className={`${styles.chipExtra} ${styles.chipExtraVeto}`}
                        aria-label={`Tirar ${e.name}`}
                        onClick={() => markExtra(e, "avoid")}
                      >
                        ⊘ {e.name} <span aria-hidden="true">×</span>
                      </button>
                    ))}
                </div>
                {hasVeto && (
                  <div className={styles.vetoChoice}>
                    <span id="bv-esconder" className={styles.vetoChoiceLabel}>
                      Nas suas listas, obras com essas tags:
                    </span>
                    <div className={styles.chips} role="group" aria-labelledby="bv-esconder">
                      <button type="button" className={styles.chip} aria-pressed={!hideAvoided} onClick={() => setHideAvoided(false)}>
                        aparecem, mais abaixo
                      </button>
                      <button
                        type="button"
                        className={`${styles.chip} ${styles.chipVeto}`}
                        aria-pressed={hideAvoided}
                        onClick={() => setHideAvoided(true)}
                      >
                        ficam escondidas
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* Busca de outras tags: o campo fica sempre à vista; a lista só aparece enquanto se digita. */}
            <div className={`${styles.glass} ${styles.tagSearch}`}>
              <div className={styles.tagSearchField}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8fdbff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="16.5" y1="16.5" x2="21" y2="21" />
                </svg>
                {/* `type="text"`: com "search" o navegador desenha um × próprio ao lado do nosso. */}
                <input
                  type="text"
                  enterKeyHint="search"
                  aria-label="Procurar outras tags"
                  placeholder="Procurar outras tags, em inglês: Villainess, Regression, Childcare…"
                  autoComplete="off"
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                />
                {tagQuery && (
                  <button type="button" className={styles.tagSearchClear} aria-label="Limpar a busca" onClick={() => setTagQuery("")}>
                    ×
                  </button>
                )}
              </div>
              {visibleHits && visibleHits.length === 0 && <p className={styles.tagSearchNone}>Nenhuma tag com esse nome.</p>}
              {visibleHits && visibleHits.length > 0 && (
                <div className={styles.tagSearchList}>
                  {visibleHits.map((t) => {
                    const stance = extras.get(t.id)?.stance
                    return (
                      <div key={t.id} className={styles.tagSearchRow}>
                        <span className={styles.tagSearchName}>
                          {t.name}
                          {t.group && <small>{t.group}</small>}
                        </span>
                        <span className={styles.tagSearchActs}>
                          <button type="button" className={styles.chip} aria-pressed={stance === "love"} aria-label={`Amo ${t.name}`} onClick={() => markExtra(t, "love")}>
                            ♥ Amo
                          </button>
                          <button
                            type="button"
                            className={`${styles.chip} ${styles.chipVeto}`}
                            aria-pressed={stance === "avoid"}
                            aria-label={`Evito ${t.name}`}
                            onClick={() => markExtra(t, "avoid")}
                          >
                            ⊘ Evito
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── 4 · lista: ANTES do deck, para o deck não oferecer o que a lista vai trazer ── */}
        {step === STEP.list && (
          <section className={styles.step} style={{ paddingTop: 40 }}>
            <p className={styles.eyebrow}>Sua lista</p>
            <h1 className={styles.title}>Tem uma lista em outro site?</h1>
            <p className={styles.sub} style={{ maxWidth: 600 }}>
              Trazemos nota, status e capítulos. As que chegarem com nota já contam para a Nota Prevista,
              as lidas sem nota você avalia no fim, e o deck a seguir pula tudo o que já veio.
            </p>
            <div className={styles.sources}>
              {SOURCE_TILES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`${styles.glass} ${styles.source}`}
                  aria-pressed={tile?.id === t.id}
                  onClick={() => setTile(tile?.id === t.id ? null : t)}
                >
                  <span className={styles.sourceMark} style={{ background: t.color }} aria-hidden="true">
                    {t.mark}
                  </span>
                  <span>
                    <span className={styles.sourceName}>{t.name}</span>
                    <span className={styles.sourceHow}>{t.how}</span>
                  </span>
                </button>
              ))}
            </div>
            {tile && (
              <div className={`${styles.glass} ${styles.importBox}`}>
                {/* `key`: trocar de fonte recomeça o import do zero (método e formato novos). */}
                <ExternalListImport key={tile.id} lockedMethod={tile.method} initialSource={tile.source} />
              </div>
            )}
          </section>
        )}

        {/* ── 5 · deck: à esquerda o que se lê e o placar, à direita o cartão e os botões ── */}
        {step === STEP.deck && (
          <section className={`${styles.step} ${styles.deckStep}`}>
            <div className={styles.deckIntro}>
              <p className={styles.eyebrow}>Suas obras</p>
              <h1 className={`${styles.title} ${styles.titleDeck}`}>Isso é a sua cara?</h1>
              <p className={styles.sub}>
                Marque as que você já leu, inteiras ou em parte: você dá nota nelas no fim. Com {ENSO_GOAL} notas, o
                app passa a prever as suas notas.
              </p>
              <div className={`${styles.glass} ${styles.tally}`}>
                <div className={styles.tallyCol}>
                  <span className={styles.tallyNum} style={{ color: "#8fdbff" }}>
                    {readSoFar}
                    <small> de {ENSO_GOAL}</small>
                  </span>
                  <span className={styles.tallyBar} aria-hidden="true">
                    <span style={{ width: `${Math.min(100, Math.round((readSoFar / ENSO_GOAL) * 100))}%` }} />
                  </span>
                  <span className={styles.tallyLabel}>já lidas</span>
                </div>
                <div className={styles.tallyCol}>
                  <span className={styles.tallyNum} style={{ color: "#9dbcff" }}>
                    {lovedCount}
                  </span>
                  <span className={styles.tallyLabel}>quero ler</span>
                </div>
                <div className={styles.tallyCol}>
                  <span className={styles.tallyNum} style={{ color: "#ffb4b4" }}>
                    {dismissedCount}
                  </span>
                  <span className={styles.tallyLabel}>dispensadas</span>
                </div>
              </div>
              {current && (
                <p className={styles.counter}>
                  obra {deckPos + 1} de {deck.length}
                </p>
              )}
              {importedTotal > 0 && (
                <p className={styles.deckHint}>
                  Inclui {importedTotal} {fromListLabel}, que o deck não mostra de novo.
                </p>
              )}
            </div>

            <div className={styles.deckSide}>
              {deckStatus === "idle" || deckStatus === "loading" ? (
                <div className={styles.loading}>montando o seu deck…</div>
              ) : deckStatus === "error" ? (
                <div className={`${styles.glass} ${styles.deckNote}`}>
                  <p>
                    Não consegui montar o deck agora.{" "}
                    <button type="button" className={styles.ghost} onClick={() => void loadDeck()}>
                      Tentar de novo
                    </button>{" "}
                    ou siga em frente: dá para marcar obras depois, no catálogo.
                  </p>
                </div>
              ) : deck.length === 0 ? (
                <div className={`${styles.glass} ${styles.deckNote}`}>
                  <p>Nenhuma obra nova para mostrar com essas escolhas. Bora em frente.</p>
                </div>
              ) : current ? (
                <DeckStack current={current} behind={behind} outClass={outClass} stamp={stamp} />
              ) : (
                <div className={`${styles.glass} ${styles.deckNote}`}>
                  <p>
                    Fim do deck: <b>{deckRead.length}</b> já lidas, <b>{lovedCount}</b> quero ler,{" "}
                    <b>{dismissedCount}</b> dispensadas.
                  </p>
                </div>
              )}
              {deckStatus === "ready" && deck.length > 0 && (
                <DeckButtons
                  onSwipe={(k) => (current ? swipe(k) : undefined)}
                  onUndo={undo}
                  canUndo={history.length > 0}
                />
              )}
            </div>
          </section>
        )}

        {/* ── 6 · notas ── */}
        {step === STEP.notes && (
          <section className={styles.step} style={{ paddingTop: 24 }}>
            <p className={styles.eyebrow}>As que você já leu</p>
            <h1 className={styles.title}>Quanto você gostou, de 0 a 10?</h1>
            <p className={styles.sub}>
              A nota de cada obra lida é o que ensina a Nota Prevista. Avalie só o que você lembra bem.
            </p>
            <div className={`${styles.glass} ${styles.ensoBar}`} aria-hidden="true">
              <EnsoRing rated={ratedTotal} size={34} stroke={9} />
              <span>
                <b>{ratedTotal}</b> de {ENSO_GOAL} notas · com {ENSO_GOAL}, a Nota Prevista liga
              </span>
            </div>
            <div className={styles.rateLayout}>
              <div className={`${styles.glass} ${styles.rateList}`}>
                {toRate.length > 0 ? (
                  toRate.map(({ work, fromList }) => {
                    const r = readingOf(work.id)
                    return (
                      <RateRow
                        key={work.id}
                        work={work}
                        score={quick.get(work.id)}
                        kind={r.kind}
                        chapters={r.chapters}
                        badge={
                          fromList
                            ? { kind: "source", label: imported?.sourceLabel ? `veio do ${imported.sourceLabel}` : "veio da sua lista" }
                            : null
                        }
                        onRate={(v) => rate(work.id, v)}
                        onReading={(kind, chapters) => changeReading(work.id, kind, chapters)}
                        onRemove={() => removeWork(work.id)}
                      />
                    )
                  })
                ) : (
                  <p className={styles.empty}>
                    Nada por aqui — volte ao deck e marque <b>“Já li”</b> nas obras que você conhece. As da
                    sua lista importada que chegaram com nota já estão contando no medidor.
                  </p>
                )}
              </div>
              {/* Preso enquanto a lista rola: o círculo enchendo é a recompensa do passo. */}
              <aside className={`${styles.glass} ${styles.enso} ${lit ? styles.ensoLit : ""}`} aria-label="Progresso da Nota Prevista">
                <EnsoRing rated={ratedTotal} withNumber />
                <EnsoTitle />
                <span className={styles.ensoText}>
                  {lit
                    ? "悟 Satori: o círculo se fechou. A nota que você vê agora mira no seu gosto, não no consenso."
                    : "Cada nota fecha um arco. Aos 20, o círculo se completa e a Nota Prevista liga."}
                </span>
                {(imported?.importedRatedCount ?? 0) > 0 && (
                  <span className={styles.ensoNote}>
                    {imported?.importedRatedCount} destas notas vieram {fromListLabel}.
                  </span>
                )}
              </aside>
            </div>
          </section>
        )}

        {/* ── 7 · resumo ── */}
        {step === STEP.done && (
          <section className={styles.step} style={{ paddingTop: 50 }}>
            <div className={`${styles.glass} ${styles.done}`}>
              <LogoMark className={styles.doneMark} />
              <h1 className={`${styles.title} ${styles.doneTitle}`}>
                Seu perfil de gosto
                <br />
                acabou de nascer.
              </h1>
              <div className={styles.summary}>
                <span>♥ {lovedCount} quero ler</span>
                {lovedList.slice(0, 3).map((t) => (
                  <span key={t} className={styles.sumLove}>
                    {t}
                  </span>
                ))}
                {vetoList.slice(0, 2).map((t) => (
                  <span key={t} className={styles.sumVeto}>
                    evita {t}
                  </span>
                ))}
              </div>
              <div className={styles.doneMeter}>
                <EnsoRing rated={ratedTotal} size={44} stroke={8} />
                <span>
                  {lit
                    ? "Nota Prevista ligada: suas listas já ordenam pelo seu gosto."
                    : `Nota Prevista em ${ratedTotal} de ${ENSO_GOAL} — faltam ${ENSO_GOAL - ratedTotal} notas. Até lá, suas listas ordenam ${
                        declared
                          ? "pelo Alinhamento, a partir dos gostos que você marcou."
                          : "pela média das plataformas."
                      }`}
                </span>
              </div>
              <div className={styles.doneButtons}>
                <button type="button" className={styles.cta} onClick={() => router.push("/ranking")}>
                  Ver meu ranking →
                </button>
                {/* A página "Dar notas" continua além das obras do deck. Com 20 notas não falta nada. */}
                {!lit && (
                  <button type="button" className={styles.ghost} onClick={() => router.push("/rate")}>
                    Dar mais notas
                  </button>
                )}
                <button type="button" className={styles.link} onClick={() => goTo(STEP.welcome)}>
                  Rever o fluxo
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Rodapé fixo: o botão de seguir no MESMO lugar em todas as telas. Gruda no pé do contêiner que
          rola (o do AppShell); em tela curta, a coluna flex o empurra para baixo. */}
      {footer && (
        <footer className={styles.footer}>
          {footer.note && (
            <p className={styles.footerNote}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8fdbff" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9.5" />
                <line x1="12" y1="11" x2="12" y2="16.5" />
                <circle cx="12" cy="7.6" r=".6" fill="#8fdbff" />
              </svg>
              {footer.note}
            </p>
          )}
          <div className={styles.footerButtons}>
            {footer.secondary && (
              <button type="button" className={styles.ghost} disabled={busy} onClick={footer.secondary.run}>
                {footer.secondary.label}
              </button>
            )}
            <button type="button" className={styles.cta} disabled={busy || footer.disabled} onClick={footer.run}>
              {footer.primary}
            </button>
          </div>
        </footer>
      )}

      {/* Confirmação de idade: abre ao escolher "Mostrar tudo" pela primeira vez. */}
      {askAge && (
        <div className={styles.modalScrim}>
          <div role="dialog" aria-modal="true" aria-labelledby="bv-idade" className={`${styles.glass} ${styles.modal}`}>
            <span className={styles.modalBadge} aria-hidden="true">
              18+
            </span>
            <h2 id="bv-idade" className={styles.modalTitle}>
              {AGE_CONFIRM.title}
            </h2>
            <p className={styles.modalText}>{AGE_CONFIRM.text}</p>
            <div className={styles.modalButtons}>
              <button
                type="button"
                className={styles.cta}
                onClick={() => {
                  setAgeOk(true)
                  setAskAge(false)
                  setHideAdult(false)
                }}
              >
                {AGE_CONFIRM.confirm}
              </button>
              <button type="button" className={styles.link} onClick={() => setAskAge(false)}>
                {AGE_CONFIRM.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Concluir com menos de 20 notas pergunta antes (só aqui: o fim já mostra quanto falta). */}
      {confirmFew && (
        <div className={styles.modalScrim}>
          <div role="dialog" aria-modal="true" aria-labelledby="bv-vinte" className={`${styles.glass} ${styles.modal}`}>
            <EnsoRing rated={ratedTotal} size={64} stroke={7} />
            <h2 id="bv-vinte" className={styles.modalTitle}>
              {ratedTotal === 0 ? "Seguir sem nenhuma nota?" : `Seguir com ${ratedTotal} de ${ENSO_GOAL} notas?`}
            </h2>
            <p className={styles.modalText}>
              Com menos de {ENSO_GOAL} notas, a Nota Prevista fica desligada e suas listas ordenam pelo Alinhamento, a
              partir dos gostos que você marcou. Ela liga sozinha quando você chegar a {ENSO_GOAL}.
            </p>
            <div className={styles.modalButtons}>
              <button
                type="button"
                className={styles.cta}
                onClick={() => {
                  setConfirmFew(false)
                  goTo(STEP.done)
                }}
              >
                Concluir assim
              </button>
              <button type="button" className={styles.ghost} onClick={() => setConfirmFew(false)}>
                Voltar e dar mais notas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
