# LEITURA — Bandas de estado de leitura

> **Data:** 2026-07-20 · **Status:** ✅ entregue — **PR #200** (mergeado na `main`, commit `cd070d1`)
> **Escopo:** página `/leitura` (Acompanhamento) · arquivo único `components/reading/reading-list.tsx`
> **Marcação:** ✅ verificado no código/app · ⚡ achado empírico que mudou o desenho · ⚠️ armadilha registrada

---

## 1. O problema (pedido)

A página de acompanhamento mostrava um selo **binário** por obra: `Em dia` ou `N pra ler`. O pedido foi
**separar visualmente** as obras que se acompanha de perto das que estão pendentes — mas considerando a
**situação real**:

> "O usuário acompanha algumas obras religiosamente, mas em outras ele **desacelera e fica bem atrasado**
> em relação ao último lançamento. Precisa considerar `em dia`/`pendente` **mas também o % lido**
> (ex.: uma obra 20/21 ≠ outra 10/56)."

O binário não capta isso: 20/21 e 10/56 são ambos "pendente", mas são situações opostas.

## 2. O insight — não é 1 eixo, são 3

| Eixo | Mede | Vem de |
|---|---|---|
| **Gap** (falta 0?) | alcançou o último lançamento | `lançado − lido` |
| **% lido** | profundidade do backlog / o quão investido | `lido / lançado` |
| **Recência** | está *ativamente* lendo ou parou? | `last_read_at` (`user_work_state`) |

Um `%` baixo significa coisas **opostas** conforme a recência: 4/73 lida **ontem** = "comecei agora,
devorando"; 4/73 há **2 meses** = "larguei". Só a recência desempata.

## 3. Decisões de design (aprovadas via mockup + perguntas)

Fluxo: mockup em Artifact → aprovação → 2 decisões:

1. **Incluir o 3º eixo (recência)?** → **SIM.** Uma obra recém-lida com % baixo não é "atrasada".
2. **Como separar?** → **Bandas agrupadas** (sub-seções tituladas dentro de cada seção), não filtro nem
   lista plana com acento.

## 4. ⚡ O achado da calibração (mudou o desenho)

Rodei um script contra o banco (`scratchpad/calibrate.mjs`) com as **25 obras reais** do usuário. Com a
regra inicial (**%-primeiro**: `Atrasado` = % baixo), a banda **"Atrasado" ficava VAZIA**.

**Por quê:** as obras que o usuário largou **não têm % baixo** — têm % médio/alto mas **~4 meses sem
abrir**:

| Obra | % lido | Última leitura | Banda (regra %-primeiro) |
|---|---|---|---|
| I Wish I Could Have Two Beds | 81% | 116 dias | ~~onpace~~ ❌ |
| The Duke's Fluffy Secret | 69% | 116 dias | ~~slowing~~ ❌ |
| I Shall Master This Family | 95% | 79 dias | ~~onpace~~ ❌ |

Ou seja: o sinal que separa "religioso" de "desacelerou" — que é *exatamente* como o usuário descreveu o
problema — é a **recência**, não o %. As obras de % baixo dele são quase todas **recentes**
(recém-começadas).

**Conclusão:** a regra virou **recência-primeiro**. Frio → "Parado" (independe do %); o `%` vira
**textura** (tag "recém-começou" + ordenação dentro da banda).

## 5. A regra final

Ordem de avaliação (recência-primeiro), com os cortes como constantes ajustáveis no topo do arquivo:

```
gap == 0                         → Em dia (uptodate)
days > COLD_DAYS (45)            → Atrasado/Parado (behind)   ← PRIMEIRO, mesmo com % alto
pct >= ONPACE_PCT (0.8)          → No ritmo (onpace)          ← colado no front
days <= RECENT_DAYS (14)         → No ritmo; se pct < 0.4 → tag "recém-começou"
resto (15–45d, longe do front)   → Desacelerando (slowing)
```

| Banda | Cor | Significado |
|---|---|---|
| 🟢 **Em dia** | emerald | leu tudo o que saiu |
| 🟡 **No ritmo** | lime | lendo agora — ou colado no último capítulo |
| 🟠 **Desacelerando** | amber | esfriando — algumas semanas sem abrir |
| 🔴 **Atrasado / Parado** | rose | sem leitura há mais de ~6 semanas |

**Casos-chave que a regra acerta:**
- The Remarried Empress **81% mas frio há 100d** → **Parado** ("pausou perto do fim"), não No ritmo.
- 4/73 lida ontem → No ritmo (tag "recém-começou"); a mesma 4/73 há 2 meses → Parado.

**Distribuição real do usuário** (25 obras): Em dia 4 · No ritmo 13 · Desacelerando 1 · Parado 7.
A distribuição é **bimodal** (ou lê nos últimos dias, ou some ~4 meses) — por isso "Desacelerando" fica
pequena. É um retrato honesto do comportamento, não um bug (bandas vazias somem).

## 6. Implementação

Tudo em `components/reading/reading-list.tsx` (client), **sem migration e sem mudança de query** —
`lastReadAt` já vinha no `ReadingWork` via `user_work_state`.

- `classifyReadingState(work, result)` → `{ state, recentlyStarted }` (a regra da §5).
- `groupIntoBands()` → agrupa em bandas na ordem de engajamento; `sort` estável desce os "recém" pro fim.
- `BandedGrid` → sub-cabeçalho colorido (barra + label + contagem + hint) por banda; divisória
  *"lendo agora · ainda longe do front"* antes do subgrupo recém-começado.
- `ReadingStateSummary` → **faixa-resumo do topo**: barra segmentada + contagem por estado (só sem filtro).
- `ReadingCard` ganhou: faixa de cor por estado, barra de progresso + chip na cor do estado, linha
  *"Última leitura: …"*.
- `ReadingSection` deixou de envolver os filhos num grid 2-col (o `BandedGrid` já faz o grid por banda).

### ⚠️ Armadilhas registradas

- **Faixa de cor via `bg-*`, NÃO `border-<cor>`.** A regra `* { border-color }` em `globals.css:113`
  (fora de `@layer`) sobrepõe as utilities do Tailwind v4 → `border-l-<cor>` é **morto** neste projeto.
  O `border-l-amber-500/70` que já existia no card estava, na prática, invisível.
- **Nuance de estado:** a banda reflete os capítulos **persistidos**. Editar o stepper atualiza o chip na
  hora, mas a obra só troca de banda no próximo refresh (não há refresh por edição — de propósito).
- **Infra:** martelar o dev server (curl + browsers headless em paralelo durante compile do Turbopack)
  **travou o next-server** (deadlock, 0% CPU). Precisou `kill` + `npm run dev` novo.

## 7. Verificação

- `tsc` + `eslint` **limpos (0 erros)**.
- Renderizado no app via rota de preview temporária com mocks (removida antes do commit), screenshot
  headless (playwright-core do sidecar `comix-render`) confirmando as 4 bandas, cores, faixa-resumo e o
  caso "81% frio → Parado".
- Distribuição real conferida pelo script de calibração.

## 8. Ideias futuras (não são pendências)

- Talvez uma 5ª banda **"Começando"** própria, em vez de embutir os recém-começados em "No ritmo".
- **Recalibrar** os cortes (`RECENT 14d`, `COLD 45d`, `% 0.8/0.4`) se a distribuição mudar com o tempo —
  o `scratchpad/calibrate.mjs` serve de molde.
