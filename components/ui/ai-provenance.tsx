/**
 * Selo de proveniência de IA: marca um bloco como GERADO POR MODELO e guarda
 * quem gerou, quando e com que prompt.
 *
 * Régua da página da obra (2026-08-08): todo bloco cujo conteúdo saiu de um LLM
 * leva este selo, e nenhuma proveniência fica solta na tela. Antes o dado ora
 * ocupava uma faixa no cabeçalho (Resumo IA e "Notas por critério" mostravam a
 * MESMA faixa, duas vezes na mesma página), ora não existia — a sinopse
 * consolidada é escrita por um modelo e a página não dizia isso em lugar nenhum.
 *
 * ⚠️ **O selo é a marca, não só o botão.** Ele aparece mesmo quando o modelo é
 * desconhecido — dizer "não registrado" é informação; esconder o selo apagaria o
 * fato de aquele texto ser de IA, que é o que ele existe pra comunicar.
 *
 * ⚠️ **Não usar `text-foreground` nem `text-muted-foreground` aqui dentro.** O
 * `TooltipContent` do app é INVERTIDO (`bg-foreground` + `text-background`):
 * `text-foreground` vira texto da cor do fundo, invisível. Ênfase = `font-semibold`;
 * tom secundário = `text-background/<alfa>` — ver a nota em `ProvenanceRow`.
 *
 * Sem "use client" de propósito: renderiza tanto no server component da página da
 * obra quanto dentro de cards client (reviews, Interesse).
 */

import { Sparkles } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export interface AiProvenanceRow {
  label: string
  /**
   * `null` imprime "sem registro" — o desconhecido é um fato, não um vazio.
   * "sem registro" e não "não registrado": o mesmo componente imprime a linha de
   * "Modelo", "Data" e "Confiança", e uma forma com gênero erraria em metade delas.
   */
  value: string | null
}

export interface AiProvenanceSealProps {
  /** Cabeçalho do tooltip. Diz o que foi gerado ("Sinopse consolidada por IA"). */
  title: string
  model?: string | null
  /** Versão do prompt; entra colada no modelo (`claude-sonnet-5 · v22`). */
  promptVersion?: string | null
  /** ISO da geração. */
  at?: string | null
  /** Linhas extras de proveniência (confiança, reviews no contexto, fontes…). */
  extra?: AiProvenanceRow[]
  /** Rodapé explicativo (uma frase). */
  note?: string
  /**
   * Rótulo ao lado do ✨. Só onde o selo mora num rodapé com outros itens: um
   * ícone solto ali não diz a que se refere.
   */
  label?: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  className?: string
}

/**
 * DD/MM/AAAA por SLICE do ISO, não `toLocaleDateString`.
 *
 * O selo renderiza nos dois lados (server component da obra e cards client), e
 * `new Date(iso).toLocaleDateString()` usa o fuso de QUEM renderiza — o HTML do
 * SSR sairia com uma data e o primeiro render do cliente com outra, quebrando a
 * hidratação. Slice é determinístico nos dois. Mesmo formatador do rodapé do
 * Interesse, que já resolvia isso assim.
 */
export function formatProvenanceDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : null
}

/** Junta modelo e versão do prompt num valor só. `null` quando não há modelo. */
export function formatProvenanceModel(
  model: string | null | undefined,
  promptVersion?: string | null,
): string | null {
  if (!model) return null
  return promptVersion ? `${model} · ${promptVersion}` : model
}

/**
 * ⚠️ Os tons secundários saem de `text-background/<alfa>`, NÃO de `text-muted-foreground`.
 *
 * O `TooltipContent` é invertido (`bg-foreground` + `text-background`), então o único tom
 * que acompanha os dois temas é uma opacidade da PRÓPRIA cor do texto do tooltip.
 * `text-muted-foreground` é um token pensado pro fundo da PÁGINA: medido em 2026-08-08,
 * no tema CLARO ele imprime cinza-escuro (hsl 224 9% 43%) sobre o quase-preto do tooltip
 * — ~3:1, um passo do texto invisível de 2026-07-03. No escuro passava, e é por isso que
 * a convenção sobreviveu: o bug só aparece num dos dois temas.
 */
function ProvenanceRow({ label, value }: AiProvenanceRow) {
  return (
    <>
      <dt className="text-background/65">{label}</dt>
      <dd className="m-0 font-mono text-[11px] font-semibold tabular-nums">
        {value ?? <span className="font-sans font-normal italic text-background/65">sem registro</span>}
      </dd>
    </>
  )
}

export function AiProvenanceSeal({
  title,
  model,
  promptVersion,
  at,
  extra,
  note,
  label,
  side = "top",
  align = "center",
  className,
}: AiProvenanceSealProps) {
  const rows: AiProvenanceRow[] = [
    { label: "Modelo", value: formatProvenanceModel(model, promptVersion) },
    { label: "Data", value: formatProvenanceDate(at) },
    ...(extra ?? []),
  ]

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${title} — ver modelo e data`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border border-transparent px-1 py-0.5",
              "text-[11px] font-semibold leading-none text-violet-600 transition-colors dark:text-violet-300",
              "hover:border-violet-500/35 hover:bg-violet-500/10",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              className,
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} align={align} className="max-w-[19rem] px-3 py-2 text-left">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em]">
            <Sparkles className="h-3 w-3" />
            {title}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
            {rows.map((row) => (
              <ProvenanceRow key={row.label} label={row.label} value={row.value} />
            ))}
          </dl>
          {note && (
            <p className="mt-2 border-t border-background/20 pt-1.5 text-[11px] text-background/75">
              {note}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
