import { cn } from "@/lib/utils"
import type { ForceKey, WorkSeparator } from "@/lib/ranking/why-this-work"

/**
 * "O que a separa das outras" — a força que mais distancia uma obra das empatadas
 * no mesmo tier, desenhada como BARRA DIVERGENTE.
 *
 * 🔴 **Plota o DESVIO, não o nível — e essa é a decisão que faz a peça funcionar.**
 * A primeira versão eram três barrinhas com o nível absoluto (0–100) de cada força.
 * Medido: no topo do acervo a crítica vai de 73 a 88, ou seja **3 px de variação
 * numa barra de 18 px**. Ela mostrava fielmente uma diferença que ninguém enxerga —
 * o mesmo erro que o #322 consertou nos pontos da Bússola (lá metade do acervo
 * cabia em 2,4 px de diâmetro). Com o desvio, a amplitude útil vira −2,5σ a +2,3σ
 * e ocupa a barra inteira.
 *
 * A baseline no centro (= média do grupo) é o que torna as linhas comparáveis
 * entre si: sem ela, cada barra teria uma origem diferente.
 */

/** |z| onde a barra satura. O maior observado no acervo é 2,5 (medido 2026-08-06). */
const Z_SCALE = 2.5

/** Ticks a cada 1σ. A régua é o que dá GRANDEZA ao desvio — sem ela a barra
 *  informa direção e "mais ou menos", mas não quanto. */
const TICKS_SIGMA = [-2, -1, 1, 2] as const

/**
 * A cor é da FORÇA; o preenchimento é do SINAL.
 *
 * 🔴 **A direção estava só na posição da barra, e ela é fraca em coluna.** Os dois lados da
 * baseline usavam o mesmo bloco chapado, então distinguir "+2,6σ" de "−2,4σ" exigia localizar o
 * fio central e decidir de que lado o retângulo começa — a cada linha, numa lista feita para ser
 * varrida na vertical. Hoje **acima da média é sólido; abaixo é contorno cheio com o miolo
 * fraco**, que é a convenção de barra divergente e não gasta uma segunda cor.
 *
 * ⚠️ **Alfa SOZINHO não serve, e é por isso que há o `ring` junto.** Barra translúcida sem
 * borda lê como *desabilitada* — e a coluna já tem um estado que significa exatamente isso (a
 * trilha vazia da obra sem separador). O contorno em força total é o que diz "isto é uma
 * medida, e ela aponta para baixo", em vez de "isto está apagado".
 *
 * ⚠️ **O ALFA vive só no preenchimento — nunca no texto.** O valor (`8,6`) e o ícone seguem na
 * cor cheia: são 11,5px, e baixar o contraste deles trocaria uma leitura por outra. O sinal
 * também continua escrito no σ (`−2,4σ`); a barra reforça, não substitui.
 */
const FORCE_CLASS: Record<ForceKey, { text: string; up: string; down: string }> = {
  chance: {
    text: "text-violet-500 dark:text-violet-400",
    up: "bg-violet-500 dark:bg-violet-400",
    down: "bg-violet-500/30 ring-1 ring-inset ring-violet-500 dark:bg-violet-400/30 dark:ring-violet-400",
  },
  avaliacao: {
    text: "text-amber-600 dark:text-amber-400",
    up: "bg-amber-600 dark:bg-amber-400",
    down: "bg-amber-600/30 ring-1 ring-inset ring-amber-600 dark:bg-amber-400/30 dark:ring-amber-400",
  },
  // ⚠️ slate-500/300, não o slate-400 da Bússola: no /ranking o texto secundário
  // JÁ é slate-400, e as duas cores coincidindo faziam a linha de Alcance ler como
  // desabilitada em vez de "terceira força". Medido: contraste 1,67:1 entre elas.
  alcance: {
    text: "text-slate-600 dark:text-slate-300",
    up: "bg-slate-600 dark:bg-slate-300",
    down: "bg-slate-600/30 ring-1 ring-inset ring-slate-600 dark:bg-slate-300/30 dark:ring-slate-300",
  },
}

/** Ícone por força — substitui a palavra na linha; a legenda ensina uma vez só. */
export function ForceIcon({ force, className }: { force: ForceKey; className?: string }) {
  const common = { viewBox: "0 0 16 16", className: cn("size-3 shrink-0", className), "aria-hidden": true } as const
  if (force === "chance")
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.6}>
        <circle cx="8" cy="8" r="6" />
        <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    )
  if (force === "avaliacao")
    return (
      <svg {...common} fill="currentColor">
        <path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
      </svg>
    )
  return (
    <svg {...common} fill="currentColor">
      <circle cx="5.5" cy="5.5" r="2.4" />
      <circle cx="11" cy="6.2" r="1.9" />
      <path d="M1.2 13.4c0-2.2 1.9-3.7 4.3-3.7s4.3 1.5 4.3 3.7z" />
      <path d="M10.6 9.9c2 .1 3.5 1.5 3.5 3.5h-3.2c0-1.3-.4-2.5-1.1-3.4z" />
    </svg>
  )
}

const FORCE_NAME: Record<ForceKey, string> = { chance: "chance", avaliacao: "crítica", alcance: "alcance" }

/**
 * Legenda da coluna: os 3 ícones de força e o que a régua mede.
 *
 * 🔴 **Ela mora na LINHA DO DIVISOR de tier, não no cabeçalho da coluna** (escolha da Ana,
 * 17/08/2026 — trocou de lugar com os chips de composição, que subiram para junto do rótulo do
 * tier). O cabeçalho foi onde ela nasceu e é o pior lugar possível: ali ela disputa a largura
 * de UMA coluna e cobra altura da linha INTEIRA. Medido no browser: 260px a 8,5px, contra 274
 * de conteúdo disponível — cabia por 14px, e só depois que a coluna passou de 100 para 296.
 * Na linha do divisor o `colSpan` é cheio e a restrição some.
 *
 * ⚠️ **O tamanho default (8,5px) é herança daquele aperto** — quem a desenha no divisor sobe
 * para 10px pelo `className`. Se ela um dia voltar para um espaço estreito, 9px já quebra a
 * linha (medido: 271px).
 *
 * ⚠️ Uma cópia só, num lugar só. Ela já esteve simultaneamente no tooltip do cabeçalho e no
 * `<th>`; duas cópias do mesmo texto divergem na primeira edição.
 */
export function SeparatorLegend({ className }: { className?: string }) {
  return (
    <span className={cn("mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[8.5px] font-semibold normal-case tracking-normal", className)}>
      {(Object.keys(FORCE_NAME) as ForceKey[]).map((f) => (
        <span key={f} className={cn("inline-flex items-center gap-1", FORCE_CLASS[f].text)}>
          <ForceIcon force={f} className="size-2.5" />
          {FORCE_NAME[f]}
        </span>
      ))}
      <span className="font-mono text-muted-foreground/70">│ cada divisão = 1σ</span>
    </span>
  )
}

/**
 * A trilha com a régua de 1σ e a baseline central. Compartilhada pelos dois estados.
 *
 * ⚠️ Ela ENCOLHE no degrau mais estreito (92 → 64px). A barra é proporcional e os ticks
 * acompanham, então continua correta — e é o que dá espaço pro VALOR caber em vez de ser
 * cortado ao meio: a 160px de coluna, 92px de trilha deixavam 16px pra "28,4K".
 */
function Track({ children, title }: { children?: React.ReactNode; title: string }) {
  return (
    <span
      title={title}
      className="relative block h-3.5 w-16 shrink-0 overflow-hidden rounded-[3px] bg-foreground/[0.07] @[200px]:w-[92px]"
    >
      {TICKS_SIGMA.map((k) => (
        <span
          key={k}
          aria-hidden
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: `${50 + (k / Z_SCALE) * 50}%` }}
        />
      ))}
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground/55" />
      {children}
    </span>
  )
}

/**
 * Frase do separador. O `rank` vem da função pura e é o que impede o texto de
 * afirmar mais do que o dado sustenta: "a mais alta" só quando é o máximo ÚNICO
 * — com duas obras empatadas no topo, seria falso nas duas.
 *
 * ⚠️ Dizia "a mais alta DO GRUPO", e o "do grupo" saiu por largura medida (−50px numa coluna
 * que raramente passa de 260): a linha divisória logo acima já nomeia o grupo ("3 obras de
 * prioridade equivalente") e o `title` da trilha continua dizendo "da média do grupo" por
 * extenso. Repetir o enquadramento em toda linha custava justamente o espaço do σ.
 */
function tail(rank: WorkSeparator["rank"]): string {
  if (rank === "max") return "a mais alta"
  if (rank === "min") return "a mais baixa"
  return rank === "above" ? "acima da média" : "abaixo da média"
}

/**
 * Valor da força na unidade em que ela é lida: Chance em %, Avaliação na escala
 * 0–10 da nota externa, Alcance em votos abreviados (28.442 → 28,4K).
 *
 * ⚠️ O separador guarda a força NORMALIZADA (0–100). Mostrar "95" para 28 mil
 * votos não diria nada a ninguém — por isso o valor exibido volta do `entry`.
 *
 * Mora aqui, junto do componente que o consome, desde que a view Faixas foi
 * absorvida pela Lista (era `ranking-bands-view.tsx`).
 */
export function separatorValue(
  entry: { platformAvg: number | null; totalVotes: number },
  sep: WorkSeparator | null,
): string | null {
  if (!sep) return null
  if (sep.force === "chance") return `${sep.value}%`
  if (sep.force === "avaliacao")
    return entry.platformAvg == null ? null : entry.platformAvg.toFixed(1).replace(".", ",")
  return formatSeparatorVotes(entry.totalVotes)
}

/** Mesma regra do `formatVotes` da view Cards — um só jeito de escrever votos. */
function formatSeparatorVotes(votes: number): string {
  if (votes === 0) return "—"
  if (votes < 1000) return String(votes)
  const k = Math.floor(votes / 100) / 10
  return `${k % 1 === 0 ? String(k) : k.toFixed(1).replace(".", ",")}K`
}

export function SeparatorCell({
  separator,
  value,
}: {
  separator: WorkSeparator | null
  /** Valor já formatado na unidade da força (76%, 8,8, 28,4K) — quem chama sabe formatar. */
  value: string | null
}) {
  // Sem separador: a MESMA trilha, vazia, com a marca no centro — que é onde a
  // obra está, na média do grupo. Dizer isso por extenso em toda linha (era
  // "— nada a separa daqui") repetia um texto longo dezenas de vezes.
  if (!separator || value == null) {
    // O `@container` também aqui: sem ele o `@[200px]:w-[92px]` da trilha não resolve e a
    // linha vazia fica com a barra estreita ao lado das cheias, que é largura demais pra
    // diferença NENHUMA — as duas têm que medir o mesmo.
    return (
      <span className="@container flex min-w-0 items-center">
        <Track title="Na média do grupo — nenhuma força destoa 1σ das empatadas">
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/75"
          />
          <span className="sr-only">Na média do grupo</span>
        </Track>
      </span>
    )
  }

  const { force, z, rank } = separator
  const up = z > 0
  const width = Math.min(1, Math.abs(z) / Z_SCALE) * 50
  const cls = FORCE_CLASS[force]

  return (
    <span className="@container flex min-w-0 items-center gap-2">
      <Track title={`${FORCE_NAME[force]}: ${value} ${tail(rank)} — desvio da média do grupo, cada divisão vale 1σ`}>
        {/* Sólido acima da média, contorno abaixo — ver o docblock de `FORCE_CLASS`. */}
        <span
          aria-hidden
          className={cn("absolute inset-y-[3px] min-w-[2px] rounded-[2px]", up ? cls.up : cls.down)}
          style={up ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
        />
      </Track>
      <ForceIcon force={force} className={cls.text} />
      {/* 🔴 **A célula cede por PARTES, e a ordem do sacrifício é medida.** As larguras da
          tabela são proporcionais e não há scroll horizontal, então esta coluna vive apertada:
          com os três pedaços num span só, o `overflow` do `td` cortava do fim para o começo —
          sumia o σ e, a 200px, o próprio VALOR ("8… +1,2σ"), que é o conteúdo da célula.
          Truncar também não bastava: abaixo de ~230px não sobra o que truncar e o corte cai no
          meio de um número.

          Hoje quem manda é o container query da própria célula:
            ≥ 270px  barra · ícone · valor · frase · σ
            ≥ 200px  a FRASE sai — a barra já diz o que ela diz (lado = direção, divisões = 1σ)
            abaixo   sai o σ — a barra continua mostrando a grandeza, com os ticks de 1σ
          O `title` da barra carrega a frase inteira em qualquer largura, então nada do que sai
          fica inalcançável. */}
      <span className="flex min-w-0 items-baseline gap-1 text-[11.5px] leading-tight">
        <b className={cn("shrink-0 font-semibold", cls.text)}>{value}</b>
        <span className="hidden min-w-0 truncate @[270px]:inline">{tail(rank)}</span>
        <span className="hidden shrink-0 font-mono tabular-nums text-muted-foreground/70 @[200px]:inline">
          {up ? "+" : "−"}
          {Math.abs(z).toFixed(1).replace(".", ",")}σ
        </span>
      </span>
    </span>
  )
}
