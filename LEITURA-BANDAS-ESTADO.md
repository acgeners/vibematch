# LEITURA — Bandas de estado de leitura

> **Data:** 2026-07-20 · **Status:** ✅ na `main` (modelo de **6 bandas**)
> **PRs:** #200 (v1 recência) · #201 (doc) · #202 (v2 %-primeiro) · #203 (doc) · **#204 (v3 — 6 bandas, atual)**
> **Modelo atual:** 6 bandas cruzando **% lido × recência (30d) × hiato de publicação**.
> **Escopo:** página `/leitura` (Acompanhamento) · arquivo único `components/reading/reading-list.tsx`
> **Marcação:** ✅ verificado no código/app · ⚡ virada de decisão · ⚠️ armadilha registrada
>
> ⚠️ **O desenho das faixas é móvel** — mudou 3× em sequência (ver §3). Antes de mexer, peça a matriz
> `% × dias` e confira a **cobertura** (nenhuma célula pode ficar sem banda).

---

## 1. O problema (pedido)

A página mostrava um selo **binário** por obra: `Em dia` ou `N pra ler`. O pedido foi **separar** as obras
que se acompanha de perto das pendentes, considerando o **% lido** (20/21 ≠ 10/56) e a situação real de
"desacelerar e ficar atrasado".

## 2. Os eixos

| Eixo | Mede | Vem de |
|---|---|---|
| **% lido** | quanto falta ler | `lido / lançado` (via `progressOf`) |
| **Recência** | lendo agora ou parou? | `last_read_at` (`user_work_state`) |
| **Hiato de publicação** | a série parou oficialmente? | `works.publication_status_id == Hiatus` |

## 3. ⚡ A jornada (3 viradas — o aprendizado é maior que o código)

**v1 — recência-primeiro (#200).** Calibração no banco (25 obras) mostrou que as obras que o dono largou
não têm % baixo — têm % médio/alto mas ~4 meses sem abrir. Então "frio → Parado", independente do %.
Distribuição 4/13/1/7.

**v2 — %-primeiro (#202).** Ver **no app** revelou o problema: "Atrasado/Parado" juntava obras a 81%/95%
(quase no fim, mas frias) com % baixo → confuso. O dono: *"tira Atrasado/Parado, importa muito mais a % do
que a data"*. Bandas por % puro (Em dia / No ritmo ≥80% / Desacelerando 40–80% / Muito atrás <40%); a data
virou textura. 4 bandas, distribuição 4/10/7/4.

**v3 — 6 bandas (#204, atual).** O dono refinou as regras e a **ordem de exibição** à mão, reintroduzindo a
recência (30 dias) como eixo e um estado de **hiato**. Antes de codar, mapeei a matriz e achei **uma célula
sem banda** (85–99% + ≥30d) — que ele mandou pra Desacelerando. Ver §4.

> **Lição:** o design de bandas do dono é iterativo e ele decide **vendo no app**. Calibração e mockup
> ajudam, mas a validação é a UI real + o gosto dele. Sempre confirmar **regras + ordem + cobertura** antes
> de codar.

## 4. O modelo atual (6 bandas)

**Matriz de cobertura** (% lido × dias sem ler), + override de hiato de publicação:

| % lido ↓ / dias → | **< 30d** | **≥ 30d** |
|---|---|---|
| **100%** | ② Em dia | ⑤ Possível hiato |
| **85–99%** | ① No ritmo | ④ Desacelerando |
| **40–84%** | ③ Muito atrás | ④ Desacelerando |
| **≤ 39%** | ⑥ Atrasado | ⑥ Atrasado |

*(+ `publicação == Hiatus` → ⑤ Possível hiato, com **prioridade máxima**, seja qual for o %)*

**Ordem de exibição** (definida pelo dono — **não** é o gradiente de %) e cores:

| # | Banda | Regra | Cor |
|---|---|---|---|
| 1 | **No ritmo** | 85–99% & < 30d | lime |
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
pct >= 0.85            → No ritmo
resto (40–84% recente) → Muito atrás
```

Cortes ajustáveis no topo do arquivo: `ONPACE_PCT 0.85` · `BEHIND_PCT 0.40` · `STALE_DAYS 30`.
A recência entra na banda (30d), mas ainda dá a tag **"recém-começou"** (`isRecentlyStarted`: < 40% lido
+ < 30d) como textura no card.

## 5. Navegação (#202, mantida)

- A faixa-resumo é uma **nav FIXA (sticky, `top-0`)** com as 6 bandas como **abas** + a barra segmentada.
- Clicar numa aba **ou** num segmento **rola** até a banda (`scrollIntoView`).
- A **aba ativa acompanha a rolagem** (scrollspy via `IntersectionObserver` sobre `[data-band-state]`).
- Rola pra primeira ocorrência da banda no DOM ("Em andamento" antes de "Concluída").
- `scroll-mt-32` nas bandas reserva a altura da nav fixa.

## 6. Implementação

Tudo em `components/reading/reading-list.tsx` (client). **Sem migration/sem mudança de query** —
`lastReadAt` e `publicationStatusId` já vinham no `ReadingWork`.

- `classifyReadingState` → o `ReadingState` (matriz da §4). `isRecentlyStarted` → a tag.
- `groupIntoBands` → agrupa por banda na ordem de `READING_STATE_ORDER`.
- `ReadingStateSummary` → a nav fixa (§5).
- `BandedGrid` → sub-cabeçalho colorido por banda; recebe `sectionKey`; marca `id={band-<section>-<state>}`
  + `data-band-state` (âncoras) + `scroll-mt-32`.
- `ReadingCard` → faixa de cor por estado (`bg-*`), barra + chip na cor, linha "Última leitura" + tag.

### ⚠️ Armadilhas registradas

- **Cor via `bg-*`, NÃO `border-<cor>`.** `* { border-color }` em `globals.css:113` (fora de `@layer`)
  sobrepõe as utilities do Tailwind v4 → `border-l-<cor>` é morto neste projeto.
- **Banda reflete os capítulos persistidos** — editar o stepper atualiza o chip na hora, mas a obra só troca
  de banda no próximo refresh (de propósito).
- **Publicação Hiatus vs seção:** obras em publicação-Hiatus não são "Ongoing" → caem na seção "Concluída &
  outras", e lá também são classificadas como "Possível hiato".
- **Infra:** martelar o dev server (curl + browsers headless em paralelo no compile do Turbopack) trava o
  next-server. `kill` + `npm run dev` novo.

## 7. Verificação

- `tsc` + `eslint` limpos em cada iteração.
- App (preview temporário + Playwright): a **ordem** das 6 bandas confere exatamente; o vazio **85–99% frio**
  cai em Desacelerando; **pub-Hiatus a 63% recente** vai pra Possível hiato (confirmado pela contagem do
  resumo); ≤39% → Atrasado com "recém-começou" só quando < 30d.

## 8. Ideias futuras (não são pendências)

- 7ª banda "Começando" (≤39% + < 30d) se um dia quiser separar recém-começadas de largadas.
- Recalibrar cortes (`0.85` / `0.40` / `30d`) se a distribuição mudar — molde em `scratchpad/calibrate.mjs`.
- Abas de banda por seção (hoje a nav rola pra "Em andamento"); ou isolar/filtrar uma banda.
