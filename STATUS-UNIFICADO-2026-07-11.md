# STATUS UNIFICADO — SatorIA / VibeMatch

> **Data:** 2026-07-11 · **Atualizado:** 2026-07-12 (ver **§0** — fontes externas; tema **G** reescrito)
> **Escopo:** consolidação de TODAS as pendências dos registros da última semana (2026-07-01 → 07-10).
> **Fontes:** PLANO-MULTIUSER, PLANO-ARQUITETURA-NOTAS, AUDIT_REPORT-2026-07-08 (canônico), PLANO-MESTRE (§24m–o + banner 07-09), STATUS-2026-06-28, PLANO-BUSSOLA-3-FORCAS, PLANO-INTERESSE-PREFS-CONFIANCA, PLANO-LABELS, PLANO-AI-EVALUATION-REDESIGN, STALENESS-MATERIALIDADE, DEPLOY-FLY, COMIX-ARCHITECTURE, DESIGN-MANGAGO-RESOLVE.
> **Marcação:** ✅ verificado no código/git hoje · 📄 vem do doc/memória (não re-verificado) · ⚠️ contradição/erro detectado.
>
> Este arquivo é um **snapshot de reconciliação**, não substitui os planos temáticos. Prioridades: **P0** bloqueia deploy ou arrisca corromper dados · **P1** destrava valor/decisão · **P2** dívida/melhoria · **P3** deferido.

---

## 0. Atualização — 2026-07-12: fontes externas honestas

> **Escopo:** PRs #101–#113 (todos mergeados). Tema **G** foi reescrito; o resto do documento
> segue válido. Marcação: ✅ verificado no app rodando · 📊 medido.

**O fio condutor:** todo bug desta leva tem a mesma assinatura — **não dá erro**. Devolve HTTP 200,
HTML válido, um resultado plausível, e está errado. Nenhum log dispara. Só se descobre medindo o
**desfecho**, não a mecânica.

### O que foi feito

| # | O quê | PR |
|---|-------|-----|
| 1 | **Fontes param de se disfarçar de match.** Fonte fora do ar e palpite de slug (AnimePlanet) viravam "match 95–100% com capa" — indistinguíveis de um match real. Conceito novo: `SourceCandidateOption.unconfirmed: "source-down" \| "slug-guess"`. | #102 #105 |
| 2 | **Canário das fontes atrás do Cloudflare** (`/settings`). Pergunta "os dados chegam agora?", não "o container respira?". Mangago e AnimePlanet dão `403 cf-mitigated` no fetch direto — **dependem** do bypass. | #107 |
| 3 | **MyAnimeList voltou.** A causa nunca foi o MAL: era o **Jikan** (scraper de terceiros) em 504 enquanto `myanimelist.net` respondia 200. Metadados → **API oficial v2** (`MAL_CLIENT_ID`, ~250ms); reviews → **scraping direto** (a v2 não tem reviews). **`jikan.ts` foi apagado.** | #101 #108 #109 |
| 4 | **Sidecar `comix-render` funciona.** Ele **já existia** (23 testes) e nunca resolveu nada: faltavam 2 linhas. Destrava o hid automático da Comix E **substitui o FlareSolverr**. | #111 #112 |
| 5 | **Backfill do apagão do Jikan.** 31 notas + 229 reviews recuperadas. Custo de IA: zero. | #113 |

### 📊 Medições que mudam decisões

- **O MAL é a fonte com mais votos do catálogo** (371k em "Solo Leveling" vs 121k do AniList). Com o Jikan em 504, a nota dele **não entrava** em `platform_ratings` — a média de plataforma rodava sem ela.
- **O impacto do backfill foi PEQUENO:** as 31 obras corrigidas moveram **0,029** em média (máx 0,11). Mediana de 180 votos ⇒ peso baixo no pooling bayesiano. **O susto era maior que o dano** — e só dava pra saber medindo.
- **O sidecar substitui o FlareSolverr:** com o container **derrubado**, a busca traz **8/9 fontes** (antes: 5/9 — sumiam ComicK, AnimePlanet, Mangago).
- **A Comix não é alcançável por fetch:** o token `_` **assina a query** (não dá pra forjar nem reescrever), e o FlareSolverr não executa SPA. Só browser real.

### ⚠️ Armadilhas registradas (todas falham em silêncio)

1. **Flags de automação matam o sidecar.** Com `--enable-automation` (default do Playwright), o app da Comix **não boota**: 200, 394KB de HTML, tela **vazia**. Parece "site fora do ar". → `ignoreDefaultArgs`.
2. **`content_rating` esconde metade do catálogo.** O default da busca da Comix é `[safe, suggestive]`: obra adulta **não aparece** e o nº 1 vira uma obra homônima **errada**. Formato: `content_rating=a,b,c` (singular, vírgula) — `content_rating[]=` (o formato da própria API!) é **ignorado** pelo front.
3. **O MAL ignora o slug, mas EXIGE o segmento.** `/manga/{id}/reviews` serve a página de **detalhe** (3 reviews de amostra) em vez das reviews. 200, HTML válido, dado errado.
4. **`preliminary=on` é obrigatório** nas reviews do MAL — review de obra em curso é filtrada por padrão, e o catálogo é majoritariamente manhwa em andamento.
5. **Supabase corta o `select` em 1000 linhas SEM AVISAR.** Me fez reportar "57 obras têm review" quando são **747**, e um backfill mirar em 22 obras quando o alvo eram **339**. **Sempre paginar** ou confirmar com `count: "exact"`.
6. **`docker stop flaresolverr` não segura:** o launchd `com.geners.flaresolverr-watchdog` (60s) o religa. Testar queda de fonte exige suspender o watchdog — senão o card "volta a funcionar" no meio da medição.

### Pendências abertas

| Pendência | Nota | Pri. |
|---|---|---|
| **Deploy no Fly** (app + sidecar) | O sidecar agora **de fato funciona** — antes seria deployar um serviço quebrado. | P1 |
| **Re-avaliação** das 91 obras com review nova do MAL | ~US$0,03/obra. **Decisão de produto:** escolher quais, não rodar lote. | P2 |
| Semântica do `down` da Comix | Cosmético — medido: **não bloqueia** a cascata (qualquer sucesso cura o gate em 295ms). | P3 |

### 🧭 Serviços em dev (macOS)

| Serviço | Como sobe | Papel |
|---|---|---|
| `comix-render` (`:8790`) | launchd `com.geners.comix-render` (RunAtLoad + KeepAlive) | Descoberta da Comix + bypass de Cloudflare |
| FlareSolverr (`:8191`) | Docker + launchd watchdog (polling 60s) | **Rede de segurança** — não é mais o único bypass |

---

## 1. TL;DR (estado em 6 linhas)

1. **Frente ativa hoje** = branch `feat/multiuser-foundation`, que virou o tronco e acumulou 3 assuntos (multi-user + gosto Fase 5 + ranking Faixas). ✅
2. **Ciência/scoring** está saudável no grosso (MAE ~0,55 vs baseline 0,73) mas é **ruído no fino** (σ ≈ MAE) — consenso dos dois audits. Nenhuma mudança de fórmula se justifica antes de acumular rótulos.
3. **A alavanca nº 1 é dado, não código:** a medição prospectiva tem **0 obras resolvidas** — ela trava as decisões de manter/matar Ridge/Chance/Bússola.
4. **Segurança está pela metade:** ✅ auth (middleware + `ensureAdmin`) feito na branch multiuser; ❌ **rate-limit (denial-of-wallet) NÃO existe**.
5. **Dívida de migrations é real e verificada:** existe **colisão de número na 132** (dois arquivos). Vários docs apontam a colisão errada (122).
6. **Working tree tem WIP não commitado** de 2 features distintas misturadas (piloto de gosto + grupos de favoritos).

---

## 2. Mapa de temas

| # | Tema | Status | Pendência dominante | Pri. máx |
|---|------|--------|---------------------|----------|
| A | Segurança & exposição | 🟡 metade feita | rate-limit inexistente | **P0** |
| B | Multi-user (partição per-user) | 🟡 fundação ok, Fase 2+ adiada | biblioteca própria por usuário | P1 |
| C | Migrations & reprodutibilidade | 🔴 dívida verificada | colisão 132 + migrations não auto-suficientes | **P0** |
| D | Medição prospectiva & decisão de modelo | 🟠 instrumentado, sem dado | 0 obras resolvidas | P1 |
| E | Backfills & batches IA | 🟠 parciais | G2 `runDigestBatch` nunca construído | P2 |
| F | Arquitetura de notas / gosto | 🟡 Fase 5 em código | migrar `pilot_taste_scores`→colunas | P1 |
| G | Deploy & fontes externas | 🟡 **fontes saneadas (07-12)**, deploy não executado | Fly deploy (o sidecar agora funciona — §0) | P1 |
| H | Higiene de código & working tree | 🟡 resíduos | commits soltos, código morto, testes | P2 |

---

## 3. Pendências por tema — abordagem & prioridade

### A. Segurança & exposição
| Item | Estado | Abordagem sugerida | Pri. |
|------|--------|--------------------|------|
| Auth nas ~39 server actions service-role | ✅ feito (`ensureAdmin` ×35, `middleware.ts`) | — (já cobre S1/F1) | — |
| **Rate-limit / denial-of-wallet (S2)** | ❌ inexistente ✅ | Middleware simples por IP+rota nas ações que gastam IA (`triggerAiEvaluation`, `generateAllWorkData`). Não precisa ser sofisticado; precisa existir antes de qualquer URL pública. | **P0** |
| Sanitização de reviews externos no prompt (S3) | 📄 aberto | Envelope/escape de bloco de review; baixo esforço, faz junto do próximo mexer em `service.ts`. | P2 |

### B. Multi-user
| Item | Estado | Abordagem sugerida | Pri. |
|------|--------|--------------------|------|
| Testar signup em aba anônima | 📄 única pendência aberta da fundação | Smoke test manual agora; é o "done" da Fase 1/3. | P1 |
| Fase 2 — partição per-user (Inc 0→5) | 📄 **adiada por decisão** | Manter adiada. Gatilho declarado: quando o produto exigir biblioteca própria por usuário. Começar por Inc 0 (dual-write helpers) quando reabrir. | P2 |
| `preference_rules` / `user_work_state` dormentes | 📄 mig 138 aplicada mas nada lê | Só ativar junto da Fase 2 — não deixar tabela órfã virar dívida silenciosa. | P3 |
| Stopgap C sem teste com sessão logada não-admin | 📄 | Cobrir no mesmo smoke test do signup. | P2 |

### C. Migrations & reprodutibilidade
| Item | Estado | Abordagem sugerida | Pri. |
|------|--------|--------------------|------|
| **Colisão de número na migration 132** | ⚠️ ✅ dois arquivos: `132_chance_score.sql` + `132_criterion_score_presets.sql` | Renumerar uma para `133b`/próximo livre **antes de mais qualquer migration**. Ambas já aplicadas em prod → é higiene de histórico, mas quebra replay limpo. | **P0** |
| Migrations não auto-suficientes (D1) | 📄 `criteria`/`publication_status`/etc. criadas fora de migration | Versionar os `CREATE TABLE` faltantes numa migration idempotente. Sem isso, ninguém reconstrói o banco. | **P0** |
| Aplicar mig **126** (labels) + `sync-constants` | 📄 arquivo existe, aplicação pendente | Rodar no SQL editor; diff do sync deve sair limpo. | P1 |
| Aplicar mig **134** (pendências lidas /settings) | 📄 arquivo existe, aplicação pendente | Idem; valida badge some. | P2 |
| CHECK `category_scores.source` atrás do enum TS (D2) | 📄 | Alinhar enum ↔ CHECK num sweep. | P3 |

### D. Medição prospectiva & decisão de modelo
| Item | Estado | Abordagem sugerida | Pri. |
|------|--------|--------------------|------|
| **0 obras resolvidas** em `prediction_snapshots` | 📄 instrumentação ✅ (migs 135/136), dado 0 | **Usar o app.** É a única forma de destravar. Meta: ≥30 resolvidas + IC. Custo $0. | P1 |
| Decidir manter/matar Ridge, Chance, Bússola (P3 audit) | 📄 gated | **Não decidir antes do dado.** Congelar a discussão até ≥30 resolvidas. | P1 (bloqueado) |
| Deduplicar sinais colineares (C2/C3/C4/C5) | ⚠️ ver §4 | `personal_fit` persistido = `tag_overlap_net` (r=1,0) e `computePersonalFit` é morto ✅ → deletar o morto já (quick win); dedup dos demais espera medição. | P2 |
| Unificar mood (C6): preset-filtro × drawer | 📄 dois mecanismos incompatíveis | Escolher um; o drawer ±0,9 é imperceptível → provável candidato a cortar. | P2 |
| Headline inconsistente por tela (C7) | 📄 /ranking≠/recs≠Cards≠/favorites | Consolidar num único número headline atrás de flag, depois da medição. | P2 |
| Tooltip `~0,6` da view Faixas → `cv_mae` real | 📄 backlog | Troca de 1 string por valor de `formula_config`. | P3 |

### E. Backfills & batches IA
| Item | Estado | Abordagem sugerida | Pri. |
|------|--------|--------------------|------|
| **G2 `runDigestBatch`/`planDigestBatch` nunca construído** | 📄 reaberto | Construir o executor de batch de digest OU decidir formalmente que digest fica sob demanda. Hoje é buraco silencioso. | P2 |
| Re-prever ~344 obras antigas em v3 (e1 só 414/758) | 📄 | Lote único (~$3–5) OU sob demanda. Decisão de custo, não técnica. | P2 |
| Completar digest da cauda reviewável (~60–130) | 📄 cobertura ~62% | Junto do G2. | P2 |
| `review_digest` = ~50% do custo IA, sem cache (I1) | 📄 | Cache de resultado + reavaliar valor marginal (baixo no ranking). Quick win de custo. | P2 |
| `synopsis_quality_predict` em Sonnet (I2) | 📄 4 rótulos num modelo caro | Trocar por Haiku ou determinístico. Quick win. | P2 |

### F. Arquitetura de notas / gosto
| Item | Estado | Abordagem sugerida | Pri. |
|------|--------|--------------------|------|
| Migrar `pilot_taste_scores` → colunas `works.like_*_score` | 📄 "2º momento" | Migration + copiar ~193 rótulos + trocar leituras/escritas. Fecha a Fase 5. | P1 |
| Seed dos critérios `eval_type='Gosto'` via migration | 📄 hoje só DML manual | Versionar (senão vira mais um D1). | P1 |
| `sync-constants` gerar `lib/constants/taste-criteria.ts` | 📄 | Estender o gerador. | P2 |
| test-retest (~15 obras) | 📄 | Separar "gosto direto discrimina melhor" de ruído antes de confiar na régua. | P2 |
| Wirar as 3 pontes fortes (setting→fantasia, art→cor, tone→humor) | 📄 | No perfil + explicação das previsões. | P2 |
| Decidir "Gostei geral": 0–10 vs 5 níveis em produção | 📄 aberto | Decisão de produto. | P2 |

### G. Deploy & fontes externas
> **Reescrita em 2026-07-12** — ver §0. A premissa "código do sidecar pronto (PR #75)" estava
> **errada**: o serviço existia mas nunca funcionou (faltavam 2 linhas). Corrigido no PR #111.

| Item | Estado | Abordagem sugerida | Pri. |
|------|--------|--------------------|------|
| Deploy do app no Fly (`gru`) | 📄 checklist não executado | **Bloqueado por A (rate-limit) e C (migrations).** Fazer P0s primeiro. | P1 |
| Deploy sidecar `comix-render` + `COMIX_RENDER_URL` | ✅ **serviço FUNCIONA** (PR #111); roda em dev sob launchd | `fly deploy` + secret. Agora vale a pena: ele destrava a Comix E substitui o FlareSolverr. | P1 |
| Flag mangago (`MANGAGO_RESOLVE_ENABLED`) | 📄 código atrás de flag OFF | Manter OFF até validar em prod. | P3 |
| DEPLOY-FLY não cobre o sidecar comix | ⚠️ doc pré-Comix | Atualizar o checklist antes de executar. | P2 |
| Re-avaliação das obras com reviews novas do MAL | 🟠 decisão de produto | 91 obras ganharam review do MAL (PR #113). O ganho só aparece re-avaliando (~US$0,03/obra). **Escolher quais**, não rodar lote. | P2 |
| Semântica do `down` da Comix (`api_auth_required`) | 🟡 cosmético | O gate diz "Comix inutilizável", mas detalhe/reviews funcionam pelo SSR token-free. Medido: qualquer sucesso cura o gate em 295ms — **não bloqueia nada**. | P3 |

### H. Higiene de código & working tree
| Item | Estado | Abordagem sugerida | Pri. |
|------|--------|--------------------|------|
| Working tree: piloto de gosto + grupos de favoritos misturados | ✅ 8 arquivos não commitados | **Separar em 2 commits/branches.** Memória marca piloto como "não misturar". | P1 |
| Commitar STALENESS Parte B | 📄 código feito, sem commit | Commit isolado. | P2 |
| Commitar Shadow A/B (INTEREST_SHADOW) | 📄 | Commit + decidir se liga a flag. | P3 |
| Deletar `computePersonalFit` (código morto) | ✅ confirmado sem chamadores | Delete direto — quick win, remove doc≠código. | P2 |
| 3 testes quebrados (falta `CostConfirmProvider`) | 📄 harness, não bug de produto | Corrigir o setup do teste. | P2 |
| `.local-experiments` polui lint (~102 erros) | 📄 | Adicionar ao ignore. | P3 |
| `import "server-only"` em `admin.ts` | 📄 quick win do audit | Uma linha. | P3 |

---

## 4. Contradições, inconsistências e info incorreta

| # | Achado | Evidência | Gravidade |
|---|--------|-----------|-----------|
| 1 | ⚠️ **A colisão de migration é a 132, não a 122.** Vários registros (PLANO-INTERESSE) alertam de colisão na 122; ela é hipotética (a migration F1 `compiled_preferences` nunca foi criada). A colisão **real e presente** é `132_chance_score.sql` + `132_criterion_score_presets.sql`. | ✅ `ls supabase/migrations/132*` | **Alta** — aponta o problema pro número errado |
| 2 | ⚠️ **"P0 de segurança resolvido" é impreciso.** Auth foi feito, mas o P0 dos dois audits inclui **rate-limit**, que não existe. Está pela metade. | ✅ auth: `middleware.ts` + 35× `ensureAdmin`; rate-limit: 0 implementações | **Alta** — risco de denial-of-wallet se expuser |
| 3 | **STATUS-2026-06-28 e PLANO-MESTRE não sabem que o auth foi feito.** Ambos listam F1 (auth) como P0 aberto; a branch multiuser já o fechou (metade). Os docs de status pararam em 07-09, anteriores à fundação. | ✅ git log da branch | Média — reabre pendência já resolvida |
| 4 | **Header da PLANO-BUSSOLA diz "Fase 1 em andamento"; a feature está no ar** (Fases 1–3 ✅, Fase 4 NO-GO). O cabeçalho contradiz o corpo. | 📄 corpo do doc + memória (PR #70 em main) | Baixa — cosmético |
| 5 | **Nome do arquivo STATUS-2026-06-28 engana:** o conteúdo foi atualizado até 07-09. Data no nome ≠ data do conteúdo. | 📄 §0.0 do doc | Baixa |
| 6 | **`computePersonalFit` documentado como fórmula de 3 componentes, mas está morto e o valor persistido = `tag_overlap_net` (r=1,0).** Doc ≠ código (audit C3). | ✅ grep: só a definição, zero chamadores | Média — engana quem lê o doc de scoring |
| 7 | **AUDIT_REPORT.md (06-17) ainda no repo sem estar arquivado**, apesar de auto-declarado SUPERSEDED. Risco de alguém ler o obsoleto. | 📄 cabeçalho do próprio arquivo | Baixa — renomear p/ `.superseded` |
| 8 | **PLANO-MESTRE corpo §1–§22 congelado em 06-19**, estado real só nos addenda. Quem lê de cima pra baixo pega dado velho. | 📄 banners do doc | Baixa — já auto-sinalizado |

---

## 5. Oportunidades

| # | Oportunidade | Por quê | Esforço |
|---|--------------|---------|---------|
| O1 | **O trabalho de auth já feito fecha o maior P0 dos audits** — falta só rate-limit pra destravar o deploy público inteiro (tema G). | 1 item pequeno separa "não expor" de "pode expor" | Baixo |
| O2 | **Quick wins de custo IA prontos:** `synopsis_quality`→Haiku + cache no `review_digest` cortam boa parte do gasto (`review_digest` ≈ 50%). | Redução direta de $/mês, sem risco de qualidade medido | Baixo |
| O3 | **Deletar código morto (`computePersonalFit`, `.local-experiments`, `prediction.ts`)** limpa o lint e alinha doc↔código de uma vez. | Reduz ruído em toda auditoria futura | Baixo |
| O4 | **"Instrumentar e esperar" é a jogada de maior ROI:** só usar o app acumula `prediction_snapshots` e destrava as decisões de fórmula que hoje estão paralisadas — custo $0. | Substitui debate por evidência | Nenhum (uso) |
| O5 | **Consolidar migrations agora (colisão 132 + os `CREATE TABLE` faltantes)** enquanto o catálogo é pequeno é muito mais barato do que depois. | Dívida cresce com o schema | Médio |
| O6 | **A branch multiuser é o momento natural pra fechar A+C+G juntos** (auth já está lá; rate-limit, migrations e deploy são pré-requisitos do mesmo objetivo "subir público"). | Uma frente coerente em vez de 3 dispersas | Médio |
| O7 | **Régua de gosto (Fase 5) + Bússola convergem** para a mesma consolidação 6→3 forças — tratar como um único desenho evita retrabalho. | Os dois docs já reconhecem o acoplamento | — |

---

## 6. Sequência sugerida (o que fazer primeiro)

1. **Higiene imediata (hoje):** separar/commitar o working tree (piloto ≠ favoritos); deletar `computePersonalFit`; renumerar a migration 132 duplicada. *Baixo esforço, destrava o resto.*
2. **Fechar o P0 de segurança:** implementar rate-limit nas ações que gastam IA. *Única coisa entre você e o deploy.*
3. **Versionar as migrations faltantes (D1)** + aplicar 126/134. *Torna o banco reconstruível.*
4. **Fechar a Fase 5 do gosto:** migrar `pilot_taste_scores`→colunas + seed via migration.
5. **Deploy (Fly + sidecar comix)** — depois que 2 e 3 estiverem prontos.
6. **Usar o app** para acumular `prediction_snapshots` em paralelo a tudo. Só reabrir decisões de fórmula com ≥30 resolvidas.
7. **Quick wins de custo** (Haiku no synopsis_quality, cache no digest) quando tocar em `service.ts`.
8. **Adiado conscientemente:** Fase 2 multi-user, G2 `runDigestBatch`, Mangago flag, unificação de mood/headline (dependem de dado ou de decisão de produto).

---

## 7. Apêndice — índice dos docs-fonte

| Doc | Data | Papel | Ação recomendada |
|-----|------|-------|------------------|
| AUDIT_REPORT-2026-07-08.md | 07-08 | **Canônico** (achados) | manter como referência |
| AUDIT_REPORT.md | 06-17 | SUPERSEDED | arquivar (`.superseded`) |
| PLANO-MULTIUSER.md | 07-10 | WIP ativo | vivo |
| PLANO-ARQUITETURA-NOTAS.md | 07-10 | WIP (Fase 5) | vivo |
| PLANO-MESTRE-…-PLANO3.md | 07-09 | histórico + addenda | ler só addenda §24m–o |
| STATUS-2026-06-28.md | 07-09 | snapshot | **substituído por este arquivo** |
| PLANO-BUSSOLA-3-FORCAS.md | 07-07 | feature no ar | corrigir header |
| PLANO-INTERESSE-PREFS-CONFIANCA.md | 07-01 | Fase 0 só | vivo (F1–F12 TODO) |
| PLANO-LABELS-CENTRALIZADOS.md | 07-04 | code-complete | fechar (aplicar mig 126) |
| PLANO-AI-EVALUATION-REDESIGN.md | 07-02 | mergeado (PR #31) | histórico |
| STALENESS-MATERIALIDADE.md | 07-05 | código feito | commitar Parte B |
| DEPLOY-FLY.md | 07-06 | não executado | atualizar p/ incluir sidecar |
| COMIX-ARCHITECTURE.md | 07-07 | código (PR #75) | deploy prod |
| DESIGN-MANGAGO-RESOLVE.md | 07-07 | flag OFF | manter deferido |
