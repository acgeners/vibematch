# Redesign das rubricas dos 9 critérios IA — prompt v23

**Data:** 2026-07-25. **Migration:** 165. **Prompt:** v23 (`lib/ai-evaluation/service.ts`).
**Frente B** da investigação de prompts (a Frente A foi o adult_content, PR #244 / v22).

Motivação: as notas dos atributos saíam de "ferramentas quebradas" — rubricas que se
contradiziam com regras globais em prosa. Diagnóstico (Fase 0, sobre a config v21):
- protagonist rebaixado por QUALIDADE em 26% das notas baixas (a rubrica dizia "fraco/forte");
- 153 notas na zona morta [4,5) citando "Faixa 4-6" (piso ≥5 brigando com a faixa 4-6);
- "não mencionaram" usado como prova de ausência em 17-18% das notas baixas;
- só 6% das obras com 2+ critérios ≥9 (a redação "define a obra" no topo excluía critérios);
- tragédia 60% <5 **invariante ao nº de reviews** → interpretação, não falta de evidência.

## Decisões congeladas (mockups aprovados)

Referência visual: rubricas https://claude.ai/code/artifact/1a289675-255f-44b9-a9dd-7e266ce84f34 ·
decisões de escopo https://claude.ai/code/artifact/1671f018-9372-4d75-b950-7235ebff262a

**Estrutura**
- **Escala NEUTRA de intensidade** (0-3 ausente → 9-10 onipresente) para 8 critérios; **couple_dynamics
  é VALÊNCIA** (destrutiva ↔ construtiva) — o único assim.
- **Topo 9-10 = SATURAÇÃO** ("onipresente/constante"), não primazia ("define a obra"): critérios não se
  excluem. Medido: a exclusão mordia só no topo (6% com 2+ ≥9 vs 32% com 5+ ≥7). Anti-correlações reais
  (humor×tragédia −0,61) são tonais e emergem sozinhas — sem regra de exclusão.
- **Dois grupos de interpretação**, marcados no prompt: **FATO/AÇÃO** (romance, fantasia, ação, adult,
  protagonista) — evidência mais confiável em tags/gêneros/premissa; **SENTIMENTO** (dinâmica, humor,
  drama, tragédia) — evidência mais confiável no consenso das reviews. **Não é exclusivo** — todas as
  fontes valem pra todos; o grupo só diz qual é mais confiável.

**Como ler**
- **Intensidade = 2 perguntas:** (1) existe? não → 0-3; (2) quão intenso = FREQUÊNCIA × POTÊNCIA
  (9-10 as duas altas; 7-8 uma alta — rara-porém-intensa cabe aqui; 4-6 moderado). Exceções:
  adult_content = só potência; tragédia = gravidade × irreversibilidade.
- **PRÁTICA, não teoria:** conta o que se manifesta nos eventos (cenas, ações), não o que é
  mencionado/discutido/planejado. Esquema que se executa com consequências é prática.
- **Sinopse em 3 partes:** background + situação inicial = contexto estabelecido; direção da trama =
  desenvolvimento. Critérios de desenvolvimento (tragédia, drama, arco da dinâmica) leem a direção,
  nunca o contexto. Setup (fantasia) lê o contexto legitimamente.

**Por critério**
- **romance** — conteúdo RETRATADO, não tema. Endymion (amor como tema, zero interação) = baixo.
- **couple_dynamics** — valência nos VÍNCULOS CENTRAIS ("casal"→"protagonistas"; sem par, conduta com
  aliados/queridos). Crueldade com antagonistas não rebaixa. Consenso importa (dark consensual ≠ 0-3).
  Backstory não excuse; arco de cura vale só se ENCENADO e cedo. Devoção a abusador não-arrependido =
  0-3. É o critério mais tricky → prioridade nº 1 do gold set.
- **fantasy_nobility** — BASTA UM dos dois (fantasia OU nobreza).
- **action_adventure** — inclui tensão externa (perseguição, intriga com risco), não só combate.
- **protagonist** — PRESENÇA/agência, não qualidade (rótulos reescritos).
- **humor** — registro cômico construído; dark comedy conta mas clima pesado o muta.
- **drama** vs **tragédia** — drama = intensidade e DURAÇÃO do conflito (pode resolver); tragédia =
  GRAVIDADE e IRREVERSIBILIDADE das perdas. Sofrimento psicológico sem perda = drama, não tragédia.

**Deletado do prompt** (regras globais que contradiziam as rubricas): bloco "critérios negativos",
piso ≥5, "0-4 reservado", "prefira o valor central", e as duplicatas de regra de critério.

## Escala é ABSOLUTA (não relativa ao gênero)

Decisão X1. Consequência aceita: num catálogo de romance, ação/tragédia/fantasia ficam baixas na
maioria — é verdade, não defeito. Obras em andamento: avaliar só o que já existe (X2). Avaliar a
adaptação, não o novel (X3). As 18 decisões de escopo estão no artifact linkado.

## Medição (como saber se melhorou)

**Consistência** (automática, grátis): re-medir as métricas da Fase 0 (protagonist-qualidade,
zona morta, invariância da tragédia, co-ocorrência de ≥9) num sample re-avaliado sob v23.

**Acurácia** (o que importa): gold set do usuário. Descoberta-chave — a tabela
`user_attribute_assessment` já tem **143 obras** com a avaliação pós-leitura do usuário dos 9
critérios. Divergência medida (entre os editados, direção):
- tragédia |Δ|1,04, IA super-avalia (usuário baixa −0,38) — maior desacordo;
- couple_dynamics |Δ|0,94, 39% editado, sem direção = ruidoso/inconsistente;
- fantasia/humor/adult |Δ|0,86, IA sub-avalia (usuário sobe ~+0,5);
- romance/protagonista/drama bem calibrados.
Ressalvas: ancorado (74% aceitou a IA → subestima), versões misturadas, definições antigas. Por isso
o usuário nota **30 obras cegas** (as mais recentes, recall fresco) sob as definições v23 — régua limpa
pros 4 critérios redefinidos.

**Nada foi reavaliado em massa.** Reavaliar o catálogo (~900 obras) custaria ~US$30 e só acontece com
aval explícito, depois de a medição confirmar melhora.

## Nota de migração

A migration 165 altera `criteria.ranges` no banco de produção (aplicada). Reverter o código exigiria
uma migration nova pra restaurar o texto antigo — não basta `git revert`. Backup feito antes
(`.backups/`, 155.869 linhas). `adult_content` NÃO foi tocado (é v22, migration 164).
