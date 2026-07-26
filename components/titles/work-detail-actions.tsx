"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRefresh } from "@/lib/use-refresh"
import {
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  ChevronsDown,
  Edit,
  FolderPlus,
  Heart,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldOff,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { archiveWork, autoRefreshWorkData, deleteWork, setAdultOverride, toggleFavorite, unarchiveWork } from "@/server/actions/works"
import { addWorksToList, createWorkList, removeWorksFromList, unfavoriteWorkFromFolders } from "@/server/actions/lists"
import { GROUP_COLORS } from "@/components/favorites/lists/group-form-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import type { ListPickerOption } from "@/server/queries/lists"
import { UpdateDataDialog } from "@/components/titles/update-data-dialog"
import { StatusEditDialog } from "@/components/titles/status-edit-dialog"
import { useCan, useIsAdmin, useCanWriteOwnState } from "@/components/layout/admin-context"
import type { PostAttributeAssessmentFormProps } from "@/components/titles/post-attribute-assessment-form"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
import type { TasteCriterion, TasteScoreKey } from "@/server/queries/pilot-taste"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

export function FavoriteToggleButton({
  workId,
  isFavorite,
  folders,
  memberOf,
}: {
  workId: string
  isFavorite: boolean
  /** Grupos do usuário pro menu "salvar em pasta". Ausente ⇒ botão simples (sem caret). */
  folders?: ListPickerOption[]
  /** IDs dos grupos que já contêm esta obra (⊆ `folders`). */
  memberOf?: string[]
}) {
  const canFavorite = useCanWriteOwnState()
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()

  // Estado otimista local. `refresh()` re-renderiza o server component mas NÃO
  // reseta useState → o clique reflete na hora e não "pisca" quando a action volta.
  const [fav, setFav] = useState(isFavorite)
  const [folderList, setFolderList] = useState<ListPickerOption[]>(() => folders ?? [])
  const [members, setMembers] = useState<Set<string>>(() => new Set(memberOf ?? []))
  const [menuOpen, setMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")

  const hasFolderMenu = folders != null

  // Favorito é estado pessoal (Fatia 1) → qualquer usuário LOGADO. Anônimo não: sem sessão
  // não há linha própria pra escrever. Os outros botões deste arquivo seguem só do Curador —
  // eles mutam o catálogo compartilhado (editar, arquivar, apagar).
  if (!canFavorite) return null

  const runFavorite = () => {
    const next = !fav
    const prevMembers = members
    setFav(next)
    // Desfavoritar tira de TODAS as pastas (grupo ⊂ favoritos) — otimista.
    if (!next) setMembers(new Set())
    startTransition(async () => {
      const result = next
        ? await toggleFavorite(workId, true)
        : await unfavoriteWorkFromFolders(workId)
      if ("error" in result) {
        setFav(!next)
        if (!next) setMembers(prevMembers)
        toast.error(result.error)
        return
      }
      toast.success(next ? "Adicionado aos favoritos." : "Removido dos favoritos.")
      refresh()
    })
  }

  const toggleFolder = (folder: ListPickerOption) => {
    const wasMember = members.has(folder.id)
    const prevMembers = members
    const prevFav = fav
    const nextMembers = new Set(members)
    if (wasMember) nextMembers.delete(folder.id)
    else nextMembers.add(folder.id)
    setMembers(nextMembers)
    setFolderList((list) =>
      list.map((f) =>
        f.id === folder.id ? { ...f, count: Math.max(0, f.count + (wasMember ? -1 : 1)) } : f,
      ),
    )
    // Salvar numa pasta favorita a obra (a action addWorksToList força is_favorite=true).
    if (!wasMember) setFav(true)

    startTransition(async () => {
      const res = wasMember
        ? await removeWorksFromList(folder.id, [workId])
        : await addWorksToList(folder.id, [workId])
      if ("error" in res) {
        setMembers(prevMembers)
        setFav(prevFav)
        setFolderList((list) =>
          list.map((f) =>
            f.id === folder.id ? { ...f, count: Math.max(0, f.count + (wasMember ? 1 : -1)) } : f,
          ),
        )
        toast.error(res.error)
        return
      }
      toast.success(wasMember ? `Removido de “${folder.name}”.` : `Salvo em “${folder.name}”.`)
      refresh()
    })
  }

  const nextColor = GROUP_COLORS[folderList.length % GROUP_COLORS.length]
  const runCreate = () => {
    const name = newName.trim()
    if (!name) return
    startTransition(async () => {
      const created = await createWorkList({ name, color: nextColor })
      if ("error" in created) {
        toast.error(created.error)
        return
      }
      const added = await addWorksToList(created.data.id, [workId])
      if ("error" in added) {
        toast.error(added.error)
        return
      }
      setFolderList((list) => [...list, { id: created.data.id, name, color: nextColor, count: 1 }])
      setMembers((m) => new Set(m).add(created.data.id))
      setFav(true)
      setNewName("")
      setCreating(false)
      toast.success(`Pasta “${name}” criada e salva.`)
      refresh()
    })
  }

  // Botão nativo (não o componente Button) pra fixar a largura sem que o `size-*`
  // brigue com o override de `w-*` no tailwind-merge. Coração LARGO (dominante) +
  // caret ESTREITO, mesma altura dos vizinhos (h-9), lendo como um controle só.
  const heart = (
    <button
      type="button"
      onClick={runFavorite}
      disabled={isPending}
      aria-pressed={fav}
      aria-label={fav ? "Remover dos favoritos" : "Favoritar"}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg border shadow-xs outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50",
        hasFolderMenu ? "w-10 rounded-r-none" : "w-9",
        fav
          ? "border-rose-500/90 bg-rose-500/90 text-white hover:border-rose-500 hover:bg-rose-500"
          : "border-border/80 bg-background/65 text-foreground hover:border-primary/35 hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
      )}
    >
      <Heart className={cn("size-4", fav && "fill-current")} />
    </button>
  )

  // Sem grupos disponíveis (outros pontos de uso): botão simples, como antes.
  if (!hasFolderMenu) return heart

  return (
    <div className="inline-flex">
      {heart}
      <Popover
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open)
          if (!open) {
            setCreating(false)
            setNewName("")
          }
        }}
      >
        <PopoverTrigger asChild>
          {/* Caret subordinado: mais estreito e chevron apagado, mesma superfície do
              coração (dividida só pela borda) — pra ler como "um botão com caret",
              não dois botões lado a lado. Botão nativo pra fixar a largura sem brigar
              com o `size-*` do componente Button (conflito no tailwind-merge). */}
          <button
            type="button"
            aria-label="Salvar em pasta"
            title="Salvar em pasta"
            className={cn(
              "inline-flex h-9 w-6 items-center justify-center rounded-l-none rounded-r-lg border border-l-0 border-border/80 bg-background/65 text-muted-foreground shadow-xs outline-none transition-all hover:border-primary/35 hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
              fav &&
                "border-rose-500/50 bg-rose-500/12 text-rose-500 hover:bg-rose-500/20 hover:text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/12 dark:text-rose-300 dark:hover:text-rose-200",
            )}
          >
            {members.size > 0 ? (
              <ChevronsDown className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-1.5">
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Salvar em pasta
          </p>

          {folderList.length === 0 && !creating && (
            <p className="px-2 pb-1.5 text-xs text-muted-foreground">Você ainda não tem pastas.</p>
          )}

          {folderList.length > 0 && (
            <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {folderList.map((f) => {
                const member = members.has(f.id)
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => toggleFolder(f)}
                      disabled={isPending}
                      aria-pressed={member}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent/60 disabled:opacity-60"
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-[3px]"
                        style={{
                          backgroundColor: f.color ? `hsl(${f.color})` : "hsl(var(--muted-foreground))",
                        }}
                      />
                      <span className={cn("min-w-0 flex-1 truncate", member && "font-semibold")}>
                        {f.name}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {f.count}
                      </span>
                      <Check
                        className={cn(
                          "size-4 shrink-0 text-rose-500 transition-opacity",
                          member ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className={cn("mt-1 pt-1", folderList.length > 0 && "border-t")}>
            {creating ? (
              <>
                <div className="flex items-center gap-1.5 px-1 py-1">
                  <FolderPlus className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={newName}
                    placeholder="Nome da pasta…"
                    maxLength={80}
                    className="h-8"
                    disabled={isPending}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newName.trim() && !isPending) runCreate()
                    }}
                  />
                </div>
                <div className="mt-1 flex justify-end gap-1.5 px-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={isPending}
                    onClick={() => {
                      setCreating(false)
                      setNewName("")
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={isPending || !newName.trim()}
                    onClick={runCreate}
                  >
                    Criar e salvar
                  </Button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <FolderPlus className="size-4 shrink-0" />
                Criar nova pasta…
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export function StatusActionButton({
  workId,
  statusInitialValues,
  totalChapters,
  latestAiEvaluation,
  existingAssessment,
  tasteCriteria,
  tasteScores,
  label = "Alterar Status",
  variant = "outline",
  size = "sm",
  className,
}: {
  workId: string
  statusInitialValues: WorkStatusValues
  totalChapters?: number | null
  latestAiEvaluation: PostAttributeAssessmentFormProps["latestAiEvaluation"]
  existingAssessment: PostAttributeAssessmentFormProps["existingAssessment"]
  /** Critérios/notas de gosto ("Como foi pra você") — repassados ao dialog. */
  tasteCriteria?: TasteCriterion[]
  tasteScores?: Record<TasteScoreKey, number | null>
  label?: string
  variant?: "outline" | "default" | "ghost"
  size?: "sm" | "default" | "lg"
  className?: string
}) {
  // "Marcar leitura" abre o form de status/capítulos — estado PESSOAL (Fatia 1). Era o botão
  // que fazia da Leitora uma espectadora: escondido pra ela, e recusado pelo servidor se
  // chamado assim mesmo. Agora vale pra qualquer usuário logado; o form em si é que decide o
  // que ela pode editar (nota e pós-leitura seguem do Curador — Fatia 2).
  const canWriteOwnState = useCanWriteOwnState()
  const [open, setOpen] = useState(false)
  if (!canWriteOwnState) return null
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} className={className}>
        <BookOpen className="h-4 w-4" />
        {label}
      </Button>
      <StatusEditDialog
        open={open}
        onOpenChange={setOpen}
        workId={workId}
        totalChapters={totalChapters ?? null}
        initialValues={statusInitialValues}
        latestAiEvaluation={latestAiEvaluation}
        existingAssessment={existingAssessment}
        tasteCriteria={tasteCriteria}
        tasteScores={tasteScores}
      />
    </>
  )
}

export function UpdateDataActionButton({
  workId,
  currentWork,
  currentCovers,
  archivedCovers,
  currentSynopses,
}: {
  workId: string
  currentWork: {
    title: string
    originalTitle?: string | null
    synopsis?: string | null
    coverUrl?: string | null
    publicationStatus?: string | null
    totalChapters?: number | null
    observations?: string | null
  }
  currentCovers?: Array<{ url: string; source?: string | null; isPrimary?: boolean }>
  /** Capas arquivadas na edição — não voltam no refresh; restauráveis no diálogo (migration 163). */
  archivedCovers?: Array<{ url: string; source?: string | null }>
  currentSynopses?: Array<{ source: string; text: string; isPrimary: boolean }>
}) {
  const isAdmin = useIsAdmin()
  const canRefresh = useCan("refresh_work")
  const [open, setOpen] = useState(false)

  // Leitor não atualiza nada.
  if (!canRefresh) return null

  // ASSINANTE: atualização automática. Sem diálogo — ele não escolhe capa, sinopse
  // nem resolve conflito (isso é curadoria, e `works` é compartilhada). Um clique,
  // o servidor funde e grava. Ver autoRefreshWorkData / buildAutoRefreshPlan.
  if (!isAdmin) return <AutoRefreshButton workId={workId} />

  // CURADOR: fluxo completo, com as telas de escolha.
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RefreshCw className="h-4 w-4" />
        Atualizar dados
      </Button>
      <UpdateDataDialog
        workId={workId}
        currentWork={currentWork}
        currentCovers={currentCovers}
        archivedCovers={archivedCovers}
        currentSynopses={currentSynopses}
        open={open}
        onOpenChange={setOpen}
        hideTrigger
        withSourceStep
      />
    </>
  )
}

function AutoRefreshButton({ workId }: { workId: string }) {
  const [loading, setLoading] = useState(false)
  const refresh = useRefresh()

  const run = async () => {
    setLoading(true)
    try {
      const r = await autoRefreshWorkData(workId)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      if (r.updatedFields.length === 0) {
        toast.info("Os dados já estão em dia — nada mudou nas fontes.")
        return
      }
      const skipped = r.skippedConflicts.length
      toast.success(
        `Dados atualizados a partir de ${r.sources.length} ${r.sources.length === 1 ? "fonte" : "fontes"}.` +
          // Diz o que NÃO foi tocado: senão o assinante acha que o app ignorou o campo.
          (skipped > 0
            ? ` ${skipped} ${skipped === 1 ? "campo divergente ficou" : "campos divergentes ficaram"} como está — só o Curador resolve divergência.`
            : ""),
      )
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar os dados.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={loading}>
      <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
      {loading ? "Atualizando…" : "Atualizar dados"}
    </Button>
  )
}

export function MoreActionsMenu({
  workId,
  workSlug,
  isArchived,
  isAdult = false,
  adultOverride = null,
  iconOnly = false,
}: {
  workId: string
  /** Slug pra rota de edição (fallback pro id). */
  workSlug?: string
  isArchived: boolean
  /** Classificação 18+ efetiva (works.is_adult). */
  isAdult?: boolean
  /** Override humano ativo (works.adult_override): true/false força, null = automático. */
  adultOverride?: boolean | null
  iconOnly?: boolean
}) {
  const isAdmin = useIsAdmin()
  const router = useRouter()
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleArchive = () => {
    startTransition(async () => {
      const result = isArchived ? await unarchiveWork(workId) : await archiveWork(workId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(isArchived ? "Obra desarquivada." : "Obra arquivada.")
      refresh()
    })
  }

  const handleAdult = (value: boolean | null) => {
    startTransition(async () => {
      const result = await setAdultOverride(workId, value)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        value === true
          ? "Marcada como 18+."
          : value === false
            ? "Marcada como não-18+."
            : "Classificação 18+ voltou ao automático.",
      )
      refresh()
    })
  }

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteWork(workId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Obra excluída.")
      router.push("/titles")
    })
  }

  // Stopgap multi-user: arquivar/deletar mutam o catálogo compartilhado → só o dono.
  if (!isAdmin) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={iconOnly ? "icon" : "sm"} aria-label="Mais ações">
            <MoreHorizontal className="h-4 w-4" />
            {!iconOnly && "Mais"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem asChild>
            <Link href={`/titles/${workSlug ?? workId}/edit`}>
              <Edit className="h-4 w-4" />
              Editar obra
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          {isAdult ? (
            <DropdownMenuItem onSelect={() => handleAdult(false)} disabled={isPending}>
              <ShieldOff className="h-4 w-4" />
              Desmarcar 18+
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => handleAdult(true)} disabled={isPending}>
              <ShieldAlert className="h-4 w-4" />
              Marcar como 18+
            </DropdownMenuItem>
          )}
          {adultOverride !== null && (
            <DropdownMenuItem onSelect={() => handleAdult(null)} disabled={isPending}>
              <RotateCcw className="h-4 w-4" />
              18+: voltar ao automático
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleArchive} disabled={isPending}>
            <Archive className="h-4 w-4" />
            {isArchived ? "Desarquivar" : "Arquivar"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setDeleteOpen(true)}
            disabled={isPending}
            variant="destructive"
          >
            <Trash2 className="h-4 w-4" />
            Deletar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir obra permanentemente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A obra e todos os dados associados serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-between">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" />
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
