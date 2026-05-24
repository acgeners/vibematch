"use client"

import { useSyncExternalStore } from "react"
import { ColumnPicker } from "@/components/ui/column-picker"
import {
  WORK_COLUMN_GROUP_LABELS,
  WORK_COLUMN_PRESETS,
  WORK_TABLE_COLUMNS,
  getActivePresetSet,
  getDefaultWorkColumnConfig,
  getPresetSetConfig,
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
}

export function WorkColumnPicker({ namespace = "titles" }: WorkColumnPickerProps = {}) {
  const config = useSyncExternalStore(
    (onChange) => subscribeWorkColumnConfig(onChange, namespace),
    () => readWorkColumnConfig(namespace),
    () => getDefaultWorkColumnConfig(namespace)
  )

  const apply = (next: WorkColumnConfig) =>
    writeWorkColumnConfig(normalizeWorkColumnConfig(next), namespace)

  const activePresets = getActivePresetSet(config)

  const handleTogglePreset = (presetId: string) => {
    const preset = presetId as WorkColumnPreset
    if (preset === "tudo") {
      apply(getPresetSetConfig(["tudo"]))
      return
    }
    const next = new Set(activePresets)
    next.delete("tudo")
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
    />
  )
}
