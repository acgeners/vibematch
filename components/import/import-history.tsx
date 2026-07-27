import { History } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { SourceTag } from "@/components/import/source-tag"
import { cn } from "@/lib/utils"
import type { ImportHistoryRow } from "@/server/queries/imports"

// timeZone fixo: o servidor pode rodar em UTC e o cliente em BR — sem fixar, a
// data absoluta divergiria entre SSR e hidratação perto da virada do dia.
const DATE_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : DATE_FMT.format(d)
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  completed: { label: "concluída", className: "text-emerald-700 bg-emerald-500/12 dark:text-emerald-300" },
  processing: { label: "processando", className: "text-amber-700 bg-amber-500/12 dark:text-amber-300" },
  failed: { label: "falhou", className: "text-destructive bg-destructive/12" },
  pending: { label: "pendente", className: "text-muted-foreground bg-muted" },
}

export function ImportHistory({ rows }: { rows: ImportHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<History className="size-9" />}
        title="Nenhuma importação ainda"
        description="Quando você importar uma lista, o registro aparece aqui — com o que foi criado, atualizado e pulado."
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Toda importação fica registrada, com o que foi criado, atualizado e pulado em cada uma.
      </p>
      <div className="overflow-hidden rounded-xl border border-border/70">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Novas</TableHead>
                <TableHead className="text-right">Atualiz.</TableHead>
                <TableHead className="text-right">Puladas</TableHead>
                <TableHead className="text-right">Erros</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const status = STATUS_LABEL[r.status] ?? STATUS_LABEL.pending
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatDate(r.createdAt)}
                    </TableCell>
                    <TableCell>
                      <SourceTag source={r.source} fallback={r.fileType} />
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate font-mono text-xs text-muted-foreground" title={r.filename}>
                      {r.filename}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.createdCount > 0 ? (
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">+{r.createdCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.updatedCount}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.skippedCount}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.errorCount > 0 ? (
                        <span className="font-medium text-destructive">{r.errorCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", status.className)}>
                        {status.label}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
