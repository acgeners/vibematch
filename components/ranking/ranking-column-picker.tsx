"use client"

import { useSyncExternalStore } from "react"
import { ColumnPicker } from "@/components/ui/column-picker"
import {
  RANKING_COLUMN_GROUP_LABELS,
  RANKING_COLUMN_PRESETS,
  RANKING_TABLE_COLUMNS,
  getActivePreset,
  getDefaultRankingColumnConfig,
  getPresetConfig,
  normalizeRankingColumnConfig,
  readRankingColumnConfig,
  subscribeRankingColumnConfig,
  writeRankingColumnConfig,
  type RankingColumnConfig,
  type RankingColumnPreset,
} from "@/components/ranking/ranking-table-config"

export function RankingColumnPicker() {
  const config = useSyncExternalStore(
    subscribeRankingColumnConfig,
    readRankingColumnConfig,
    getDefaultRankingColumnConfig
  )

  const apply = (next: RankingColumnConfig) =>
    writeRankingColumnConfig(normalizeRankingColumnConfig(next))

  const activePreset = getActivePreset(config)
  const activePresets = new Set<string>(activePreset ? [activePreset] : [])

  return (
    <ColumnPicker
      columns={RANKING_TABLE_COLUMNS}
      groupLabels={RANKING_COLUMN_GROUP_LABELS}
      presets={RANKING_COLUMN_PRESETS}
      config={config}
      onChange={(next) => apply({ ...config, ...next })}
      activePresets={activePresets}
      onTogglePreset={(id) => apply(getPresetConfig(id as RankingColumnPreset))}
      onReset={() => apply(getDefaultRankingColumnConfig())}
    />
  )
}
