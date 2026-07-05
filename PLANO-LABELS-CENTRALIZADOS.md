# PLANO — Centralização de nomes e tooltips (LABELS / `ui_labels`)

Status: **implementado no working tree** (2026-07-04) — tsc verde, rotas 200. **Pendente do usuário:** aplicar `126_ui_labels.sql` no Supabase + `npm run sync-constants`. Fonte única de verdade dos nomes de exibição e tooltips dos campos, com o Supabase como origem e o `sync-constants` gerando o TypeScript.

---

## 1. Objetivo

Centralizar o **máximo possível** de nomes de exibição e tooltips dos campos do app, chaveados pelo **nome da variável usada nas fórmulas** (ex.: `synopsis_pred`), cada um com múltiplas formas:

- `full` — nome completo (ex.: "Interesse na obra previsto")
- `short` — nome curto (ex.: "Interesse previsto")
- `abbrev` — nome abreviado (ex.: "Int. Prev.")
- `tooltip_full` — tooltip canônica/completa
- `tooltip_short` — tooltip resumida

Trocar num lugar → todos os call sites adotam. Mata o drift atual (mesmo conceito com até 4 grafias e tooltips divergentes).

## 2. Contexto — os 3 eixos de "nome" (não confundir)

| Eixo | Exemplo | Ferramenta |
|---|---|---|
| **Nome de coluna do DB** (schema) | `works.calc_score` | `supabase gen types` (não feito) |
| **Nome de exibição / tooltip** (o que o user lê) | "Veredito IA" | **este plano — `ui_labels` + LABELS** |
| **Nome de variável no código** | `expectedScore` | é compilado, não centralizável |

`sync-constants` sincroniza **valores** (linhas de lookup: criteria/status/source). Os nomes de exibição soltos são um 3º eixo → tabela própria `ui_labels`.

## 3. Decisões (log)

1. **DB-driven** (não constante TS pura) — decisão do user, por consistência com o resto do app. Custo: editar no DB + `npm run sync-constants` + rebuild (NÃO é ao vivo). Aceito.
2. **Tabela GERAL** `ui_labels`, não `score_labels` (estreita demais) — pra centralizar o máximo, não só notas.
3. **Chaveado por `field`** = nome da variável/fórmula (ex.: `synopsis_pred`, `expected_score`). PK = `field`.
4. **3 formas de nome** (`full`/`short`/`abbrev`) + **2 tooltips** (`tooltip_full`/`tooltip_short`).
5. **Escopo deste lote = campos soltos.** Critérios/status/source **NÃO** entram (já têm casa no DB — duplicar = drift). Ficam pra um 2º lote, mesclados pelo gerador (derivados, sem copiar dado).
6. **Limite das tooltips:** `tooltip_full/short` = explicação do **conceito** do campo. Ficam **fora**: tooltips de estado ("Sem Nota Prevista ainda…"), de ação (botão "Rankear…"), de plano ("feature Paga…") e as **ricas dinâmicas** (Veredito com confiança/riscos/justificativa do LLM). Essas são UI contextual/dinâmica, não descrição do campo.
7. **`synopsis_q` full** renomeado para "Interesse na obra (user)" (decisão do user).
8. Nomes de coluna do DB usam prefixo `name_` (`name_full`/`name_short`/`name_abbrev`) pra evitar palavra reservada `full`; TS expõe `full`/`short`/`abbrev` (gerador mapeia).

## 4. Achados da auditoria

- **Duas fontes paralelas de descrição de header**: `work-table-config.ts` (`description`) e `NON_CRITERION_TOOLTIPS` em `work-heatmap-view.tsx` — mesmos campos, textos diferentes.
- **Grafias múltiplas do mesmo conceito** (ex.: `platform_avg` = "Nota.M" / "N.M" / "Média externa" / "Externa" em 4 lugares).
- **`alignment_score`** é o mais fragmentado (~13 textos), mas a maioria é estado/ação/plano/dinâmico — só ~2 são descrição-de-conceito.
- **`calc_score`** e **`title`** não têm tooltip user-facing.
- Contagem: 2 campos com 0 texto, 10 com 1, 8 com 2+ divergentes.
- Tooltips ricas de score (`score-tooltip-content.tsx`) são JSX estruturado → não centralizáveis como string (ficam como componente).

## 5. Arquitetura

**Tabela `ui_labels`** (migration `126_ui_labels.sql`):
```
field         text  PK      -- nome da variável (ex.: synopsis_pred)
category      text          -- 'score' | 'basic' (organização)
name_full     text NOT NULL
name_short    text NOT NULL
name_abbrev   text NOT NULL
tooltip_full  text
tooltip_short text
sort_order    int  NOT NULL
updated_at    timestamptz
```
RLS ligado sem policy (padrão do schema; service role do sync bypassa).

**Gerado** `lib/constants/ui-labels.ts` (via `sync-constants`):
```ts
export const LABELS = {
  synopsis_pred: { full: "…", short: "…", abbrev: "…", tooltip_full: "…", tooltip_short: "…" },
  …
} as const
export type LabelField = keyof typeof LABELS
```
Uso: `LABELS.platform_avg.abbrev` (header curto), `.full` (config picker), `.short` (sort), `.tooltip_full` (tooltip do header).

**Fluxo de rename:** editar linha no Supabase → `npm run sync-constants` → rebuild.

## 6. Spec completa (aprovada) — 20 campos

### Família `score`
| field | full | short | abbrev | tooltip_full | tooltip_short |
|---|---|---|---|---|---|
| decision | Prioridade de leitura | Prioridade | Prior. | Quão provável que você goste — número único (0–10) pra priorizar o que ler primeiro. Ancorado na Nota Prevista (que já embute o Alinhamento) e ajustado pelo Veredito IA quando existe. É PRIORIDADE, não previsão de nota. | Número pra priorizar o que ler primeiro (não é previsão de nota). |
| expected_score | Nota Prevista | Prevista | Prev. | Nota que o modelo prevê que você daria à obra (0–10). É a âncora calibrada — uma regressão Ridge treinada nas suas notas. | Nota que o modelo prevê que você daria (0–10). |
| calc_score | Nota.Calc | Nota.Calc | Calc | Nota determinística de ensemble — âncora interna do preditor, não é a nota headline. | Âncora interna do preditor. |
| personal_fit | Alinhamento | Alinhamento | Alinh. | O quanto a obra combina com seu perfil de gosto, como percentil na sua biblioteca (0–100; Top 25% = ≥75). Junta tags amadas/evitadas, faixas ideais de critério e consistência geral. | O quanto a obra combina com seu perfil (percentil 0–100). |
| platform_avg | Média externa | Nota.M | N.M | Média ponderada das notas das plataformas externas (AniList, MAL, etc.), 0–10. Pondera mais as fontes com mais votos. | Média ponderada das notas externas (0–10). |
| total_votes | Votos externos | Votos | Votos | Total de votos/avaliações somados nas plataformas externas. Quanto maior, mais confiável é a Nota.M. | Total de votos nas plataformas externas. |
| alignment_score | Veredito IA | Veredito | Ver. | Veredito do consultor IA (0–100), gerado sob demanda. Reordena as recomendações e ajusta a Prioridade — a maioria das obras fica sem valor até passar pelo Rankear. | Veredito do consultor IA (0–100). |
| synopsis_q | Interesse na obra (user) | Interesse | Sinopse | O quanto a obra te interessou (♥ a ♥♥♥♥), informado por você na triagem/avaliação. | Seu interesse informado (♥ a ♥♥♥♥). |
| synopsis_pred | Interesse na obra previsto | Interesse previsto | Int. Prev. | Previsão da IA de quanto a obra vai te interessar (♥ a ♥♥♥♥), com base no seu perfil. Diferente de "Interesse na obra (user)", que é o que você informou. Só na feature Paga. | Previsão da IA do seu interesse (♥ a ♥♥♥♥). |

### Família `basic`
| field | full | short | abbrev | tooltip_full | tooltip_short |
|---|---|---|---|---|---|
| fav | Favorito | Favorito | Fav | Indica se a obra está marcada como favorita. | Marcada como favorita. |
| title | Título | Título | Título | *(vazio)* | *(vazio)* |
| publication_status | Status de publicação | Publicação | Pub. | Status de publicação da obra na fonte (em andamento, concluída, hiato, cancelada). | Status de publicação na fonte. |
| personal_status | Status pessoal | Status pessoal | Status | Seu status de leitura para a obra (pra ler, lendo, concluída, etc.). | Seu status de leitura. |
| chapters_total | Capítulos totais | Capítulos | Caps. | Número total de capítulos da obra, quando conhecido. | Total de capítulos. |
| chapters_read | Capítulos lidos | Lidos | Lidos | Quantos capítulos você já marcou como lidos. | Capítulos que você leu. |
| chapters_progress | Progresso de leitura | % lido | % Lido | Progresso de leitura: capítulos lidos ÷ total de capítulos. | Capítulos lidos ÷ total. |
| year | Ano de lançamento | Ano | Ano | Ano de lançamento/início da publicação. | Ano de lançamento. |
| ai_status | Status da avaliação IA | Avaliação IA | IA | Estágio da avaliação por IA: pendente de atributos, pendente de Veredito IA, avaliado ou pulado. | Estágio da avaliação por IA. |
| updated_at | Atualizado em | Atualizado | Atual. | Quando o registro da obra foi atualizado pela última vez. | Última atualização do registro. |
| last_read_at | Última leitura | Última leitura | Últ. leit. | Data da última vez que você leu algum capítulo desta obra. | Sua última leitura. |

## 7. Plano de execução

1. ✅ Migration `126_ui_labels.sql` (schema + seed dos 20 campos).
2. ✅ `sync-constants` gera `lib/constants/ui-labels.ts` (`LABELS`).
3. ✅ Arquivo gerado seedado (diff limpo ao sincronizar).
4. ✅ **Sweep** feito — call sites apontados pro `LABELS`:
   - *Definition sites*: `work-table-config.ts` (`label`→abbrev/short, `configLabel`→full/short, `description`→tooltip_full), `work-heatmap-view.tsx` (2 dicts NON_CRITERION_LABELS→short/abbrev + NON_CRITERION_TOOLTIPS→tooltip_full), `ranking-filters.tsx`/`title-filters.tsx` (SORTABLE_FIELDS→short, range defs + pushRange(Chip)→full), filtro synopsis_pred (abbrev + tooltip_full).
   - *Render sites*: `ranking-table.tsx` MetricCell 2×2 (short/abbrev) + re-key dos 38 sites que usavam `SCORE_LABELS` (→ `.full`).
   - **Fora de propósito (deixados hardcoded):** presets (Tudo/Compacto…), rótulos de grupo (Básico/Notas/Atributos), tooltips de estado/ação/plano e as ricas dinâmicas (score-tooltip-content, cells state, detalhe da obra, hints de settings) — são UI contextual/dinâmica, não descrição do campo.
5. ✅ Verificado — `tsc` 0 erros; `/titles` `/ranking` `/favorites` `/recommendations` HTTP 200 sem erro. 21 arquivos alterados.

## 8. Pendências do usuário (não dá pra eu fazer)

- **Aplicar `126_ui_labels.sql`** no SQL editor do Supabase (service key não faz DDL).
- Rodar **`npm run sync-constants`** (deve sair com diff limpo = tabela == código).

## 9. Follow-ups / diferidos

- **2º lote:** mesclar critérios + status no mesmo `LABELS` via gerador (derivado das tabelas `criteria`/`publication_status`/…, sem duplicar) → API única pra TODOS os nomes.
- Rótulos de grupo (Básico/Notas/Atributos) e presets (Tudo/Compacto…) — não são "variável de fórmula"; tratar à parte se quiser.
- Templatizar as tooltips que citam outros labels (ex.: "…mais confiável é a Nota.M") pra puxarem do próprio `LABELS` — overkill hoje.
