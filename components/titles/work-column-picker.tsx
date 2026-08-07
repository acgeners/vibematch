"use client"

import { useSyncExternalStore } from "react"
import { ColumnPicker } from "@/components/ui/column-picker"
import {
  EXACT_SET_PRESETS,
  WORK_COLUMN_GROUP_LABELS,
  WORK_COLUMN_PRESETS,
  WORK_TABLE_COLUMNS,
  getActivePresetSet,
  getDefaultWorkColumnConfig,
  getPresetConfig,
  getPresetSetConfig,
  isDefaultWorkColumnConfig,
  normalizeWorkColumnConfig,
  readWorkColumnConfig,
  subscribeWorkColumnConfig,
  writeWorkColumnConfig,
  type WorkColumnConfig,
  type WorkColumnNamespace,
  type WorkColumnPreset,
} from "@/components/titles/work-table-config"

interface WorkColumnPickerProps {
  namespace?: WorkColumnNamespace
  /** Mantém o botão na barra, apagado, onde as colunas não se aplicam. */
  disabled?: boolean
  disabledTitle?: string
}

export function WorkColumnPicker({
  namespace = "titles",
  disabled,
  disabledTitle,
}: WorkColumnPickerProps = {}) {
  const config = useSyncExternalStore(
    (onChange) => subscribeWorkColumnConfig(onChange, namespace),
    () => readWorkColumnConfig(namespace),
    () => getDefaultWorkColumnConfig(namespace)
  )

  const apply = (next: WorkColumnConfig) =>
    writeWorkColumnConfig(normalizeWorkColumnConfig(next), namespace)

  // Na visualização padrão, nenhum preset fica marcado (o default não é um preset).
  // Vazio serve tanto ao destaque quanto à base do toggle: clicar um grupo a partir
  // do padrão começa "do zero" nesse grupo, em vez de somar ao recorte default.
  const activePresets = isDefaultWorkColumnConfig(config, namespace)
    ? new Set<WorkColumnPreset>()
    : getActivePresetSet(config)

  const handleTogglePreset = (presetId: string) => {
    const preset = presetId as WorkColumnPreset
    // Presets de conjunto exato (tudo/compacto): clicar SUBSTITUI o conjunto
    // visível pelo do preset, em vez de somar grupos.
    if (EXACT_SET_PRESETS.has(preset)) {
      apply(getPresetConfig(preset))
      return
    }
    const next = new Set(activePresets)
    for (const exact of EXACT_SET_PRESETS) next.delete(exact)
    if (next.has(preset)) next.delete(preset)
    else next.add(preset)
    apply(getPresetSetConfig(next))
  }

  return (
    <ColumnPicker
      columns={WORK_TABLE_COLUMNS}
      groupLabels={WORK_COLUMN_GROUP_LABELS}
      presets={WORK_COLUMN_PRESETS}
      config={config}
      onChange={(next) => apply({ ...config, ...next })}
      activePresets={activePresets as Set<string>}
      onTogglePreset={handleTogglePreset}
      onReset={() => apply(getDefaultWorkColumnConfig(namespace))}
      disabled={disabled}
      disabledTitle={disabledTitle}
    />
  )
}
