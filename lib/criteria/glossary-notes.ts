/**
 * As ressalvas que a rubrica do banco NÃO carrega — e sem as quais a nota é lida errado.
 *
 * Elas não são resumo da rubrica: são o que se aprendeu ERRANDO. A escala de valência do
 * `couple_dynamics` já produziu prosa contradizendo o próprio número; o piso automático do
 * `adult_content` já congelou 64 obras em 9,0 por uma tag de circunstância; o `protagonist`
 * já teve metade das justificativas chamando o protagonista de passivo com nota ≥7. Quem lê
 * a rubrica crua não tem como saber de nada disso.
 *
 * 🔴 Por isso ficam AQUI e não no `criteria.ranges`: o texto do banco vai para o PROMPT, e
 * cada linha nova ali muda a régua da IA e obriga a subir `PROMPT_VERSION`. Explicação para
 * humano não pode custar uma reavaliação do catálogo.
 *
 * ⚠️ A chave é o slug do critério e o teste reprova slug que não exista — nota órfã depois
 * de um rename seria texto que ninguém mais vê, o que é indistinguível de nota ausente.
 */
export interface GlossaryNote {
  /** A afirmação, em negrito na tela. */
  title: string
  /** O porquê, com o caso concreto quando existe. */
  body: string
}

export const GLOSSARY_NOTES: Record<string, GlossaryNote> = {
  couple_dynamics: {
    title: "É o único critério de valência.",
    body: "Nos outros oito, 0 é “não está lá” e 10 é “domina a obra”. Aqui 0–3 é um vínculo que faz mal e 9–10 um que faz bem, então nota baixa não quer dizer “pouca dinâmica”: quer dizer dinâmica ruim. E 5 significa “sem vínculo central recorrente” — protagonista isolado —, nunca “sem romance”.",
  },
  adult_content: {
    title: "É o único com piso automático.",
    body: "Marcador R19 no texto, o content rating das fontes externas (suggestive → 5, erotica → 7, pornographic → 8) e as tags marcadas em adult_score_tier empurram a nota para dentro de uma faixa mínima depois da avaliação. Por isso ele fica fora da auditoria de critérios: sugerir ali seria uma segunda régua para o mesmo número.",
  },
  protagonist: {
    title: "Não avalia qualidade.",
    body: "“Irritante”, “fria”, “Mary Sue” dizem como o protagonista é, e não rebaixam — presença forte polêmica continua sendo presença forte. “Passivo” e “sem agência” dizem o que ele faz, e esses rebaixam.",
  },
  drama: {
    title: "Drama não é tragédia.",
    body: "Drama é a intensidade e a duração do conflito emocional, que pode se resolver. Tragédia é a gravidade e a irreversibilidade das perdas. Sofrimento psicológico prolongado sem perda irreversível é drama.",
  },
  tragedy: {
    title: "Só conta o que acontece na direção da trama.",
    body: "Perda no contexto já estabelecido — a família morta antes do primeiro capítulo — é background e não pontua, por mais pesada que seja. O critério mede o que a obra faz com os protagonistas enquanto ela acontece.",
  },
}
