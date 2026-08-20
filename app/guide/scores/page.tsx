import Link from "next/link"
import { ChartLine } from "lucide-react"
import { Header } from "@/components/layout/header"
import { BackToTop } from "@/components/guide/back-to-top"
import { ScoreEntryCard } from "@/components/guide/score-entry-card"
import { buildScoreGlossary, MIN_TRAIN, RECALC_INPUT_LABELS, RECALC_CATALOGO, RECALC_PESSOAL } from "@/lib/scores/glossary"
import { SCORE_EXCLUSIONS } from "@/lib/scores/glossary-notes"
import { getScoreCoverage } from "@/server/queries/score-coverage"

export const dynamic = "force-dynamic"
export const metadata = { title: "Dicionário dos números" }

/**
 * O dicionário dos números: o que cada medida do app quer dizer e o que a move.
 *
 * Irmã do `/guide/attributes`, e pela mesma razão: a régua existia só em constantes de
 * código. A página da obra mostra o número DAQUELA obra, o tooltip da coluna cabe uma
 * frase, e as entradas do modelo (`LogVotos`, `RunLength`, `CriterionFitScore`) não têm
 * rótulo em lugar nenhum — quem quisesse saber por que duas obras parecidas recebem notas
 * diferentes não tinha onde ler.
 *
 * 🔴 Todo o conteúdo DERIVA de `lib/scores/glossary.ts`, que por sua vez deriva das
 * constantes do cálculo. Ver o doc-comment de lá.
 *
 * ⚠️ A cobertura é contada ao vivo (`getScoreCoverage`) e as contagens pessoais só saem
 * com sessão — `calculated_scores` guarda os números do DONO, e servi-los a um visitante
 * seria publicar o gosto dele como se fosse estatística do catálogo.
 */
export default async function DicionarioDosNumerosPage() {
  const { medidas, features, controles } = buildScoreGlossary()
  const { total, counts, hasPersonal } = await getScoreCoverage()

  const cobertura = (entry: (typeof medidas)[number]) => {
    if (!entry.coverage) return null
    const n = counts[entry.coverage]
    return n == null ? null : { n, total }
  }
  const precisaSessao = (entry: (typeof medidas)[number]) =>
    !hasPersonal && entry.coverage != null && counts[entry.coverage] == null

  const secoes = [
    {
      id: "medidas",
      titulo: "O que a tela mostra",
      sub: "Na ordem em que a leitura acontece: primeiro o que decide a ordem da lista, depois o que sustenta a decisão.",
      entries: medidas,
    },
    {
      id: "entradas",
      titulo: "O que alimenta a Nota Prevista",
      sub: "As entradas do modelo. Nenhuma delas aparece sozinha em lista nenhuma — mas é a soma delas que explica por que duas obras parecidas recebem notas diferentes.",
      entries: features.filter((f) => !f.sameAs),
      // Cinco entradas do modelo SÃO medidas que a seção acima já explicou (a Média externa
      // entra como `Nota.M`, o seu Interesse como `SinopseScore`…). Elas viram uma faixa de
      // referência no fim da seção, não um segundo verbete: dois textos para o mesmo número
      // divergem na primeira edição, e esta é a página que menos pode se contradizer.
      refs: features.filter((f) => f.sameAs),
    },
    {
      id: "controles",
      titulo: "O que você controla",
      sub: "Mexer em qualquer um destes muda a nota de todas as obras, não só a da que está aberta.",
      entries: controles,
    },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <Header
        icon={<ChartLine />}
        title="Dicionário dos números"
        description="Cada número que aparece numa lista ou num card: em que escala ele está, quem o produziu, o que faz ele mudar e em quantas obras ele existe hoje. O dicionário dos atributos responde o que “romance 7,5” quer dizer; este responde o que a Prioridade, o Alinhamento e o Veredito querem dizer — e o que não entra em nenhum deles."
      />

      <nav aria-label="Ir para uma seção" className="grid gap-2 sm:grid-cols-3">
        {secoes.map((s) => (
          <Link
            key={s.id}
            href={`#${s.id}`}
            className="flex flex-col gap-1 rounded-xl bg-card px-4 py-3 ring-1 ring-border transition-colors hover:ring-primary/60"
          >
            <span className="text-sm font-semibold">{s.titulo}</span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {s.entries.length} {s.entries.length === 1 ? "verbete" : "verbetes"}
            </span>
          </Link>
        ))}
      </nav>

      <section id="caminho" className="scroll-mt-[calc(var(--top-nav-h)+15px)] space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">O caminho de uma nota</h2>
          <p className="text-sm text-muted-foreground">
            Da esquerda para a direita: o que entra, o que é calculado com isso, e o número que ordena a
            lista.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <Etapa titulo="as entradas">
            <No nome="9 atributos" desc="a IA lê o consenso de até 30 reviews de 8 fontes" tone="ia" />
            <No nome="Média externa · Votos" desc="AniList, MyAnimeList, Kitsu…" tone="ext" />
            <No nome="Capítulos · Ano · Status" desc="a ficha da obra" tone="ext" />
            <No nome="Suas tags · seu Interesse" desc="o que você declarou" tone="voce" />
          </Etapa>

          <Etapa titulo="o que é calculado com isso">
            <No nome="Nota.IA" desc="os 9 somados pela sua ênfase" />
            <Seta>→</Seta>
            <No nome="Nota.Calc" desc="a Nota.IA misturada com a nota externa, por volume de votos" />
            <Seta>→</Seta>
            <No
              nome="Nota Prevista"
              desc={`regressão treinada nas obras que você já avaliou (mínimo de ${MIN_TRAIN})`}
              tone="out"
            />
          </Etapa>

          <Etapa titulo="e o número que ordena">
            <No nome="Nota Prevista" desc="a âncora" tone="out" />
            <Seta>+</Seta>
            <No nome="Veredito IA" desc="ajuste, só nas obras que passaram pelo Rankear" tone="ia" />
            <Seta>=</Seta>
            <No nome="Prioridade" desc="o que ordena o /ranking" tone="out" />
          </Etapa>
        </div>

        <p className="max-w-[82ch] rounded-r-lg border-l-[3px] border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed">
          <b className="font-semibold">O Alinhamento não aparece nesta cadeia, e isso é o ponto.</b> As tags
          que ele mede já entram na Nota Prevista por outro caminho, com peso aprendido nas suas notas.
          Somá-lo de novo por cima contaria o mesmo sinal duas vezes — foi medido, e não melhora a ordem.
        </p>
      </section>

      {secoes.map((secao) => (
        <section key={secao.id} id={secao.id} className="scroll-mt-[calc(var(--top-nav-h)+15px)] space-y-2">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">{secao.titulo}</h2>
            <p className="max-w-[80ch] text-sm text-muted-foreground">{secao.sub}</p>
          </div>
          <div className="flex flex-col">
            {secao.entries.map((entry, i) => (
              <ScoreEntryCard
                key={entry.key}
                entry={entry}
                coverage={cobertura(entry)}
                coverageNeedsSession={precisaSessao(entry)}
                first={i === 0}
              />
            ))}
          </div>

          {secao.refs && secao.refs.length > 0 && (
            <div className="mt-2 rounded-xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                <b className="font-semibold text-foreground">
                  Outras {secao.refs.length} entradas já estão explicadas acima
                </b>{" "}
                — são as mesmas medidas da tela, entrando no modelo:
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {secao.refs.map((f) => (
                  <li key={f.key}>
                    <Link
                      href={`#${f.sameAs}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/40 px-2.5 py-1 text-xs hover:border-primary/50"
                    >
                      <span className="font-semibold">{f.name}</span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">{f.slug}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}

      <section id="recalculo" className="scroll-mt-[calc(var(--top-nav-h)+15px)] space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">O que faz as notas serem refeitas</h2>
          <p className="max-w-[80ch] text-sm text-muted-foreground">
            Quando um destes muda, o botão “Recalcular notas” acende. Os de catálogo valem para qualquer
            pessoa que os mexa; os pessoais só contam quando é o dono do catálogo.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ListaDeEntradas titulo="Catálogo" itens={[...RECALC_CATALOGO]} />
          <ListaDeEntradas titulo="Pessoais" itens={[...RECALC_PESSOAL]} />
        </div>
      </section>

      <section id="fora" className="scroll-mt-[calc(var(--top-nav-h)+15px)] space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">O que não entra em nota nenhuma</h2>
          <p className="max-w-[80ch] text-sm text-muted-foreground">
            Metade das dúvidas sobre o cálculo é sobre o que ficou de fora.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SCORE_EXCLUSIONS.map((x) => (
            <div
              key={x.slug}
              className="flex flex-col gap-1 rounded-xl border border-dashed border-border bg-card/60 px-4 py-3"
            >
              <span className="text-sm font-semibold">{x.name}</span>
              <span className="break-all font-mono text-[10.5px] text-muted-foreground">{x.slug}</span>
              {x.why && <span className="text-[13px] leading-snug text-muted-foreground">{x.why}</span>}
            </div>
          ))}
        </div>
      </section>

      <BackToTop label="Voltar ao início" />
    </div>
  )
}

function Etapa({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {titulo}
      </span>
      <div className="flex flex-wrap items-stretch gap-2">{children}</div>
    </div>
  )
}

function Seta({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center font-mono text-muted-foreground">
      {children}
    </span>
  )
}

function No({
  nome,
  desc,
  tone,
}: {
  nome: string
  desc: string
  tone?: "out" | "ia" | "voce" | "ext"
}) {
  const cls =
    tone === "out"
      ? "ring-primary/45 bg-primary/10"
      : tone === "ia"
        ? "ring-violet-500/40 bg-violet-500/[0.09]"
        : tone === "voce"
          ? "ring-emerald-500/35 bg-emerald-500/[0.08]"
          : "ring-border bg-background/40"
  return (
    <div className={`flex min-w-0 flex-1 basis-[132px] flex-col gap-0.5 rounded-lg p-3 ring-1 ${cls}`}>
      <b className={`text-sm font-semibold ${tone === "out" ? "text-primary" : ""}`}>{nome}</b>
      <span className="text-[11.5px] leading-snug text-muted-foreground">{desc}</span>
    </div>
  )
}

function ListaDeEntradas({ titulo, itens }: { titulo: string; itens: Array<keyof typeof RECALC_INPUT_LABELS> }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {titulo}
      </span>
      <ul className="mt-2 space-y-1.5">
        {itens.map((i) => (
          <li key={i} className="flex flex-col text-sm">
            <span>{RECALC_INPUT_LABELS[i]}</span>
            <span className="font-mono text-[10.5px] text-muted-foreground">{i}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
