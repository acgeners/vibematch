import { CollapsibleCard } from "@/components/ui/collapsible-card"
import { SourceTag } from "@/components/import/source-tag"

// Passo a passo de como obter a lista de cada fonte. AniList é por usuário (sem
// arquivo); as demais exportam um arquivo que entra em "Por arquivo".
const GUIDES: { source: string; steps: string[] }[] = [
  {
    source: "anilist",
    steps: [
      "Deixe a lista pública em Settings → Lists.",
      'Aqui, escolha "Por usuário".',
      "Digite seu nome de usuário — pronto, sem arquivo.",
    ],
  },
  {
    source: "myanimelist",
    steps: [
      "Perfil → Manga List.",
      "Menu ⋯ → Export e baixe o arquivo.",
      'Suba o .json em "Por arquivo".',
    ],
  },
  {
    source: "mangaupdates",
    steps: [
      "Sua conta → Lists.",
      "Export e salve o .json.",
      'Suba em "Por arquivo".',
    ],
  },
  {
    source: "animeplanet",
    steps: [
      "Settings → Export your data.",
      "Baixe o .xml.gz (formato MyAnimeList).",
      "Suba direto — não precisa descompactar.",
    ],
  },
]

export function ExportHelp() {
  return (
    <CollapsibleCard
      title="Como exportar sua lista"
      description="Onde baixar o arquivo (ou obter o usuário) em cada fonte."
      defaultOpen={false}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {GUIDES.map((g) => (
          <div key={g.source} className="rounded-lg border border-border/60 bg-muted/30 p-3">
            <SourceTag source={g.source} />
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              {g.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </CollapsibleCard>
  )
}
