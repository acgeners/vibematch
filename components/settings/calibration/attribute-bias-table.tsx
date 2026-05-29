import { AlertTriangle } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import type { AttributeBiasOverview } from "@/server/queries/attribute-bias"

const LOW_CONFIDENCE_N = 10

function fmtSigned(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}`
}

export function AttributeBiasTable({ overview }: { overview: AttributeBiasOverview }) {
  const { rows, totalAssessments, assessedWorks } = overview
  const allEmpty = rows.every((r) => r.nSamples === 0)

  if (allEmpty) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Offset ainda não calibrado. Marque obras como Completed/Dropped e preencha o questionário
        pós-leitura (aba <strong>Meu Status</strong> da obra) pra começar a coletar dados.
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Diferença sistemática entre o que a IA avalia e o que você respondeu pós-leitura, por
          atributo. O pipeline aplica <code>valor_calibrado = valor_IA − aplicado</code> nas notas
          de origem IA. Base: <strong>{totalAssessments}</strong> avaliações em{" "}
          <strong>{assessedWorks}</strong> obras.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Atributo</TableHead>
              <TableHead className="text-right">
                <Tooltip>
                  <TooltipTrigger className="cursor-help underline decoration-dotted">
                    IA vs Você
                  </TooltipTrigger>
                  <TooltipContent>
                    Diferença média (IA − você). Positivo = a IA superestima o atributo.
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="text-right">
                <Tooltip>
                  <TooltipTrigger className="cursor-help underline decoration-dotted">
                    Aplicado
                  </TooltipTrigger>
                  <TooltipContent>
                    Correção efetiva após shrinkage Bayesiano (k={LOW_CONFIDENCE_N}). Cresce com mais amostras.
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="text-right">Aplicação</TableHead>
              <TableHead className="text-right">Amostras</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const lowConfidence = r.nSamples > 0 && r.nSamples < LOW_CONFIDENCE_N
              const neutral = Math.abs(r.meanBiasRaw) < 0.005
              return (
                <TableRow key={r.attributeSlug}>
                  <TableCell className="font-medium">
                    <span className="mr-1.5" aria-hidden>
                      {CRITERIA_INFO[r.attributeSlug]?.emoji}
                    </span>
                    {r.attributeLabel}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono tabular-nums",
                      neutral
                        ? "text-muted-foreground"
                        : r.meanBiasRaw > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {fmtSigned(r.meanBiasRaw)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtSigned(r.biasApplied)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {r.shrinkagePct}%
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span className="inline-flex items-center justify-end gap-1">
                      {r.nSamples}
                      {lowConfidence && (
                        <Tooltip>
                          <TooltipTrigger>
                            <AlertTriangle className="h-3 w-3 text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            Apenas {r.nSamples} amostras. Adicione mais avaliações pós-leitura pra
                            aumentar a confiança da correção.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  )
}
