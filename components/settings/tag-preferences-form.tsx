"use client"

import { useMemo, useState, useTransition } from "react"
import { Heart, Ban, ChevronRight, Sparkles, Save, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { saveTagPreferences } from "@/server/actions/tag-preferences"
import { useRefresh } from "@/lib/use-refresh"
import { Button } from "@/components/ui/button"
import type { TagOption } from "@/server/queries/tags"
import type { TagPreferenceRow, TagPrefLevel, TagStance } from "@/server/queries/tag-preferences"
import { cn } from "@/lib/utils"

interface TagPreferencesFormProps {
  tags: TagOption[]
  initialRows: TagPreferenceRow[]
}

interface SubgroupNode {
  id: string
  label: string
  tags: TagOption[]
}
interface GroupNode {
  id: string
  label: string
  subgroups: SubgroupNode[]
  /** Tags do grupo sem subgrupo atribuído. */
  looseTags: TagOption[]
}

interface Decl {
  stance: TagStance
  weight: number
}

const SIN_GRUPO = "Sem grupo"

function keyOf(level: TagPrefLevel, id: string): string {
  return `${level}:${id}`
}

function rowsToMap(rows: TagPreferenceRow[]): Map<string, Decl> {
  const m = new Map<string, Decl>()
  for (const r of rows) m.set(keyOf(r.level, r.targetId), { stance: r.stance, weight: r.weight })
  return m
}

/** Quantas declarações diferem entre o estado atual e o persistido. */
function diffCount(current: Map<string, Decl>, base: Map<string, Decl>): number {
  let n = 0
  const keys = new Set([...current.keys(), ...base.keys()])
  for (const k of keys) {
    const a = current.get(k)
    const b = base.get(k)
    if (!a || !b || a.stance !== b.stance || a.weight !== b.weight) n++
  }
  return n
}

export function TagPreferencesForm({ tags, initialRows }: TagPreferencesFormProps) {
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()

  // Árvore Grupo → Subgrupo → Tag a partir do catálogo achatado.
  const groups = useMemo<GroupNode[]>(() => {
    const byGroup = new Map<string, GroupNode>()
    for (const t of tags) {
      const gid = t.tag_group_id ?? SIN_GRUPO
      let g = byGroup.get(gid)
      if (!g) {
        g = { id: gid, label: t.groupName || SIN_GRUPO, subgroups: [], looseTags: [] }
        byGroup.set(gid, g)
      }
      if (t.tag_subgroup_id) {
        let sg = g.subgroups.find((s) => s.id === t.tag_subgroup_id)
        if (!sg) {
          sg = { id: t.tag_subgroup_id, label: t.subGroupName || "Subgrupo", tags: [] }
          g.subgroups.push(sg)
        }
        sg.tags.push(t)
      } else {
        g.looseTags.push(t)
      }
    }
    const list = [...byGroup.values()].filter((g) => g.id !== SIN_GRUPO)
    for (const g of list) {
      g.subgroups.sort((a, b) => a.label.localeCompare(b.label))
      g.looseTags.sort((a, b) => a.name.localeCompare(b.name))
      for (const s of g.subgroups) s.tags.sort((a, b) => a.name.localeCompare(b.name))
    }
    return list.sort((a, b) => a.label.localeCompare(b.label))
  }, [tags])

  // Estado das declarações (local). Map "level:id" → Decl. As mudanças ficam só
  // no cliente até clicar Salvar (batch) — nada de round-trip por clique.
  const [decls, setDecls] = useState<Map<string, Decl>>(() => rowsToMap(initialRows))
  // Baseline = o que está persistido. Compara contra `decls` pra saber o que falta salvar.
  const [baseline, setBaseline] = useState<Map<string, Decl>>(() => rowsToMap(initialRows))
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set())

  const declaredCount = decls.size
  const dirtyCount = useMemo(() => diffCount(decls, baseline), [decls, baseline])
  const isDirty = dirtyCount > 0

  // Edição LOCAL (sem servidor). stance null = remove.
  function apply(level: TagPrefLevel, targetId: string, stance: TagStance | null, weight = 1) {
    const key = keyOf(level, targetId)
    setDecls((prev) => {
      const next = new Map(prev)
      if (stance) next.set(key, { stance, weight })
      else next.delete(key)
      return next
    })
  }

  function discard() {
    setDecls(new Map(baseline))
  }

  function save() {
    const items = [...decls.entries()].map(([k, v]) => {
      const idx = k.indexOf(":")
      return {
        level: k.slice(0, idx) as TagPrefLevel,
        targetId: k.slice(idx + 1),
        stance: v.stance,
        weight: v.weight,
      }
    })
    startTransition(async () => {
      const res = await saveTagPreferences(items)
      if (!res.ok) {
        toast.error(res.error || "Não consegui salvar as preferências.")
        return
      }
      setBaseline(new Map(decls))
      toast.success("Preferências salvas.")
      refresh()
    })
  }

  // Stance herdada de um ancestral (subgrupo > grupo). Usada só pra dica visual.
  function inherited(groupId: string | null, subgroupId: string | null): Decl | null {
    if (subgroupId) {
      const s = decls.get(keyOf("subgroup", subgroupId))
      if (s) return s
    }
    if (groupId) {
      const g = decls.get(keyOf("group", groupId))
      if (g) return g
    }
    return null
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Declare o que você <strong>ama</strong> ou <strong>evita</strong> por <strong>subgrupo</strong> ou{" "}
        <strong>tag</strong> (os grupos servem só pra navegar). A tag sobrepõe o subgrupo. Isso vira um{" "}
        <em>prior</em> do seu perfil de gosto e ajusta o ranking no próximo Recalcular.{" "}
        {declaredCount > 0 && <span className="text-foreground">{declaredCount} declaração(ões) ativa(s).</span>}
      </p>

      {/* Barra de ação — salva tudo de uma vez (batch). */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
        <span className={cn("text-xs", isDirty ? "font-medium text-amber-600" : "text-muted-foreground")}>
          {isDirty ? `${dirtyCount} alteração(ões) não salva(s)` : "Tudo salvo"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={discard}
            disabled={!isDirty || isPending}
            className="h-8 gap-1.5"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Descartar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={!isDirty || isPending}
            className="h-8 gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/60 rounded-lg border border-border/60">
        {groups.map((g) => {
          const gExpanded = expandedGroups.has(g.id)
          return (
            <div key={g.id}>
              <NodeRow
                label={g.label}
                level="group"
                bold
                selectable={false}
                expandable
                expanded={gExpanded}
                onToggleExpand={() =>
                  setExpandedGroups((s) => {
                    const n = new Set(s)
                    if (n.has(g.id)) n.delete(g.id)
                    else n.add(g.id)
                    return n
                  })
                }
                decl={null}
                inheritedDecl={null}
                disabled={isPending}
                onSet={() => {}}
              />

              {gExpanded && (
                <div className="bg-muted/20">
                  {g.subgroups.map((sg) => {
                    const sExpanded = expandedSubs.has(sg.id)
                    const sDecl = decls.get(keyOf("subgroup", sg.id)) ?? null
                    return (
                      <div key={sg.id}>
                        <NodeRow
                          label={`${sg.label} · ${sg.tags.length}`}
                          level="subgroup"
                          indent={1}
                          expandable
                          expanded={sExpanded}
                          onToggleExpand={() =>
                            setExpandedSubs((s) => {
                              const n = new Set(s)
                              if (n.has(sg.id)) n.delete(sg.id)
                              else n.add(sg.id)
                              return n
                            })
                          }
                          decl={sDecl}
                          inheritedDecl={sDecl ? null : inherited(g.id, null)}
                          disabled={isPending}
                          onSet={(stance, weight) => apply("subgroup", sg.id, stance, weight)}
                        />
                        {sExpanded && (
                          <div className="grid grid-cols-1 gap-x-6 pl-6 md:grid-cols-2">
                            {sg.tags.map((t) => {
                              const tDecl = decls.get(keyOf("tag", t.id)) ?? null
                              return (
                                <NodeRow
                                  key={t.id}
                                  label={t.name}
                                  level="tag"
                                  indent={0}
                                  decl={tDecl}
                                  inheritedDecl={tDecl ? null : inherited(g.id, sg.id)}
                                  disabled={isPending}
                                  onSet={(stance, weight) => apply("tag", t.id, stance, weight)}
                                />
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {g.looseTags.length > 0 && (
                    <div className="grid grid-cols-1 gap-x-6 pl-6 md:grid-cols-2">
                      {g.looseTags.map((t) => {
                        const tDecl = decls.get(keyOf("tag", t.id)) ?? null
                        return (
                          <NodeRow
                            key={t.id}
                            label={t.name}
                            level="tag"
                            indent={0}
                            decl={tDecl}
                            inheritedDecl={tDecl ? null : inherited(g.id, null)}
                            disabled={isPending}
                            onSet={(stance, weight) => apply("tag", t.id, stance, weight)}
                          />
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface NodeRowProps {
  label: string
  level: TagPrefLevel
  indent?: 0 | 1 | 2
  bold?: boolean
  /** false = nó só de navegação (grupo): sem controles amo/evito. */
  selectable?: boolean
  expandable?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  decl: Decl | null
  inheritedDecl: Decl | null
  disabled?: boolean
  onSet: (stance: TagStance | null, weight: number) => void
}

const INDENT = ["pl-3", "pl-8", "pl-14"] as const

function NodeRow({
  label,
  indent = 0,
  bold,
  selectable = true,
  expandable,
  expanded,
  onToggleExpand,
  decl,
  inheritedDecl,
  disabled,
  onSet,
}: NodeRowProps) {
  const emphatic = (decl?.weight ?? 1) >= 2
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border/25 py-1.5 pr-2 transition-colors hover:bg-foreground/[0.045]",
        INDENT[indent],
      )}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label={expanded ? "Recolher" : "Expandir"}
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}

      <span className={cn("flex-1 truncate text-sm", bold ? "font-semibold" : "font-normal")}>
        {label}
        {inheritedDecl && (
          <span
            className={cn(
              "ml-2 align-middle text-[10px]",
              inheritedDecl.stance === "love" ? "text-emerald-600" : "text-rose-600",
            )}
          >
            herda {inheritedDecl.stance === "love" ? "❤" : "⊘"}
          </span>
        )}
      </span>

      {/* Ênfase (weight 2×) — só quando há stance explícita. */}
      {selectable && decl && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSet(decl.stance, emphatic ? 1 : 2)}
          title={emphatic ? "Ênfase forte (2×) — clique pra normal" : "Marcar como ênfase forte (2×)"}
          className={cn(
            "flex h-6 items-center gap-0.5 rounded px-1.5 text-[10px] font-medium",
            emphatic ? "bg-amber-500/15 text-amber-600" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Sparkles className="h-3 w-3" />
          {emphatic ? "2×" : ""}
        </button>
      )}

      {selectable && (
      <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border/60 p-0.5">
        <StanceButton
          active={decl?.stance === "love"}
          tone="love"
          disabled={disabled}
          onClick={() => onSet(decl?.stance === "love" ? null : "love", decl?.weight ?? 1)}
        />
        <StanceButton
          active={decl?.stance === "avoid"}
          tone="avoid"
          disabled={disabled}
          onClick={() => onSet(decl?.stance === "avoid" ? null : "avoid", decl?.weight ?? 1)}
        />
      </div>
      )}
    </div>
  )
}

function StanceButton({
  active,
  tone,
  disabled,
  onClick,
}: {
  active: boolean
  tone: "love" | "avoid"
  disabled?: boolean
  onClick: () => void
}) {
  const Icon = tone === "love" ? Heart : Ban
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      title={tone === "love" ? "Amo" : "Evito"}
      className={cn(
        "flex h-6 w-7 items-center justify-center rounded transition-colors disabled:opacity-50",
        active && tone === "love" && "bg-emerald-500/20 text-emerald-600",
        active && tone === "avoid" && "bg-rose-500/20 text-rose-600",
        !active && "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", active && "fill-current")} />
    </button>
  )
}
