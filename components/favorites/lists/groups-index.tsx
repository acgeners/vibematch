"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { FolderOpen, Heart, Layers, MessageSquare, Pencil, Plus, Sparkles, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CoverImage } from "@/components/ui/cover-image"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import { deleteWorkList } from "@/server/actions/lists"
import type { FavoritesSummary } from "@/server/queries/favorites"
import type {
  MultiGroupFavorites,
  NestedGroupPair,
  UngroupedFavorites,
  WorkListSummary,
  WorkLiteForPicker,
} from "@/server/queries/lists"
import { GroupFormDialog, type GroupFormData } from "./group-form-dialog"
import { SuggestGroupsDialog } from "./suggest-groups-dialog"

interface GroupsIndexProps {
  lists: WorkListSummary[]
  allSummary: FavoritesSummary
  /** Visão derivada "Sem grupo" (favoritas fora de qualquer grupo). */
  ungrouped: UngroupedFavorites
  /** Visão derivada "Em vários grupos" (favoritas que aparecem em 2+ recortes). */
  multi: MultiGroupFavorites
  /** Grupos 100% contidos em outro — o card do CONTIDO avisa. */
  nested: NestedGroupPair[]
  catalog: WorkLiteForPicker[]
}

const STACK_POS = [
  "left-0 -rotate-6 z-[1]",
  "left-[28px] -rotate-1 z-[2]",
  "left-[56px] rotate-6 z-[3]",
]

function CoverStack({ urls }: { urls: string[] }) {
  const slots = urls.slice(0, 3)
  return (
    <div className="pointer-events-none relative h-[92px] w-[120px] shrink-0">
      {slots.length === 0 ? (
        <div className="absolute left-[30px] top-1 h-[84px] w-[60px] rounded-md border border-dashed border-border bg-muted/40" />
      ) : (
        slots.map((url, i) => (
          <div
            key={i}
            className={cn(
              "absolute top-1 h-[84px] w-[60px] overflow-hidden rounded-md border border-white/10 shadow-md",
              slots.length === 1 ? "left-[30px]" : STACK_POS[i],
            )}
          >
            <CoverImage url={url} className="h-full w-full object-cover" />
          </div>
        ))
      )}
    </div>
  )
}

function AttrChips({ topCriteria }: { topCriteria: FavoritesSummary["topCriteria"] }) {
  if (topCriteria.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {topCriteria.map((c) => {
        const info = CRITERIA_INFO[c.slug]
        return (
          <span
            key={c.slug}
            title={info?.name ?? c.slug}
            className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs tabular-nums text-secondary-foreground"
          >
            {info?.emoji} {c.avg.toFixed(1)}
          </span>
        )
      })}
    </div>
  )
}

function CardFoot({ summary, commentCount }: { summary: FavoritesSummary; commentCount?: number }) {
  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
        <span className="font-medium">
          {summary.total} obra{summary.total !== 1 ? "s" : ""}
        </span>
        {summary.avgExpectedScore != null && (
          <>
            <span aria-hidden>·</span>
            <span
              className="inline-flex items-center gap-1 font-semibold tabular-nums text-emerald-400"
              title="Nota Prevista média"
            >
              <Sparkles className="size-3" />
              {summary.avgExpectedScore.toFixed(1)}
            </span>
          </>
        )}
        {commentCount != null && (
          <>
            <span aria-hidden>·</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 tabular-nums",
                commentCount > 0 ? "text-foreground/70" : "text-muted-foreground/45",
              )}
              title={`${commentCount} comentário${commentCount !== 1 ? "s" : ""} no grupo`}
            >
              <MessageSquare className="size-3" />
              {commentCount}
            </span>
          </>
        )}
      </div>
      <AttrChips topCriteria={summary.topCriteria} />
    </div>
  )
}

export function GroupsIndex({
  lists,
  allSummary,
  ungrouped,
  multi,
  nested,
  catalog,
}: GroupsIndexProps) {
  // Um aviso por grupo CONTIDO. É raro por construção (1 par em 33 na medição de
  // 2026-08-15) — se um dia deixar de ser, o aviso estará dizendo a verdade sobre uma
  // estrutura de grupos de fato redundante.
  const nestedByInner = new Map(nested.map((n) => [n.innerId, n]))
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [editing, setEditing] = useState<WorkListSummary | null>(null)
  const [deleting, setDeleting] = useState<WorkListSummary | null>(null)
  const [, startDelete] = useTransition()

  const allCoverUrls = catalog
    .filter((w) => w.isFavorite && w.coverUrl)
    .slice(0, 3)
    .map((w) => w.coverUrl as string)

  function confirmDelete() {
    const target = deleting
    if (!target) return
    startDelete(async () => {
      const res = await deleteWorkList(target.id)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      toast.success(`Grupo “${target.name}” excluído.`)
      setDeleting(null)
      router.refresh()
    })
  }

  const editData: GroupFormData | undefined = editing
    ? {
        id: editing.id,
        name: editing.name,
        description: editing.description,
        color: editing.color,
        coverWorkIds: editing.coverWorkIds,
      }
    : undefined
  const editCandidates = editing
    ? catalog.filter((w) => editing.workIds.includes(w.id))
    : []

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {lists.length} grupo{lists.length !== 1 ? "s" : ""} · organize seus favoritos em recortes.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSuggestOpen(true)}>
            <Sparkles /> Sugerir grupos com IA
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Novo grupo
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {/* Card fixo: todos os favoritos (comportamento clássico da página) */}
        <div className="relative flex min-h-[132px] items-center gap-4 rounded-xl border border-primary/40 bg-gradient-to-b from-primary/10 to-card/40 p-4 transition hover:-translate-y-0.5 hover:border-primary/60">
          <Link
            href="/favorites/all"
            aria-label="Todos os favoritos"
            className="absolute inset-0 rounded-xl"
          />
          <CoverStack urls={allCoverUrls} />
          <div className="pointer-events-none min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-semibold">Todos os favoritos</p>
              <Badge variant="outline" className="text-[10px]">
                fixo
              </Badge>
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              Tudo que você marcou com <Heart className="inline size-3 -translate-y-px fill-current text-rose-400" /> — a
              visão completa, sem filtro de grupo.
            </p>
            <CardFoot summary={allSummary} />
          </div>
        </div>

        {/* Card DERIVADO: favoritas que aparecem em 2+ recortes. Irmão do "Sem grupo" (as duas
            respondem perguntas opostas sobre a mesma coleção) e, como ele, sem linha em
            `work_lists`: nada para editar, comentar ou excluir.

            ⚠️ O texto fala em RECORTES, não em gosto. Medido em 2026-08-15: dos grupos de
            hoje, uns descrevem a obra e outros o estado dela no fluxo, e 30 das 46 obras
            misturam os dois — "onde seu gosto converge" seria falso na maioria delas. */}
        {multi.workIds.length > 0 && (
          <div className="relative flex min-h-[132px] items-center gap-4 rounded-xl border border-dashed border-primary/45 bg-gradient-to-b from-primary/10 to-muted/25 p-4 transition hover:-translate-y-0.5 hover:border-primary/70">
            <Link
              href="/favorites/multi"
              aria-label="Favoritas em vários grupos"
              className="absolute inset-0 rounded-xl"
            />
            <CoverStack urls={multi.coverUrls} />
            <div className="pointer-events-none min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Layers className="size-4 shrink-0 text-primary" />
                <p className="truncate font-semibold">Em vários grupos</p>
                <Badge variant="outline" className="border-primary/50 text-[10px] text-primary">
                  derivado
                </Badge>
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                Obras que você fichou em mais de um recorte — onde seus recortes se cruzam.
                {multi.maxGroups >= 2 && ` A mais recorrente está em ${multi.maxGroups}.`}
              </p>
              <CardFoot summary={multi.summary} />
            </div>
          </div>
        )}

        {/* Card DERIVADO: favoritas fora de qualquer grupo. Sem linha em `work_lists` — daí a
            borda tracejada e a ausência de editar/excluir. Escondido quando não há grupo
            nenhum: aí ele seria uma cópia exata de "Todos os favoritos". */}
        {ungrouped.groupCount > 0 && (
          <div className="relative flex min-h-[132px] items-center gap-4 rounded-xl border border-dashed border-muted-foreground/40 bg-muted/30 p-4 transition hover:-translate-y-0.5 hover:border-muted-foreground/70">
            <Link
              href="/favorites/ungrouped"
              aria-label="Favoritas sem grupo"
              className="absolute inset-0 rounded-xl"
            />
            <CoverStack urls={ungrouped.coverUrls} />
            <div className="pointer-events-none min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                <p className="truncate font-semibold">Sem grupo</p>
                <Badge variant="outline" className="text-[10px]">
                  derivado
                </Badge>
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                Favoritas que ainda não entraram em nenhum grupo — a fila do que falta organizar.
              </p>
              <CardFoot summary={ungrouped.summary} />
            </div>
          </div>
        )}

        {/* Grupos do usuário */}
        {lists.map((list) => (
          <div
            key={list.id}
            className="group relative flex min-h-[132px] items-center gap-4 rounded-xl border bg-card/60 p-4 transition hover:-translate-y-0.5 hover:border-primary/40"
          >
            <Link
              href={`/favorites/${list.id}`}
              aria-label={list.name}
              className="absolute inset-0 rounded-xl"
            />
            <CoverStack urls={list.coverUrls} />
            <div className="pointer-events-none min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {list.color && (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: `hsl(${list.color})` }}
                  />
                )}
                <p className="truncate font-semibold">{list.name}</p>
              </div>
              {list.description && (
                <p className="line-clamp-2 text-sm text-muted-foreground">{list.description}</p>
              )}
              <CardFoot summary={list} commentCount={list.commentCount} />
              {/* Grupo contido em outro: sem isto, as obras dele exibem "2 grupos" na tabela e
                  parecem convergência, quando são o mesmo recorte contado duas vezes. */}
              {nestedByInner.has(list.id) && (
                <p className="mt-2 rounded-md border bg-muted/60 px-2 py-1 text-[11px] leading-snug text-muted-foreground">
                  ⊂ as {nestedByInner.get(list.id)!.innerCount} também estão em{" "}
                  <span className="font-medium text-foreground">
                    {nestedByInner.get(list.id)!.outerName}
                  </span>{" "}
                  — para elas, “2 grupos” não é convergência
                </p>
              )}
            </div>
            <div className="pointer-events-auto absolute right-3 top-3 z-10 flex gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Editar grupo"
                title="Editar grupo"
                onClick={() => setEditing(list)}
              >
                <Pencil />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Excluir grupo"
                title="Excluir grupo"
                className="hover:border-destructive/60 hover:text-destructive"
                onClick={() => setDeleting(list)}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}

        {/* Ghost: criar */}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex min-h-[132px] items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition hover:border-primary/60 hover:text-primary"
        >
          <span className="grid size-8 place-items-center rounded-lg border border-current">
            <Plus className="size-4" />
          </span>
          Criar novo grupo
        </button>
      </div>

      <GroupFormDialog open={createOpen} onOpenChange={setCreateOpen} mode="create" />
      <SuggestGroupsDialog open={suggestOpen} onOpenChange={setSuggestOpen} catalog={catalog} />
      <GroupFormDialog
        open={editing != null}
        onOpenChange={(o) => !o && setEditing(null)}
        mode="edit"
        list={editData}
        coverCandidates={editCandidates}
      />
      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Excluir “${deleting?.name}”?`}
        description="O grupo é removido, mas as obras e seus favoritos continuam intactos."
        confirmText="Excluir grupo"
        onConfirm={confirmDelete}
      />
    </section>
  )
}
