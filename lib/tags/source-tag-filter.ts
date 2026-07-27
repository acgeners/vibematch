/**
 * Filtro/normalização de strings de tag/gênero vindas das fontes externas.
 * Compartilhado entre `server/actions/external.ts` (fluxo de criação) e os scripts
 * de backfill — por isso NÃO é "use server" (aquele só pode exportar async fns).
 */

/** Chave de comparação: minúsculas, sem separadores (casa "4-Koma" com "4koma"). */
export function normalizeTagKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/**
 * Meta-tags de FORMATO/estrutura das fontes que não descrevem conteúdo nem gosto.
 * Filtradas na entrada pra não poluir o catálogo (o resto NÃO é descartado — vira
 * tag e vai pra revisão em "Tags novas"). Extensível conforme aparecer ruído.
 */
export const SOURCE_TAG_DENYLIST: ReadonlySet<string> = new Set(
  [
    "Full Color", "Fan Colored", "Full Colored", "Long Strip", "Web Comic", "Webcomic",
    "Webtoon", "Webtoons", "Anthology", "4-Koma", "Oneshot", "One-shot", "Doujinshi",
    "Adaptation", "Fan-Made",
  ].map(normalizeTagKey),
)
