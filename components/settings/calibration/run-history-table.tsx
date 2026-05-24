import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatRelativeDateTime } from "@/lib/date-utils"
import type { CalibrationRunRow } from "@/lib/ai-calibration/types"

interface RunHistoryTableProps {
  runs: CalibrationRunRow[]
}

function tokens(n: number | null): string {
  if (!n) return "—"
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toString()
}

export function RunHistoryTable({ runs }: RunHistoryTableProps) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum run ainda.</p>
  }
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Modo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Obras</TableHead>
            <TableHead className="text-right">Sugestões</TableHead>
            <TableHead className="text-right">Auto</TableHead>
            <TableHead className="text-right">Input tok</TableHead>
            <TableHead className="text-right">Cache</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="whitespace-nowrap text-xs">
                {formatRelativeDateTime(run.completed_at ?? run.created_at)}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px]">
                  {run.mode}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    run.status === "completed"
                      ? "text-emerald-700 border-emerald-500/40 text-[10px]"
                      : run.status === "failed"
                        ? "text-rose-700 border-rose-500/40 text-[10px]"
                        : "text-amber-700 border-amber-500/40 text-[10px]"
                  }
                >
                  {run.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{run.n_works_scanned}</TableCell>
              <TableCell className="text-right tabular-nums">{run.n_suggestions}</TableCell>
              <TableCell className="text-right tabular-nums">{run.n_auto_applied}</TableCell>
              <TableCell className="text-right tabular-nums">{tokens(run.input_tokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{tokens(run.cache_read_tokens)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
