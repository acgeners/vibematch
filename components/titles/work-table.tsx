"use client"

import { useSyncExternalStore, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table"
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  ImageOff,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
} from "lucide-react"
import { toast } from "sonner"
import type { WorkWithRelations, WorkCover } from "@/types/domain"
import { cn, titleToSlug } from "@/lib/utils"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { ScoreBadge, type ScoreColorThresholds } from "@/components/ui/score-badge"
import {
  AiStatusBadge,
  PersonalStatusBadge,
  PublicationStatusBadge,
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
import { WorkTitleLink } from "@/components/titles/work-title-link"

type ViewMode = "list" | "cards"
const VIEW_STORAGE_KEY = "titles_view_mode_v1"
const VIEW_EVENT = "titles-view-mode-change"

function readViewMode(): ViewMode {
  if (typeof window === "undefined") return "list"
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
  return stored === "cards" ? "cards" : "list"
}

function subscribeViewMode(onChange: () => void) {
  if (typeof window === "undefined") return () => {}
  window.addEventListener(VIEW_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(VIEW_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

function writeViewMode(mode: ViewMode) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(VIEW_STORAGE_KEY, mode)
  window.dispatchEvent(new CustomEvent(VIEW_EVENT))
}

interface WorkTableProps {
  works: WorkWithRelations[]
  total: number
  page: number
  pageSize: number
  searchQuery?: string
  scoreThresholds?: ScoreColorThresholds | null
}

export function WorkTable({ works, total, page, pageSize, searchQuery, scoreThresholds = null }: WorkTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const viewMode = useSyncExternalStore(subscribeViewMode, readViewMode, () => "list" as const)
  const setViewModePersisted = (mode: ViewMode) => writeViewMode(mode)

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total} obra{total !== 1 ? "s" : ""}
          {totalPages > 1 && (
            <span> · página {page} de {totalPages}</span>
          )}
        </p>
        <ViewModeToggle value={viewMode} onChange={setViewModePersisted} />
      </div>

      {works.length === 0 ? (
        <EmptyState searchQuery={searchQuery} />
      ) : viewMode === "cards" ? (
        <WorkCardsView works={works} scoreThresholds={scoreThresholds} />
      ) : (
        <WorkListView
          works={works}
          searchParams={searchParams}
          router={router}
          scoreThresholds={scoreThresholds}
        />
      )}

      {totalPages > 1 && works.length > 0 && (
        <Pagination page={page} totalPages={totalPages} router={router} />
      )}
    </div>
  )
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border/70 bg-background/60 p-0.5">
      <button
        type="button"
        onClick={() => onChange("list")}
        aria-label="Visualizar em lista"
        aria-pressed={value === "list"}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
          value === "list"
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <List className="h-3.5 w-3.5" />
        Lista
      </button>
      <button
        type="button"
        onClick={() => onChange("cards")}
        aria-label="Visualizar em cards"
        aria-pressed={value === "cards"}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
          value === "cards"
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Cards
      </button>
    </div>
  )
}

function EmptyState({ searchQuery }: { searchQuery?: string }) {
  const searchedTitle = searchQuery?.trim()

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border/70 bg-card/80 px-4 py-16 text-center text-sm text-muted-foreground shadow-sm">
      <div>
        <p className="font-medium text-foreground">Nenhuma obra encontrada</p>
        {searchedTitle ? (
          <p className="mt-1">
            Não há nenhum título cadastrado para &quot;{searchedTitle}&quot;.
          </p>
        ) : (
          <p className="mt-1">Ajuste os filtros ou adicione uma nova obra.</p>
        )}
      </div>
      {searchedTitle && (
        <Button asChild size="sm">
          <Link href={`/titles/new?title=${encodeURIComponent(searchedTitle)}`}>
            <Plus className="h-4 w-4" />
            Adicionar &quot;{searchedTitle}&quot;
          </Link>
        </Button>
      )}
    </div>
  )
}

function pickPrimaryCover(covers: WorkCover[] | undefined): string | null {
  if (!covers || covers.length === 0) return null
  const primary = covers.find((c) => c.is_primary)
  return (primary ?? covers[0])?.url ?? null
}

function WorkCardsView({
  works,
  scoreThresholds,
}: {
  works: WorkWithRelations[]
  scoreThresholds: ScoreColorThresholds | null
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {works.map((work) => {
        const slug = titleToSlug(work.title)
        const coverUrl = pickPrimaryCover(work.work_covers)
        const finalScore = work.calculated_scores?.final_score ?? null
        return (
          <Link
            key={work.id}
            href={`/titles/${slug}`}
            className="group flex flex-col gap-2 text-left transition-transform hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:outline-none"
          >
            <div className="relative aspect-[2/3] overflow-hidden rounded-lg border border-border/65 bg-muted/40 shadow-sm shadow-black/10 transition-shadow group-hover:border-primary/40 group-hover:shadow-md group-hover:shadow-primary/15 group-focus-visible:border-primary/40 group-focus-visible:shadow-md">
              {coverUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={getCoverImageSrc(coverUrl)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImageOff className="size-7 opacity-40" />
                </div>
              )}
              {finalScore != null && (
                <div className="absolute right-1.5 top-1.5">
                  <ScoreBadge score={finalScore} size="sm" thresholds={scoreThresholds} />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-end gap-1 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-1.5">
                <PublicationStatusBadge statusId={work.publication_status_id} />
                <PersonalStatusBadge statusId={work.personal_status_id} />
              </div>
            </div>
            <div className="px-0.5">
              <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground group-hover:text-primary">
                {work.title}
              </p>
              {(work.chapters_read != null || work.total_chapters != null) && (
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  Caps {work.chapters_read ?? "?"}/{work.total_chapters ?? "?"}
                </p>
              )}
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function WorkListView({
  works,
  searchParams,
  router,
  scoreThresholds,
}: {
  works: WorkWithRelations[]
  searchParams: ReturnType<typeof useSearchParams>
  router: ReturnType<typeof useRouter>
  scoreThresholds: ScoreColorThresholds | null
}) {
  const [activeSortField, activeSortDirection = "desc"] = (
    searchParams.get("sort") ?? "final_score:desc"
  ).split(":")

  const sortableColumns: Record<string, { field: string; label: string }> = {
    title: { field: "title", label: "Título" },
    publication_status: { field: "publication_status", label: "Publicação" },
    personal_status: { field: "personal_status", label: "Pessoal" },
    chapters: { field: "total_chapters", label: "Caps." },
    calc_score: { field: "calc_score", label: "Nota.IA" },
    predicted_score: { field: "predicted_score", label: "Nota.Pr" },
    final_score: { field: "final_score", label: "Nota.Final" },
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
        <span onClick={(e) => e.stopPropagation()} className="block max-w-[420px]">
          <WorkTitleLink
            title={row.original.title}
            workId={row.original.id}
            className="text-sm font-semibold leading-snug text-foreground line-clamp-2 hover:underline"
          />
        </span>
      ),
    },
    {
      id: "publication_status",
      header: "Publicação",
      cell: ({ row }) => (
        <PublicationStatusBadge statusId={row.original.publication_status_id} />
      ),
    },
    {
      id: "personal_status",
      header: "Pessoal",
      cell: ({ row }) => (
        <PersonalStatusBadge statusId={row.original.personal_status_id} />
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
      header: "Nota.IA",
      cell: ({ row }) => (
        <ScoreBadge score={row.original.calculated_scores?.calc_score ?? null} size="sm" thresholds={scoreThresholds} />
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
            thresholds={scoreThresholds}
          />
        )
      },
    },
    {
      id: "final_score",
      header: "Nota.Final",
      cell: ({ row }) => (
        <ScoreBadge score={row.original.calculated_scores?.final_score ?? null} size="sm" thresholds={scoreThresholds} />
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
        const slug = titleToSlug(work.title)
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/titles/${slug}`} onClick={(e) => e.stopPropagation()}>
                  <Eye className="h-4 w-4 mr-2" />
                  Ver detalhes
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  href={`/titles/${slug}`}
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

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: works,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: Math.ceil(works.length / 50),
  })

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
    <>
      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-lg border border-border/70 bg-card/80 shadow-sm shadow-black/5 backdrop-blur md:block">
        <Table>
          <TableHeader className="bg-muted/60">
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
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer border-b transition-colors odd:bg-background even:bg-muted/20 hover:bg-primary/5"
                onClick={() => router.push(`/titles/${titleToSlug(row.original.title)}`)}
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
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile compact cards */}
      <div className="space-y-3 md:hidden">
        {works.map((work) => (
          <div
            key={work.id}
            className="cursor-pointer space-y-3 rounded-lg border border-border/70 bg-card/80 p-4 shadow-sm shadow-black/5 transition-all hover:border-primary/30 hover:bg-card"
            onClick={() => router.push(`/titles/${titleToSlug(work.title)}`)}
          >
            <div className="flex items-start justify-between gap-2">
              <span onClick={(e) => e.stopPropagation()} className="min-w-0 flex-1">
                <WorkTitleLink
                  title={work.title}
                  workId={work.id}
                  className="font-medium text-sm line-clamp-2 hover:underline"
                />
              </span>
              <ScoreBadge score={work.calculated_scores?.final_score ?? null} size="sm" thresholds={scoreThresholds} />
            </div>
            <div className="flex flex-wrap gap-1">
              <PublicationStatusBadge statusId={work.publication_status_id} />
              <PersonalStatusBadge statusId={work.personal_status_id} />
              <AiStatusBadge status={work.ai_eval_status} />
            </div>
            {(work.chapters_read != null || work.total_chapters != null) && (
              <p className="text-xs text-muted-foreground font-mono">
                Caps: {work.chapters_read ?? "?"}/{work.total_chapters ?? "?"}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function Pagination({
  page,
  totalPages,
  router,
}: {
  page: number
  totalPages: number
  router: ReturnType<typeof useRouter>
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/70 p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Página {page} de {totalPages}
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
  )
}
