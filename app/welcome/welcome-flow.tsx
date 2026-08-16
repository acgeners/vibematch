"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { setHideAdultContent } from "@/server/actions/settings"
import {
  saveOnboardingTastes,
  getOnboardingDeckAction,
  deckSwipeAction,
  getOnboardingProgressAction,
} from "@/server/actions/onboarding"
import { saveQuickScore } from "@/server/actions/quick-score"
import { ExternalListImport } from "@/components/import/external-list-import"
import { LOVED_CHIPS, VETO_CHIPS, MIN_LOVED } from "@/lib/onboarding/chips"
import type { OnboardingDeckWork } from "@/server/queries/onboarding-deck"
import styles from "./welcome.module.css"

const TOTAL_STEPS = 7
const QUICK_VALUES = [0, 2, 4, 6, 8, 10]
const MIN_TRAIN = 20

/** Ensō de progresso: arco k/7 do círculo aberto da marca (não fecha nunca — 87/113). */
function EnsoMini({ step }: { step: number }) {
  const arc = ((step + 1) / TOTAL_STEPS) * 87
  return (
    <svg className={styles.ensoMini} viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="3.4" />
      <circle
        cx="22"
        cy="22"
        r="18"
        fill="none"
        stroke="url(#bv-blue)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeDasharray={`${arc.toFixed(1)} 113`}
        transform="rotate(126 22 22)"
      />
    </svg>
  )
}

/** Defs compartilhadas da marca (gradiente, pétala, estrela, marca reduzida). */
function BrandDefs() {
  return (
    <svg aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        <linearGradient id="bv-blue" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0" stopColor="#8FDBFF" />
          <stop offset="1" stopColor="#2E7FF0" />
        </linearGradient>
        <path id="bv-petal" d="M0,-50 C13,-30 12,-8 0,3 C-12,-8 -13,-30 0,-50 Z" />
        <g id="bv-star">
          <path
            d="M0,-23 L3.4,-3.4 L23,0 L3.4,3.4 L0,23 L-3.4,3.4 L-23,0 L-3.4,-3.4 Z"
            fill="#8FE7FF"
          />
          <circle r="2.6" fill="#FFFFFF" />
        </g>
        <g id="bv-mark">
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke="url(#bv-blue)"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray="244 70"
            transform="rotate(126 60 60)"
          />
          <g fill="url(#bv-blue)">
            <use href="#bv-petal" transform="translate(60 74) rotate(-60) scale(.8)" opacity=".68" />
            <use href="#bv-petal" transform="translate(60 74) rotate(60) scale(.8)" opacity=".68" />
            <use href="#bv-petal" transform="translate(60 74) rotate(-31) scale(.92)" opacity=".85" />
            <use href="#bv-petal" transform="translate(60 74) rotate(31) scale(.92)" opacity=".85" />
            <use href="#bv-petal" transform="translate(60 74) scale(.98)" />
          </g>
          <circle cx="94" cy="25" r="6" fill="#8FE7FF" />
        </g>
      </defs>
    </svg>
  )
}

/** Ordem de acendimento das pétalas: centro → fora (igual ao mockup). */
const PETALS = [
  "", // centro
  "rotate(-31) scale(.92)",
  "rotate(31) scale(.92)",
  "rotate(-60) scale(.8)",
  "rotate(60) scale(.8)",
  "rotate(-90) scale(.62)",
  "rotate(90) scale(.62)",
]

const SHELF_COLORS = [
  "linear-gradient(155deg,#3E5C9A,#8E5FA8)",
  "linear-gradient(155deg,#2F6B63,#5FA88C)",
  "linear-gradient(155deg,#9A5B4F,#C99566)",
  "linear-gradient(155deg,#41537E,#7A9BD6)",
]

type SwipeKind = "love" | "dismiss" | "read"
const STAMP_TXT: Record<SwipeKind, string> = { love: "quero ler", dismiss: "dispensar", read: "já li" }
const STAMP_CLASS: Record<SwipeKind, string> = {
  love: styles.stampLove,
  dismiss: styles.stampNo,
  read: styles.stampRead,
}
const OUT_CLASS: Record<SwipeKind, string> = {
  love: styles.deckOutLove,
  dismiss: styles.deckOutNo,
  read: styles.deckOutRead,
}

export function WelcomeFlow({ displayName }: { displayName: string | null }) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  // tela 2
  const [hideAdult, setHideAdult] = useState(false)
  // tela 3
  const [loved, setLoved] = useState<Set<string>>(new Set())
  const [vetos, setVetos] = useState<Set<string>>(new Set())
  // tela 4
  const [deck, setDeck] = useState<OnboardingDeckWork[]>([])
  const [deckPos, setDeckPos] = useState(0)
  const [outClass, setOutClass] = useState("")
  const [stamp, setStamp] = useState<{ kind: SwipeKind; key: number } | null>(null)
  const [readWorks, setReadWorks] = useState<OnboardingDeckWork[]>([])
  const [picks, setPicks] = useState({ love: 0, dismiss: 0, read: 0 })
  const swiping = useRef(false)
  // tela 6
  const [baseRated, setBaseRated] = useState(0)
  const [quick, setQuick] = useState<Map<string, number>>(new Map())

  const first = displayName?.trim().split(/\s+/)[0] ?? null
  const ratedTotal = baseRated + quick.size
  const lit = ratedTotal >= MIN_TRAIN

  const goTo = useCallback((i: number) => setStep(Math.max(0, Math.min(TOTAL_STEPS - 1, i))), [])

  // ── transições que gravam ─────────────────────────────────────────────
  const leaveAdult = async () => {
    setBusy(true)
    try {
      const res = await setHideAdultContent(hideAdult)
      if (res.error) console.error("[bem-vindo] conteúdo adulto:", res.error)
      goTo(2)
    } finally {
      setBusy(false)
    }
  }

  const leaveTastes = async () => {
    setBusy(true)
    try {
      const save = await saveOnboardingTastes(Array.from(loved), Array.from(vetos))
      if (!save.ok) console.error("[bem-vindo] gostos:", save.error)
      goTo(3)
      const res = await getOnboardingDeckAction(Array.from(loved))
      if (res.ok) {
        setDeck(res.works)
        setDeckPos(0)
      } else console.error("[bem-vindo] deck:", res.error)
    } finally {
      setBusy(false)
    }
  }

  const enterNotes = async () => {
    setBusy(true)
    try {
      const res = await getOnboardingProgressAction()
      if (res.ok) setBaseRated(res.ratedCount)
      goTo(5)
    } finally {
      setBusy(false)
    }
  }

  // ── deck ──────────────────────────────────────────────────────────────
  const current = deck[deckPos] ?? null

  const swipe = (kind: SwipeKind) => {
    if (!current || swiping.current) return
    swiping.current = true
    setStamp({ kind, key: Date.now() })
    setOutClass(OUT_CLASS[kind])
    setPicks((p) => ({ ...p, [kind]: p[kind] + 1 }))
    if (kind === "read") {
      setReadWorks((r) => (r.some((w) => w.id === current.id) ? r : [...r, current]))
    }
    void deckSwipeAction(current.id, kind).then((r) => {
      if (!r.ok) console.error("[bem-vindo] swipe:", r.error)
    })
    window.setTimeout(() => {
      setDeckPos((p) => p + 1)
      setOutClass("")
      swiping.current = false
    }, 200)
  }

  // ── nota rápida ───────────────────────────────────────────────────────
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

  const lovedList = useMemo(() => Array.from(loved), [loved])
  const vetoList = useMemo(() => Array.from(vetos), [vetos])
  const marked = picks.love + picks.dismiss + picks.read

  const toggle = (set: Set<string>, apply: (s: Set<string>) => void, v: string) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    apply(next)
  }

  const stepLabel = [
    "Passo 1 de 7",
    "Passo 2 de 7 · Seu conforto",
    "Passo 3 de 7 · Seu gosto",
    "Passo 4 de 7 · Suas obras",
    "Passo 5 de 7 · Sua lista",
    "Passo 6 de 7 · As que você já leu",
    "Pronto",
  ][step]

  return (
    <div className={styles.page}>
      <BrandDefs />
      <div className={styles.shell}>
        <div className={styles.top}>
          <span className={styles.step}>
            <EnsoMini step={step} />
            {stepLabel}
          </span>
          {step === 0 && (
            <button type="button" className={styles.skip} onClick={() => router.push("/")}>
              Pular por agora
            </button>
          )}
          {step > 0 && step < 6 && (
            <button
              type="button"
              className={styles.skip}
              onClick={() => (step === 4 ? void enterNotes() : goTo(step + 1))}
            >
              {step === 4 ? "Não tenho lista" : step === 5 ? "Depois" : "Pular"}
            </button>
          )}
        </div>

        {/* ── 1 · boas-vindas ── */}
        {step === 0 && (
          <div className={styles.screen}>
            <div className={styles.welcome}>
              <span className={styles.wGlow} aria-hidden="true" />
              <span className={styles.wKanji} aria-hidden="true">
                悟
              </span>
              <span className={styles.eyebrow}>{first ? `Boas-vindas, ${first}` : "Boas-vindas"}</span>
              <h1 className={`${styles.title} ${styles.titleXl}`}>
                Seu próximo <span className={styles.hl}>favorito</span> já existe.
                <br />
                Vamos ensinar a SatorIA a encontrá-lo.
              </h1>
              <p className={styles.sub}>
                Ela recomenda pelo <em>seu</em> gosto — não pela média da multidão. Um minuto e meio
                agora, e ela já começa a te conhecer:
              </p>
              <ul className={styles.wSteps}>
                <li>
                  <span className={styles.n}>01</span>
                  <span>
                    <b>O que te atrai</b> — e o que te faz largar uma obra no meio.
                  </span>
                </li>
                <li>
                  <span className={styles.n}>02</span>
                  <span>
                    <b>Umas dez obras</b>: curtir, dispensar ou marcar “já li”.
                  </span>
                </li>
                <li>
                  <span className={styles.n}>03</span>
                  <span>
                    <b>Sua lista de outro site</b>, se tiver — com as notas que você já deu.
                  </span>
                </li>
              </ul>
            </div>
            <div className={styles.foot}>
              <span className={styles.hint}>
                leva <b>~90s</b> · dá para refazer em Preferências
              </span>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGo} ${styles.btnGoBig}`}
                onClick={() => goTo(1)}
              >
                Começar →
              </button>
            </div>
          </div>
        )}

        {/* ── 2 · conteúdo adulto ── */}
        {step === 1 && (
          <div className={styles.screen}>
            <h1 className={styles.title}>Quer ver obras adultas no catálogo?</h1>
            <p className={styles.sub}>
              Perguntamos agora porque é isso que decide o que aparece nas próximas telas. Dá para
              mudar quando quiser em Configurações.
            </p>
            <div className={styles.picks}>
              <button
                type="button"
                className={styles.pick}
                aria-pressed={!hideAdult}
                onClick={() => setHideAdult(false)}
              >
                <b>Mostrar tudo</b>
                <span className={styles.shelf} aria-hidden="true">
                  {SHELF_COLORS.slice(0, 3).map((g, i) => (
                    <i key={i} style={{ background: g }} />
                  ))}
                  <i className={styles.shelfAdult}>18+</i>
                  <i style={{ background: SHELF_COLORS[3] }} />
                </span>
                <span>O catálogo inteiro, sem filtro. Obras adultas aparecem marcadas com 18+.</span>
              </button>
              <button
                type="button"
                className={styles.pick}
                aria-pressed={hideAdult}
                onClick={() => setHideAdult(true)}
              >
                <b>Ocultar obras adultas</b>
                <span className={styles.shelf} aria-hidden="true">
                  {SHELF_COLORS.slice(0, 3).map((g, i) => (
                    <i key={i} style={{ background: g }} />
                  ))}
                  <i className={styles.shelfGap} />
                  <i style={{ background: SHELF_COLORS[3] }} />
                </span>
                <span>Elas somem das listas, da busca e das recomendações — biblioteca limpa.</span>
              </button>
            </div>
            <div className={styles.foot}>
              <span className={styles.hint}>preferência pessoal · só sua</span>
              <div style={{ display: "flex", gap: 9 }}>
                <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} onClick={() => goTo(0)}>
                  Voltar
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGo}`}
                  disabled={busy}
                  onClick={leaveAdult}
                >
                  Continuar →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 3 · gostos ── */}
        {step === 2 && (
          <div className={styles.screen}>
            <h1 className={styles.title}>O que te atrai — e o que te faz largar?</h1>
            <div className={styles.bloom} aria-hidden="true">
              <svg viewBox="0 0 100 64">
                <g transform="translate(50 58)">
                  {PETALS.map((t, i) => (
                    <use
                      key={i}
                      href="#bv-petal"
                      transform={t || undefined}
                      className={`${styles.bloomPetal} ${i < Math.min(7, loved.size) ? styles.bloomPetalLit : ""}`}
                    />
                  ))}
                </g>
              </svg>
              <small>{loved.size ? `florescendo · ${Math.min(loved.size, 7)}/7` : "sua lótus"}</small>
            </div>

            <div className={styles.band}>
              <div className={styles.bandHead}>
                <span className={`${styles.bandName} ${styles.bandLove}`}>✓ Me atrai</span>
                <span className={styles.bandWhy}>
                  Escolha pelo menos três. O resto a IA aprende sozinha.
                </span>
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
              </div>
            </div>

            <div className={styles.band}>
              <div className={styles.bandHead}>
                <span className={`${styles.bandName} ${styles.bandVeto}`}>✕ Eu evito</span>
                <span className={styles.bandWhy}>
                  Opcional, mas vale ouro: um veto tira dezenas de obras da sua frente.
                </span>
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
              </div>
            </div>

            <div className={styles.foot}>
              <span className={styles.hint}>
                <b>{loved.size}</b> atraem · <b>{vetos.size}</b> vetos
              </span>
              <div style={{ display: "flex", gap: 9 }}>
                <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} onClick={() => goTo(1)}>
                  Voltar
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGo}`}
                  disabled={busy || loved.size < MIN_LOVED}
                  onClick={leaveTastes}
                >
                  Continuar →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 4 · deck ── */}
        {step === 3 && (
          <div className={styles.screen}>
            <h1 className={styles.title}>Isso é a sua cara?</h1>
            <p className={styles.sub}>
              Uma obra por vez, com a <em>sinopse inteira</em> — role dentro dela se precisar. A
              pergunta é de <b>interesse</b>: curtir e dispensar falam do que te atrai. O “já li” é o
              desvio: essas vão pra tela de notas, logo adiante.
            </p>

            {stamp && (
              <span key={stamp.key} className={`${styles.stamp} ${STAMP_CLASS[stamp.kind]} ${styles.stampPop}`}>
                {STAMP_TXT[stamp.kind]}
              </span>
            )}

            {deck.length === 0 ? (
              <div className={styles.loading}>montando o seu deck…</div>
            ) : current ? (
              <>
                <div className={`${styles.deck} ${outClass}`}>
                  <div className={styles.deckArt}>
                    {current.coverUrls[0] && (
                      // eslint-disable-next-line @next/next/no-img-element -- capa externa, sem images config
                      <img src={current.coverUrls[0]} alt="" />
                    )}
                    {current.totalChapters != null && (
                      <span className={styles.deckBadge}>{current.totalChapters} caps</span>
                    )}
                  </div>
                  <div className={styles.deckBody}>
                    <div className={styles.deckTitle}>{current.title}</div>
                    <div className={styles.deckMeta}>
                      {current.genres.slice(0, 3).map((g) => (
                        <span key={g} className={styles.tag}>
                          {g}
                        </span>
                      ))}
                    </div>
                    <p className={styles.syn} tabIndex={0}>
                      {current.synopsis}
                    </p>
                    <span className={styles.synSrc}>sinopse canônica</span>
                  </div>
                </div>
                <div>
                  <div className={styles.acts}>
                    <button
                      type="button"
                      className={`${styles.act} ${styles.actNo}`}
                      aria-label="Não é pra mim"
                      onClick={() => swipe("dismiss")}
                    >
                      ✕
                    </button>
                    <button
                      type="button"
                      className={`${styles.act} ${styles.actRead}`}
                      aria-label="Já li"
                      onClick={() => swipe("read")}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className={`${styles.act} ${styles.actLove}`}
                      aria-label="Quero ler"
                      onClick={() => swipe("love")}
                    >
                      ♥
                    </button>
                  </div>
                  <div className={styles.actLbl}>dispensar · já li · quero ler</div>
                </div>
              </>
            ) : (
              <p className={styles.rateEmpty}>
                Deck completo — <b>{picks.love}</b> quero ler, <b>{picks.read}</b> já li,{" "}
                <b>{picks.dismiss}</b> dispensadas. Bora em frente.
              </p>
            )}

            <div className={styles.foot}>
              <span className={styles.hint}>
                <b>{Math.min(deckPos + 1, deck.length)}</b> de {deck.length || "…"}
              </span>
              <div style={{ display: "flex", gap: 9 }}>
                <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} onClick={() => goTo(2)}>
                  Voltar
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnGo}`} onClick={() => goTo(4)}>
                  Continuar →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 5 · importar ── */}
        {step === 4 && (
          <div className={styles.screen}>
            <h1 className={styles.title}>Já tem uma lista em outro site?</h1>
            <p className={styles.sub}>
              Se você já avaliou obras no AniList ou no MyAnimeList, a SatorIA aproveita{" "}
              <em>essas notas</em> — e o que a sua lista já trouxer, a próxima tela nem pergunta.
            </p>
            <div className={styles.importBox}>
              <ExternalListImport />
            </div>
            <div className={styles.foot}>
              <span className={styles.hint}>
                4 fontes · <b>o import traz nota, status e capítulos</b>
              </span>
              <div style={{ display: "flex", gap: 9 }}>
                <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} onClick={() => goTo(3)}>
                  Voltar
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGo}`}
                  disabled={busy}
                  onClick={enterNotes}
                >
                  Continuar →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 6 · notas rápidas ── */}
        {step === 5 && (
          <div className={styles.screen}>
            <h1 className={styles.title}>Quanto você gostou, de 0 a 10?</h1>
            <p className={styles.sub}>
              Estas são as que você marcou <b>“já li”</b> no deck. A nota delas é a única coisa que
              ensina a <b>Nota Prevista</b> — quem veio da sua lista já com nota não aparece aqui.
            </p>

            {readWorks.length > 0 ? (
              <div>
                <span className={styles.rateFrom}>vindas do deck · marcadas “já li”</span>
                {readWorks.map((w) => {
                  const chosen = quick.get(w.id)
                  return (
                    <div key={w.id} className={styles.rateRow}>
                      <span className={styles.rateThumb}>
                        {w.coverUrls[0] && (
                          // eslint-disable-next-line @next/next/no-img-element -- capa externa
                          <img src={w.coverUrls[0]} alt="" />
                        )}
                      </span>
                      <span className={styles.rateName}>
                        {w.title}
                        <small>{w.genres.slice(0, 2).join(" · ")}</small>
                      </span>
                      <span className={styles.scale}>
                        {QUICK_VALUES.map((v) => (
                          <button
                            key={v}
                            type="button"
                            className={
                              chosen === v
                                ? styles.scaleOn
                                : chosen != null && v < chosen
                                  ? styles.scaleFill
                                  : undefined
                            }
                            aria-pressed={chosen === v}
                            onClick={() => rate(w.id, v)}
                          >
                            {v}
                          </button>
                        ))}
                      </span>
                      <span className={`${styles.rateVal} ${chosen != null ? styles.rateValGot : ""}`}>
                        {chosen ?? "–"}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className={styles.rateEmpty}>
                Nada por aqui — volte ao deck e marque <b>“já li”</b> nas obras que você conhece. As
                da sua lista importada que chegaram com nota já estão contando no medidor.
              </p>
            )}

            <div className={`${styles.meter} ${lit ? styles.meterLit : ""}`}>
              <div className={styles.gauge} aria-hidden="true">
                <svg viewBox="0 0 90 90">
                  <circle className={styles.gaugeBg} cx="45" cy="45" r="38" />
                  <circle
                    className={styles.gaugeArc}
                    cx="45"
                    cy="45"
                    r="38"
                    strokeDasharray={`${(Math.min(1, ratedTotal / MIN_TRAIN) * 185.6).toFixed(1)} 239`}
                    transform="rotate(126 45 45)"
                  />
                </svg>
                <span className={styles.gaugeNum}>
                  <b>{ratedTotal}</b>
                  <small>de {MIN_TRAIN}</small>
                </span>
              </div>
              <div className={styles.meterBody}>
                <span className={styles.meterLabel}>Seu ensō — a Nota Prevista pessoal</span>
                <p className={styles.meterNote}>
                  {lit
                    ? "悟 Satori: o círculo se fechou. A nota que você vê agora mira no seu gosto, não no consenso."
                    : "Cada nota fecha um arco. Aos 20, o círculo se completa — e a SatorIA passa a enxergar o catálogo com os seus olhos."}
                </p>
              </div>
            </div>

            <div className={styles.foot}>
              <span className={styles.hint}>avalie só o que lembra bem</span>
              <div style={{ display: "flex", gap: 9 }}>
                <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} onClick={() => goTo(4)}>
                  Voltar
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnGo}`} onClick={() => goTo(6)}>
                  Concluir →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 7 · resumo ── */}
        {step === 6 && (
          <div className={styles.screen}>
            <span className={`${styles.spark} ${styles.sparkA}`} aria-hidden="true">
              <svg viewBox="-23 -23 46 46">
                <use href="#bv-star" />
              </svg>
            </span>
            <span className={`${styles.spark} ${styles.sparkB}`} aria-hidden="true">
              <svg viewBox="-23 -23 46 46">
                <use href="#bv-star" />
              </svg>
            </span>
            <h1 className={`${styles.title} ${styles.titleXl}`}>
              O seu perfil de gosto <span className={styles.hl}>acabou de nascer</span>.
            </h1>
            <p className={styles.sub}>
              Esta é a primeira página dele — o resto, vocês escrevem juntos, leitura a leitura.
            </p>

            <div className={styles.readerCard}>
              <div className={styles.rcIn}>
                <div className={styles.rcTop}>
                  <svg className={styles.rcMark} viewBox="0 0 120 120" aria-hidden="true">
                    <use href="#bv-mark" />
                  </svg>
                  <span className={styles.rcName}>
                    <b>{first ?? "Leitor(a)"}</b>
                    <small>desde hoje</small>
                  </span>
                </div>
                <dl className={styles.rcRows}>
                  <div className={styles.rcRow}>
                    <dt>ama</dt>
                    <dd>
                      {lovedList.length ? (
                        <b>
                          {lovedList.slice(0, 3).join(", ")}
                          {lovedList.length > 3 ? ` +${lovedList.length - 3}` : ""}
                        </b>
                      ) : (
                        <b>nada escolhido</b>
                      )}
                    </dd>
                  </div>
                  <div className={styles.rcRow}>
                    <dt>evita</dt>
                    <dd>
                      {vetoList.length ? (
                        <b>
                          {vetoList.slice(0, 2).join(", ")}
                          {vetoList.length > 2 ? ` +${vetoList.length - 2}` : ""}
                        </b>
                      ) : (
                        <b>nenhum veto</b>
                      )}
                    </dd>
                  </div>
                  <div className={styles.rcRow}>
                    <dt>na estante</dt>
                    <dd>
                      <b>{marked}</b> obras marcadas
                    </dd>
                  </div>
                  <div className={styles.rcRow}>
                    <dt>{lit ? "já mira em você" : "ainda aprendendo"}</dt>
                    <dd>
                      {lit ? (
                        <span>
                          Nota Prevista <b>ligada</b>
                        </span>
                      ) : (
                        <span>
                          Nota Prevista em <b>{ratedTotal}/20</b>
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className={styles.foot}>
              <span className={styles.hint}>
                tudo isso vive em <b>Preferências</b> · o <a href="/guide" style={{ color: "var(--sky)" }}>guia</a> explica cada número
              </span>
              <div style={{ display: "flex", gap: 9 }}>
                <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} onClick={() => goTo(0)}>
                  Rever o fluxo
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGo}`}
                  onClick={() => router.push("/ranking")}
                >
                  Ver meu ranking →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
