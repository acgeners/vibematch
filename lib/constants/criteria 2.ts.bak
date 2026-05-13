export const CRITERIA_INFO: Record<
  string,
  { name: string; emoji: string; description: string }
> = {
  romance: { name: "Romance", emoji: "💞", description: "Avalia o quanto o romance está presente e influencia a obra.\nConsidera se o relacionamento é apenas um detalhe, um subplot relevante ou o eixo principal da história." },
  couple_dynamics: { name: "Dinâmica do Casal", emoji: "💑", description: "Avalia a qualidade da relação entre o casal principal.\nConsidera se a dinâmica é tóxica, conflituosa, saudável, divertida, comunicativa ou baseada em parceria." },
  fantasy_nobility: { name: "Fantasia/Nobreza", emoji: "👑", description: "Avalia o quanto elementos de fantasia, magia, nobreza, realeza ou política de corte fazem parte da obra.\nConsidera se esses elementos são só estética ou se realmente moldam o mundo, os conflitos e as decisões dos personagens." },
  action_adventure: { name: "Ação/Aventura", emoji: "⚔️", description: "Avalia o nível de movimento, tensão e eventos marcantes da história.\nConsidera se a obra é mais cotidiana/parada ou se envolve missões, conflitos externos, perigos, batalhas, viagens ou eventos de grande escala." },
  adult_content: { name: "Conteúdo Adulto", emoji: "🔥", description: "Avalia o nível de sexualização ou conteúdo sexual presente na obra.\nConsidera desde ausência quase total até cenas explícitas recorrentes, levando em conta frequência, intensidade e relevância para a narrativa." },
  protagonist: { name: "Protagonista Marcante", emoji: "🦸", description: "Avalia o quanto o protagonista se destaca e carrega a obra.\nConsidera presença, personalidade, inteligência, força, habilidade, agência e capacidade de tornar a história mais interessante." },
  humor: { name: "Humor", emoji: "🦸", description: "Avalia o quanto o humor está presente no tom da obra.\nConsidera se há apenas alívio cômico pontual ou se a comédia é parte frequente e importante da experiência." },
  drama: { name: "Drama", emoji: "😂", description: "Avalia a intensidade dos conflitos emocionais da obra.\nConsidera sofrimento, tensão emocional, dilemas, conflitos de relacionamento e o quanto isso afeta o ritmo e as decisões dos personagens." },
  tragedy: { name: "Tragédia", emoji: "🎭", description: "Avalia o peso de acontecimentos trágicos durante o desenvolvimento principal da história (não considera background nem acontecimentos no começo imediato da história).\nConsidera perdas, separações, mortes, injustiças e sofrimento que acontecem no meio da obra e impactam diretamente os personagens principais." },
}

export const CRITERIA_RUBRICS: Record<
  string,
  { title: string; ranges: string[]; note?: string }
> = {
  romance: {
    title: "Romance",
    ranges: [
      "0-3 | Ausente / irrelevante: não tem romance ou é totalmente secundário; pode ter crush leve que não impacta nada.",
      "4-6 | Subplot: romance existe, mas não guia a história; desenvolvimento lento ou pouco foco.",
      "7-8 | Core romance: romance é um dos pilares da história e impacta decisões, conflitos e evolução.",
      "9-10 | Romance-driven: a história é sobre o romance; o plot gira em torno do relacionamento.",
    ],
  },
  couple_dynamics: {
    title: "Dinâmica do Casal",
    ranges: [
      "0-3 | Dinâmica de obsessão, controle, toxicidade, abuso emocional, manipulação ou relação majoritariamente prejudicial.",
      "4-6 | Há mal-entendidos eventuais, ciúme e algum nível de conflito.",
      "7-8 | Relacionamento saudável, com alguns conflitos eventuais, mas trabalhados e resolvidos relativamente rápido.",
      "9-10 | Dinâmica leve, divertida e saudável; parceria, desenvolvimento mútuo e boa comunicação.",
    ],
  },
  fantasy_nobility: {
    title: "Fantasia/Nobreza",
    ranges: [
      "0-3 | Realista / residual: mundo normal ou fantasia irrelevante; fantasia como estética, por exemplo 'é príncipe', mas isso não importa.",
      "4-6 | Presente: elementos de fantasia/nobreza existem e influenciam algumas partes da história.",
      "7-8 | Estrutural: sistema de magia, política nobre, aristocracia, reencarnação, nobreza ou fantasia afetam conflitos principais.",
      "9-10 | Dominante: o mundo é construído em cima disso; regras de fantasia/nobreza definem a história.",
    ],
  },
  action_adventure: {
    title: "Ação/Aventura",
    ranges: [
      "0-3 | Principalmente slice of life: ritmo mais parado, eventos cotidianos.",
      "4-6 | Ritmo um pouco mais agitado, mas sem grandes eventos ou desenrolar emocionante.",
      "7-8 | Presença constante de situações marcantes, ritmo acelerado, protagonistas envolvidos em eventos significativos para o mundo.",
      "9-10 | Raramente há momentos parados/cotidianos; protagonistas em missão para salvar/mudar o mundo/história ou centro de eventos extremamente marcantes.",
    ],
  },
  adult_content: {
    title: "Conteúdo Adulto",
    ranges: [
      "0-3 | Clean: sem sexualização relevante; no máximo beijo leve ou sugestão implícita.",
      "4-6 | Suggestive: insinuação clara, roupas/situações/tensão sexual; pode ter cena cortada/fade to black.",
      "7-8 | Mature: sexo parcialmente mostrado, sem foco explícito; nudez e contexto sexual relevante para a trama.",
      "9-10 | Smut: sexo explícito recorrente; foco no ato, não só na narrativa.",
    ],
  },
  protagonist: {
    title: "Protagonista Marcante",
    ranges: [
      "0-3 | Fraco / genérico: esquecível, sem personalidade clara; poderia ser trocado sem grande diferença.",
      "4-6 | Funcional: tem personalidade básica e conduz a história, mas não brilha.",
      "7-8 | Forte: presença clara, decisões relevantes, personalidade consistente; destaca-se por força, inteligência ou habilidade.",
      "9-10 | Icônico / overpowered: carrega a obra; mesmo sem plot, o protagonista sustentaria o interesse.",
    ],
  },
  humor: {
    title: "Humor",
    ranges: [
      "0-3 | Ausente: quase nenhum humor; tom sério o tempo todo.",
      "4-6 | Pontual: piadas ocasionais; alívio cômico, não base do tom.",
      "7-8 | Presente: humor aparece com frequência em diálogos ou estilo visual; parte importante do tom.",
      "9-10 | Dominante: comédia frequente, piadas, sátiras ou bom humor marcante; até cenas sérias podem ter humor.",
    ],
  },
  drama: {
    title: "Drama",
    ranges: [
      "0-3 | Leve: pouco conflito emocional; problemas simples, resolução rápida.",
      "4-6 | Moderado: conflitos existem; emoção presente, mas controlada.",
      "7-8 | Intenso: conflitos profundos e recorrentes; impactam decisões e ritmo da história.",
      "9-10 | Dominante: emoção marcante durante toda a obra; alta carga emocional.",
    ],
  },
  tragedy: {
    title: "Tragédia",
    ranges: [
      "0-3 | Ausente: nada muito trágico acontece.",
      "4-6 | Leve: eventos tristes, reversíveis ou pouco impactantes; perdas e traumas aparecem como contexto/background, mas não são o foco.",
      "7-8 | Pesada: mortes ou perdas importantes acontecem no meio da obra e impactam o desenvolvimento dos personagens principais, causando vários capítulos de ruptura/conflito.",
      "9-10 | Brutal: sofrimento constante ou extremo; sensação forte de inevitabilidade ou injustiça.",
    ],
  },
}

export const PUBLICATION_STATUS_LABELS: Record<string, string> = {
  "CMP": "Completed",
  "Completed": "Completed",
  "ONG": "Ongoing",
  "Ongoing": "Ongoing",
  "HIA": "Hiatus",
  "Hiatus": "Hiatus",
  "CXL": "Cancelled",
  "Cancelled": "Cancelled",
  "UNK": "Unknown",
  "Unknown": "Unknown",
}

export const PERSONAL_STATUS_LABELS: Record<string, string> = {
  "Finalizado": "Completed",
  "Completed": "Completed",
  "Lendo": "Reading",
  "Reading": "Reading",
  "Pausado": "Started",
  "Started": "Started",
  "Retomar (tenso)": "Stalled",
  "Stalled": "Stalled",
  "Retomar": "Paused",
  "Paused": "Paused",
  "Esp. Temp": "Hiatus",
  "Hiatus": "Hiatus",
  "Lendo (antigo)": "On-hold",
  "On-hold": "On-hold",
  "Ler": "To read",
  "To read": "To read",
  "Droppado": "Dropped",
  "Dropped": "Dropped",
}

export const SYNOPSIS_QUALITY_LABELS: Record<string, string> = {
  "♥": "Fraca",
  "♥♥": "Regular",
  "♥♥♥": "Boa",
  "♥♥♥♥": "Ótima",
}

export const PLATFORM_LABELS: Record<string, string> = {
  "mangaupdates": "Manga Updates",
  "comick": "ComicK",
  "anilist": "AniList",
  "animeplanet": "Anime Planet",
  "comix": "Comix",
  "mangadex": "MangaDex",
  "kitsu": "Kitsu",
  "myanimelist": "MyAnimeList",
}
