# Backlog atual

> **Reconciliado em 2026-10-09 sobre `origin/main @ a8096c2`** (merge do #547); **atualizado no mesmo
> dia após o deploy da v38** (`origin/main @ 04884c2`, Next 16.4.0). Fonte única do que está ABERTO. Os documentos datados (`STATUS-*`, `PLANO-*`, `PLANO_INTEGRADO_SATORIA_2026-08-22.md`,
> `AUDIT_REPORT*`, notas `PROMPT-PROXIMA-SESSAO*` e `Auditoria/`) são HISTÓRIA: o que eles listam e
> não aparece aqui foi conferido e está encerrado, superseded ou foi absorvido abaixo.
>
> Marcação: **[fato]** conferido no código/git/banco nesta data · **[inferência]** dedução não
> medida · **[decisão]** escolha de produto registrada. Ao fechar ou abrir item, edite AQUI.

## Fazer agora

Nenhuma pendência conhecida exige ação imediata.

## Fazer depois

| Prioridade | Item | Motivo / estado | Custo · condição para retomar |
|---|---|---|---|
| **importante** | **Regra de Conteúdo Adulto do `c1` nunca foi à produção** | [fato] O artefato aprovado `v29+alvo11-c1` (base de V0, checkpoint-60 e retestes) traz "REGRA PARA ADULT_CONTENT — RUBRICA SUBSTITUÍDA": cena explícita **isolada = 7-8**, 9-10 exige recorrência/centralidade. Produção (`service.ts:459`, v32) diz o oposto: "uma única cena explícita basta → 9-10", e o piso por tag `EXPLICIT_FLOOR = 9` segue. O commit do rollout (`fe4138a`) cita Humor e compatibilização, não a regra adulta. [inferência] Não é regressão (a regra de produção é a de sempre), mas o que roda não é o que foi medido, e não há decisão registrada. | **frente própria (revisão completa da lógica de R18/Conteúdo Adulto), conduzida à parte** · decidir: foi intencional? Se não, adotar = `PROMPT_VERSION` novo + migration de `canonical_contract` + revisar o piso por tag + reavaliar obras afetadas (pago) |
| **importante** | **Proxies sem sessão: `/api/animeplanet`, `/api/comick/search`, `/api/comick/[hid]`** | [fato] `GET` sem checagem de sessão/papel chamando `fetchHtmlWithCfFallback` → FlareSolverr de produção. Qualquer anônimo pode fazê-la raspar AnimePlanet/ComicK (abuso de recurso; a máquina é de 1 GB). Único consumidor: `lib/external/client-fetches.ts` (fluxo do curador). Fonte: `AUDIT_REPORT-2026-07-08.md:323`. | US$0 · exigir sessão de curador nas 3 rotas + deploy |
| **importante** | **Trabalho e evidência só nesta máquina** | [fato] Branches sem cópia no remoto: `fix/eval-payload-contract`, `fix/phase3-healthcheck-propagation`, `feat/frozen-evaluation-replay` (61 commits, parada desde 09/09), `integration/a4-complete`, `audit/session-role-server-first`. Contêm A4 server-first, log de erros absorvidos, home sem "0 obras" com backend fora, contrato de payload. [inferência] `git cherry` superestima (o #512 levou parte por squash). Também: os NDJSON **pagos** do gate final da Arte (art4, 01/10) vivem só em `../animedb-art4/.pilot/`, sem relatório em `Auditoria/`. Disco ou worktree perdido = trabalho perdido. | US$0 · por branch: arquivar no remoto (push sem merge) ou descartar; copiar os NDJSON para `Auditoria/` |
| baixa | Embeddings OpenAI sem guarda | [fato] `lib/ml/embeddings.ts` faz `fetch` direto: sem `assertPaidCallAllowed`, sem linha em `ai_api_calls`. Só por ação explícita (painel ou "Gerar tudo"); centavos. | US$0 · `assertPaidCallAllowed()` antes do `fetch` |
| baixa | Desvio de documentação | [fato] O `CLAUDE.md` descreve `enforceR19AdultContentRule`/`enforceExternalContentRatingRule` (removidas na v22, `3cc25b0`) e "pornographic → 8" (o código usa 9,0); diz "ABERTO" o `.limit(2000)` do `/ranking`, resolvido em `68a1bba` (08/09); e trata a falha do `hiato-tipo-no-badge` como "defeito do `classifyPace`" (é o teste). Também defasados: o comentário `leitura-limitada` em `server/queries/ranking.ts:675`, o de `service.ts:88` (modelo default 4.6) e `Auditoria/INDICE.md` (parado em 21/09). | US$0 · corrigir o texto |
| baixa | `smoke:logado` vermelho antes de qualquer mudança | [fato] 4 falhas por piso de conteúdo: `/curation`, `/curation/model-metrics` e `/curation/requests` (7 elementos, mínimo 8) e `/my-list` do curador (5). Mesmas falhas e contagens no Next 16.4.0, no `main` em 16.2.11 e no commit da v37 ⇒ não são regressão do upgrade e não bloqueiam build nem produto. [inferência] Piso desatualizado ou estado da réplica local — não investigado. O custo real: o smoke pré-deploy deixa de distinguir quebra nova de ruído conhecido. | US$0 · investigar e recalibrar o piso (ou consertar a rota) |
| baixa | Teste `hiato-tipo-no-badge` com data vencida | [fato] Fixture `lastReadAt: "2026-08-10"` sem `now` fixo; desde 09/09 cai em "frio" pelo relógio real. Código e produto certos. Deixa a suíte vermelha de forma permanente, o que ensina a ignorar falha. | US$0 · passar `now` fixo |
| baixa | `scripts/gold-mae.ts` defasado | [fato] Pesos de 07/2026 e chave `fantasy_nobility`; não conhece `fantasy`, `setting_era` nem `angst`. É o instrumento de precisão contra o gold. | US$0 · atualizar antes de qualquer trabalho de prompt |
| baixa | Proveniência do Fly | [fato] Linhas com `runtime: fly` não trazem SHA/imagem. Sem incidente. | US$0 · gravar o SHA do build no runtime |
| baixa | Melhorias pequenas de UI/infra (do plano de 22/08) | [fato] Sem `loading.tsx` em `/my-list`, `/reading`, `/recommendations`, `/discover`, `/account`; catálogo de tags (72 KB) importado estaticamente em 2 componentes client; `mobile-nav` sem `/my-list`; `jsx-a11y` desligado; 84 usos de `text-[6–9px]`; sem telemetria de erro do cliente; sem refresh periódico de dados externos; `noUncheckedIndexedAccess` desligado. O resto estrutural do plano (C1–C5, D1, D2, pushdown do `/ranking`, F3/F4, G1–G6) segue lá como referência. | US$0 · quando a área for tocada |
| baixa | Limpezas | [fato] `MoodBar` sem nenhum render (o `?mood=` só por URL); `LOW_EVIDENCE_CONFIDENCE_CAP` disparou 0 vezes em 2.296 avaliações; flags do shadow A/B do Interesse (`INTEREST_SHADOW`) ainda no código; avaliação `failed` gravada sem `prompt_version`; `work_tags.source` sempre nulo; `lib/supabase/admin.ts` sem `import "server-only"`; `.local-experiments` fora do ignore do ESLint; colunas legadas da Nota.Calc (`calc_score`, `mae_calc`, `rmse_calc`) no schema; `works_owner` (view) entra no backup duplicando `works`; `MAPA-DADOS-E-ROADMAP.md` ainda descreve o Alinhamento 40/30/30. | US$0 · oportunístico (a das colunas exige migration) |
| baixa | `scripts/egress-baseline.mjs` quebrado | [fato] `logs.all` foi removido pelo Supabase (410); o endpoint novo não aceita `edge_logs` como o script usa. | US$0 · só se a frente de egress reabrir |
| futura | P6 — ilustrações de `setting_era` e `angst` | [fato] `ATTRIBUTE_ART_PENDING` em `lib/criteria/glossary.ts`. **Não é a Arte por IA.** A arte de `fantasy` é cópia byte a byte da de `fantasy_nobility` (provisória), e os `nobility-*.webp` ficaram órfãos. | design |

## Riscos latentes

Existem, mas não justificam frente agora. Corrigir quando o código for tocado ou o gatilho disparar.

- **Paginação em scripts:** app, backup (#546) e `ai-review-adult-uncertain` (#547) protegidos; ~39
  scripts com `.range()` sem `.order()` (contagem grosseira). Corrigir quando cada um for tocado; não
  abrir campanha.
- **Bypasses pagos em scripts manuais:** `synopsis-prompt-lab`, `piloto-flashforward` (os dois com alvo
  LOCAL), os 6 que usam `scripts/lib/ai-log.js` (registram custo, sem guarda; usados 1× em 07/2026) e
  os 2 do Pilot 2 (legado, com `--execute` + assinatura + teto). Corrigir quando tocados.
- **Transição Fantasy/Nobility:** o slot `fantasy` lê `fantasy_nobility` quando existe (Strategy B);
  obra nova usa `fantasy` real como fallback → pequeno viés em obra nova com nobreza forte. Impacto
  medido não justificou mudança. A Strategy B sai quando as rotuladas tiverem `fantasy` real
  ([fato] hoje 36 de 238).
- **Tooltip do Radix sem `TooltipProvider` global:** só providers locais; esquecer um derruba a página.
- **`contentRatings` só em runtime:** mudança em `CONTENT_RATING_BOUNDS` não tem backfill possível.
- **Migrations não reconstroem o banco** (sem `CREATE TABLE` de `criteria` etc.; dois `132_*`).
  Mitigado pelo `schema.sql.gz` do backup semanal.
- **Comix sem descoberta automática de hid:** obra nova precisa de hid manual ou ausência declarada
  (aba Fontes), senão "Preparar e avaliar" bloqueia.
- **Tamanho do banco no plano free:** [fato] 227,5 MB de 500 (≈45%) com 1.065 obras ativas — igual a
  22/08. Teto estimado em ~2.500 obras.
- **Dados só-locais (P4 da auditoria de 23/09):** `ai_api_calls` de experimento já sincronizado;
  reviews só-locais nunca provadas por linha. Não rodar `db:pull` sem comparar antes.
- **Arte por IA:** a metade negativa da escala (`BELOW_AVERAGE`) nunca apareceu na amostra validada, e
  nenhuma tela lê `ai_evaluation_art` ainda. Sem efeito hoje; pesa no dia em que a Arte for exibida.
- **Advisories transitivos de build:** [fato] `nanoid` e `source-map-js` seguem com advisory **high**
  (via `postcss`/`@tailwindcss/postcss`) e não entram no standalone de runtime. Risco baixo; corrigir
  oportunisticamente.
- **Gatilho — patch de segurança do Next anunciado para 14/10/2026:** quando sair, rodar
  `npm audit --omit=dev`; abrir frente só se houver patch aplicável ao SatorIA.

## Deferidos por custo/decisão

| Item | Estado | Condição para retomar |
|---|---|---|
| **Cobertura v32 / Arte por IA** | [fato] Arte na mesma chamada desde a v32 (05/10): 43 linhas (15 com nota, 27 abstenções, 1 inválida). Ampliar = reavaliar (pago). | autorização de gasto |
| **P3 — Fantasia exibida herdada** | [fato] 98 obras de nobreza sem magia: 23 reavaliadas (todas caíram ≥3; Δ médio −5,83), **75 herdadas, 60 com seed ≥ 7**. Não afeta o cálculo (Strategy B). ~US$3,3. As 49 do grupo inverso: erro medido = ruído. | autorização de gasto |
| Contradições lógicas no prompt `v32` | [fato] `couple_dynamics`: `service.ts:400` × regra própria (~:479), fora das isenções "≥5"/"recorrente", e "vínculo mais central" × "nesta ordem de prioridade" nas faixas; `tragedy` (`service.ts:490` × `criteria.ts:139`); `humor` 0-3 "tom sério" × "tom sério NÃO é critério" (`service.ts:471`) — a faixa errada aparece ao leitor em `/guide/attributes`; fresta de meio ponto e "0-4 RESERVADAS". Diagnóstico de `couple_dynamics` já no `CLAUDE.md` (v23 revertida). Corrigir = `PROMPT_VERSION` novo + migration de `canonical_contract` + piloto pago, e o gold (piso 0,10) não enxerga ganho de ~0,05. Agrupar com a decisão da regra adulta do `c1`. | instrumento capaz de medir (e `gold-mae.ts` atualizado) + autorização de gasto |
| Onda B restante do plano de 22/08 | B2 (trace congelado da avaliação — há um replay só na branch local `feat/frozen-evaluation-replay`), B3–B6 (ablação de fontes do input do LLM), B8/B9 (`unknown` × 5, confiança por atributo), B12–B15 (rubricas tipadas, prompt gerado). Parcialmente superseded pelo caminho v32. | nova frente de qualidade da IA |
| Gate de 18+ separado do score (decisão de 29/08) | Só parcial: `r19_edition` (mig 199). Os estados `none/r18_only/mixed` com dois scores não existem. | decisão de produto |
| Backup gerenciado (Supabase Pro, US$25/mês) | [decisão 22/08] adiado. [fato] PITR desligado; backup local semanal ativo (último 04/10, com schema). | decidir fora de incidente; ou banco perto do teto |
| SMTP / recuperação de senha em produção | [decisão 19/08] retomar pelo domínio + Resend, não pelo Gmail. [fato] 2 contas, ambas da dona; cadastro não depende de e-mail. | primeira conta real que não seja da dona |
| Multiuser: Passo 2 (`works_owner`), Fase 3 (`calculated_scores` per-user, `attribute_bias` hierárquico, config per-user) | [decisão 14/07] adiado. | primeiro assinante real |
| Pedidos de curadoria: faixa do `create_by_name`, "meus pedidos", "Atendi" × "Descartar" | [fato] 1 pedido em toda a história. | 2º pedido vindo de conta que não seja a dona |
| Crédito/débito do leitor (free × pago) | [fato] `roles.ts`: sem mecanismo de débito, crédito não libera nada. | modelo de cobrança |
| Compilador de preferências (Peça 1), gosto segmentado "2º momento", eixo de trope, decidir Chance/Bússola | [decisão] cada um adiado com motivo no próprio plano/memória. Chance/Bússola espera ≥30 previsões resolvidas; as coortes prospectivas congeladas em `Auditoria/gate-prospectivo-ledger/` não têm análise registrada. | o gatilho de cada um |
| Paleta do `WorkQueueCard` × `STATUS_TONE` | [decisão 15/08] inventário pronto, travado em 3 perguntas de design. | decisão de design |

## Encerrados recentemente

Não reabrir sem evidência nova e concreta.

- **Segurança do Next (09/10/2026):** `next` 16.2.11 → 16.4.0 e `eslint-config-next` 16.2.4 →
  16.4.0 (PR #548, merge `04884c2`), publicado na **v38**. Zero advisories críticos conhecidos do
  Next após o bump; `postcss` e `sharp` também saíram. O mesmo deploy publicou o #544 e o #545 — o
  Fly deixou de estar atrás do `main`.
- **Recalc/scoring:** guarda canônica do recalc (#545) e das chamadas pagas (#520); `recalc_pending`;
  contrato `s9-fantasy-b-v1` + `canonical_contract` (mig 202, `enforce=true`); Nota.Calc aposentada
  (não é calculada nem gravada; colunas legadas ficam — ver Limpezas).
- **Egress:** encerrado em 05/10 (#525–#532, −59%). P4c/P3b/cache são opcionais.
- **Fontes:** provenance e false-zero do Mangago (#542), falhas da Comix (#543), `qejnx → 206ek`,
  `3ey50` validado, FlareSolverr GRU/min0/watchdog, local-first na curadoria.
- **Segurança/operação:** `SUPABASE_ACCESS_TOKEN` antigo revogado (novo, escopado e só-leitura; o Fly
  não usa esse token); `backup-db.mjs` com paginação pela PK (#546); `ai-review-adult-uncertain` exige
  `--execute`, passa pelo wrapper central e pagina pela PK (#547).
- **`/ranking` `.limit(2000)`:** resolvido em `68a1bba` (08/09) — leitura paginada.
- **Auditoria inicial (23/09):** P2 encerrado (producer de 11 rodou; comparação 9×11 feita em 24–25/09).
  P5 encerrado no app (G-ORD, 26/09). **P7 eram 2 avaliações `failed` de *Lift My Curse, Sir Knight*,
  não testes** — a obra foi reavaliada na v30. P3 e P6: ver acima.
- **Plano integrado de 22/08:** A1a/A1b (modelo e registry), A2/E2 (cascata de recalc), D3, B5.4
  (fronteira textual de reviews) e A3 parcial (telas de erro + `onRequestError`) feitos; `xlsx`/
  `papaparse` removidos. P1 (Onda B) superseded pelo caminho v32; o que sobrou está nas tabelas acima.
- **Docs superseded:** `STATUS-2026-06-28`, `STATUS-UNIFICADO-2026-07-11`, `AUDIT_REPORT*`,
  `PLANO_INTEGRADO_SATORIA_2026-08-22` e as notas locais `PROMPT-PROXIMA-SESSAO*` (executadas antes de
  23/09) — ficam como história.
