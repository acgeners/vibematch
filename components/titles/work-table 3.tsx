"use client"

import type { ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table"
import { MoreHorizontal, Eye, Pencil, Archive, ArchiveRestore, ChevronDown, ChevronUp, ExternalLink } from "lucide-react"
import type { WorkWithRelations } from "@/types/domain"
import { ScoreBadge } from "@/components/ui/score-badge"
import {
  PublicationStatusBadge,
  PersonalStatusBadge,
  AiStatusBadge,
} from "@/components/ui/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { archiveWork, unarchiveWork } from "@/server/actions/works"
import { toast } from "sonner"
import Link from "next/link"

interface WorkTableProps {
  works: WorkWithRelations[]
  total: number
  page: number
  pageSize: number
}

export function WorkTable({ works, total, page, pageSize }: WorkTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeSortField, activeSortDirection = "desc"] = (searchParams.get("sort") ?? "final_score:desc").split(":")

  const sortableColumns: Record<string, { field: string; label: string }> = {
    title: { field: "title", label: "Título" },
    publication_status: { field: "publication_status", label: "Publicação" },
    personal_status: { field: "personal_status", label: "Pessoal" },
    chapters: { field: "total_chapters", label: "Caps." },
    calc_score: { field: "calc_score", label: "Nota.Calc" },
    predicted_score: { field: "predicted_score", label: "Nota.Pr" },
    final_score: { field: "final_score", label: "NotaFinal" },
    ai_status: { field: "ai_eval_status", label: "IA" },
  }

  const updateSort = (field: string) => {
    const params = new URLSearchParams(window.location.search)
    const isActive = activeSortField === field
    const nextDirection = isActive && activeSortDirection !== "asc" ? "asc" : "desc"
    params.set("sort", `${field}:${nextDirection}`)
    params.delete("page")
    router.push(`/titles?${params.toString()}`)
  }

  const columns: ColumnDef<WorkWithRelations>[] = [
    {
      accessorKey: "title",
      header: "Título",
      cell: ({ row }) => (
        <Link
          href={`/titles/${row.original.id}`}
          className="block max-w-[420px] text-sm font-semibold leading-snug text-foreground line-clamp-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      id: "publication_status",
      header: "Publicação",
      cell: ({ row }) => (
        <PublicationStatusBadge status={row.original.publication_status} />
      ),
    },
    {
      id: "personal_status",
      header: "Pessoal",
      cell: ({ row }) => (
        <PersonalStatusBadge status={row.original.personal_status} />
      ),
    },
    {
      id: "chapters",
      header: "Caps.",
      cell: ({ row }) => {
        const { chapters_read, total_chapters } = row.original
        if (chapters_read == null && total_chapters == null) return <span className="text-muted-foreground">—</span>
        return (
          <span className="text-sm font-mono">
            {chapters_read ?? "?"}/{total_chapters ?? "?"}
          </span>
        )
      },
    },
    {
      id: "calc_score",
      header: "Nota.Calc",
      cell: ({ row }) => (
        <ScoreBadge score={row.original.calculated_scores?.calc_score ?? null} size="sm" />
      ),
    },
    {
      id: "predicted_score",
      header: "Nota.Pr",
      cell: ({ row }) => {
        const cs = row.original.calculated_scores
        return (
          <ScoreBadge
            score={cs?.predicted_score ?? null}
            size="sm"
            showStub={cs?.predicted_is_stub ?? false}
          />
        )
      },
    },
    {
      id: "final_score",
      header: "NotaFinal",
      cell: ({ row }) => (
        <ScoreBadge score={row.original.calculated_scores?.final_score ?? null} size="sm" />
      ),
    },
    {
      id: "ai_status",
      header: "IA",
      cell: ({ row }) => <AiStatusBadge status={row.original.ai_eval_status} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const work = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/titles/${work.id}`} onClick={(e) => e.stopPropagation()}>
                  <Eye className="h-4 w-4 mr-2" />
                  Ver detalhes
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  href={`/titles/${work.id}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Abrir em nova aba
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/titles/${work.id}/edit`} onClick={(e) => e.stopPropagation()}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async (e) => {
                  e.stopPropagation()
                  const action = work.is_archived ? unarchiveWork : archiveWork
                  const result = await action(work.id)
                  if (result.error) {
                    toast.error("Erro ao alterar status da obra")
                  } else {
                    toast.success(work.is_archived ? "Obra desarquivada" : "Obra arquivada")
                    router.refresh()
                  }
                }}
              >
                {work.is_archived ? (
                  <><ArchiveRestore className="h-4 w-4 mr-2" />Desarquivar</>
                ) : (
                  <><Archive className="h-4 w-4 mr-2" />Arquivar</>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const table = useReactTable({
    data: works,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: Math.ceil(total / pageSize),
  })

  const totalPages = Math.ceil(total / pageSize)
  const titleColumnClass = "w-[34rem] min-w-[360px]"
  const metricColumnClass = "text-center"
  const renderHeaderContent = (columnId: string, fallback: ReactNode) => {
    const sortable = sortableColumns[columnId]
    if (!sortable) return fallback

    const isActive = activeSortField === sortable.field
    const isAsc = activeSortDirection === "asc"

    return (
      <button
        type="button"
        onClick={() => updateSort(sortable.field)}
        className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-background hover:text-foreground ${
          isActive ? "text-foreground" : ""
        }`}
        aria-label={`Ordenar por ${sortable.label}`}
      >
        <span>{sortable.label}</span>
        {isActive ? (
          isAsc ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 opacity-25" />
        )}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-lg border bg-card shadow-sm md:block">
        <Table>
          <TableHeader className="bg-muted/80">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={`h-11 whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground ${
                      header.column.id === "title" ? titleColumnClass : ""
                    } ${
                      ["chapters", "calc_score", "predicted_score", "final_score"].includes(header.column.id)
                        ? metricColumnClass
                        : ""
                    }`}
                  >
                    {renderHeaderContent(
                      header.column.id,
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-12 text-muted-foreground">
                  Nenhuma obra encontrada
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer border-b transition-colors odd:bg-background even:bg-muted/20 hover:bg-primary/5"
                  onClick={() => router.push(`/titles/${row.original.id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`h-14 py-3 align-middle ${
                        cell.column.id === "title" ? `${titleColumnClass} whitespace-normal` : ""
                      } ${
                        ["chapters", "calc_score", "predicted_score", "final_score"].includes(cell.column.id)
                          ? metricColumnClass
                          : ""
                      }`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {works.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Nenhuma obra encontrada
          </div>
        ) : (
          works.map((work) => (
            <div
              key={work.id}
              className="border rounded-lg p-4 space-y-2 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => router.push(`/titles/${work.id}`)}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-sm line-clamp-2">{work.title}</span>
                <ScoreBadge score={work.calculated_scores?.final_score ?? null} size="sm" />
              </div>
              <div className="flex flex-wrap gap-1">
                <PublicationStatusBadge status={work.publication_status} />
                <PersonalStatusBadge status={work.personal_status} />
                <AiStatusBadge status={work.ai_eval_status} />
              </div>
              {(work.chapters_read != null || work.total_chapters != null) && (
                <p className="text-xs text-muted-foreground font-mono">
                  Caps: {work.chapters_read ?? "?"}/{work.total_chapters ?? "?"}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {total} obras — página {page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                const params = new URLSearchParams(window.location.search)
                params.set("page", String(page - 1))
                router.push(`/titles?${params.toString()}`)
              }}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => {
                const params = new URLSearchParams(window.location.search)
                params.set("page", String(page + 1))
                router.push(`/titles?${params.toString()}`)
              }}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
