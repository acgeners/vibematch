import { BookOpenText, Gem } from "lucide-react"
import { Header } from "@/components/layout/header"
import { canConsumeAi } from "@/server/queries/current-user"

export const dynamic = "force-dynamic"
export const metadata = { title: "Guia — SatorIA" }

interface GuideCard {
  tier: string
  title: string
  one: string
  detailsTitle: string
  details: string
  where: string
  /** Consome crédito de IA (decisão de 31/07: só INDICA — sem gate novo). */
  aiCredit?: boolean
}

/**
 * Guia de conceitos em TRÊS camadas (decisão 3 do onboarding, mockup = spec):
 * a frase que resolve (sempre visível), o mecanismo por trás (expande) e onde o
 * número aparece na tela. Quem só quer usar o app para na primeira. Conteúdo do
 * mockup aprovado; o que consome crédito de IA vem marcado no card, com o texto
 * ajustado ao plano de quem lê.
 */
const CARDS: GuideCard[] = [
  {
    tier: "o número principal",
    title: "Nota Prevista",
    one: "Quanto você provavelmente vai gostar desta obra — de 0 a 10. Não é a nota do público.",
    detailsTitle: "Como ela é calculada",
    details:
      "Um modelo treinado nas notas que você mesmo deu. Ele cruza os nove atributos avaliados pela IA, a média das plataformas, o tamanho e a idade da obra, e o quanto as tags dela batem com o que você ama ou evita. Enquanto você tiver menos de 20 obras avaliadas, ele ainda não tem material — e a SatorIA avisa isso na cara, em vez de chutar.",
    where: "/ranking · card da obra · recomendações",
  },
  {
    tier: "a leitura da obra",
    title: "Os 9 atributos",
    one: "Uma IA lê reviews de oito sites e resume cada obra em nove notas: romance, ação, worldbuilding, ritmo e outras.",
    detailsTitle: "De onde vêm as reviews",
    details:
      "MangaUpdates, AniList, MyAnimeList, Kitsu, AnimePlanet, MangaDex, ComicK e Comix. A IA recebe uma amostra equilibrada entre as fontes e responde pelo consenso — nunca por uma review isolada. Cada avaliação fica registrada com data e modelo usado, e você pode discordar: a nota que você corrige vale mais que a dela.",
    where: "página da obra · aba Atributos",
  },
  {
    tier: "seu sinal mais barato",
    title: "Interesse ♥",
    one: "Um toque dizendo “isso me chamou atenção”, sem compromisso de ler.",
    detailsTitle: "Por que ele importa",
    details:
      "É o único sinal que você dá antes de ler — por isso ele alimenta um modelo separado, que aprende a prever atração pela sinopse. Curtir e dispensar valem igual: o não é o que evita que a IA te ofereça a mesma coisa errada dez vezes.",
    where: "todo card de obra · deck das boas-vindas",
  },
  {
    tier: "seu vocabulário",
    title: "Tags que amo / evito",
    one: "Você declara o que persegue e o que abandona. O app respeita as duas listas.",
    detailsTitle: "Declarado × observado",
    details:
      "Existem dois retratos do seu gosto: o que você diz (estas tags) e o que suas notas revelam. Quando os dois discordam, o perfil mostra a divergência em vez de escolher sozinho — geralmente é aí que você descobre algo sobre si.",
    where: "/preferencias · usado no ranking e na previsão",
  },
  {
    tier: "o retrato",
    title: "Perfil de gosto",
    one: "O resumo do que a IA entendeu sobre você, reescrito a cada tantas avaliações novas.",
    detailsTitle: "Por que ele “desatualiza”",
    details:
      "Seu gosto muda mais rápido que o retrato. Quando entram avaliações suficientes para mudar as conclusões, o perfil aparece marcado como defasado — e refazê-lo custa uma chamada de IA, então a decisão é sua, não automática.",
    where: "/conta/perfil",
    aiCredit: true,
  },
  {
    tier: "quando vale a leitura longa",
    title: "Deep Dive",
    one: "Uma análise sob encomenda de uma obra específica, escrita para o seu perfil.",
    detailsTitle: "Quanto custa e quando usar",
    details:
      "Serve para a dúvida cara — aquela obra de 400 capítulos que você não sabe se começa. Cada análise fica salva e pode ser relida à vontade, sem gastar de novo. O crédito de IA é limitado por plano, então o guia marca isso no próprio card em vez de deixar você descobrir batendo no teto.",
    where: "/recommendations · botão na página da obra",
    aiCredit: true,
  },
]

export default async function GuiaPage() {
  const aiAvailable = await canConsumeAi()

  return (
    <div className="w-full max-w-5xl space-y-6">
      <Header
        kicker="Guia"
        icon={<BookOpenText />}
        title="O guia entrega uma camada de cada vez"
        description="Cada conceito abre em três níveis — a frase que resolve, o mecanismo por trás e onde o número aparece na tela. Quem só quer usar o app para no primeiro."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((c) => (
          <article
            key={c.title}
            className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm"
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-sky-300 via-primary to-transparent"
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {c.tier}
            </span>
            <h2 className="text-lg font-semibold leading-tight">{c.title}</h2>
            {c.aiCredit && (
              <span
                className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${
                  aiAvailable
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                }`}
              >
                <Gem className="size-3" />
                {aiAvailable ? "consome crédito de IA · incluso no seu plano" : "consome crédito de IA · assinatura"}
              </span>
            )}
            <p className="text-[14.5px] leading-relaxed">{c.one}</p>
            <details className="border-t border-border pt-2.5">
              <summary className="cursor-pointer text-[13px] font-semibold text-primary">
                {c.detailsTitle}
              </summary>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{c.details}</p>
            </details>
            <span className="mt-auto border-t border-dashed border-border pt-2.5 font-mono text-[11px] text-muted-foreground">
              {c.where}
            </span>
          </article>
        ))}
      </div>
    </div>
  )
}
