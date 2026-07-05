# Resiliência do Comix ao adicionar/atualizar obra

Branch: `feat/comix-resilience` (a partir de `main`).
Data: 2026-07-04.
Escopo: **backend** (server actions + 1 ajuste de UI). Não é layout.

---

## 1. O problema

Toda chamada ao Comix (detalhe SSR de `/title/{hid}`, reviews `/threads/*`) passa pelo
**FlareSolverr**, que resolve o desafio Cloudflare usando uma sessão persistente
(`"comix"`). Quando essa sessão **expira ou o FlareSolverr cai**, as chamadas falham.

Fluxo antigo ao adicionar/atualizar uma obra:

1. Você cola o hid (ou URL) da Comix e manda salvar.
2. `validateComixHid()` valida o hid chamando `fetchComixById()` via FlareSolverr.
3. FlareSolverr fora → retorna `null` → **`toast.error("Falha ao validar o hid da Comix")`**.
4. Você ia em **/settings → "Testar agora"** (que reaquece a sessão), manualmente, até
   voltar a funcionar, e só então re-tentava salvar.

Ou seja: um erro bloqueante + um loop manual de "testa, espera, tenta de novo".

---

## 2. A solução — "salva já + resolve em background com auto-warm/retry"

Duas decisões de produto (escolhidas pelo usuário):

- **Fase 1 (bounded):** o retry roda por alguns minutos e para (não é durável entre
  restarts — ver §6).
- **Aceitar hid otimista:** com o Comix fora, o hid é aceito e salvo assim mesmo; os
  dados (capa/sinopse/reviews) vêm depois, no background.

Comportamento novo:

1. Você cola o hid e salva **na hora**, mesmo com o FlareSolverr fora.
2. Em background, o app **reaquece a Comix sozinho** (o mesmo que o botão "Testar
   agora" faz) num loop com backoff, até a conexão voltar.
3. Quando volta, preenche capa/sinopse/rating/reviews da obra **sem você re-tentar
   nada manualmente**.

---

## 3. As mudanças (3 arquivos, +93/−2)

### `server/actions/comix-resolver.ts`

- **`ensureComixReady({ maxAttempts = 6 })`** _(novo)_ — loop que:
  - checa `getComixStatus()`; se já `"ok"`, retorna na hora (barato);
  - senão roda o **warm** = `checkComixHealth()` (o canário do "Testar agora", que
    reaquece o FlareSolverr + a sessão `"comix"`);
  - re-checa; se não subiu, espera (backoff `3 → 8 → 20 → 45 → 90s`) e tenta de novo,
    até `"ok"` ou esgotar as tentativas. **Bounded** (não trava pra sempre).
- **`resolveComixDataResilient(workId)`** _(novo)_ — `ensureComixReady()` →
  `enrichComixDataForWork()` (grava capa/sinopse/rating, não-destrutivo) + recalcula
  a nota se o rating mudou. É o "resolve em background" do salva-já.
- **`validateComixHid()`** — se o hid **não resolve** mas a **infra está fora**
  (`isFlareSolverrCircuitOpen()`, ou `flareSolverrHealth()` falha, ou
  `getComixStatus() === "down"`), retorna `{ ok: true, hid, pending: true }` (aceita
  otimista). Se a infra está **OK** e mesmo assim não resolve → erro real (hid errado),
  como antes.
- **`resolveComixHidForWork()`** — se a obra **já tem hid** (vínculo manual, via
  `getComixResolutionStatus()`), pula a descoberta por Puppeteer/Chrome e vai direto
  pro `resolveComixDataResilient()` (não depende de Chrome). Sem hid → descoberta +
  `ensureComixReady()` + enrich, como antes.

### `server/actions/works.ts`

- Em **`updateWorkExternalData()`**: se `updates.externalIds?.comix` está presente,
  dispara `after(() => resolveComixDataResilient(id))`. Cobre o caminho de
  **atualização** (update-data-dialog / `onDuplicateUpdate`). A **criação** já é coberta
  pelo `resolveComixHidForWork()` no `after()` do `createWork()`.

### `components/titles/external-search.tsx`

- Em **`handleAddComixManual()`**: trata `res.pending`. No caso otimista, vincula o hid
  do mesmo jeito e mostra `toast.warning("Comix instável — hid vinculado, os dados vêm
  em segundo plano quando a conexão voltar")` em vez do erro bloqueante.

---

## 4. Peças reusadas (nada reinventado)

| Peça existente | Papel aqui |
|---|---|
| `checkComixHealth()` | o **warm** (reaquece FlareSolverr + sessão) |
| `getComixStatus()` (comix-gate) | o **gate** — sabe se está `ok`/`degraded`/`down` |
| `enrichComixDataForWork()` | grava capa/sinopse/rating (não-destrutivo) |
| `getComixResolutionStatus()` | detecta se a obra já tem hid |
| `resolveComixHidForWork()` / `after()` | ponto de background que já existia |

---

## 5. Verificação

- `npx tsc --noEmit` + `npx eslint` nos arquivos tocados → **limpos**.
- Dev real na `:3005` (worktree própria) → `GET /titles/new` = **HTTP 200, sem erro de
  compile** (o `"use server"` do `comix-resolver.ts` passou — só funções `async`
  exportadas).
- ⚠️ **Não exercitado ponta-a-ponta com o FlareSolverr fora** (difícil simular pelo
  form). Validar no cenário real: colar um hid quando o FlareSolverr estiver expirado e
  confirmar que (a) salva sem erro, e (b) os dados aparecem sozinhos quando volta.

---

## 6. Limitação conhecida & Fase 2 (adiada)

O retry roda dentro do **`after()`** do Next.js — continua após a resposta HTTP, mas
vive **na memória do processo do servidor**. Se o servidor **reiniciar** (deploy, crash,
reload do dev) **enquanto** o loop ainda tenta, o loop **se perde** e não retoma. A obra
fica sem os dados do Comix até algo tocá-la de novo.

- **Fase 1 (entregue):** tenta por ~3 min e para. Cobre o caso comum (sessão do
  FlareSolverr expira → um reaquecimento resolve em segundos/1-2 tentativas).
- **Fase 2 (não feita):** persistir as obras pendentes no banco (reusando
  `getWorksMissingComixHid`) + um worker no boot/cron que retenta "de verdade" até dar
  certo, sobrevivendo a restarts. Mais código/infra.

---

## 7. Como rodar/testar

```bash
cd /Users/geners/Code/VibeMatch/animedb-comix-resilience
npm run dev            # sobe na :3001 desta worktree
# ou, pra não colidir com outro dev server:
npm run dev -- -p 3005
```

Gotcha: **não symlinkar** `node_modules` de outra worktree — o Turbopack rejeita
("points out of filesystem root"). Rode `npm install` na worktree (é rápido com cache).
