import { Header } from "@/components/layout/header"
import {
  TagConsolidationTool,
  type TagConsolidationParams,
} from "@/components/settings/tag-consolidation/tag-consolidation-tool"

interface PageProps {
  searchParams: Promise<TagConsolidationParams>
}

// Rota dedicada da Consolidação de tags — mantida como deep-link estável (a
// navegação de filtros usa `basePath` default). A mesma ferramenta também roda
// inline (expandida) na pilha do tópico "Avançado" em /settings.
export const metadata = { title: "Consolidação de tags" }

export default async function TagConsolidationPage({ searchParams }: PageProps) {
  const params = await searchParams
  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        title="Consolidação de tags"
        description="Revise os clusters semânticos, as mudanças de grupo e os sub-grupos propostos pela IA."
      />
      <TagConsolidationTool params={params} />
    </div>
  )
}
