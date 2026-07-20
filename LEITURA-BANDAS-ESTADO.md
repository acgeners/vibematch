# LEITURA — Bandas de estado de leitura

> **Data:** 2026-07-20 · **Status:** ✅ na `main`
> **PRs:** **#200** (bandas, 1ª versão) · **#201** (este doc) · **#202** (reversão p/ %-primeiro + navegação)
> **Modelo final:** bandas por **% lido** (quanto falta ler). A data (última leitura) é só **textura**.
> **Escopo:** página `/leitura` (Acompanhamento) · arquivo único `components/reading/reading-list.tsx`
> **Marcação:** ✅ verificado no código/app · ⚡ virada de decisão · ⚠️ armadilha registrada

---

## 1. O problema (pedido)

A página de acompanhamento mostrava um selo **binário** por obra: `Em dia` ou `N pra ler`. O pedido foi
**separar visualmente** as obras que se acompanha de perto das pendentes, considerando o **% lido**:

> "Acompanho algumas obras religiosamente, mas em outras eu **desacelero e fico bem atrasado**. Precisa
> considerar `em dia`/`pendente` **mas também o % lido** (ex.: 20/21 ≠ 10/56)."

O binário não capta isso: 20/21 e 10/56 são ambos "pendente", mas são situações opostas.

## 2. Os 3 eixos possíveis

| Eixo | Mede | Vem de |
|---|---|---|
| **Gap** (falta 0?) | alcançou o último lançamento | `lançado − lido` |
| **% lido** | quanto falta ler / profundidade do backlog | `lido / lançado` |
| **Recência** | está lendo agora ou parou? | `last_read_at` (`user_work_state`) |

Qual eixo dirige as bandas? A resposta **mudou duas vezes** — ver §3. O modelo final: **% dirige a banda,
recência é textura.**

## 3. ⚡ A jornada (por que o eixo mudou 2×)

Vale registrar porque o aprendizado é maior que o código: **calibração no papel ≠ ver no app + o gosto do dono.**

**v1 — %-primeiro ingênuo (`behind` = < 40% lido E frio).** A banda "Atrasado" ficava **VAZIA**. Motivo:
as obras que o Geners largou **não têm % baixo** — têm % médio/alto mas ~4 meses sem abrir; e as de %
baixo dele são quase todas **recentes** (recém-começadas), então caíam em "No ritmo".

**v2 — recência-primeiro (PR #200).** Rodei `scratchpad/calibrate.mjs` contra o banco (25 obras reais) e
inverti: **frio → "Parado", independente do %**. Distribuição 4/13/1/7 — "Parado" enfim populada.
Parecia certo.

**v3 — de volta a %-primeiro (PR #202).** Vendo **no app com dado real**, "Atrasado/Parado" agrupava
`I Shall Master This Family` (95%, 79d) e `The Remarried Empress` (81%, 100d) junto com % baixo — uma obra
quase terminada marcada como "atrasada" **confunde**. O Geners:

> "Tira 'Atrasado / Parado', importa muito mais a % de leitura do que a data."

Então: **a banda passa a dizer QUANTO FALTA LER (%)**; a recência vira textura. A diferença crucial pro
v1 não voltar a dar banda vazia: a banda de baixo é **% puro** (< 40%, sem exigir frieza) — as obras de %
baixo recentes agora populam "Muito atrás" (com a tag "recém-começou"), em vez de escaparem pra "No ritmo".

## 4. A regra final (%-primeiro)

Cortes como constantes ajustáveis no topo do arquivo. **A data não entra na classificação.**

```
gap == 0            → Em dia (uptodate)
pct >= 0.8          → No ritmo (onpace)        // faltam poucos capítulos
pct >= 0.4          → Desacelerando (slowing)  // 40–80% lido
senão               → Muito atrás (behind)     // < 40% lido, backlog grande
```

| Banda | Cor | Regra | Distribuição real |
|---|---|---|---|
| 🟢 **Em dia** | emerald | leu tudo (gap 0) | 4 |
| 🟩 **No ritmo** | lime | ≥ 80% lido | 10 |
| 🟠 **Desacelerando** | amber | 40–80% lido | 7 |
| 🔴 **Muito atrás** | rose | < 40% lido | 4 |

**Recência = textura, não banda:**
- Linha *"Última leitura: …"* em todo card.
- Tag *"recém-começou"* (`isRecentlyStarted`): `< 40% lido` **e** aberto nos últimos **14 dias**. Explica
  um % baixo sem rebaixar de banda uma obra que você só começou agora.

**Caso-chave:** `The Archduke's...` 93% lido, frio há 79d → fica em **No ritmo** (não "Muito atrás"). É
justamente o que o v2 errava.

## 5. Navegação (PR #202)

Pedido: *"alguma forma mais fácil de navegar — clicando e rolando, com abas".*

- A antiga faixa-resumo virou uma **nav FIXA (sticky, `top-0`)** no topo da lista.
- **Abas por banda** (bolinha + nome + contagem) + a **barra segmentada** — ambas **clicáveis**: clicar
  **rola suave** até a banda (`scrollIntoView`).
- A **aba ativa acompanha a rolagem** (scrollspy via `IntersectionObserver` sobre os `[data-band-state]`).
- Rola pra **primeira ocorrência** da banda no DOM ("Em andamento" vem antes de "Concluída").
- `scroll-mt-32` nas bandas reserva a altura da nav fixa pra o cabeçalho não sumir sob ela.

## 6. Implementação

Tudo em `components/reading/reading-list.tsx` (client), **sem migration e sem mudança de query** —
`lastReadAt` já vinha no `ReadingWork` via `user_work_state`.

- `classifyReadingState(work, result)` → devolve **só** o `ReadingState` (a regra da §4, sem data).
- `isRecentlyStarted(work, result)` → a tag "recém-começou" (< 40% + ≤ 14d).
- `groupIntoBands()` → agrupa por banda na ordem fixa; sem divisória (a de recência do v2 saiu).
- `ReadingStateSummary` → a **nav fixa** (§5): abas + barra clicáveis + scrollspy.
- `BandedGrid` → sub-cabeçalho colorido por banda; recebe `sectionKey` e marca cada banda com
  `id={band-<section>-<state>}` + `data-band-state` (âncoras da nav) + `scroll-mt-32`.
- `ReadingCard` → faixa de cor por estado (`bg-*`), barra + chip na cor do estado, linha "Última leitura"
  + tag "recém-começou".

### ⚠️ Armadilhas registradas

- **Faixa de cor via `bg-*`, NÃO `border-<cor>`.** A regra `* { border-color }` em `globals.css:113`
  (fora de `@layer`) sobrepõe as utilities do Tailwind v4 → `border-l-<cor>` é **morto** neste projeto.
- **Nuance de estado:** a banda reflete os capítulos **persistidos**. Editar o stepper atualiza o chip na
  hora, mas a obra só troca de banda no próximo refresh (não há refresh por edição — de propósito).
- **Infra:** martelar o dev server (curl + browsers headless em paralelo durante compile do Turbopack)
  **travou o next-server** (deadlock, 0% CPU). Precisou `kill` + `npm run dev` novo.

## 7. Verificação

- `tsc` + `eslint` **limpos (0 erros)**.
- Testado no app (preview temporário com mocks + Playwright no `playwright-core` do sidecar `comix-render`):
  clicar numa aba **rola** até a banda (medido 2181px → 154px) e marca a **aba ativa** (`aria-current`);
  a tag "recém-começou" só aparece em % baixo lido recentemente; obra 93% fria há 79d fica em "No ritmo".
- Distribuição real (`scratchpad/calibrate.mjs`) confere a §4.

## 8. Aprendizado central

**Não confie só na calibração — valide na UI real, e o gosto do dono é o árbitro.** A recência parecia o
eixo certo no papel (era o único que populava "Atrasado"); mas ver as obras empilhadas no app mostrou que
misturar "% alto + frio" com "% baixo" confunde. O usuário quer **quanto falta ler**. A data ainda ajuda —
como textura, não como eixo de banda.

## 9. Ideias futuras (não são pendências)

- Talvez uma 5ª banda **"Começando"** própria para os recém-começados de % baixo, em vez da tag.
- **Recalibrar** os cortes de % (`0.8` / `0.4`) ou o `RECENT_DAYS` (14) se a distribuição mudar —
  `scratchpad/calibrate.mjs` serve de molde.
- Abas de banda **por seção** (hoje a nav rola pra "Em andamento"); ou permitir isolar/filtrar uma banda.
