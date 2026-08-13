/**
 * Régua de COR DE ESTADO — dono único (2026-08-12).
 *
 * Antes disto, o âmbar dizia cinco coisas diferentes na mesma página da obra:
 * "Desatualizado" (Veredito), "Previsão desatualizada" (Interesse), "Inputs: média",
 * "avisos de conteúdo", "síntese corrompida" e "inferência de tags: nunca rodou" —
 * mais o meio das escalas de nota. Quando tudo é âmbar, nada é urgente: o que CHAMA
 * AÇÃO some no meio do que só descreve.
 *
 * A régua tem seis papéis, e a pergunta que separa um do outro é sempre a mesma —
 * **o que eu faço com isso?**
 *
 * | tom       | quer dizer                                                        |
 * |-----------|-------------------------------------------------------------------|
 * | `stale`   | existe, mas os inputs mudaram depois ⇒ não aplique sem refazer     |
 * | `pending` | nunca rodou ou está na fila ⇒ falta uma ação sua                   |
 * | `ok`      | confirmado / aplicado ⇒ nada a fazer                               |
 * | `failed`  | quebrou, corrompeu ou falta input obrigatório ⇒ não dá pra usar    |
 * | `content` | fato sobre a OBRA (avisos, 18+) ⇒ quem lê decide, não é do sistema |
 * | `absent`  | ausente / não se aplica ⇒ nem bom nem ruim                        |
 *
 * 🔴 **`stale` é o único âmbar.** Foi a escolha da Ana em 12/08/2026, e o motivo é
 * frequência: "desatualizado" aparece em quatro pontos da página (Veredito, Interesse,
 * Estrutura de abertura, IA-Rk) e é o estado mais acionável dela. Os avisos de conteúdo
 * foram para o vermelho, na mesma família do selo 🔞 18+ — os dois falam da obra, não
 * do sistema, e ali a proximidade é coerência, não colisão.
 *
 * ⚠️ **Proveniência de IA NÃO está aqui.** O violeta do ✨ (`AiProvenanceSeal`) não é
 * estado: ele responde "quem escreveu isto", não "o que eu faço com isso". Misturar os
 * dois faria a régua autorizar violeta em chip de estado.
 *
 * ⚠️ **Escala de VALOR não é estado.** Nota, similaridade, alinhamento e veredito são
 * rampas contínuas e vêm sempre com o número ao lado (`8,4`, `72%`) — elas seguem
 * usando amarelo no meio da rampa sem ambiguidade, porque ninguém lê "8,4" como estado.
 * O que a régua proíbe é **chip de palavra** em âmbar que não seja "desatualizado".
 *
 * ⚠️ **`border-<cor>` não pinta neste app**: o `* { border-color }` de `globals.css`
 * (fora de `@layer`) vence utilities no Tailwind v4. Por isso `box` usa `ring-*` e
 * `outline` carrega `!`. Descobrir isso de novo custa meia hora por componente.
 */

export type StatusTone = "stale" | "pending" | "ok" | "failed" | "content" | "absent"

export interface StatusToneClasses {
  /** Só a cor do texto — pro estado que vive dentro de uma frase. */
  text: string
  /** Chip fechado (pílula): fundo + borda + texto. */
  chip: string
  /** Caixa/painel: fundo + anel. Borda colorida só sai com `ring-*` (ver acima). */
  box: string
  /** Anel isolado, pra pendurar num container que já tem fundo próprio. */
  ring: string
  /** Realce de borda num elemento existente — precisa do `!` (ver acima). */
  outline: string
}

export const STATUS_TONE: Record<StatusTone, StatusToneClasses> = {
  stale: {
    text: "text-amber-600 dark:text-amber-400",
    chip: "border-amber-500/55 bg-amber-500/15 text-amber-600 dark:text-amber-400",
    box: "bg-amber-500/10 ring-1 ring-amber-500/30",
    ring: "ring-1 ring-amber-500/30",
    outline: "border-amber-600! dark:border-amber-400!",
  },
  pending: {
    text: "text-sky-600 dark:text-sky-300",
    chip: "border-sky-500/55 bg-sky-500/15 text-sky-600 dark:text-sky-300",
    box: "bg-sky-500/10 ring-1 ring-sky-500/30",
    ring: "ring-1 ring-sky-500/30",
    outline: "border-sky-600! dark:border-sky-300!",
  },
  ok: {
    text: "text-emerald-600 dark:text-emerald-300",
    chip: "border-emerald-500/55 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    box: "bg-emerald-500/10 ring-1 ring-emerald-500/30",
    ring: "ring-1 ring-emerald-500/30",
    outline: "border-emerald-600! dark:border-emerald-300!",
  },
  failed: {
    text: "text-rose-600 dark:text-rose-300",
    chip: "border-rose-500/55 bg-rose-500/15 text-rose-600 dark:text-rose-300",
    box: "bg-rose-500/10 ring-1 ring-rose-500/30",
    ring: "ring-1 ring-rose-500/30",
    outline: "border-rose-600! dark:border-rose-300!",
  },
  content: {
    text: "text-red-700 dark:text-red-300",
    chip: "border-red-500/50 bg-red-500/12 text-red-700 dark:text-red-300",
    box: "bg-red-500/10 ring-1 ring-red-500/30",
    ring: "ring-1 ring-red-500/30",
    outline: "border-red-600! dark:border-red-300!",
  },
  absent: {
    text: "text-slate-600 dark:text-slate-300",
    chip: "border-slate-500/45 bg-slate-500/12 text-slate-600 dark:text-slate-300",
    box: "bg-slate-500/10 ring-1 ring-slate-500/25",
    ring: "ring-1 ring-slate-500/25",
    outline: "border-slate-500!",
  },
}

/** Classe base de chip — o formato é o mesmo em todo estado; só a cor muda. */
export const STATUS_CHIP_BASE =
  "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
