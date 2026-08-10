export const CRITERIA_INFO: Record<
  string,
  { name: string; emoji: string; description: string; iconUrl?: string }
> = {
  romance: { name: "Romance", emoji: "💞", description: "Avalia o quanto o romance está presente e influencia a obra.\nConsidera se o relacionamento é apenas um detalhe, um subplot relevante ou o eixo principal da história.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/romance.png" },
  couple_dynamics: { name: "Dinâmica entre Protagonistas", emoji: "💑", description: "Avalia a qualidade da dinâmica entre os personagens principais — o vínculo MAIS CENTRAL da obra, nesta ordem de prioridade: casal principal; depois família (pais, irmãos, filhos); depois os demais vínculos recorrentes (mestre e discípulo, equipe, rivalidade, amizade). Numa obra de romance é sobre o casal; num drama familiar, entre o protagonista e a família.\nConsidera se a dinâmica é destrutiva, conflituosa, saudável, divertida, comunicativa ou baseada em parceria.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/couple_dynamics.png" },
  fantasy_nobility: { name: "Fantasia/Nobreza", emoji: "👑", description: "Avalia o quanto elementos de fantasia, magia, nobreza, realeza ou política de corte fazem parte da obra.\nConsidera se esses elementos são só estética ou se realmente moldam o mundo, os conflitos e as decisões dos personagens.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/fantasy_nobility.png" },
  action_adventure: { name: "Ação/Aventura", emoji: "⚔️", description: "Avalia o nível de movimento, tensão e eventos marcantes da história.\nConsidera se a obra é mais cotidiana/parada ou se envolve missões, conflitos externos, perigos, batalhas, viagens ou eventos de grande escala.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/action_adventure.png" },
  adult_content: { name: "Conteúdo Adulto", emoji: "🔥", description: "Avalia o nível de sexualização ou conteúdo sexual presente na obra.\nConsidera desde ausência quase total até cenas explícitas recorrentes, levando em conta frequência, intensidade e relevância para a narrativa.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/adult_content.png" },
  protagonist: { name: "Protagonista Marcante", emoji: "🦸", description: "Avalia o quanto o protagonista se destaca e impacta a história — presença em cena e AGÊNCIA (decisões que movem a trama). NÃO avalia qualidade: se é simpático, bem escrito ou agradável. Mary Sues, OPs, FLs frias/insensíveis/inconsistentes, vilões marcantes têm presença FORTE, não fraca.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/protagonist.png" },
  humor: { name: "Humor", emoji: "😂", description: "Avalia o quanto o humor está presente no tom da obra.\nConsidera se há apenas alívio cômico pontual ou se a comédia é parte frequente e importante da experiência.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/humor.png" },
  drama: { name: "Drama", emoji: "🎭", description: "Avalia a intensidade dos conflitos emocionais da obra.\nConsidera sofrimento, tensão emocional, dilemas, conflitos de relacionamento e o quanto isso afeta o ritmo e as decisões dos personagens.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/drama.png" },
  tragedy: { name: "Tragédia", emoji: "💔", description: "Avalia o peso de acontecimentos trágicos durante o desenvolvimento principal da história (não considera background nem acontecimentos no começo imediato da história).\nConsidera perdas, separações, mortes, injustiças e sofrimento que acontecem no meio da obra e impactam diretamente os personagens principais.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/tragedy.png" },
}

export const CRITERIA_RUBRICS: Record<
  string,
  { title: string; ranges: string[]; note?: string }
> = {
  romance: {
    title: "Romance",
    ranges: [
      "0-3 | Ausente: nenhum conteúdo romântico se desenvolvendo — sem casal, sem interação/tensão romântica. \"Amor\" como TEMA, sem romance retratado (um obcecado por algo inalcançável, sem interação), é esta faixa.",
      "4-6 | Presente mas secundário: existe um fio romântico, mas pouco desenvolvido — poucas cenas/beats; acessório para quem procura romance.",
      "7-8 | Substancial: a relação se desenvolve com cenas e beats claros (atração, tensão, aproximação, declaração). Slow burn com foco romântico é esta faixa (desenvolve, só gradual).",
      "9-10 | Onipresente: desenvolvimento e cenas românticas permeiam a obra; a experiência é dominada pelo romance do casal.",
    ],
  },
  couple_dynamics: {
    title: "Dinâmica entre Protagonistas",
    ranges: [
      "0-3 | Destrutiva: dano ativo/não-consensual DENTRO dos vínculos centrais — abuso, manipulação, sofrimento contínuo de quem é próximo. Devoção a um abusador não-arrependido também é 0-3 (autodestrutiva). Dinâmica não-tradicional CONSENSUAL (BDSM, posse, ciúme) com tom romântico/cômico NÃO entra aqui. Crueldade com antagonistas que a merecem NÃO rebaixa.",
      "4-6 | Conflituosa ou ambivalente: conflitos recorrentes, mal-entendidos prolongados, comunicação falha; ou conduta mista nos vínculos centrais (ajuda uns, prejudica outros).",
      "7-8 | Saudável: relação/conduta majoritariamente construtiva, respeito mútuo, conflitos pontuais resolvidos.",
      "9-10 | Construtiva: parceria, apoio mútuo, comunicação e crescimento conjunto. Dois personagens danificados que se curam e se entendem (cura ENCENADA, cedo na obra) são esta faixa.",
    ],
  },
  fantasy_nobility: {
    title: "Fantasia/Nobreza",
    ranges: [
      "0-3 | Ausente ou estético: mundo comum, ou fantasia/nobreza só de fachada (é \"príncipe\", mas isso não importa).",
      "4-6 | Presente mas secundário: elementos de fantasia/nobreza influenciam partes da obra, mas não a organizam.",
      "7-8 | Estrutural: magia, política nobre, aristocracia, reencarnação ou regras do mundo moldam os conflitos principais.",
      "9-10 | Onipresente: magia/nobreza/regras do mundo aparecem constantemente e sustentam quase tudo que acontece.",
    ],
  },
  action_adventure: {
    title: "Ação/Aventura",
    ranges: [
      "0-3 | Ausente: cotidiano, sem conflito externo relevante (slice of life).",
      "4-6 | Presente mas secundário: alguns eventos de tensão/ação (inclui perseguição, fuga, competição, intriga política com risco real), mas o foco é outro.",
      "7-8 | Significativa: situações de ação/risco marcantes e frequentes, ou raras mas de alto risco; ritmo acelerado.",
      "9-10 | Onipresente: ação, perigo e eventos de grande escala são constantes e intensos, quase sem respiro cotidiano.",
    ],
  },
  adult_content: {
    title: "Conteúdo Adulto",
    ranges: [
      "0-3 | Clean: sem sexualização relevante; no máximo beijo leve ou sugestão implícita. Marcador de EDIÇÃO (\"R19 disponível\", \"Original Webtoon: R19\") NÃO impede esta faixa: ele diz que existe uma edição R19 da história, não que a obra avaliada mostre algo.",
      "4-6 | Suggestive: insinuação clara, roupas/situações/tensão sexual; nada de sexo é mostrado — pode ter cena cortada/fade to black.",
      "7-8 | Mature: sexo mostrado PARCIALMENTE, sem cena explícita; nudez e contexto sexual relevante para a trama. Se existe cena explícita, mesmo uma só, a faixa é 9-10.",
      "9-10 | Smut: há cena de sexo explícito, em QUALQUER quantidade. Uma única cena basta. NÃO rebaixe porque é pouco frequente, escasso ou porque o foco da obra é outro — frequência muda o FOCO, não a natureza do conteúdo.",
    ],
  },
  protagonist: {
    title: "Protagonista Marcante",
    ranges: [
      "0-3 | Presença mínima: sem agência, decisões irrelevantes, substituível por outro personagem sem mudar a história.",
      "4-6 | Presença moderada: conduz a história e tem personalidade reconhecível, mas não domina as cenas.",
      "7-8 | Presença forte: agência clara, decisões movem a trama, personalidade marcante — mesmo se polêmica (Mary Sue, OP, insensível, inconsistente CONFIRMAM presença forte, não fraca).",
      "9-10 | Presença dominante: no centro de quase todas as cenas e decisões; sustentaria o interesse mesmo sem plot.",
    ],
  },
  humor: {
    title: "Humor",
    ranges: [
      "0-3 | Ausente: tom sério; a obra quase não emprega comédia.",
      "4-6 | Presente mas secundário: humor ocasional, alívio cômico pontual.",
      "7-8 | Significativo: a obra emprega humor com frequência; a comédia é parte importante do registro.",
      "9-10 | Onipresente: o registro cômico domina; a obra é construída para fazer rir o tempo todo. (Humor sombrio/sátira conta, mas o clima pesado o muta: mesmas piadas em clima leve pontuam mais alto.)",
    ],
  },
  drama: {
    title: "Drama",
    ranges: [
      "0-3 | Ausente: pouco conflito emocional; problemas simples e de resolução rápida.",
      "4-6 | Presente mas secundário: conflitos emocionais existem, mas controlados. (Fricção romântica leve — ciúme, mal-entendido do casal — não é drama por si só.)",
      "7-8 | Significativo: conflitos emocionais profundos e recorrentes movem a obra.",
      "9-10 | Onipresente: carga emocional intensa e constante do início ao fim. Drama = intensidade E DURAÇÃO do conflito emocional (que PODE se resolver) — distinto de tragédia (gravidade e irreversibilidade das perdas).",
    ],
  },
  tragedy: {
    title: "Tragédia",
    ranges: [
      "0-3 | Ausente: nenhuma perda irreversível nem luto relevante no desenvolvimento.",
      "4-6 | Presente mas secundária: sofrimento ou perdas sérias, porém isoladas ou reversíveis. Perda no CONTEXTO ESTABELECIDO (background/situação inicial — ex.: família morta antes do início) NÃO conta; só a DIREÇÃO da trama. Sofrimento psicológico prolongado SEM perda irreversível é drama, não tragédia.",
      "7-8 | Significativa: perdas irreversíveis (mortes, separações definitivas) na direção da trama que reconfiguram a história e marcam os protagonistas.",
      "9-10 | Onipresente: luto e perda irreversível permeiam a obra inteira; tom trágico constante, sensação de inevitabilidade.",
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
  "started": "Started",
  "Started": "Started",
  "reading": "Reading",
  "Reading": "Reading",
  "stalled": "Stalled",
  "Stalled": "Stalled",
  "on-hold": "On-hold",
  "On-hold": "On-hold",
  "hiatus": "Hiatus",
  "Hiatus": "Hiatus",
  "finished": "Finished",
  "Finished": "Finished",
  "read_again": "Read Again",
  "Read Again": "Read Again",
  "dropped": "Dropped",
  "Dropped": "Dropped",
  "not_now": "Not Now",
  "Not Now": "Not Now",
  "untracked": "Untracked",
  "Untracked": "Untracked",
  "not_interested": "Not Interested",
  "Not Interested": "Not Interested",
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
  /** Classe Tailwind de fundo (gráfico de distribuição do dashboard). */
  bgClass: string
  /** Descrição em PT exibida no seletor de status. */
  descriptionPt: string
  /** A leitura encerrou (concluiu ou desistiu). */
  isTerminal: boolean
  /** Leu até o fim. */
  isFullyRead: boolean
  /** Faz sentido ter capítulo lido neste status. */
  tracksProgress: boolean
  /** Não precisa de estimativa de Interesse — sai da fila do Avaliar. */
  hideFromInterest: boolean
  /** É o status que a obra APARENTA quando não há linha no espelho. Exatamente um. */
  isDefaultUnset: boolean
  /** "Estou acompanhando" — KPI da home, widget de progresso. */
  isFollowing: boolean
  /** "Ainda não comecei" — filtro padrão do ranking, seed da auditoria. */
  isUnread: boolean
}

export const PERSONAL_STATUSES_BY_ID: Record<number, PersonalStatusInfo> = {
  8: { id: 8, status: "Want to Read", slug: "want-to-read", color: "#A3E635", symbol: "⭐️", comment: "Not started yet, but intended for future reading", bgClass: "bg-slate-400", descriptionPt: "Não comecei — está na lista de leitura", isTerminal: false, isFullyRead: false, tracksProgress: false, hideFromInterest: false, isDefaultUnset: true, isFollowing: false, isUnread: true },
  3: { id: 3, status: "Started", slug: "started", color: "#22D3EE", symbol: "▶️", comment: "Started recently; still deciding whether to continue", bgClass: "bg-violet-500", descriptionPt: "Comecei a leitura recentemente, ainda não terminei", isTerminal: false, isFullyRead: false, tracksProgress: true, hideFromInterest: false, isDefaultUnset: false, isFollowing: true, isUnread: false },
  2: { id: 2, status: "Reading", slug: "reading", color: "#60A5FA", symbol: "📖", comment: "Currently reading or actively following new chapters/releases", bgClass: "bg-emerald-500", descriptionPt: "Estou lendo e acompanhando os capítulos novos", isTerminal: false, isFullyRead: false, tracksProgress: true, hideFromInterest: false, isDefaultUnset: false, isFollowing: true, isUnread: false },
  4: { id: 4, status: "Stalled", slug: "stalled", color: "#FACC15", symbol: "⏸️", comment: "Lost momentum or interest. Not sure I liked it; likely needs rereading before continuing", bgClass: "bg-orange-500", descriptionPt: "Comecei e pausei por tensão na história — pretendo terminar", isTerminal: false, isFullyRead: false, tracksProgress: true, hideFromInterest: true, isDefaultUnset: false, isFollowing: false, isUnread: false },
  7: { id: 7, status: "On-hold", slug: "on-hold", color: "#FB923C", symbol: "📁", comment: "Paused for now, but I still want to continue; likely needs rereading before continuing", bgClass: "bg-slate-500", descriptionPt: "Comecei, planejo retomar, mas preciso reler antes", isTerminal: false, isFullyRead: false, tracksProgress: true, hideFromInterest: false, isDefaultUnset: false, isFollowing: false, isUnread: false },
  6: { id: 6, status: "Hiatus", slug: "hiatus", color: "#A78BFA", symbol: "⏳", comment: "Waiting for new chapters, season, translation, or official return", bgClass: "bg-cyan-500", descriptionPt: "Aguardando nova temporada / retorno do título", isTerminal: false, isFullyRead: false, tracksProgress: true, hideFromInterest: false, isDefaultUnset: false, isFollowing: false, isUnread: false },
  1: { id: 1, status: "Finished", slug: "finished", color: "#4ADE80", symbol: "✔", comment: "Finished reading", bgClass: "bg-blue-500", descriptionPt: "Terminei de ler", isTerminal: true, isFullyRead: true, tracksProgress: true, hideFromInterest: true, isDefaultUnset: false, isFollowing: false, isUnread: false },
  12: { id: 12, status: "Read Again", slug: "read_again", color: "#F472B6", symbol: "🔁", comment: "Already read, but want to read again", bgClass: "bg-teal-500", descriptionPt: "Já li mas quero ler novamente", isTerminal: false, isFullyRead: false, tracksProgress: true, hideFromInterest: true, isDefaultUnset: false, isFollowing: false, isUnread: false },
  9: { id: 9, status: "Dropped", slug: "dropped", color: "#F87171", symbol: "🗑️", comment: "Dropped before finishing", bgClass: "bg-red-500", descriptionPt: "Abandonado, não pretendo continuar", isTerminal: true, isFullyRead: false, tracksProgress: true, hideFromInterest: true, isDefaultUnset: false, isFollowing: false, isUnread: false },
  11: { id: 11, status: "Not Now", slug: "not_now", color: "#D6A77A", symbol: "💤", comment: "Not interested in reading for now, but not permanently dismissed", bgClass: "bg-stone-400", descriptionPt: "Não me interessa agora, mas não descartei de vez", isTerminal: false, isFullyRead: false, tracksProgress: false, hideFromInterest: false, isDefaultUnset: false, isFollowing: false, isUnread: false },
  10: { id: 10, status: "Untracked", slug: "untracked", color: "#9CA3AF", symbol: "⎯", comment: "Stored in the database without an active reading status", bgClass: "bg-zinc-400", descriptionPt: "Está no catálogo, sem status de leitura ativo", isTerminal: false, isFullyRead: false, tracksProgress: false, hideFromInterest: false, isDefaultUnset: false, isFollowing: false, isUnread: true },
  13: { id: 13, status: "Not Interested", slug: "not_interested", color: "#C06C84", symbol: "🚫", comment: "Works the user reviewed based on their synopsis, tags, and images and decided not to read.", bgClass: "bg-pink-600", descriptionPt: "Obras que o usuário avaliou pela sinopse, tags e imagens e decidiu não ler.", isTerminal: false, isFullyRead: false, tracksProgress: false, hideFromInterest: false, isDefaultUnset: false, isFollowing: false, isUnread: false },
}

/**
 * Conjuntos SEMÂNTICOS de status pessoal — gerados da tabela `personal_status` (migration 155).
 *
 * 🔴 NÃO escreva o nome de um status à mão no código. Renomear "Completed" → "Finished" no
 * Supabase quebrou 10 lugares, e o TypeScript só pegou 6: os outros eram strings soltas dentro de
 * `new Set([...])` / arrays, que param de casar EM SILÊNCIO. As 74 obras terminadas deixariam de
 * pedir as 8 notas pós-leitura e de sumir do ranking, sem um único erro.
 *
 * Use estes conjuntos (ou os helpers de `lib/constants/status-lookups.ts`). Assim um rename vira
 * operação de banco: roda `sync-constants` e o código nem fica sabendo.
 */
export const TERMINAL_PERSONAL_STATUSES = ["Finished", "Dropped"] as const
export const FULLY_READ_PERSONAL_STATUSES = ["Finished"] as const
export const PROGRESS_PERSONAL_STATUSES = ["Started", "Reading", "Stalled", "On-hold", "Hiatus", "Finished", "Read Again", "Dropped"] as const
export const INTEREST_HIDDEN_PERSONAL_STATUSES = ["Stalled", "Finished", "Read Again", "Dropped"] as const
export const FOLLOWING_PERSONAL_STATUSES = ["Started", "Reading"] as const
export const UNREAD_PERSONAL_STATUSES = ["Want to Read", "Untracked"] as const

/**
 * O status que a obra APARENTA quando o usuário não tem linha no espelho.
 *
 * Não confundir com "Untracked", que é escolha EXPLÍCITA do usuário. Os dois coexistiam sem nome
 * no código — e por isso pareciam contradição: o Zod tinha default "Untracked" enquanto a exibição
 * caía em `?? "Want to Read"` em 8 lugares.
 */
export const DEFAULT_PERSONAL_STATUS = "Want to Read"

export const SYNOPSIS_QUALITY_LABELS: Record<string, string> = {
  "♥": "Fraca",
  "♥♥": "Regular",
  "♥♥♥": "Boa",
  "♥♥♥♥": "Ótima",
}

export const PLATFORM_LABELS: Record<string, string> = {
  "mangaupdates": "Manga Updates",
  "myanimelist": "MyAnimeList",
  "anilist": "AniList",
  "animeplanet": "Anime Planet",
  "comick": "ComicK",
  "mangadex": "MangaDex",
  "kitsu": "Kitsu",
  "comix": "Comix",
  "mangago": "Mangago",
  "outros": "Outros",
}
