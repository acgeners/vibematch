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

const FORCE_CLASS: Record<ForceKey, { text: string; fill: string }> = {
  chance: { text: "text-violet-500 dark:text-violet-400", fill: "bg-violet-500 dark:bg-violet-400" },
  avaliacao: { text: "text-amber-600 dark:text-amber-400", fill: "bg-amber-600 dark:bg-amber-400" },
  // ⚠️ slate-500/300, não o slate-400 da Bússola: no /ranking o texto secundário
  // JÁ é slate-400, e as duas cores coincidindo faziam a linha de Alcance ler como
  // desabilitada em vez de "terceira força". Medido: contraste 1,67:1 entre elas.
  alcance: { text: "text-slate-600 dark:text-slate-300", fill: "bg-slate-600 dark:bg-slate-300" },
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

/** Legenda da coluna: ensina os 3 ícones e o que a régua mede. Uma vez, no header. */
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

/** A trilha com a régua de 1σ e a baseline central. Compartilhada pelos dois estados. */
function Track({ children, title }: { children?: React.ReactNode; title: string }) {
  return (
    <span
      title={title}
      className="relative block h-3.5 w-[92px] shrink-0 overflow-hidden rounded-[3px] bg-foreground/[0.07]"
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
 * afirmar mais do que o dado sustenta: "a mais alta do grupo" só quando é o
 * máximo ÚNICO — com duas obras empatadas no topo, seria falso nas duas.
 */
function tail(rank: WorkSeparator["rank"]): string {
  if (rank === "max") return "a mais alta do grupo"
  if (rank === "min") return "a mais baixa do grupo"
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
    return (
      <Track title="Na média do grupo — nenhuma força destoa 1σ das empatadas">
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/75"
        />
        <span className="sr-only">Na média do grupo</span>
      </Track>
    )
  }

  const { force, z, rank } = separator
  const up = z > 0
  const width = Math.min(1, Math.abs(z) / Z_SCALE) * 50
  const cls = FORCE_CLASS[force]

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Track title={`${FORCE_NAME[force]}: ${value} — desvio da média do grupo, cada divisão vale 1σ`}>
        <span
          aria-hidden
          className={cn("absolute inset-y-[3px] min-w-[2px] rounded-[2px]", cls.fill)}
          style={up ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
        />
      </Track>
      <ForceIcon force={force} className={cls.text} />
      <span className="min-w-0 truncate text-[11.5px] leading-tight">
        <b className={cn("font-semibold", cls.text)}>{value}</b> {tail(rank)}{" "}
        <span className="font-mono tabular-nums text-muted-foreground/70">
          {up ? "+" : "−"}
          {Math.abs(z).toFixed(1).replace(".", ",")}σ
        </span>
      </span>
    </span>
  )
}
