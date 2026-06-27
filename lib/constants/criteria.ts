export const CRITERIA_INFO: Record<
  string,
  { name: string; emoji: string; description: string }
> = {
  romance: { name: "Romance", emoji: "💞", description: "Avalia o quanto o romance está presente e influencia a obra.\nConsidera se o relacionamento é apenas um detalhe, um subplot relevante ou o eixo principal da história." },
  couple_dynamics: { name: "Dinâmica do Casal", emoji: "💑", description: "Avalia a qualidade da relação entre o casal principal.\nConsidera se a dinâmica é tóxica, conflituosa, saudável, divertida, comunicativa ou baseada em parceria." },
  fantasy_nobility: { name: "Fantasia/Nobreza", emoji: "👑", description: "Avalia o quanto elementos de fantasia, magia, nobreza, realeza ou política de corte fazem parte da obra.\nConsidera se esses elementos são só estética ou se realmente moldam o mundo, os conflitos e as decisões dos personagens." },
  action_adventure: { name: "Ação/Aventura", emoji: "⚔️", description: "Avalia o nível de movimento, tensão e eventos marcantes da história.\nConsidera se a obra é mais cotidiana/parada ou se envolve missões, conflitos externos, perigos, batalhas, viagens ou eventos de grande escala." },
  adult_content: { name: "Conteúdo Adulto", emoji: "🔥", description: "Avalia o nível de sexualização ou conteúdo sexual presente na obra.\nConsidera desde ausência quase total até cenas explícitas recorrentes, levando em conta frequência, intensidade e relevância para a narrativa." },
  protagonist: { name: "Protagonista Marcante", emoji: "🦸", description: "Avalia o quanto o protagonista se destaca e impacta a história — presença, agência, decisões marcantes, personalidade reconhecível.\nNÃO avalia se o protagonista é simpático, bem escrito, equilibrado ou agradável de acompanhar. Mary Sues, OPs, vilões marcantes, FLs frias/insensíveis/inconsistentes podem todos ser muito marcantes." },
  humor: { name: "Humor", emoji: "😂", description: "Avalia o quanto o humor está presente no tom da obra.\nConsidera se há apenas alívio cômico pontual ou se a comédia é parte frequente e importante da experiência." },
  drama: { name: "Drama", emoji: "🎭", description: "Avalia a intensidade dos conflitos emocionais da obra.\nConsidera sofrimento, tensão emocional, dilemas, conflitos de relacionamento e o quanto isso afeta o ritmo e as decisões dos personagens." },
  tragedy: { name: "Tragédia", emoji: "💔", description: "Avalia o peso de acontecimentos trágicos durante o desenvolvimento principal da história (não considera background nem acontecimentos no começo imediato da história).\nConsidera perdas, separações, mortes, injustiças e sofrimento que acontecem no meio da obra e impactam diretamente os personagens principais." },
}

export const CRITERIA_RUBRICS: Record<
  string,
  { title: string; ranges: string[]; note?: string }
> = {
  romance: {
    title: "Romance",
    ranges: [
      "0-3 | Ausente / irrelevante: não tem romance ou é totalmente secundário; pode ter crush leve que não impacta nada.",
      "4-6 | Subplot: romance existe, mas não guia a história; pouco foco ou em background. NOTA: slow burn com foco romântico claro NÃO é subplot — é core romance (7-8).",
      "7-8 | Core romance: romance é um dos pilares da história e impacta decisões, conflitos e evolução.",
      "9-10 | Romance-driven: a história é sobre o romance; o plot gira em torno do relacionamento.",
    ],
  },
  couple_dynamics: {
    title: "Dinâmica do Casal",
    ranges: [
      "0-3 | Dinâmica prejudicial ao parceiro contra sua vontade: abuso emocional ativo, manipulação não-consensual, sofrimento contínuo do parceiro abusado dentro do desenvolvimento. Dinâmicas não-tradicionais (BDSM, Dom/Sub, posse, ciúme intenso) com consenso mútuo e tom romântico/cômico NÃO se enquadram aqui — vão para 7-8 ou 9-10.",
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
      "0-3 | Clean: sem sexualização relevante; no máximo beijo leve ou sugestão implícita. NÃO use esta faixa se há marcador R19 disponível na obra, mesmo sem corroboração de tag/review (piso 6.0).",
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
  "completed": "Completed",
  "Completed": "Completed",
  "ONG": "Ongoing",
  "ongoing": "Ongoing",
  "Ongoing": "Ongoing",
  "HIA": "Hiatus",
  "hiatus": "Hiatus",
  "Hiatus": "Hiatus",
  "CXL": "Cancelled",
  "cancelled": "Cancelled",
  "Cancelled": "Cancelled",
  "UNK": "Unknown",
  "unknown": "Unknown",
  "Unknown": "Unknown",
}

export const PERSONAL_STATUS_LABELS: Record<string, string> = {
  "want-to-read": "Want to Read",
  "Want to Read": "Want to Read",
  "untracked": "Untracked",
  "Untracked": "Untracked",
  "reading": "Reading",
  "Reading": "Reading",
  "started": "Started",
  "Started": "Started",
  "stalled": "Stalled",
  "Stalled": "Stalled",
  "on-hold": "On-hold",
  "On-hold": "On-hold",
  "completed": "Completed",
  "Completed": "Completed",
  "hiatus": "Hiatus",
  "Hiatus": "Hiatus",
  "dropped": "Dropped",
  "Dropped": "Dropped",
}

export interface PublicationStatusInfo {
  id: number
  status: string
  slug: string
  short: string
  color: string
  symbol: string
}

export const PUBLICATION_STATUSES_BY_ID: Record<number, PublicationStatusInfo> = {
  1: { id: 1, status: "Completed", slug: "completed", short: "CMP", color: "#22C55E", symbol: "✅" },
  2: { id: 2, status: "Ongoing", slug: "ongoing", short: "ONG", color: "#3B82F6", symbol: "🔄" },
  3: { id: 3, status: "Hiatus", slug: "hiatus", short: "HIA", color: "#F59E0B", symbol: "⏸️" },
  4: { id: 4, status: "Cancelled", slug: "cancelled", short: "CXL", color: "#EF4444", symbol: "⛔" },
  5: { id: 5, status: "Unknown", slug: "unknown", short: "UNK", color: "", symbol: "？" },
}

export interface PersonalStatusInfo {
  id: number
  status: string
  slug: string
  color: string
  symbol: string
  comment: string
}

export const PERSONAL_STATUSES_BY_ID: Record<number, PersonalStatusInfo> = {
  8: { id: 8, status: "Want to Read", slug: "want-to-read", color: "#8B5CF6", symbol: "⭐️", comment: "Not started yet, but intended for future reading" },
  10: { id: 10, status: "Untracked", slug: "untracked", color: "#6B7280", symbol: "○", comment: "Stored in the database without an active reading status" },
  2: { id: 2, status: "Reading", slug: "reading", color: "#2563EB", symbol: "📖", comment: "Currently reading or actively following new chapters/releases" },
  3: { id: 3, status: "Started", slug: "started", color: "#06B6D4", symbol: "▶️", comment: "Started recently; still deciding whether to continue" },
  4: { id: 4, status: "Stalled", slug: "stalled", color: "#64748B", symbol: "⏸️", comment: "Lost momentum or interest. Not sure I liked it; likely needs rereading before continuing" },
  7: { id: 7, status: "On-hold", slug: "on-hold", color: "#F97316", symbol: "📁", comment: "Paused for now, but I still want to continue; likely needs rereading before continuing" },
  1: { id: 1, status: "Completed", slug: "completed", color: "#16A34A", symbol: "✔", comment: "Finished reading" },
  6: { id: 6, status: "Hiatus", slug: "hiatus", color: "#D97706", symbol: "⏳", comment: "Waiting for new chapters, season, translation, or official return" },
  9: { id: 9, status: "Dropped", slug: "dropped", color: "#DC2626", symbol: "🗑️", comment: "Dropped before finishing" },
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
  "comix": "Comix",
  "animeplanet": "Anime Planet",
  "myanimelist": "MyAnimeList",
  "mangadex": "MangaDex",
  "kitsu": "Kitsu",
  "anilist": "AniList",
  "outros": "Outros",
}
