export const CRITERIA_INFO: Record<
  string,
  { name: string; emoji: string; description: string; iconUrl?: string }
> = {
  romance: { name: "Romance", emoji: "💞", description: "Unipolar de intensidade. Participação e peso narrativo de uma relação romântica que SE DESENVOLVE ao longo da experiência.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/romance.png" },
  couple_dynamics: { name: "Dinâmica entre Protagonistas", emoji: "💑", description: "Avalia a qualidade da dinâmica entre os personagens principais — o vínculo MAIS CENTRAL da obra, nesta ordem de prioridade: casal principal; depois família (pais, irmãos, filhos); depois os demais vínculos recorrentes (mestre e discípulo, equipe, rivalidade, amizade). Numa obra de romance é sobre o casal; num drama familiar, entre o protagonista e a família.\nConsidera se a dinâmica é destrutiva, conflituosa, saudável, divertida, comunicativa ou baseada em parceria.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/couple_dynamics.png" },
  fantasy: { name: "Fantasia", emoji: "✨", description: "Unipolar de intensidade. Presença e participação de magia, poderes, criaturas ou fenômenos NÃO explicados como ciência." },
  setting_era: { name: "Ambientação Temporal", emoji: "🏛️", description: "Bipolar. Posição entre mundos inspirados em períodos pré-modernos e ambientes contemporâneos. Pergunta canônica: \"em que DIREÇÃO temporal e social está a ambientação?\"" },
  action_adventure: { name: "Dinamismo Narrativo", emoji: "⚔️", description: "Bipolar. Posição entre uma história de rotina e pequenas mudanças e uma movida por eventos externos, objetivos, perigo e deslocamento. DESCRITIVO — não é avaliação de qualidade do pacing.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/action_adventure.png" },
  adult_content: { name: "Conteúdo Adulto", emoji: "🔥", description: "Avalia o nível de sexualização ou conteúdo sexual presente na obra.\nConsidera desde ausência quase total até cenas explícitas recorrentes, levando em conta frequência, intensidade e relevância para a narrativa.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/adult_content.png" },
  protagonist: { name: "Protagonista Marcante", emoji: "🦸", description: "Unipolar de intensidade. Centralidade em cena E agência sobre a trama, de qualquer valência. Toda faixa descreve o nível REPRESENTATIVO do par (centralidade, agência) na experiência como um todo: quando uma das duas varia materialmente, as fases relevantes entram EM CONJUNTO — é PROIBIDO pontuar pelo pico, pela fase inicial, pela fase final, por média dos checkpoints ou por peso temporal. As fases são evidência, não parcelas.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/protagonist.png" },
  humor: { name: "Humor", emoji: "😂", description: "Avalia o quanto o humor está presente no tom da obra.\nConsidera se há apenas alívio cômico pontual ou se a comédia é parte frequente e importante da experiência.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/humor.png" },
  drama: { name: "Drama", emoji: "🎭", description: "Unipolar de intensidade. Quantidade, frequência, duração e importância do conflito emocional — AGNÓSTICO quanto à resolução.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/drama.png" },
  tragedy: { name: "Tragédia", emoji: "💔", description: "Avalia o peso de acontecimentos trágicos durante o desenvolvimento principal da história (não considera background nem acontecimentos no começo imediato da história).\nConsidera perdas, separações, mortes, injustiças e sofrimento que acontecem no meio da obra e impactam diretamente os personagens principais.", iconUrl: "https://obwlwukwovetgjqdpizd.supabase.co/storage/v1/object/public/criteria-icons/tragedy.png" },
  angst: { name: "Angústia", emoji: "🥀", description: "Unipolar de intensidade. Saldo entre ACÚMULO de sofrimento e ALÍVIO EFICAZ ao longo da leitura. Redutores contam pelo EFEITO, nunca pela presença." },
}

export const CRITERIA_RUBRICS: Record<
  string,
  { title: string; ranges: string[]; note?: string; guidance?: string[] }
> = {
  romance: {
    title: "Romance",
    ranges: [
      "0-3 | Romance ausente ou marginal. Vínculo intenso não-romântico NÃO conta.",
      "4-6 | Romance presente com densidade baixa — formalizado, prometido ou motivador, sem desenvolvimento recorrente.",
      "7-8 | Romance recorrente e desenvolvido, ocupando parte relevante da experiência — inclusive quando o casal se estabelece cedo e o desenvolvimento continua.",
      "9-10 | Romance recorrente, desenvolvido e estruturante da experiência.",
    ],
    guidance: [
      "FRONTEIRA PRINCIPAL — DENSIDADE de desenvolvimento. Não é presença, não é centralidade motivacional, não é intensidade da tensão. Para SUBIR: o romance precisa ocupar mais da experiência com desenvolvimento, não gerar mais tensão. Para DESCER: a relação existe mas não se desenvolve em cena.",
      "ÂNCORAS: 9-10 A Business Proposal, Semantic Error (recorrência longitudinal; slow burn de alta densidade) — 7-8 Another Typical Fantasy Romance (casal estabelecido cedo, desenvolvimento segue) — 0-3 Omniscient Reader (vínculo intenso que NÃO é romance) — fronteira 4-6/7-8 Kaguya-sama, Maybe Meant to Be.",
      "NÃO FAÇA: promover por tensão altíssima (Kaguya-sama: centralidade e tensão altíssimas com entrega concreta menor ⇒ não sobe) · tratar formalização como desenvolvimento (Maybe Meant to Be: a formalização precede a experiência romântica) · somar milestones tardios como densidade (Solo Leveling: milestones ≠ densidade proporcional) · ler vínculo intenso como romance · confundir com Conteúdo Adulto (ressalva de Semantic Error).",
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
  fantasy: {
    title: "Fantasia",
    ranges: [
      "0-3 | Nenhum elemento mágico/sobrenatural ATUANTE.",
      "4-6 | Mecanismo sobrenatural presente e NÃO recorrente — dispara a premissa e sai de cena.",
      "7-8 | Fenômeno sobrenatural ESTRUTURAL, ainda que de escopo ontológico estreito.",
      "9-10 | Magia/poderes/criaturas participam CONTINUAMENTE do mundo e da experiência.",
    ],
    guidance: [
      "FRONTEIRA PRINCIPAL — dois testes, NESTA ORDEM. (1) Teste ontológico: como a obra explica o fenômeno? Explicado como ciência/tecnologia ⇒ NÃO é Fantasia, por mais extraordinário que seja. (2) Recorrência/participação: aparece uma vez e sai, ou opera no mundo continuamente? Para SUBIR: mais participação estrutural. Para DESCER: o fenômeno deixa de operar.",
      "ÂNCORAS: 9-10 Villains Are Destined to Die (interface de jogo NÃO é tecnologia explicada pela obra) — 7-8 Unholy Blood, See You in My 19th Life (escopo estreito, porém estrutural) — 4-6 Marry My Husband (mecanismo inicial ≠ recorrência) — 0-3 A Business Proposal, Whale Star, Semantic Error — stress: Cyberpunk Edgerunners (tecnologia extraordinária NÃO é Fantasia).",
      "NÃO FAÇA: tratar estética fantástica como Fantasia atuante (o teste é ontológico, não visual) · tecnologia extraordinária = Fantasia (Cyberpunk) · retelling de mito = Fantasia (Whale Star: o retelling de sereia não dá Fantasia) · pouca variedade = pouca participação (See You in My 19th Life) · premissa sobrenatural = faixa alta (Marry My Husband: dispara e sai).",
    ],
  },
  setting_era: {
    title: "Ambientação Temporal",
    ranges: [
      "0-3 | Ambientação histórica / de época / pré-moderna — inclusive mundos INSPIRADOS em períodos pré-modernos, sem historicidade real.",
      "4-6 | A obra ocupa os DOIS lados de forma material — o presente é atravessado por outra época de modo estrutural.",
      "7-8 | Contemporânea COM deslocamento temporal que não muda a direção.",
      "9-10 | Contemporânea sem truque · futurista entra aqui como extensão declarada do polo.",
    ],
    guidance: [
      "FRONTEIRA PRINCIPAL — DIREÇÃO, não historicidade. A escala responde para que lado a ambientação aponta. Um mundo pré-moderno FICCIONAL está no polo histórico porque a direção é clara; que ele não seja um período real é ressalva que viaja, não deslocamento de faixa.",
      "ÂNCORAS: 0-3 Whale Star (histórico sem nobreza e sem magia), A Bride's Story (histórico cotidiano), Villains Are Destined to Die (de época/pré-moderno inspirado) — 4-6 See You in My 19th Life (memória de épocas ≠ obra histórica) — 7-8 Marry My Husband (regrediu ≠ virou histórico) — 9-10 A Business Proposal, Semantic Error; Cyberpunk Edgerunners como extensão futurista.",
      "NÃO FAÇA: medir grau de historicidade (o eixo é direção; Villains prova a diferença) · regressão/reencarnação = histórico (Marry My Husband) · memória de outras épocas = obra histórica (See You in My 19th Life) · chamar mundo pré-moderno ficcional de \"histórico realista\".",
    ],
  },
  action_adventure: {
    title: "Dinamismo Narrativo",
    ranges: [
      "0-3 | Rotina, convivência e conversa; acontecimentos reorganizam a convivência, não viram aventura.",
      "4-6 | Intermediário real — diálogo, investigação ou estratégia predominam COM progressão externa efetiva.",
      "7-8 | Eventos externos, objetivos e deslocamento movem a história de forma RECORRENTE.",
      "9-10 | Progressão material, deslocamento e perigo ESTRUTURAM a experiência.",
    ],
    guidance: [
      "FRONTEIRA PRINCIPAL — O QUE MOVE A HISTÓRIA. Não é velocidade, não é presença de ação, não é volume de diálogo. Para SUBIR: mais da experiência é movida por evento externo e objetivo. Para DESCER: o que move volta a ser convivência e rotina.",
      "REGRA LONGITUDINAL: a banda representa o dinamismo CARACTERÍSTICO da experiência como um todo. Fases entram conforme sua RELEVÂNCIA. PROIBIDO: pico automático · fase final automática · média dos checkpoints · pesos por arco. Mudar de dinamismo não é premiado nem penalizado. Obra cotidiana com UM arco explosivo NÃO sobe pelo pico; obra que começa parada e passa a MAIOR PARTE com progressão constante PODE sustentar banda alta; fases substanciais em níveis diferentes ⇒ a banda reflete a experiência MISTA.",
      "ÂNCORAS: 0-3 Seasons of Blossom (cotidiano com Drama alto), Maybe Meant to Be — 4-6 The Ember Knight (diálogo/estratégia COM progressão externa) — 7-8 The Perks of Being an S-Class Heroine (aventureiro dentro de rofan) — 9-10 The Greatest Estate Developer (progressão material, crises, deslocamento), Blue Lock (alto SEM combate).",
      "NÃO FAÇA: pacing lento = Dinamismo baixo (Frieren: a leitura correta é intermediário) · ação presente = Dinamismo alto (Spy × Family) · exigir combate para faixa alta (Blue Lock) · Drama alto = Dinamismo alto (Seasons of Blossom) · muito diálogo = faixa baixa (The Ember Knight) · pontuar pelo arco mais movimentado.",
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
      "0-3 | Centralidade E agência representativas baixas — a personagem é conduzida pelos acontecimentos, e as decisões dela não têm efeito estrutural. Presença NÃO equivale a condução narrativa. É CONJUNÇÃO: agência baixa com centralidade alta é 4-6, não aqui.",
      "4-6 | Protagonismo moderado — centralidade OU agência é relevante, mas não as duas de forma forte E sustentada. As decisões importam sem que a personagem reorganize a narrativa de forma dominante. A agência pode ser parcial, localizada, diluída por coralidade ou não sustentada ao longo da obra.",
      "7-8 | Protagonismo forte — centralidade alta E agência real e consequente, representativas ao longo da experiência: as decisões alteram significativamente o curso da narrativa DENTRO de um enquadramento que a personagem não controla.",
      "9-10 | Protagonismo estruturante — a narrativa é fortemente organizada em torno dela E as escolhas dela reorganizam repetidamente o próprio ENQUADRAMENTO da história. Centralidade e agência ambas muito altas e representativas.",
    ],
    guidance: [
      "NENHUMA TRAJETÓRIA É REQUISITO DE FAIXA: agência constrangida por sistema, agência sem poder institucional, agência que varia ao longo da obra e agência exercida em consequências relacionais e não políticas são FORMAS de produzir protagonismo — a faixa mede o NÍVEL, não a forma. Nenhuma pode ser exigida, e nenhuma por si só qualifica.",
      "FRONTEIRA PRINCIPAL — AGÊNCIA, cruzada com centralidade. Para SUBIR: as decisões precisam ALTERAR O RUMO, não só ocorrer. Para DESCER: a personagem está em cena mas o rumo é decidido por outros.",
      "SEPARADOR 7-8 × 9-10 — dentro do enquadramento × SOBRE o enquadramento. Não é fórmula e não é trajetória: é a MAGNITUDE do que as decisões alcançam. 7-8 = as decisões mudam a trajetória dela dentro de um enquadramento que ela não controla (Villains Are Destined to Die: o sistema do jogo; The Apothecary Diaries: a corte, sem poder institucional). 9-10 = as decisões mudam o ENQUADRAMENTO em si (The Villainess Lives Again; The Ember Knight: o gatilho não é dele, as respostas é que reorganizam).",
      "NÃO FAÇA: poder/força/competência = protagonismo (One-Punch Man) · presença em cena = agência (Under the Oak Tree) · exigir controle total para faixa alta (Villains: agência alta sob constrangimento) · exigir poder institucional (Apothecary) · exigir força física (The Ember Knight) · ler valência moral como protagonismo (o construto é de qualquer valência) · pontuar pela fase mais forte ou pela mais fraca (a banda é o nível representativo; uma fase não é uma banda) · tratar agência que CESSA como agência constrangida (constrangida é agir sob limite e cabe em 7-8; cessar é deixar de agir e entra na agregação como o nível baixo que é) · competência = agência (\"ela resolve tudo sem esforço\" é competência; resolver sem que a decisão custe ou altere o rumo não sobe faixa).",
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
      "0-3 | Pouco conflito emocional; tensões pequenas, resolvidas na própria cena.",
      "4-6 | Conflito presente porém EPISÓDICO — não estrutura a experiência.",
      "7-8 | Conflito emocional RECORRENTE e importante, inclusive com progresso e catarse.",
      "9-10 | Conflito recorrente, duradouro e CENTRAL à experiência.",
    ],
    guidance: [
      "FRONTEIRA PRINCIPAL — RECORRÊNCIA e importância do conflito. Para SUBIR: o conflito precisa VOLTAR e PESAR, não ser maior num momento. Para DESCER: o conflito passa a ser episódico ou resolvido em cena.",
      "ÂNCORAS: 9-10 What It Means to Be You (Drama alto + Angústia muito alta + Tragédia baixa), Villains Are Destined to Die — 7-8 Marry My Husband (Drama alto COM progresso e catarse) — 0-3 A Sign of Affection (manga) — stress: Kaguya-sama (Drama alto + Humor alto), Look Back (poucos conflitos + uma perda enorme).",
      "NÃO FAÇA: deixar a resolução abaixar Drama (Marry My Husband tem catarse e permanece alto) · um evento enorme = Drama alto (Look Back: poucos conflitos + uma perda enorme ⇒ isso é Tragédia, não Drama) · Humor alto exclui Drama alto (Kaguya-sama) · muito conflito = Angústia extrema (Betrayal of Dignity: são construtos diferentes) · ler final feliz como Drama baixo (agnóstico quanto à resolução).",
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
  angst: {
    title: "Angústia",
    ranges: [
      "0-3 | Sofrimento resolvido ou compensado dentro da experiência.",
      "4-6 | Sofrimento presente COM alívio eficaz — o suporte de fato funciona.",
      "7-8 | O ACÚMULO SUPERA O ALÍVIO de forma recorrente.",
      "9-10 | Sofrimento persiste e se acumula; o alívio é ausente, tardio ou INEFICAZ.",
    ],
    guidance: [
      "FRONTEIRA PRINCIPAL — O SALDO. Não é a quantidade de eventos ruins. Para SUBIR: o alívio precisa FALHAR ou CHEGAR TARDE. Para DESCER: o redutor precisa FUNCIONAR — presença de suporte não basta, ele tem que desfazer o acúmulo.",
      "ÂNCORAS: 9-10 What It Means to Be You (Angústia muito alta SEM Tragédia proporcional; o alívio chega DEPOIS do acúmulo), How to Win My Husband Over (suporte insuficiente) — 7-8 Villains Are Destined to Die — 0-3 A Sign of Affection (manga; sofrimentos resolvidos) — stress: Look Back (agudo × acumulativo), Betrayal of Dignity (toxicidade ≠ Angústia automática).",
      "NÃO FAÇA: contar eventos ruins (o que decide é o SALDO, não a quantidade) · deixar a presença de suporte abaixar a nota (o redutor conta pelo efeito — tem que funcionar) · toxicidade = Angústia (Betrayal of Dignity) · agudo = acumulativo (Look Back) · Drama alto ⇒ Angústia alta (Marry My Husband: Drama alto COM Angústia baixa) · Tragédia ⇒ Angústia (What It Means to Be You: Angústia muito alta SEM Tragédia proporcional).",
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
