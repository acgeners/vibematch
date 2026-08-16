import Link from "next/link"
import { BookOpenText } from "lucide-react"
import { Header } from "@/components/layout/header"
import { AttributeIndex } from "@/components/guide/attribute-index"
import { attributeArtSrc, buildGlossary } from "@/lib/criteria/glossary"

export const dynamic = "force-dynamic"
export const metadata = { title: "Dicionário dos atributos" }

/**
 * O dicionário dos 9 atributos: o que cada critério mede e o que cada faixa quer dizer.
 *
 * A rubrica existia em dois lugares e nenhum era tela — a tabela `criteria` no Supabase e o
 * prompt da avaliação. Na interface só apareciam pedaços: a página da obra mostra a faixa
 * DAQUELA obra, o formulário pós-leitura mostra a da nota que você arrasta, e `/preferences`
 * mostra a descrição sem as faixas. Quem quisesse saber a diferença entre 6 e 8 em drama não
 * tinha onde ler.
 *
 * 🔴 Todo o texto DERIVA de `CRITERIA_INFO` + `CRITERIA_RUBRICS` (ver `lib/criteria/glossary.ts`).
 * Uma cópia em prosa aqui envelheceria em silêncio, e a página existe justamente para
 * responder o que a IA leu ao pontuar — respondendo diferente, ela é pior que ausente.
 */
export default function DicionarioDeAtributosPage() {
  const entries = buildGlossary()
  // As faixas são as mesmas nos nove critérios; a legenda de cobertura sai do primeiro que
  // tiver rubrica, nunca de uma lista escrita à mão (o corte é `bandBarBounds`).
  const faixas = entries.find((e) => e.bands.length > 0)?.bands ?? []

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <Header
        icon={<BookOpenText />}
        title="Dicionário dos atributos"
        description="Os nove critérios que a IA atribui a cada obra, de 0 a 10, lendo o consenso de até 30 reviews de 8 fontes. É esta rubrica que decide o que “romance 7,5” quer dizer."
      />

      <AttributeIndex
        items={entries.map((e) => ({
          slug: e.slug,
          name: e.name,
          icon: attributeArtSrc(e.slug, 160),
        }))}
      />

      <section
        id="escala"
        className="space-y-4 scroll-mt-[var(--anchor-offset,164px)]"
      >
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Como ler a escala</h2>
          <p className="text-sm text-muted-foreground">
            As quatro faixas são as mesmas nos nove critérios. O rótulo muda; os cortes, não.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {faixas.map((faixa, i) => (
            <div key={faixa.band} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
              <span className="font-mono text-lg font-semibold tabular-nums tracking-tight">
                {faixa.band.replace("-", "–")}
              </span>
              <span className="flex gap-1" aria-hidden="true">
                {faixas.map((_, j) => (
                  <i
                    key={j}
                    className={`h-1.5 flex-1 rounded-full ${j <= i ? "bg-primary" : "bg-muted"}`}
                  />
                ))}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                cobre {faixa.covers}
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <p className="max-w-[82ch] rounded-r-lg border-l-[3px] border-amber-500/45 bg-amber-500/[0.09] px-4 py-3 text-sm leading-relaxed">
            <b className="font-semibold text-amber-700 dark:text-amber-300">
              O rótulo mente sobre o meio ponto.
            </b>{" "}
            Escritas assim, as faixas não cobrem 3,5 · 6,5 · 8,5 — mas o bin real é semiaberto,
            então <b className="font-semibold">8,5 é “7–8”</b>, não 9–10. A faixa exibida sai
            sempre da nota vigente, nunca da faixa que a IA citou na prosa: a nota pode ter sido
            editada ou movida por regra depois.
          </p>
          <p className="max-w-[82ch] rounded-r-lg border-l-[3px] border-amber-500/45 bg-amber-500/[0.09] px-4 py-3 text-sm leading-relaxed">
            <b className="font-semibold text-amber-700 dark:text-amber-300">
              Oito critérios medem presença; um mede valência.
            </b>{" "}
            Em oito deles 0 é “não está lá” e 10 é “domina a obra” — nota alta não é elogio nem
            crítica. Dinâmica entre Protagonistas é a exceção, e o verbete dela explica.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Os nove lado a lado</h2>
          <p className="text-sm text-muted-foreground">
            Só os rótulos das faixas — clique numa linha para abrir o verbete completo.
          </p>
        </div>

        {/* A tabela é larga e rola SOZINHA: sem este contêiner, quem sai de lado é a página
            inteira, e aí o índice grudado sai junto do lugar. */}
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                <th className="border-b border-border px-4 py-3 text-left font-mono text-[10.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">
                  Atributo
                </th>
                {faixas.map((faixa) => (
                  <th
                    key={faixa.band}
                    className="whitespace-nowrap border-b border-border px-4 py-3 text-left font-mono text-[10.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground"
                  >
                    {faixa.band.replace("-", "–")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.slug} className="border-b border-border/60 last:border-b-0 hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <Link href={`#${entry.slug}`} className="flex items-center gap-2.5 whitespace-nowrap font-semibold">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attributeArtSrc(entry.slug, 64)}
                        alt=""
                        width={26}
                        height={26}
                        className="size-[26px] shrink-0"
                      />
                      {entry.name}
                    </Link>
                  </td>
                  {entry.bands.map((faixa, j) => (
                    <td key={faixa.band} className="px-4 py-2.5">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          j === entry.bands.length - 1
                            ? "bg-primary text-primary-foreground"
                            : "bg-primary/15 text-primary"
                        }`}
                      >
                        {faixa.label}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Os nove verbetes</h2>
        <p className="text-sm text-muted-foreground">
          O texto de cada faixa é o mesmo que a IA lê ao pontuar.
        </p>
      </section>

      <div className="flex flex-col">
        {entries.map((entry, i) => (
          <article
            key={entry.slug}
            id={entry.slug}
            className={`grid scroll-mt-[var(--anchor-offset,164px)] gap-6 py-8 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8 ${
              i === 0 ? "pt-2" : "border-t border-border"
            }`}
          >
            <div className="w-full max-w-[200px] self-start md:sticky md:top-[var(--anchor-offset,164px)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attributeArtSrc(entry.slug, 480)}
                alt={`Arte do atributo ${entry.name}`}
                width={480}
                height={480}
                className="aspect-square w-full object-contain"
              />
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight">{entry.name}</h3>
                <span className="font-mono text-[11.5px] text-muted-foreground">{entry.slug}</span>
              </div>

              {entry.description.split("\n").map((paragrafo, j) => (
                <p key={j} className="max-w-[68ch] text-[15px] leading-relaxed text-muted-foreground">
                  {paragrafo}
                </p>
              ))}

              <div className="flex flex-col gap-2">
                {entry.bands.map((faixa, j) => (
                  <div
                    key={faixa.band}
                    className="grid items-start gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[86px_minmax(0,1fr)] sm:gap-4"
                  >
                    <div className="flex flex-col gap-1.5">
                      <span
                        className={`rounded-md py-1 text-center font-mono text-xs font-semibold tabular-nums ${
                          j === entry.bands.length - 1
                            ? "bg-primary text-primary-foreground"
                            : "bg-primary/15 text-primary"
                        }`}
                      >
                        {faixa.band.replace("-", "–")}
                      </span>
                      <span className="flex gap-1" aria-hidden="true">
                        {entry.bands.map((_, k) => (
                          <i
                            key={k}
                            className={`h-1 flex-1 rounded-full ${k === j ? "bg-primary" : "bg-muted"}`}
                          />
                        ))}
                      </span>
                      <span className="text-center font-mono text-[10px] tabular-nums text-muted-foreground">
                        {faixa.covers}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-[15px] font-semibold">{faixa.label}</h4>
                      {faixa.text && (
                        <p className="max-w-[76ch] text-sm leading-relaxed text-muted-foreground">
                          {faixa.text}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {entry.note && (
                <p className="max-w-[76ch] rounded-r-lg border-l-[3px] border-amber-500/45 bg-amber-500/[0.09] px-4 py-3 text-[13.5px] leading-relaxed">
                  <b className="font-semibold text-amber-700 dark:text-amber-300">
                    {entry.note.title}
                  </b>{" "}
                  {entry.note.body}
                </p>
              )}
            </div>
          </article>
        ))}
      </div>

      <footer className="grid gap-6 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <h4 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
            De onde vem o texto
          </h4>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Da tabela <code className="font-mono text-primary">criteria</code> no Supabase, a mesma
            que o prompt da avaliação lê. Mudar uma faixa no banco muda a régua da IA e esta página
            junto, sem editar código.
          </p>
        </div>
        <div>
          <h4 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
            Onde a nota é usada
          </h4>
          <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-muted-foreground">
            <li>Filtros por atributo e desempate do Ranking.</li>
            <li>Os chips de atributo em destaque no card da obra.</li>
            <li>Como entrada da Nota Prevista.</li>
          </ul>
        </div>
        <div>
          <h4 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
            Continue
          </h4>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            <Link href="/guide" className="font-semibold text-primary hover:underline">
              O guia dos números
            </Link>{" "}
            explica a Nota Prevista, o Interesse e as tags que você ama ou evita.
          </p>
        </div>
      </footer>
    </div>
  )
}
