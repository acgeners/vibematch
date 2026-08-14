import { confidenceBand } from "./confidence-ruler"

/**
 * As CLASSES que pintam confiança. Irmão de `lib/ui/status-tone.ts`, e pelo mesmo motivo:
 * enquanto a cor mora em cada componente, duas telas passam a discordar sobre a mesma
 * avaliação ser verde ou âmbar, e nada acusa — o resultado é plausível dos dois lados.
 *
 * 🔴 Eram **quatro** cópias, não três. Em 2026-08-14 os cortes `0,75/0,5` ganharam dono
 * (`confidenceBand`) em três lugares — formulário de revisão, comparador e o card da fila —,
 * e a quarta passou despercebida: `components/titles/work-form.tsx` reescrevia os dois
 * números E as três classes na criação de obra. Achada só ao varrer cor clara fixa. Por isso
 * o dono agora é a CLASSE, não só o número: enquanto cada tela montar a própria string, some
 * uma cópia e nasce outra.
 *
 * ⚠️ Isto NÃO é `STATUS_TONE`. Aquela régua é de ESTADO (`stale`/`pending`/`ok`/`failed`), e
 * confiança é escala de VALOR — vem sempre com o número ao lado, e "verde" aqui quer dizer
 * "a IA tinha material", nunca "a nota está certa". A técnica é a mesma; o dono, não.
 *
 * 🔴 **Fundo em ALFA, nunca `bg-<cor>-50` sem `dark:`.** O app é escuro por padrão e não tem
 * seletor de tema; fundo claro fixo vira pílula branca sobre card escuro em toda visita
 * (medido: luminosidade ~98% em lab). `bg-<cor>-500/15` compõe com o fundo e serve os dois
 * temas com UMA classe. Só o texto precisa de `dark:` — contraste de texto não é composição.
 *
 * ⚠️ **`ring-1` e não `border-<cor>`:** `* { border-color }` no `globals.css` está FORA de
 * layer, e no Tailwind v4 CSS sem layer vence `@layer utilities` mesmo com especificidade
 * menor. Medido: `border-emerald-300` computava `rgb(49, 56, 68)` — o neutro do tema — nas
 * três faixas. Quem usar `confidenceBadgeClass` precisa de `ring-1` no elemento.
 */

/** Só a cor do TEXTO — o fundo é de quem contém (botão, célula). */
export function confidenceTextClass(confidence: number): string {
  const band = confidenceBand(confidence)
  if (band === "alta") return "text-emerald-600 dark:text-emerald-400"
  if (band === "media") return "text-amber-600 dark:text-amber-400"
  return "text-rose-600 dark:text-rose-400"
}

/** Pílula completa: anel + fundo + texto. Combine com `rounded-full ring-1 px-2 py-0.5`. */
export function confidenceBadgeClass(confidence: number | null): string {
  if (confidence == null) return "ring-border bg-muted text-muted-foreground"
  const band = confidenceBand(confidence)
  if (band === "alta") return "ring-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
  if (band === "media") return "ring-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400"
  return "ring-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300"
}
