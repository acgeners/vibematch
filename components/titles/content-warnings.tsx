"use client"

import { AlertTriangle } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AiProvenanceSeal } from "@/components/ui/ai-provenance"
import type { AiProvenanceSealProps } from "@/components/ui/ai-provenance"
import { STATUS_TONE } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

/**
 * Avisos de conteúdo = `review_digest.content_warnings`: temas sensíveis que as reviews
 * relatam (violência, abuso, morte…). São gerados junto com o digest e não têm pipeline
 * próprio.
 *
 * 🔴 **Aviso NÃO é a classificação 18+.** Quem decide o 18+ é `works.is_adult` (o gate),
 * que não lê este campo. Por isso os dois desenhos daqui evitam a FORMA do selo 🔞
 * (pílula vermelha em negrito): o aviso é uma linha de informação, não um selo.
 *
 * Os dois consumidores desenham a MESMA lista (`ContentWarningsList`) a partir da MESMA régua
 * (`displayableContentWarnings`, em `lib/reviews/digest-view.ts`).
 */

/** O texto completo dos avisos — é o mesmo no card de reviews e na Visão Geral. */
function ContentWarningsList({ warnings }: { warnings: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {warnings.map((w, i) => (
        <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />
          {w}
        </li>
      ))}
    </ul>
  )
}

/**
 * Avisos de conteúdo. Pílulas à vista, texto inteiro no popover (mediana de 3 avisos,
 * 85% das obras têm).
 *
 * ⚠️ **Vermelho, não âmbar (2026-08-12).** O âmbar passou a significar só "desatualizado"
 * (`lib/ui/status-tone.ts`), e o aviso migrou para a família do selo 🔞 18+: os dois são
 * fato sobre a OBRA — quem lê decide —, não estado do sistema.
 *
 * ⚠️ Ele deixou de morar na coluna do topo: ver o comentário do layout, no corpo do card.
 */
export function ContentWarningsPanel({ warnings }: { warnings: string[] }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl p-3", STATUS_TONE.content.box)}>
      <div className={cn("flex items-center gap-1.5 text-xs font-semibold", STATUS_TONE.content.text)}>
        <AlertTriangle className="size-3.5 shrink-0" />
        {warnings.length} aviso{warnings.length === 1 ? "" : "s"} de conteúdo
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="ml-auto text-[11.5px] font-semibold text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
            >
              ver
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-2">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
              Avisos de conteúdo
            </p>
            <ContentWarningsList warnings={warnings} />
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex flex-col items-start gap-1">
        {warnings.map((w, i) => (
          <span
            key={i}
            title={w}
            className={cn(
              "max-w-full truncate rounded-full bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground",
              STATUS_TONE.content.ring,
            )}
          >
            {w}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Versão compacta para a Visão Geral: `⚠ 3 avisos de conteúdo · Ver avisos`.
 *
 * ⚠️ **Só a CONTAGEM fica à vista; o texto, só depois do clique.** Alguns avisos descrevem
 * violência sexual em uma frase, e o leitor decide se quer ler. É por isso que esta versão,
 * ao contrário do painel do card, não tem pílulas.
 *
 * ⚠️ **Sem fundo, sem borda e sem negrito vermelho**, de propósito: o selo 🔞 18+ do cabeçalho
 * é uma pílula vermelha, e esta linha não pode ser lida como um segundo selo. A cor de
 * conteúdo fica só no ícone.
 *
 * Lista vazia ⇒ não renderiza nada. Nunca imprime "sem avisos" (ver `displayableContentWarnings`).
 */
export function ContentWarningsSummary({
  warnings,
  provenance,
}: {
  warnings: string[]
  /** Proveniência do digest (o modelo que resumiu as reviews). Vai dentro do popover. */
  provenance?: AiProvenanceSealProps | null
}) {
  if (warnings.length === 0) return null
  const n = warnings.length
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
      <AlertTriangle className={cn("size-4 shrink-0", STATUS_TONE.content.text)} aria-hidden />
      <span>
        {n} aviso{n === 1 ? "" : "s"} de conteúdo
      </span>
      <span aria-hidden>·</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="font-medium text-foreground/80 underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
          >
            Ver avisos
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 space-y-2"
          // O foco vai pro PRÓPRIO popover, não pro 1º item focável dele: esse item é o selo ✨,
          // e o tooltip de proveniência abria sozinho por cima da lista (visto no navegador).
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.target as HTMLElement | null)?.focus?.()
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
              Avisos de conteúdo
            </p>
            {provenance && <AiProvenanceSeal {...provenance} />}
          </div>
          <ContentWarningsList warnings={warnings} />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Temas sensíveis relatados nas reviews dos leitores. Não é a classificação 18+.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  )
}
