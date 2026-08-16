# LEITURA — Bandas de estado de leitura

> **Data:** 2026-07-21 · **Status:** ✅ na `main` (modelo v4 — **duas taxonomias por seção**)
> **PRs:** #200 (v1 recência) · #201 (doc) · #202 (v2 %-primeiro) · #203 (doc) · #204 (v3 — 6 bandas) · **v4 (esta — taxonomia por seção)**
> **Modelo atual:** cada **seção** da página tem sua **própria taxonomia**:
> - **Em andamento** (publicação *Ongoing*) → **6 bandas de RITMO** (% × recência 30d × hiato).
> - **Concluída & outras** (completa · **hiato** · cancelada) → **3 bandas de TRIAGEM** (Continuar / Definir / Parado).
>
> **Escopo:** página `/reading` (Acompanhamento) · arquivo único `components/reading/reading-list.tsx`
> **Marcação:** ✅ verificado no código/app · ⚡ virada de decisão · ⚠️ armadilha registrada
>
> ⚠️ **O desenho das faixas é móvel** — mudou 4× em sequência (ver §3). Antes de mexer, peça a matriz
> `% × dias` e confira a **cobertura** (nenhuma célula pode ficar sem banda).

---

## 1. O problema (pedido)

A página mostrava um selo **binário** por obra: `Em dia` ou `N pra ler`. O pedido foi **separar** as obras
que se acompanha de perto das pendentes, considerando o **% lido** (20/21 ≠ 10/56) e a situação real de
"desacelerar e ficar atrasado". Na v4 o dono observou que **obra concluída não se mede por "ritmo"** (não
sai capítulo novo), então cada seção passou a ter uma taxonomia própria.

## 2. Os eixos

| Eixo | Mede | Vem de |
|---|---|---|
| **% lido** | quanto falta ler | `lido / lançado` (via `progressOf`) |
| **Recência** | lendo agora ou parou? | `last_read_at` (`user_work_state`) |
| **Hiato de publicação** | a série parou oficialmente? | `works.publication_status_id == Hiatus` |
| **Publicação (Ongoing?)** | dita qual **taxonomia** a obra usa | `works.publication_status_id == Ongoing` |

## 3. ⚡ A jornada (4 viradas — o aprendizado é maior que o código)

**v1 — recência-primeiro (#200).** Calibração no banco (25 obras) mostrou que as obras que o dono largou
não têm % baixo — têm % médio/alto mas ~4 meses sem abrir. Então "frio → Parado", independente do %.

**v2 — %-primeiro (#202).** Ver **no app** revelou que juntar 81%/95% frias com % baixo confundia. O % puro
virou o eixo primário, a data virou textura. 4 bandas.

**v3 — 6 bandas (#204).** O dono reintroduziu a recência (30d) e um estado de **hiato**, refinando a ordem de
exibição à mão. Uma célula ficou sem banda (85–99% + ≥30d) → foi pra Desacelerando.

**v4 — taxonomia por seção (esta).** O dono percebeu que as 6 bandas de ritmo só fazem sentido pra **publicação
ativa**. Obra **concluída/hiato/cancelada** não recebe capítulo novo → a pergunta vira "vou terminar / vou
decidir / parei". Então:
- **Em andamento** mantém as 6 bandas de ritmo (com **"No ritmo" renomeado pra "Acompanhando"**).
- **Concluída & outras** ganha a triagem **Continuar / Definir / Parado** (hiato de publicação entra junto,
  por decisão do dono).

Também nesta virada: a **faixa-resumo saiu do topo global e foi pra dentro de cada seção** (e deixou de ser
`sticky`), e a previsão vencida passou a **realçar a data já exibida** em vez de virar seção nova.

> **Lição:** o design de bandas do dono é iterativo e ele decide **vendo no app**. Calibração e mockup
> ajudam, mas a validação é a UI real + o gosto dele. Sempre confirmar **regras + ordem + cobertura** antes
> de codar.

## 4. Taxonomia A — RITMO (seção "Em andamento" / publicação Ongoing)

**Matriz de cobertura** (% lido × dias sem ler), + override de hiato de publicação:

| % lido ↓ / dias → | **< 30d** | **≥ 30d** |
|---|---|---|
| **100%** | ② Em dia | ⑤ Possível hiato |
| **85–99%** | ① Acompanhando | ④ Desacelerando |
| **40–84%** | ③ Muito atrás | ④ Desacelerando |
| **≤ 39%** | ⑥ Atrasado | ⑥ Atrasado |

*(+ `publicação == Hiatus` → ⑤ Possível hiato, com **prioridade máxima**, seja qual for o %)*

**Ordem de exibição** (definida pelo dono — **não** é o gradiente de %) e cores:

| # | Banda | Regra | Cor |
|---|---|---|---|
| 1 | **Acompanhando** *(ex-"No ritmo")* | 85–99% & < 30d | lime |
| 2 | **Em dia** | 100% & < 30d | emerald |
| 3 | **Muito atrás** | 40–84% & < 30d | amber |
| 4 | **Desacelerando** | 40–99% & ≥ 30d *(pegou o vazio 85–99% frio)* | orange |
| 5 | **Possível hiato** | 100% & ≥ 30d **ou** publicação em Hiatus | violet |
| 6 | **Atrasado** | ≤ 39% *(tag "recém-começou" se < 30d)* | rose |

**`classifyReadingState` = matriz priorizada** (a 1ª que casa vence):

```
publicação == Hiatus   → Possível hiato          (prioridade máxima)
pending == 0 (100%)    → Em dia (recente) / Possível hiato (frio)
pct < 0.40 (≤39%)      → Atrasado
frio (≥ 30d)           → Desacelerando            (inclui 85–99% frio)
pct >= 0.85            → Acompanhando
resto (40–84% recente) → Muito atrás
```

Cortes ajustáveis no topo do arquivo: `ONPACE_PCT 0.85` · `BEHIND_PCT 0.40` · `STALE_DAYS 30`.

## 4b. Taxonomia B — TRIAGEM (seção "Concluída & outras")

Obra sem capítulos novos previsíveis (completa · **hiato de publicação** · cancelada) só se mede por
**% lido × recência**. 3 bandas:

| # | Banda | Regra | Cor | Ação por card |
|---|---|---|---|---|
| 1 | **Continuar** | > 50% lido & leu < 45d | emerald | — |
| 2 | **Definir** | ≤ 50% lido & leu < 45d *(ou % desconhecido)* | sky | — |
| 3 | **Parado** | sem ler há ≥ 45d | slate | **On-hold** · **Arquivar** |

**`classifyTriageState`** (a 1ª que casa vence):

```
≥ 45d sem ler          → Parado
pct > 0.50             → Continuar
resto (ou pct null)    → Definir
```

Cortes: `CONTINUE_PCT 0.5` · `STALLED_DAYS 45`.

**Ações do "Parado"** (nada automático — o dono rejeitou troca de status automática):
- **On-hold** → `setReadingStatusForWorks([id], personalStatusNameBySlugOrThrow("on-hold"))`. Muda o status
  pessoal pra `On-hold`; como `/reading` só lista *reading* + *hiatus* pessoal, a obra **sai da lista**.
- **Arquivar** → `archiveWork(id)`.

## 5. Navegação (v4 — faixa por seção, **sem sticky**)

- Cada seção tem a **sua** faixa-resumo (`SectionSummary`), **dentro** dela (não mais global no topo).
- A faixa **não é mais `sticky`** — rola junto com o conteúdo (era `sticky top-0` + `backdrop-blur`, que
  cobria os cards de um jeito estranho ao descer; o dono pediu estática).
- Clicar num segmento **ou** chip **rola** até a banda por `id="band-<sectionKey>-<state>"`. Como cada seção
  tem taxonomia própria, os `state` são **disjuntos** entre as duas → o `getElementById` nunca colide.
- Sem scrollspy/`IntersectionObserver` (não faz sentido sem a barra fixa). `scroll-mt-4` nas bandas.

## 6. Implementação

Tudo em `components/reading/reading-list.tsx` (client). **Sem migration/sem mudança de query** —
`lastReadAt`, `publicationStatusId`, `nextChapterPredictedAt` já vinham no `ReadingWork`.

- **Genéricos `<S extends string>`** (servem às duas taxonomias): `groupBands`, `tallyBands`,
  `SectionSummary`, `BandedGrid` — recebem `classify` + `order` + `config: Record<S, BandConfig>`.
- `classifyReadingState` (§4) e `classifyTriageState` (§4b) → o `ReadingState` / `TriageState`.
- `SectionSummary` → a faixa da seção (§5); `label` e contagens vêm das obras **daquela** seção.
- `BandedGrid` → sub-cabeçalho colorido por banda; `id="band-<section>-<state>"` (âncora do jump);
  prop `actionState` marca a banda que ganha ações (ex.: `"parado"`).
- `ReadingCard` → faixa de cor (`bg-*`), barra + chip na cor, "Última leitura" + tag, e as ações do Parado.
- **Item 3 (realce da previsão vencida):** `predictedOverdue = nextChapterPredictedAt < hoje` → a linha
  "Próximo previsto" já exibida vira `<data> · já passou` em âmbar. **Band-agnostic**, sem seção/selo novo
  (uma seção separada duplicaria as bandas; o sinal cai quase sempre em "Em dia", raramente em Acompanhando).

### ⚠️ Armadilhas registradas

- **Cor via `bg-*`, NÃO `border-<cor>`.** `* { border-color }` em `globals.css:113` (fora de `@layer`)
  sobrepõe as utilities do Tailwind v4 → `border-l-<cor>` é morto neste projeto.
- **Banda reflete os capítulos persistidos** — editar o stepper atualiza o chip na hora, mas a obra só troca
  de banda no próximo refresh (de propósito).
- **Hiato de publicação está em duas seções, com sentidos diferentes:** na seção "Em andamento" um Ongoing
  pessoalmente-parado-a-100% cai em "Possível hiato" (ritmo); publicação-Hiatus fica na seção "Concluída &
  outras" e entra na **triagem** (Continuar/Definir/Parado).
- **Datas (âncora + previsão):** o **MangaDex EN está desatualizado** pros webtoons coreanos (caps param em
  ~2024) → a âncora fresca do "último cap" vem do **comix** (`"Xd atrás"`); o MangaDex só empresta a
  **cadência** (mediana dos gaps). Previsto = âncora + mediana; fica **"—"** se sem âncora, âncora > 45d
  (assume hiato) ou < 3 datas de cadência.

## 7. Verificação

- `tsc` + `eslint` limpos.
- Rota `/reading` compila (HTTP 200) e o componente monta sem erro de runtime (shell anônimo).
- Visual com dados reais logado: **conferir no app** (a sessão do dono não é acessível fora do browser dele).

## 8. Ideias futuras (não são pendências)

- Tratamento à parte pra publicação-Hiatus dentro da triagem ("aguardando retorno") se um dia quiser separar
  do "completo".
- Recalibrar cortes (`0.85`/`0.40`/`30d` no ritmo · `0.50`/`45d` na triagem) se a distribuição mudar.
- Estender o realce da previsão vencida pra além de "Em dia" se fizer sentido.
