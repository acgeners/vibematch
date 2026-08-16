import Link from "next/link"
import styles from "./about.module.css"

export const metadata = {
  title: "Sobre",
  description:
    "SatorIA (satori 悟り + IA): o catálogo de mangás e manhwas com uma IA que aprende o seu gosto.",
}

/**
 * Página pública "Sobre a SatorIA" — port do mockup aprovado (Artifact 26710e1f,
 * 2026-07-26). Estática, sem banco; renderiza full-bleed (sem sidebar — ver
 * AppShell). Os vetores da marca são locais à página (níveis "Completa", com o
 * kanji, e "Reduzida" SEM o tile navy — diferente do LogoMark, que leva o tile);
 * ids com prefixo `sobre-` pra não colidir com os `satoria-` do LogoMark.
 */

/** Defs compartilhadas dos três desenhos da marca usados na página. */
function BrandDefs() {
  return (
    <svg className={styles.svgDefs} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sobre-blue" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0" stopColor="#8FDBFF" />
          <stop offset="1" stopColor="#2E7FF0" />
        </linearGradient>
        <linearGradient id="sobre-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#8FE7FF" />
        </linearGradient>
        <radialGradient id="sobre-bead" cx="0.4" cy="0.36" r="0.72">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.55" stopColor="#CBF0FF" />
          <stop offset="1" stopColor="#6FB8F5" />
        </radialGradient>
        <filter id="sobre-glow" x="-90%" y="-90%" width="280%" height="280%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <path id="sobre-petal" d="M0,-50 C13,-30 12,-8 0,3 C-12,-8 -13,-30 0,-50 Z" />
        <g id="sobre-lotus" fill="url(#sobre-blue)">
          <use href="#sobre-petal" transform="rotate(-90) scale(.6)" opacity=".5" />
          <use href="#sobre-petal" transform="rotate(90) scale(.6)" opacity=".5" />
          <use href="#sobre-petal" transform="rotate(-60) scale(.82)" opacity=".68" />
          <use href="#sobre-petal" transform="rotate(60) scale(.82)" opacity=".68" />
          <use href="#sobre-petal" transform="rotate(-31) scale(.93)" opacity=".85" />
          <use href="#sobre-petal" transform="rotate(31) scale(.93)" opacity=".85" />
          <use href="#sobre-petal" />
        </g>
        <g id="sobre-star">
          <path
            d="M0,-23 L3.4,-3.4 L23,0 L3.4,3.4 L0,23 L-3.4,3.4 L-23,0 L-3.4,-3.4 Z"
            fill="url(#sobre-spark)"
          />
          <path
            d="M0,-11 L2,-2 L11,0 L2,2 L0,11 L-2,2 L-11,0 L-2,-2 Z"
            fill="#DAF4FF"
            transform="rotate(45)"
          />
          <circle r="2.6" fill="#FFFFFF" />
        </g>
        <circle
          id="sobre-enso"
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke="url(#sobre-blue)"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray="244 70"
          transform="rotate(126 60 60)"
        />
        <g id="sobre-trail" fill="url(#sobre-blue)">
          <circle cx="98" cy="35" r="2.4" />
          <circle cx="103" cy="47" r="2.1" />
          <circle cx="105" cy="59" r="1.8" />
          <circle cx="104" cy="71" r="1.5" />
          <circle cx="99.5" cy="81" r="1.3" />
          <circle cx="93" cy="89" r="1.1" />
        </g>
        <g id="sobre-mark-completa">
          <use href="#sobre-enso" />
          <use href="#sobre-trail" />
          <text
            x="60"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            fill="url(#sobre-blue)"
            style={{
              fontFamily: "'Hiragino Mincho ProN','Yu Mincho','Songti SC',serif",
              fontSize: 40,
              fontWeight: 600,
            }}
          >
            悟
          </text>
          <use href="#sobre-lotus" transform="translate(60 107) scale(.66)" />
          <use href="#sobre-star" transform="translate(95 24) scale(.8)" filter="url(#sobre-glow)" />
        </g>
        <g id="sobre-mark-reduzida">
          <use href="#sobre-enso" />
          <use href="#sobre-lotus" transform="translate(60 74) scale(.98)" />
          <circle cx="94" cy="25" r="11" fill="#8FE7FF" opacity="0.22" />
          <circle cx="94" cy="25" r="6.2" fill="url(#sobre-bead)" filter="url(#sobre-glow)" />
        </g>
      </defs>
    </svg>
  )
}

export default function SobrePage() {
  return (
    <div className={styles.page}>
      <BrandDefs />

      <nav className={styles.topnav}>
        <div className={styles.brand}>
          <svg className={styles.mark} width="32" height="32" viewBox="0 0 120 120" aria-hidden="true">
            <use href="#sobre-mark-reduzida" />
          </svg>
          <span className={styles.wordmark}>
            Sator<span className={styles.ia}>IA</span>
          </span>
        </div>
        <div className={styles.navLinks}>
          <Link className={styles.navCta} href="/guide">
            Guia do app
          </Link>
          <Link className={styles.navCta} href="/login">
            Entrar
          </Link>
        </div>
      </nav>

      <div className={styles.wrap}>
        <header className={styles.hero}>
          <svg className={`${styles.mark} ${styles.heroMark}`} viewBox="0 0 120 120" aria-label="SatorIA">
            <use href="#sobre-mark-completa" />
          </svg>
          <span className={styles.eyebrow}>
            <span className={styles.kanjiBadge}>悟り</span> · satori
          </span>
          <h1>
            A leitura certa é aquele instante em que <span className={styles.hl}>tudo faz sentido</span>.
          </h1>
          <p className={styles.heroSub}>
            A SatorIA é o seu catálogo de mangás e manhwas com uma IA que aprende o seu gosto — pra te
            levar até esse instante, obra por obra.
          </p>
          <div className={styles.heroActions}>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} href="/catalog">
              Ver meu catálogo →
            </Link>
            <a className={`${styles.btn} ${styles.btnGhost}`} href="#como">
              Como funciona
            </a>
          </div>
        </header>

        <section>
          <div className={styles.nameCard}>
            <span className={styles.eyebrow}>
              Por que <b style={{ color: "var(--blue-2)" }}>SatorIA</b>?
            </span>
            <div className={styles.decomp}>
              <div className={styles.morph}>
                <span className={styles.big}>悟り</span>
                <span className={styles.latin} style={{ color: "var(--blue-2)" }}>
                  satori
                </span>
                <small>o instante de compreensão súbita — o &ldquo;aha&rdquo; em que a peça encaixa</small>
              </div>
              <span className={styles.plus}>+</span>
              <div className={styles.morph}>
                <svg className={`${styles.mark} ${styles.markmini}`} viewBox="0 0 120 120" aria-hidden="true">
                  <use href="#sobre-mark-reduzida" />
                </svg>
                <span className={styles.latin}>
                  <span style={{ color: "var(--blue)" }}>IA</span>
                </span>
                <small>a inteligência que aprende com tudo o que você lê</small>
              </div>
            </div>
            <p className={styles.nameLead}>
              Junte os dois e você tem a ideia: uma IA que te leva ao <b>satori</b> sobre o seu próprio
              gosto.
            </p>
          </div>
        </section>

        <section className={styles.center}>
          <span className={styles.eyebrow}>O que há por dentro</span>
          <h2 className={styles.sec}>Três peças, um só objetivo</h2>
          <p className={styles.secLead}>
            Catálogo, avaliação e aprendizado trabalhando juntos — porque recomendação boa nasce de
            conhecer a obra <em>e</em> o leitor.
          </p>
          <div className={styles.pillars}>
            <article className={styles.pill}>
              <div className={styles.gmark}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5h16M4 12h16M4 19h10" />
                  <path d="M4 5v14" />
                </svg>
              </div>
              <h3>Catálogo pessoal</h3>
              <p>
                Organize tudo o que você lê — status de leitura, suas notas, tags e observações. Seu
                acervo, do seu jeito.
              </p>
            </article>
            <article className={styles.pill}>
              <div className={styles.gmark}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />
                </svg>
              </div>
              <h3>Avaliações de verdade</h3>
              <p>
                Cada obra é avaliada em 9 critérios, cruzando reviews de várias fontes — MangaUpdates,
                AniList, MyAnimeList e outras — em um só lugar.
              </p>
            </article>
            <article className={styles.pill}>
              <div className={styles.gmark}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 4a5 5 0 0 1 5 5c0 2-1.5 3-1.5 5h-7C8.5 12 7 11 7 9a5 5 0 0 1 5-5z" />
                  <path d="M9.5 20h5M10 22h4" />
                </svg>
              </div>
              <h3>IA que aprende</h3>
              <p>
                Quanto mais você avalia, mais afiado fica o seu perfil de gosto — e a <b>Nota Prevista</b>{" "}
                passa a mirar no que <em>você</em> vai achar, não na média da multidão.
              </p>
            </article>
          </div>
        </section>

        <section id="como">
          <div className={styles.center}>
            <span className={styles.eyebrow}>Como funciona</span>
            <h2 className={styles.sec}>Do primeiro registro à recomendação certa</h2>
          </div>
          <div className={styles.steps}>
            <div className={styles.step}>
              <span className={styles.stepN}>1</span>
              <div>
                <h3>Você adiciona e avalia o que lê</h3>
                <p>
                  Monte seu catálogo e diga o que achou. Não sabe por onde começar? A IA já traz uma
                  avaliação inicial de cada obra pra você ajustar.
                </p>
              </div>
            </div>
            <div className={styles.step}>
              <span className={styles.stepN}>2</span>
              <div>
                <h3>A IA monta o seu perfil de gosto</h3>
                <p>
                  Ela lê os padrões nas suas notas — o que você ama, o que evita, o que te faz continuar —
                  e transforma isso em um retrato do seu gosto.
                </p>
              </div>
            </div>
            <div className={styles.step}>
              <span className={styles.stepN}>3</span>
              <div>
                <h3>Você recebe recomendações e uma nota prevista</h3>
                <p>
                  Para cada obra, uma estimativa de quanto <em>você</em> vai gostar — com o contexto que
                  explica o porquê, fácil de explorar.
                </p>
              </div>
            </div>
            <div className={styles.step}>
              <span className={styles.stepN}>4</span>
              <div>
                <h3>Quanto mais você usa, mais ela acerta</h3>
                <p>
                  Cada nova avaliação recalibra o modelo. O perfil evolui com você — e o próximo satori
                  chega mais rápido.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className={styles.quote}>
            <span className={styles.mk} aria-hidden="true">
              悟
            </span>
            <blockquote>Não é sobre o que é popular. É sobre o que é seu.</blockquote>
            <p>
              A maioria dos apps recomenda pela média da multidão. A SatorIA recomenda pelo seu gosto — o
              que te prende, o que você abandona, o que você releria. A diferença entre &ldquo;todo mundo
              gostou&rdquo; e &ldquo;isso é a sua cara&rdquo;.
            </p>
          </div>
        </section>

        <section>
          <div className={styles.closing}>
            <span className={`${styles.spark} ${styles.sparkA}`} aria-hidden="true">
              <svg viewBox="-23 -23 46 46">
                <use href="#sobre-star" />
              </svg>
            </span>
            <span className={`${styles.spark} ${styles.sparkB}`} aria-hidden="true">
              <svg viewBox="-23 -23 46 46">
                <use href="#sobre-star" />
              </svg>
            </span>
            <svg className={`${styles.mark} ${styles.deco}`} viewBox="0 0 120 120" aria-hidden="true">
              <use href="#sobre-mark-reduzida" />
            </svg>
            <h2>Seu próximo mangá favorito já está te esperando.</h2>
            <p>Comece o seu catálogo e deixe a SatorIA aprender o seu gosto.</p>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} href="/signup">
              Começar agora →
            </Link>
          </div>
        </section>
      </div>

      <footer className={styles.pageFooter}>
        <svg className={styles.mark} width="18" height="18" viewBox="0 0 120 120" aria-hidden="true">
          <use href="#sobre-mark-reduzida" />
        </svg>
        SatorIA · 悟 satori + IA · feito para leitores
      </footer>
    </div>
  )
}
