/**
 * A FAIXA de um número 0–100 do consultor IA — dono único.
 *
 * 🔴 Estava escrita **três vezes**, e duas delas descrevem o MESMO número: a coluna "Ver."
 * do `/ranking` (`ranking-cells.tsx`) e o card do Veredito na página da obra
 * (`app/catalog/[id]/page.tsx`). A terceira é o `match_score` do Deep Dive — outro número,
 * mesma escala e mesma linguagem visual. Enquanto cada tela montava a própria rampa, mudar
 * uma cor fazia o mesmo 55 sair cinza na lista e âmbar na obra, sem erro e sem log: a família
 * "dois critérios pro mesmo fato" do CLAUDE.md, aqui decidindo o que a pessoa vê.
 *
 * A régua (escolha da Ana, 17/08/2026) é de **SEMÁFORO, não de colorimetria**:
 *
 * | faixa | corte | cor | o que diz |
 * |---|---|---|---|
 * | `forte` | ≥ 80 | violeta | combina muito |
 * | `bom`   | ≥ 60 | azul    | combina |
 * | `morno` | ≥ 40 | cinza   | neutro — nem chama nem afasta |
 * | `fraco` | < 40 | âmbar   | a IA acha que NÃO é pra você |
 *
 * 🔴 **O âmbar no FUNDO da rampa é deliberado, e contraria o que este arquivo faria por
 * colorimetria.** Numa rampa contínua o amarelo é a cor do MEIO (é o que `STATUS_TONE`
 * registra sobre escalas de valor), e até 17/08 era assim: `≥40` âmbar e `<40` cinza. O
 * argumento que decidiu não é de cor, é de convenção adquirida — **amarelo já significa
 * "pior que o neutro"** em toda sinalização, então o cinza é quem descreve o morno e o âmbar
 * é quem avisa. Trocar de volta é trocar a régua inteira, não uma cor.
 *
 * ⚠️ **O preço, aceito e medido:** âmbar é a cor do "desatualizado" em `lib/ui/status-tone.ts`,
 * e o ⟳ âmbar do Veredito stale fica a 4px da pílula, na MESMA célula. Uma obra com veredito
 * baixo e re-rank desatualizado mostra dois âmbares vizinhos que falam de coisas diferentes.
 * Quem separa é a forma (pílula com número × ícone) e o esmaecimento da pílula stale.
 *
 * ⚠️ **`border-<cor>` NÃO entra aqui porque não pinta.** Conferido no CSS servido em
 * 17/08/2026: `.border-violet-500\/40` é gerada dentro de `@layer utilities` (linha 5331) e o
 * `* { border-color: hsl(var(--border)) }` do `globals.css` está FORA de layer (linha 18979) —
 * CSS sem layer vence layered independente de especificidade. As três telas carregavam
 * `border-<cor>-500/40` desde sempre e nenhuma pintou: a borda é o neutro do tema. As classes
 * mortas saíram daqui em vez de serem herdadas pelo dono novo. Devolver a cor à borda é um
 * `ring-1 ring-<cor>-500/40` (o `ring` do `confidenceBadgeClass` existe pelo mesmo motivo) —
 * decisão de aparência, não deste PR.
 */

export const VERDICT_BAND_CUTOFFS = { forte: 80, bom: 60, morno: 40 } as const

export type VerdictBand = "forte" | "bom" | "morno" | "fraco"

export function verdictBand(score: number): VerdictBand {
  if (score >= VERDICT_BAND_CUTOFFS.forte) return "forte"
  if (score >= VERDICT_BAND_CUTOFFS.bom) return "bom"
  if (score >= VERDICT_BAND_CUTOFFS.morno) return "morno"
  return "fraco"
}

/**
 * Fundo em ALFA + texto, nunca `bg-<cor>-50`: o app é escuro por padrão e não tem seletor de
 * tema, então fundo claro fixo vira pílula branca sobre card escuro em toda visita.
 */
const BAND_TONE: Record<VerdictBand, string> = {
  forte: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  bom: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  morno: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  fraco: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
}

/** As classes de COR da faixa. Quem chama põe a própria forma (raio, padding, borda). */
export function verdictBandClass(score: number): string {
  return BAND_TONE[verdictBand(score)]
}
