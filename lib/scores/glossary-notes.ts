/**
 * As ressalvas do dicionário dos números — o que nenhuma constante do cálculo carrega.
 *
 * Irmão de `lib/criteria/glossary-notes.ts`, e pelo mesmo motivo: o texto que descreve
 * uma medida não pode morar junto da medida. `ui_labels.tooltip_full` alimenta o seletor
 * de colunas, o heatmap e o painel de filtros, onde cabe UMA frase; e as features do
 * Ridge não têm rótulo em lugar nenhum — o nome delas é um identificador de código.
 *
 * 🔴 O que entra aqui é o que se aprendeu ERRANDO, com o número medido junto. O
 * Alinhamento passou dois meses sendo explicado por uma fórmula aposentada; a ênfase
 * declarada em `/preferences` pode não ser a que está em vigor; `RunLength` existe em
 * 27,8% do catálogo e é imputada no resto. Quem lê só a constante não tem como saber de
 * nada disso.
 *
 * ⚠️ A chave é a `key` do verbete e o teste reprova nota órfã — ressalva pendurada num
 * verbete que não existe mais é texto que ninguém vê, indistinguível de não tê-la escrito.
 */
export interface ScoreNote {
  /** A afirmação, em destaque na tela. */
  title: string
  /** O porquê, com o caso concreto quando existe. */
  body: string
  /**
   * `alerta` para o que muda a leitura do número (âmbar, a cor de "não aplique sem
   * refazer"); `contexto` para o que só acrescenta. A régua de cor é a do
   * `lib/ui/status-tone.ts` — aqui o âmbar continua querendo dizer "olhe antes de usar".
   */
  tone: "alerta" | "contexto"
}

export const SCORE_NOTES: Record<string, ScoreNote> = {
  expected_score: {
    tone: "alerta",
    title: "Uma nota sua muda o catálogo inteiro.",
    body: "O modelo é treinado nas obras que você já avaliou, então avaliar uma reordena todas as outras — é por isso que o botão “Recalcular notas” acende. Abaixo de 20 obras avaliadas ele não prevê nada: devolve a média do treino, e a tela diz isso em vez de fingir um número.",
  },
  personal_fit: {
    tone: "alerta",
    title: "O erro é direcional: alto é confiável, baixo é ambíguo.",
    body: "A soma não tem denominador, então obra com muitas tags tende a pontuar mais (correlação de +0,58 entre número de tags e o percentil). Medido no catálogo: quase nenhuma obra pouco tagueada alcança o topo — mas uma em sete fica na parte de baixo tendo menos de 25 tags, e aí “não combina com você” e “ninguém descreveu esta obra ainda” dão o mesmo número.",
  },
  alignment_score: {
    tone: "contexto",
    title: "Ele não existe até você pedir.",
    body: "É o único número da página que custa uma chamada de IA, então ele só existe nas obras em que alguém pediu o re-rank. Onde ele falta, a Prioridade é a Nota Prevista intacta — não há penalidade por não ter passado por ele.",
  },
  decision: {
    tone: "contexto",
    title: "É prioridade, não previsão.",
    body: "A Nota Prevista responde “quanto eu daria”; a Prioridade responde “o que eu leio primeiro”. Ela parte da Prevista e só se afasta dela quando existe um Veredito — e o Veredito entra como desvio da própria média, não como nota: antes de 16/08/2026 ele era somado direto e derrubava 625 das 695 obras que o tinham, favorecendo na ordenação justamente quem não tinha sido processado.",
  },
  score_weights: {
    tone: "alerta",
    title: "A ênfase que você declarou pode não ser a que está valendo.",
    body: "Com a ênfase automática ligada, o sistema usa os pesos inferidos do seu histórico e os declarados em /preferences viram reserva. Medido no catálogo do dono: os dois discordam em 7 dos 9 atributos e em 3 deles o sinal está invertido — tragédia declarada em −15 e inferida em +11,4. O automático acerta mais o gosto dele (correlação 0,584 contra 0,499); o problema nunca foi qual dos dois usar, foi a tela não dizer qual está em vigor.",
  },
  run_length: {
    tone: "alerta",
    title: "Feature quase vazia é feature quase muda.",
    body: "O ano de fim só existe em obras concluídas com a data preenchida. Onde falta, o valor é substituído pela mediana do catálogo — ou seja, contribui igual para todo mundo e não separa nada. É a diferença entre “o modelo considerou a duração” e “o modelo tinha a duração de uma obra em cada quatro”.",
  },
  ia_eval_normalized: {
    tone: "contexto",
    title: "Ela é amplificada de propósito.",
    body: "Depois da soma ponderada, o resultado é esticado em torno de 5 (`5 + (nota − 5) × 1,25`). Sem isso as notas se amontoam no meio da escala, porque a média dos nove atributos raramente é extrema — e uma nota que não separa obras não serve para ordenar nenhuma lista.",
  },
  calc_score: {
    tone: "contexto",
    title: "Ela não aparece em lista nenhuma, e isso é escolha.",
    body: "Foi a nota principal do app até 06/2026, quando virou entrada da Nota Prevista em vez de resultado. Continua sendo calculada porque ancora o modelo quando há poucos rótulos — mas mostrá-la ao lado da Prevista seria oferecer dois números para a mesma pergunta.",
  },
  platform_avg: {
    tone: "contexto",
    title: "É a única nota da página que não é sobre você.",
    body: "Ela pondera as plataformas pelo número de votos, então uma nota 9,5 com 40 votos pesa menos que uma 8,2 com 12 mil. Contra o gosto do dono ela é o sinal mais fraco de todos os que entram no modelo (correlação 0,271, contra 0,646 da Nota Prevista) — o que não a torna inútil: ela é o que sobra quando não há modelo nenhum.",
  },
  art_signal: {
    tone: "contexto",
    title: "Sai como percentil, nunca em pontos.",
    body: "A estimativa é comprimida — vive num intervalo bem menor que o dos atributos —, então um número em pontos convidaria a comparar com uma nota de critério e daria a impressão errada de precisão. Ela também é pessoal: treinada nos seus rótulos de arte, e por isso não aparece para quem não os tem.",
  },
  synopsis_q: {
    tone: "contexto",
    title: "É o único sinal que você dá antes de ler.",
    body: "Por isso ele alimenta um modelo à parte, que aprende a prever atração pela sinopse. Dispensar vale tanto quanto curtir: é o não que impede a IA de oferecer a mesma coisa errada dez vezes.",
  },
  observation_adjustment: {
    tone: "contexto",
    title: "É somado depois, não aprendido.",
    body: "Ele já foi feature do modelo e saiu em 05/2026: como é quase sempre zero, o peso aprendido ficava ruidoso e não correspondia ao ajuste que a pessoa tinha em mente. Hoje é uma soma determinística de até ±0,30 aplicada no fim — você mexe, e a nota anda exatamente isso.",
  },
  attribute_bias: {
    tone: "alerta",
    title: "É por aqui que a sua leitura entra — e é o único caminho.",
    body: "As oito notas que você dá ao terminar uma obra não entram no modelo: elas só existem em obras lidas, e o modelo precisa de sinais que existam também nas que você ainda não leu. O que sobrevive delas é a diferença sistemática entre a sua percepção e a da IA, que desloca as notas de origem IA nas suas contas — sem tocar no que as outras pessoas veem.",
  },
}

/**
 * O que NÃO entra em nota nenhuma — e por quê.
 *
 * 🔴 Isto não é derivável: é o complemento de um universo aberto. O que o teste garante é
 * o outro lado, que é o que envelhece — nenhum item daqui pode estar em `RECALC_INPUTS`.
 * No dia em que alguém ligar `work_genres` ao modelo, esta lista reprova em vez de a
 * página seguir afirmando o contrário.
 *
 * ⚠️ Metade das perguntas sobre o cálculo é sobre o que ficou de fora, e o par mais
 * confuso está aqui: `work_tags` entra e `work_genres` não, sendo que na página da obra os
 * dois aparecem lado a lado como se fossem a mesma coisa.
 */
export interface ScoreExclusion {
  /** Como a pessoa chama isso na tela. */
  name: string
  /** O nome técnico, para quem for procurar no código. */
  slug: string
  /** Por que não entra — vazio quando o nome já responde. */
  why: string
}

export const SCORE_EXCLUSIONS: ScoreExclusion[] = [
  {
    name: "Gêneros",
    slug: "work_genres",
    why: "descrevem a obra, mas quem o modelo lê são as tags — é o par que mais confunde, porque na página da obra os dois ficam lado a lado",
  },
  {
    name: "Sinopse",
    slug: "synopsis",
    why: "alimenta a previsão de Interesse, que é outro modelo; na nota ela não entra",
  },
  { name: "Capa", slug: "work_covers", why: "" },
  {
    name: "Títulos alternativos",
    slug: "alternative_titles",
    why: "servem para a busca e para detectar duplicata",
  },
  {
    name: "Seu status de leitura",
    slug: "personal_status_id",
    why: "marcar como “Lendo” organiza a sua lista e não move nota nenhuma",
  },
  { name: "Capítulos lidos", slug: "chapters_read", why: "" },
  { name: "Última leitura", slug: "last_read_at", why: "" },
  { name: "Favorito", slug: "is_favorite", why: "organiza, não pontua" },
  {
    name: "As 8 notas de pós-leitura",
    slug: "post_*_score",
    why: "entram só como correção do seu viés (ver Viés de atributo), nunca direto na nota",
  },
]
