import { discoverBySeeds, DEFAULT_RESULT_LIMIT } from "@/server/queries/seed-discovery"
import { DiscoveryView } from "@/components/discovery/discovery-view"

/**
 * `/descobrir` — "Mais como estas".
 *
 * A pessoa aponta de 2 a 5 obras-semente e recebe o catálogo cruzado em dois eixos:
 * PARECENÇA com as sementes (embeddings centralizados, migration 187) e ALINHAMENTO com o
 * perfil dela. Os dois são ortogonais (corr ≈ −0,04, medido), então cada ponta do slider
 * devolve uma lista genuinamente diferente — é essa diferença que a página existe para
 * explorar.
 *
 * 🔴 A rota está em `SIGNED_IN_PREFIXES` (proxy): metade do resultado é dado de quem olha.
 * Sem sessão a página não teria sujeito e cairia no singleton do dono.
 *
 * ⚠️ Tudo mora na QUERY STRING de propósito — a busca vira link, sobrevive ao refresh e ao
 * voltar do browser, e pode ser salva em `ranking_filter_presets` (que já é multi-página
 * via `base_path`). IDs e não slugs: slug muda num rename e o link salvo morreria.
 */

interface PageProps {
  searchParams: Promise<{
    seeds?: string
    anti?: string
    w?: string
    lidas?: string
  }>
}

function parseIds(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
}

export default async function DescobrirPage({ searchParams }: PageProps) {
  const params = await searchParams
  const seedIds = parseIds(params.seeds)
  const antiIds = parseIds(params.anti)

  // `w` em 0–100 na URL (inteiro legível), 0–1 no código. Unidade única na query string,
  // pela mesma razão que os limiares do /ranking são sempre em pontos.
  const rawWeight = Number.parseInt(params.w ?? "", 10)
  const weight = Number.isFinite(rawWeight) ? rawWeight / 100 : undefined

  // `lidas=1` INCLUI as já lidas; a ausência do parâmetro é o padrão (só não lidas).
  const onlyUnread = params.lidas !== "1"

  const result = await discoverBySeeds({
    seedIds,
    antiIds,
    weight,
    onlyUnread,
    limit: DEFAULT_RESULT_LIMIT,
  })

  return <DiscoveryView result={result} onlyUnread={onlyUnread} />
}
