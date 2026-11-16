# Backlog atual

> **Reconciliado em 2026-10-09 sobre `origin/main @ a8096c2`** (merge do #547); **atualizado no mesmo
> dia após o deploy da v38** (`origin/main @ 04884c2`, Next 16.4.0); **Fase 2 das mixed encerrada em 2026-10-13**
> (Fly v49, migs 213–218, `origin/main @ 1ce140a`); **frente de qualidade das avaliações por IA registrada e proxies
> encerrados em 2026-10-21** (`origin/main @ 7d2c13be`); **mixed com R18 só nos extras e confirmação pela avaliação
> de IA em 2026-11-16** (#616, `origin/main @ 0b5ce742`). Fonte única do que está ABERTO. Os documentos datados (`STATUS-*`, `PLANO-*`, `PLANO_INTEGRADO_SATORIA_2026-08-22.md`,
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
| **importante** | **Qualidade das avaliações por IA — P1–P5 abertos** | [fato] Auditoria US$0 de 20/10 sobre o backup de 19/10 e Etapa 2 de 21/10. Cinco problemas-raiz, todos ABERTOS: **P1** intensidades e extremos comprimidos (10,0 nunca aparece; Romance: 15 obras com ≥ 9 antes do c1, 14 caíram; *Hooked* editada pela curadora de 7,5 para 9) · **P2** evidência útil fora do prompt (cota igual por fonte, ruído nas vagas, corte de 900 em 7 conectores, 6 conectores que transformavam erro em `[]` (todos corrigidos: MangaUpdates, linha abaixo; fórum do MangaDex, AniList, MAL, Kitsu e AnimePlanet em 14/11), 290 reviews perdidas antes do #575) · **P3** origem e edição da evidência (26% das tags `ai_inferred` sem marca; o prompt não conhece edição) · **P4** nota × justificativa × regra (piso de rótulo contra evidência; rótulo "Core Romance") · **P5** validação que não decide (gold de 9 colunas antigas, `gold-mae.ts` defasado). Etapa 2 (A×B×C, offline): redistribuir vagas com teto 12/fonte = parcialmente eficaz (15 de 50 extras com informação nova, +2,4% de custo); passar de 12 = ineficaz. [decisão] encerrar uma tentativa não encerra o problema. Registro, evidências e critério de resolução de cada raiz: `Auditoria/qualidade-avaliacoes-ia-2026-10/DOCUMENTO-MESTRE.md` (§10.A, §15, §17). | US$0 até nova autorização · próxima ação proposta, aguardando decisão: referência humana às cegas de Romance nas 15 obras (§15) · esta linha absorve, sem duplicar, os itens marcados "→ qualidade IA" abaixo |
| **importante** | **Mixed ainda sem Nota Prevista principal — curadoria residual (a automação já está ligada)** | [fato] Remedido em 16/11, depois do #616 e do recálculo: **12 mixed ativas sem previsão principal, e são exatamente as 12 com a R18 sem nota** (*Father, I Don't Want This Marriage*, *My Unexpected Marriage* e *Reforming the Obsessive Male Lead*, com R18 só nos extras; *My Brother's Boyfriend Fell for Me*, *I Have Never Abandoned the Tyrant*, *Lucia*, *Baroness Goes on Strike*, *The Glamorous Life of the Fake Mistress*, *I Became the Villain's Mother*, *Secrets of the Mystic Moonlit Library*, *Teach Me How to Desire*, *The Tyrant's Comfort Doll*). A natureza sexual da R18 delas não está confirmada, e a avaliação de IA de cada uma é de prompt anterior ao v32, então não confirma (#616). **R18 só nos extras deixou de ser motivo:** desde o #616 a padrão de quem vê 18+ é a R18 também nessas obras, e 7 das 10 ganharam previsão principal; a normal delas segue sem nota (10 de 12 normais sem nota), o que só afeta quem oculta 18+. **11 conflitos** da normal seguem (base 5,0 que a política não sustenta — 5 com natureza sexual não confirmada: *Baroness Goes on Strike*, *The Glamorous Life of the Fake Mistress*, *I Became the Villain's Mother*, *Secrets of the Mystic Moonlit Library*, *The Tyrant's Comfort Doll*; 3 padrão R17; 2 abaixo de R15; *Teach Me How to Desire*, rótulo desconhecido). *The Elegant Sea of Savagery*: rever se o explícito está só nos capítulos `.1` (a R18 `reused_existing` média sustenta a base 6 hoje). Fora das mixed, 4 obras ativas sem previsão principal: *Ero♥Märchen: Cinderella* e *Gold Metal Bet* (`skipped`), *You're More Dangerous for Me* e *Kadan of the Deep Forest* (nunca avaliadas). Registro do legado: `Auditoria/edicoes-mixed-2026-10-15/`. | US$0 · curadoria por obra ("Versões da obra…" ou avaliação); nenhum script a rodar · reavaliar as 12 com o prompt atual (~3,8¢ cada, ~US$0,46) resolve sozinho as que derem Conteúdo Adulto ≥ 9 sem piso de tag; as demais seguem para a curadoria |
| **importante** | **Regra de Conteúdo Adulto do `c1` nunca foi à produção** | [fato] O artefato aprovado `v29+alvo11-c1` (base de V0, checkpoint-60 e retestes) traz "REGRA PARA ADULT_CONTENT — RUBRICA SUBSTITUÍDA": cena explícita **isolada = 7-8**, 9-10 exige recorrência/centralidade. Produção (`service.ts:459`, v32) diz o oposto: "uma única cena explícita basta → 9-10", e o piso por tag `EXPLICIT_FLOOR = 9` segue. O commit do rollout (`fe4138a`) cita Humor e compatibilização, não a regra adulta. [inferência] Não é regressão (a regra de produção é a de sempre), mas o que roda não é o que foi medido, e não há decisão registrada. | **frente própria (revisão completa da lógica de R18/Conteúdo Adulto), conduzida à parte** · → qualidade IA: R6/E9/D5 (P3, P4) · decidir: foi intencional? Se não, adotar = `PROMPT_VERSION` novo + migration de `canonical_contract` + revisar o piso por tag + reavaliar obras afetadas (pago) · [decisão] 15/10: o campo CONDICIONAL da versão adulta das mixed (alvo explícito, de preferência categórico, grava `ai_evaluated` e substitui o piso inferido da adulta) entra NESTA frente, não antes · ⚠️ desde 16/10 a fronteira editorial das mixed DERIVA de `EXPLICIT_FLOOR` (`EDITION_EXPLICIT_THRESHOLD`): mexer nele move junto a validação da curadoria, o piso inferido e os conflitos das versões · ⚠️ desde 16/11 (#616) a avaliação de IA **confirma** a natureza sexual da R18 quando dá Conteúdo Adulto ≥ 9 (prompt em `AI_EVALUATION_VERSIONS_THAT_CONFIRM`, hoje só v32): com o `c1`, explícito pontual vira 7-8 e deixa de confirmar (*I Failed to Oust the Villain!* confirma hoje exatamente por "explícito ainda que tardio e pontual"). Decidir o limiar e a lista junto com o prompt novo; um teste reprova o `PROMPT_VERSION` fora da lista |
| **importante** | **Trabalho e evidência só nesta máquina** | [fato] 08/11: 11 branches locais têm commits que não estão em nenhuma branch do GitHub (`git log --branches --not --remotes=origin --source`); a maior é `feat/frozen-evaluation-replay` (worktree `animedb-a1f2`, parada desde 09/09). O WIP de `art2` (o art3 da Arte), `art4`, `avisos` e `baseline` virou commit LOCAL e os worktrees saíram; os NDJSON pagos do gate art4 estão em `Auditoria/piloto-arte-abc/gate-art4-ndjson-2026-10-01/` e os 2 backups da nuvem de 10/10 em `Auditoria/edicoes-mixed-fase2-local-2026-10-10/backups-nuvem-2026-10-10/`. Desde 08/11 tudo isso vai toda semana para `iCloud Drive/VibeMatch-copias/` em DMG criptografado, pelo agente de domingo (`scripts/backup-locais-icloud.mjs`, ensaio de 08/11: 555,6 MB antes da compressão). Sem cópia fora do Mac ficam, de propósito: os dumps `local-primary`, `pull` e `push-curation` (`copiaLocal: false`, com motivo). O que falta é proteção do Mac inteiro: o Time Machine estava falhando (Code=17). 🔴 O repositório no GitHub é **público**: arquivar no remoto publicaria material de auditoria. | US$0 · conferir a 1ª cópia semanal (`npm run backup:locais -- --conferir`) e então apagar a foto manual sem criptografia de 06/11; consertar o Time Machine; por branch: descartar ou manter local |
| **importante** | **Vínculo externo corrigido deixa dados da obra errada** | [fato] Exemplo de 23/10/2026: *The Little Princess and Her Monster Prince* estava ligada desde 15/05 a outra obra na Comix (`grkwk`). A coleta aceitava esses dados porque o vínculo estava confirmado, apesar do aviso "título não bate (0,65)" no log (`[hydrateAccept]`). Efeitos: uma review da outra obra guardada desde 14/07 e, no contexto de cada avaliação, a sinopse e a nota (9,0, 2 votos) da outra obra. A troca manual para `mkvz` corrigiu vínculo e nota, mas deixou 2 reviews do id antigo (uma delas gravada na própria atualização, minutos antes da troca). Segundo a curadora, as duas foram removidas por correção pontual no mesmo dia; preparação, backup e reversão estão em `Auditoria/qualidade-avaliacoes-ia-2026-10/artefatos/correcao-comix-little-princess-2026-10-23/`. A evidência congelada do piloto excluiu a sinopse e a nota. **Problema estrutural:** trocar o id externo não revê o que o id anterior trouxe. O que fica entra na avaliação por IA (o pool une reviews frescas e persistidas), no Resumo, no Digest, no embedding e nas recomendações, com notas e justificativas apoiadas em outra obra. [fato] O controle derivado não se corrige sozinho: o Resumo de 23:54 usou 1 das 2 reviews entre 92, e o gate de materialidade não regenera numa remoção desse tamanho. [fato] `work_reviews` guarda a fonte, não o id externo; separar o que veio do id antigo exige provar por texto, data e log de coleta. [inferência] Outras obras podem ter vínculos errados aceitos da mesma forma; não medido. | US$0 para desenhar · **frente posterior; não bloqueia o piloto** · menor solução suficiente: ao trocar o id, mostrar ao curador o que veio daquela fonte (reviews, nota, sinopse, capa, títulos), separar o comprovadamente errado do incerto, preservar o manual e as outras fontes, corrigir com backup e reversão e só regenerar Resumo/Digest/embedding com autorização · reaproveitar o fluxo de fontes (`markSourcesAbsent` e rejeição), `scripts/diag-external-ids-compartilhados.ts`, os gates de materialidade e o modelo da correção de 23/10 · relaciona-se ao P3 da qualidade IA (origem da evidência), sem duplicá-lo; não é o risco latente "Comix sem descoberta automática de hid" |
| **importante** | **Reavaliar as obras da limpeza de reviews alheias (08/11) e as avaliadas com pouca evidência** | [fato] Em 08/11 a limpeza removeu 202 reviews de outras obras em 22 obras (fases 0–2 de `Auditoria/qualidade-avaliacoes-ia-2026-10/VERIFICACAO-CONTAMINACAO-2026-10-28.md`). As fases seguintes nunca rodaram (14/11: nenhuma das 22 reavaliada desde a limpeza): 2b "Atualizar dados" nas 22 → "Preparar e avaliar" nas 18 com avaliação vigente contaminada → digest e tags nas 4 com vigente limpa → recálculo → conferência (`etapa4/verificar.py` no backup seguinte). Uma delas é rótulo de treino da Nota Prevista. [fato] 14/11: **106** obras têm avaliação vigente que leu menos de 4 reviews úteis (`evaluationContext.sourcedReviews`, texto ≥ 40); **76** já têm 4 ou mais hoje e **30** dependem do lote "Reviews do catálogo"; só 1 coincide com as 22. [fato] 14/11: só 63 das 1.076 avaliações vigentes estão na v32, e 801 obras ganharam reviews úteis desde a avaliação. [decisão pendente] reavaliar já (as 22, ou 22 + 76) ou esperar as mudanças de régua em aberto (regra adulta do `c1`, contradições da v32, P1–P5, Sonnet 5.5) e fazer uma passada única no catálogo, para não pagar duas vezes. | ~US$1,8 (22) · ~US$5–7 (22 + 76) · ~US$40–70 (catálogo inteiro) · decisão da curadora |
| média | **"Média externa" com dois números para a mesma obra** | [fato] 16/11: a página da obra imprime a média PONDERADA crua das plataformas; listas, `/ranking` e comparador imprimem `calculated_scores.platform_avg` (bayesiana, puxada para a média global). Divergem ≥ 0,05 em **927 de 1.085** obras ativas. Os votos batem (desde 16/11 os dois somam por `sumVotes`). | US$0 · decidir qual é a "Média externa" e derivar a outra dela, ou dar nomes diferentes |
| baixa | Proxy de imagens com 502 intermitente | [fato] `/api/image-proxy` devolveu 502 de forma intermitente em 11/11; não investigado. Capa que falha cai no fallback de candidatas (`coverCandidates`). | US$0 · investigar se voltar a aparecer |
| baixa | Erro não tratado de `scrollIntoView` na suíte | [fato] `components/titles/external-search.tsx:1238` chama `sourcepickBottomRef.current?.scrollIntoView(...)` dentro de `requestAnimationFrame`; o jsdom não implementa o método e o erro estoura depois do teste, como "Errors 1 error" no rodapé com todos os testes passando. Aparece em parte das rodadas da suíte inteira; conferido em 14/11 numa cópia limpa do `main`, então não vem de mudança recente. O custo: um erro real novo no rodapé passa a se confundir com este. | US$0 · `scrollIntoView?.(...)` no componente, ou um stub do método no setup dos testes |
| baixa | Mangago também detecta 404, mas não grava | [fato] `classifyMangagoPage` (`lib/external/mangago.ts`) reconhece a página 404, mas `fetchMangagoById`, `fetchMangagoReviews` e a checagem de capítulos achatam isso em `null`/`[]`. A marca da migration 222 serve a qualquer fonte e hoje só a Comix grava; um slug do Mangago morto continua contando como vinculado. [fato] Medido em 14/11 nas 44 obras com Mangago vinculado e nenhuma review dele (de 926): **1 slug morto**; 39 vivas sem discussão no Mangago; 4 com tópicos que o lote de reviews ainda não percorreu (`reviews_checked_at` nulo). 🔴 Slug morto responde **200 e vazio** na página de discussão, que é a única que a coleta de reviews abre: o 404 só aparece na página da obra (`/read-manga/`). | US$0 · [decisão 14/11] o slug morto (1 obra) fica como está: não há slug novo para colar · o desenho da Comix vale só na checagem de capítulos ou na hidratação, nunca na coleta de reviews; retomar quando aparecerem mais |
| baixa | Embeddings OpenAI sem guarda | [fato] `lib/ml/embeddings.ts` faz `fetch` direto: sem `assertPaidCallAllowed`, sem linha em `ai_api_calls`. Só por ação explícita (painel ou "Gerar tudo"); centavos. | US$0 · `assertPaidCallAllowed()` antes do `fetch` |
| baixa | Desvio de documentação | [fato] O `CLAUDE.md` descreve `enforceR19AdultContentRule`/`enforceExternalContentRatingRule` (removidas na v22, `3cc25b0`) e "pornographic → 8" (o código usa 9,0); diz "ABERTO" o `.limit(2000)` do `/ranking`, resolvido em `68a1bba` (08/09); e diz que o `hiato-tipo-no-badge` falha (passa de forma determinística desde o #578, ver Encerrados). Também defasados: o comentário `leitura-limitada` em `server/queries/ranking.ts:675`, o de `service.ts:88` (modelo default 4.6) e `Auditoria/INDICE.md` (parado em 21/09). | US$0 · corrigir o texto |
| baixa | `smoke:logado` vermelho antes de qualquer mudança | [fato] 4 falhas por piso de conteúdo: `/curation`, `/curation/model-metrics` e `/curation/requests` (7 elementos, mínimo 8) e `/my-list` do curador (5). Mesmas falhas e contagens no Next 16.4.0, no `main` em 16.2.11 e no commit da v37 ⇒ não são regressão do upgrade e não bloqueiam build nem produto. [inferência] Piso desatualizado ou estado da réplica local — não investigado. O custo real: o smoke pré-deploy deixa de distinguir quebra nova de ruído conhecido. | US$0 · investigar e recalibrar o piso (ou consertar a rota) |
| baixa | `scripts/gold-mae.ts` defasado | [fato] Pesos de 07/2026 e chave `fantasy_nobility`; não conhece `fantasy`, `setting_era` nem `angst`. É o instrumento de precisão contra o gold. → qualidade IA: P5 | US$0 · atualizar antes de qualquer trabalho de prompt |
| baixa | Proveniência do Fly | [fato] Linhas com `runtime: fly` não trazem SHA/imagem. Sem incidente. | US$0 · gravar o SHA do build no runtime |
| baixa | Melhorias pequenas de UI/infra (do plano de 22/08) | [fato] Sem `loading.tsx` em `/my-list`, `/reading`, `/recommendations`, `/discover`, `/account`; catálogo de tags (72 KB) importado estaticamente em 2 componentes client; `mobile-nav` sem `/my-list`; `jsx-a11y` desligado; 84 usos de `text-[6–9px]`; sem telemetria de erro do cliente; sem refresh periódico de dados externos; `noUncheckedIndexedAccess` desligado. O resto estrutural do plano (C1–C5, D1, D2, pushdown do `/ranking`, F3/F4, G1–G6) segue lá como referência. | US$0 · quando a área for tocada |
| baixa | Limpezas | [fato] `MoodBar` sem nenhum render (o `?mood=` só por URL); `LOW_EVIDENCE_CONFIDENCE_CAP` disparou 0 vezes em 2.296 avaliações; flags do shadow A/B do Interesse (`INTEREST_SHADOW`) ainda no código; avaliação `failed` gravada sem `prompt_version`; `work_tags.source` nulo em tudo que entra pelo formulário e pelo "Atualizar dados" (humano e fonte indistinguíveis; até 24/07 o formulário ainda apagava `ai_inferred`; → qualidade IA: E4); `lib/supabase/admin.ts` sem `import "server-only"`; `.local-experiments` fora do ignore do ESLint; colunas legadas da Nota.Calc (`calc_score`, `mae_calc`, `rmse_calc`) no schema; `works_owner` (view) entra no backup duplicando `works`; `MAPA-DADOS-E-ROADMAP.md` ainda descreve o Alinhamento 40/30/30.; `user_settings.preferred_mixed_edition` sem leitor desde o #562 (nula nas 2 contas); `title` do selo 18+ das obras não-mixed diz "nota de conteúdo adulto ≥ 7", mas o selo segue `is_adult` (tags fortes, override, `r18_only`/`unknown`) — falso hoje em 1 obra (sem nota); 3 jobs órfãos em `running` (2 `predict_interest_potential` de 17/08, 1 `generate_review_digest` de 27/09): os artefatos existem e o `claim()` os retoma, só inflam o contador "processing" do plano de backfill de Interesse | US$0 · oportunístico (a das colunas exige migration) |
| baixa | Suíte local vermelha por teste de `Auditoria/` | [fato] O `vitest.config.ts` não tem `include`, então o padrão do vitest pega os `*.test.ts(x)` da `Auditoria/` local (excluída do git por `.git/info/exclude`). Em 05/11: 7 arquivos, 5 testes falhando (dependem de `tmp-smoke-*`, de import de outro worktree e do estado do checkout), com **zero** falha em teste versionado. Ensina a ler vermelho como ruído. | US$0 · `exclude` de `Auditoria/**` no vitest (ou `include` explícito) |
| baixa | `scripts/egress-baseline.mjs` quebrado | [fato] `logs.all` foi removido pelo Supabase (410); o endpoint novo não aceita `edge_logs` como o script usa. | US$0 · só se a frente de egress reabrir |
| futura | **P2 — Revisar o limite global de 30 reviews por avaliação** (→ qualidade IA: P2) | [fato] O 30 foi herdado de decisões anteriores; nenhuma medição mostra que seja a capacidade ideal. A W3 (na `main` pelo #576, publicada em 23/10) aproveita melhor a capacidade, mas não a define. [decisão] O 30 fica provisoriamente. Aumentar não é objetivo por si. Leitores diferentes concordando são consenso legítimo e devem ser preservados mesmo sem informação inédita; cópias da mesma manifestação, não. Objetivo: descobrir quantas reviews dão à IA a melhor combinação de informação nova, corroboração e divergência, pesando qualidade da evidência, custo e texto enviado. Ao retomar: comparar offline 20, 30, 40 e 50 reviews; medir informação nova, corroborações e divergências preservadas e os sinais que deixam de ir; considerar relevância e ruído sem desvalorizar concordância; medir texto e tokens já truncados e o custo incremental; testar se um limite adaptativo traz benefício real. Não presumir que maior ou adaptativo seja melhor. Registro: `Auditoria/qualidade-avaliacoes-ia-2026-10/IMPLEMENTACAO-W3-DEDUP-2026-10-22.md`. | US$0 (offline) · retomar depois de E2 (relevância da seleção) e E3 (truncamento), de preferência antes de uma reavaliação ampla paga · não bloqueia a W3 nem o piloto v3 · validação paga só com autorização explícita |
| futura | P6 — ilustrações de `setting_era` e `angst` | [fato] `ATTRIBUTE_ART_PENDING` em `lib/criteria/glossary.ts`. **Não é a Arte por IA.** A arte de `fantasy` é cópia byte a byte da de `fantasy_nobility` (provisória), e os `nobility-*.webp` ficaram órfãos. | design |

## Riscos latentes

Existem, mas não justificam frente agora. Corrigir quando o código for tocado ou o gatilho disparar.

- **Inferência estrutural por versão (15/10), quatro pontas conhecidas:** [fato] (1) não há interface para
  devolver à automação uma versão que a curadoria marcou "sem nota" — só dando uma nota (o override
  humano é respeitado pela reconciliação; o que falta é o caminho de volta); (2) com erro na
  reconciliação, o recálculo mantém a pendência e reinicia a janela de 1h — a retentativa espera até 1h,
  de propósito, para não virar laço; (3) reclassificar o nível de uma tag (`server/actions/tag-review.ts`)
  não marca recálculo, então a inferência só acompanha no próximo recálculo por outro motivo; (4) o mesmo
  vale para a avaliação de IA que confirma a R18 (#616): `triggerAiEvaluation` não marca recálculo, só
  aceitar a revisão (`submitAiReview`) ou o "Gerar tudo" marcam.

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
- **"Não avaliado" por edição sem atomicidade de banco:** [fato] o controle "Edições da obra" troca
  nota → `not_rated` com DELETE…RETURNING + INSERT e, se o INSERT falha, reinsere a linha apagada
  (testado com falha real no banco local). Se a reinserção também falhar, a edição fica sem linha —
  erro explícito na tela e a linha inteira no log. Atomicidade de verdade = função SQL/RPC
  (migration); hardening futuro, não bloqueador (decisão de 12/10).
- **User-Agent fixo de Chrome 124 em 8 lugares:** [fato] ComicK, Anime-Planet, Mangago, Comix, reviews
  do MAL, política de capas (`cover-host-policy.ts`), `scripts/resolve-comix-hids.mjs` e o sidecar
  (`services/comix-render/src/config.ts`). Hoje funcionam; o MangaUpdates passou a recusar exatamente
  esse UA em ~06/2026, e outro site pode adotar a mesma regra. [fato] Adotou: o fórum do MangaDex passou a recusar QUALQUER UA de navegador (`Mozilla/5.0` → 403, desafio anti-robô) por volta de 23/10, e as reviews do MangaDex viraram zero sem aviso até 14/11, quando o fetch passou a ir sem o cabeçalho. [inferência, não testada] o sidecar roda
  um Chromium moderno (Playwright 1.61) declarando ser Chrome 124 — UA × client hints incoerentes é
  sinal clássico de robô e pode explicar por que ele não atravessa a Comix desde 29/07.
- **Tooltip do Radix sem `TooltipProvider` global:** só providers locais; esquecer um derruba a página.
- **`contentRatings` sem coluna própria:** o valor só fica no `raw_response` das avaliações que o registraram; mudança em `CONTENT_RATING_BOUNDS` não tem backfill pronto.
- **Migrations não reconstroem o banco** (sem `CREATE TABLE` de `criteria` etc.; dois `132_*`).
  Mitigado pelo `schema.sql.gz` do backup semanal.
- **Comix só se descobre por cross-ID:** [fato] o `/resolve` do sidecar acha a obra (8 de 8 em
  12/11, todas em 1º lugar) e o app casa por AniList, MAL ou MangaUpdates — este último só desde
  12/11, quando o código da URL passou a ser convertido em número. Obra que a Comix não liga a
  nenhum dos três segue precisando do hid colado (campo sempre visível na criação e no "Atualizar
  dados") ou de ausência declarada (aba Fontes), senão "Preparar e avaliar" bloqueia.
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
| Contradições lógicas no prompt `v32` (→ qualidade IA: A1, P4) | [fato] `couple_dynamics`: `service.ts:400` × regra própria (~:479), fora das isenções "≥5"/"recorrente", e "vínculo mais central" × "nesta ordem de prioridade" nas faixas; `tragedy` (`service.ts:490` × `criteria.ts:139`); `humor` 0-3 "tom sério" × "tom sério NÃO é critério" (`service.ts:471`) — a faixa errada aparece ao leitor em `/guide/attributes`; fresta de meio ponto e "0-4 RESERVADAS". Diagnóstico de `couple_dynamics` já no `CLAUDE.md` (v23 revertida). Corrigir = `PROMPT_VERSION` novo + migration de `canonical_contract` + piloto pago, e o gold (piso 0,10) não enxerga ganho de ~0,05. Agrupar com a decisão da regra adulta do `c1`. | instrumento capaz de medir (e `gold-mae.ts` atualizado) + autorização de gasto |
| Onda B restante do plano de 22/08 (→ qualidade IA: A5, A7, E5) | B2 (trace congelado da avaliação — há um replay só na branch local `feat/frozen-evaluation-replay`), B3–B6 (ablação de fontes do input do LLM), B8/B9 (`unknown` × 5, confiança por atributo), B12–B15 (rubricas tipadas, prompt gerado). Parcialmente superseded pelo caminho v32. | nova frente de qualidade da IA |
| Gate de 18+ separado do score (decisão de 29/08) | [fato] Feito para `mixed` (migs 204–218: estado editorial + nota e previsão por versão). Resta a semântica de `unknown` ("na dúvida, protege": liga `is_adult`): 3 obras hoje, 2 adultas, 1 adulta só por isso. | decisão de produto |
| Backup gerenciado (Supabase Pro, US$25/mês) | [decisão 22/08] adiado. [fato] PITR desligado; backup local semanal ativo (último 04/10, com schema). | decidir fora de incidente; ou banco perto do teto |
| SMTP / recuperação de senha em produção | [decisão 19/08] retomar pelo domínio + Resend, não pelo Gmail. [fato] 2 contas, ambas da dona; cadastro não depende de e-mail. | primeira conta real que não seja da dona |
| Multiuser: Passo 2 (`works_owner`), Fase 3 (`calculated_scores` per-user, `attribute_bias` hierárquico, config per-user) | [decisão 14/07] adiado. | primeiro assinante real |
| Pedidos de curadoria: faixa do `create_by_name`, "meus pedidos", "Atendi" × "Descartar" | [fato] 1 pedido em toda a história. | 2º pedido vindo de conta que não seja a dona |
| Crédito/débito do leitor (free × pago) | [fato] `roles.ts`: sem mecanismo de débito, crédito não libera nada. | modelo de cobrança |
| Compilador de preferências (Peça 1), gosto segmentado "2º momento", eixo de trope, decidir Chance/Bússola | [decisão] cada um adiado com motivo no próprio plano/memória. Chance/Bússola espera ≥30 previsões resolvidas; as coortes prospectivas congeladas em `Auditoria/gate-prospectivo-ledger/` não têm análise registrada. | o gatilho de cada um |
| Paleta do `WorkQueueCard` × `STATUS_TONE` | [decisão 15/08] inventário pronto, travado em 3 perguntas de design. | decisão de design |

## Encerrados recentemente

Não reabrir sem evidência nova e concreta.

- **Pendências de interface da lista de 16/11 (encerrado em 16/11/2026, #618–#626):** toast de reviews,
  votos do comparador, contagem e "Pular" da `/my-ai-scores`, erro do Interesse, rótulo de faixa em "Meu Status",
  diagnóstico da Comix (#618); criação em lote e enriquecimento que não esperava as reviews (#622); busca, console,
  data das reviews, Arte no comparador e pular em lote (#623); lotes de Fontes com N obras (#624); filtro padrão da
  aba Fontes = obras da sua lista (#625; Tags & Reviews e Digests sem padrão, por decisão); justificativa da Nota
  Prevista, "Por que esta nota?" (#626): mig 224 aplicada na nuvem antes do deploy de `01f255a4`, recálculo em
  seguida — **1.070 de 1.076 obras com nota têm a justificativa, 0 divergem da nota**; as 6 sem são arquivadas
  com nota antiga (o recálculo não passa por arquivadas).
- **Status de publicação pela TRADUÇÃO (encerrado em 16/11/2026, #619):** [decisão] status e capítulos são os
  da tradução disponível. Deploy de `10b403ed`, 3000 refeita, `scripts/status-pela-traducao.ts --execute` na nuvem:
  1.085 ativas → 1.070 com MangaUpdates → 1.053 lidas → **83/83 gravadas** (66 Completed → Ongoing, 10 Hiatus →
  Ongoing, 3 Cancelled → Completed, 2 Cancelled → Ongoing, 1 Ongoing → Completed, 1 Ongoing → Hiatus), estado
  anterior em `.backups/status-pela-traducao-2026-11-16T04-58-23-923Z/`, recálculo da nuvem concluído (1.085).
  Das 11 a 1 capítulo do original, a regra de tolerância (#621: total final no MangaUpdates + 90 dias sem
  lançamento) concluiu 1; 4 lançaram há pouco ou estão em hiato no MangaUpdates e seguem em andamento; **5 não
  têm a data do último lançamento** e só se resolvem quando o lote "Capítulos e status" as checar.

- **Servidor de desenvolvimento esquecido na 3001 (encerrado em 16/11/2026):** a porta estava livre na
  conferência de 16/11, sem processo escutando. O laço de recarregamento (HMR) de 11/11 não foi investigado;
  reabrir só se voltar a aparecer.
- **Mixed com R18 só nos extras abriam na normal para quem vê 18+ (encerrado em 16/11/2026, #616):** a regra
  de 12/10 contradizia a `read_edition = r18` gravada nas avaliações da conta principal. Hoje os extras só viram
  uma frase no seletor. No mesmo PR, a avaliação de IA mais recente com prompt v32, Conteúdo Adulto ≥ 9 e sem
  piso de tag ≥ 9 passou a confirmar a natureza sexual da R18. Deploy e recálculo em 16/11: a inferência gravou 1
  nota (*I Failed to Oust the Villain!*, R18 → 9) e 7 das 10 obras com R18 só nos extras ganharam previsão
  principal.

- **"Comix com problemas" no "Testar agora" e "Nenhuma novidade" com 53 de 55 obras não verificadas (encerrado
  em 15/11/2026, #613 e #614):** a Comix funcionava. (1) O `poster` passou a vir como caminho
  (`/images/covers/…`, servido por `comix.to`); repassado cru, derrubava a checagem de imagem do canário e
  gravou capa relativa em 5 obras de 12 a 14/11, corrigidas na nuvem no mesmo dia. Dono: `comixCoverUrl`.
  (2) A checagem de capítulos rodou em produção, onde a Comix barra o Fly com 403 e o Mangago não tem desvio
  do Cloudflare; do Mac, as mesmas páginas respondem 200 sem desvio nenhum. O aviso passou a só dizer
  "nenhuma novidade" sobre o que foi verificado (`checkOutcomeHeadline`), e sem desvio o botão fica
  desabilitado com o motivo (`hasCfBypassConfigured`). Junto, saiu do item "Desvio de documentação" a
  contradição do `CLAUDE.md` sobre a Comix.

- **Mangago estourando o tempo no lote "Reviews do catálogo" (encerrado em 14/11/2026):** na 1ª rodada longa do
  lote ele excedeu os 60 s em 91 de 152 obras, e o estouro descartava todas as reviews dele. Medido: 1,58 s por
  página (mediana de 2.893), ~70 s para 40 tópicos. Hoje `collectMangagoReviews` tem orçamento de 50 s
  (`MANGAGO_REVIEWS_BUDGET_MS`), cada página leva no máximo o que sobra dele, e o parcial volta como
  `partialFailure` (não é fonte em falha). Conferido no Mangago real: 27 reviews em 50,0 s numa obra com 40+
  tópicos, que antes entregava zero. O teto da orquestração seguiu em 60 s.
- **Códigos da Comix com 404 (encerrado em 14/11/2026):** a linha dizia "12 vínculos", que era o que o lote de
  capítulos de 11/11 tinha visto. A conferência de 12/11 (`scripts/conferir-links-comix.ts --execute`) marcou **23**.
  [fato] Em 14/11 os 23 têm código novo e nenhum código vinculado está marcado como morto
  (`not_found_external_id = external_id`: 0). A marca da migration 222 segue sendo gravada pelos lotes de
  capítulos e de reviews; código que voltar a dar 404 reaparece na lista "Código não funciona (404)".
- **Tempo do lote "Reviews do catálogo" (medido em 12/11/2026):** na 1ª rodada real, 6 obras levaram
  ~35 s cada (de 6 a 51 s: as com muitas reviews no Mangago ficam perto de 50 s), com 108 reviews úteis
  novas e zero chamada de IA. A estimativa do painel (`REVIEW_SECONDS_PER_WORK = 37`) ficou: a diferença
  dá ~30 min em 11 h, abaixo do que 6 obras sustentam.
- **Teste `hiato-tipo-no-badge` (verde desde 02/11/2026):** a linha dizia que a fixture sem `now` fixo caía
  em "frio" pelo relógio. [fato] Desde o #578 (`975c6765`), `classifyOngoing` com `pending: 0` olha só o
  último lançamento, que a fixture não tem, então o resultado não depende mais da data. O teste não mudou.
- **Proteções da resposta da IA (07/11/2026, PR #587, publicadas no mesmo dia por `npm run deploy`):**
  a avaliação deixa de completar critério ausente com nota 5 e "Não avaliado." (piloto de 24/10:
  *Charming* veio com 1 de 11 e teria sido aceita com 10 notas inventadas). Resposta incompleta é recusada
  SEM 2ª chamada paga (decisão da curadora de 23/10), e o recebido fica estruturado em
  `ai_api_calls.metadata.payload_recusado.parcial`. O cache L2 também não serve avaliação gravada
  incompleta. Regra 7 da recuperação: `scores` com aspas escapadas e cruas na mesma string (*Dragondaily*,
  recuperado offline em 24/10, 11/11). Prompt e tool intocados (v32 byte a byte). Dono:
  `lib/ai-evaluation/criteria-completeness.ts`.
- **MangaUpdates religado (05–06/11/2026):** desde ~17/06 o site respondia 429 a navegador antigo e o
  conector devolvia `[]` calado (4,5 meses sem coletar). Comentários pela API oficial com falha que rejeita
  (#583, publicado na v60 em 06/11); rodapé legado de 563 linhas limpo na nuvem em 05/11 (#584). [fato]
  Recoleta em 06/11 (`scripts/backfill-source-reviews.ts --fonte=mangaupdates --escopo=vinculadas`, US$0,
  backup completo antes): 1.062 obras, 0 falhas, **1.694 reviews novas em 495 obras** (MU 2.766 → 4.460),
  `reviews_hash` em dia nas 495, nenhuma duplicata nova; **239 obras entraram em "Reviews novas"**. Fazer as
  reviews chegarem às notas exige reavaliar (pago) e é decisão da frente de qualidade das avaliações por IA.
  Sobram 5 pares idênticos antigos (mai/jun) no MU, que a seleção W3 colapsa.
- **`tsx` fixado nas dependências (06/11/2026):** `tsx` **4.23.15** exato em `devDependencies`. Antes, 35
  npm scripts (inclusive `recalc:scores:cloud`) e ~90 cabeçalhos de script chamavam `npx tsx`, que
  baixava `tsx@latest` do registro e o rodava com as chaves de produção. O npx prefere o binário local,
  então nenhum comando mudou. [fato] A versão é a que já tinha rodado aqui em 02/11; assinatura e
  procedência conferidas (`npm audit signatures`); `npm audit` igual antes e depois (26). Guardado por
  `tests/unit/orchestration/npx-nao-baixa-pacote.test.ts`: todo `npx <comando>` do `package.json`, dos
  scripts e do `CLAUDE.md` tem de sair de dependência DIRETA do lockfile.
- **Proxies sem sessão (`/api/animeplanet`, `/api/comick/search`, `/api/comick/[hid]`) (20/10/2026):** PR #574 (`3c4e3f60`) — `gateCuradorDaRota()` antes de qualquer busca externa (sem sessão → 401, sem papel de curador → 403). [fato] Em `main` e no deploy de `7d2c13be` de 20/10 (rota anônima responde `{"error":"unauthenticated"}`, artefato local do deploy). Conferido em 21/10.
- **Inferência estrutural por versão das mixed (17/10/2026):** legado aplicado por `scripts/reconciliar-inferencia-estrutural.ts`, em etapas, cada uma com backup e dry-run: R18 (43 → 9,0 `piso_adulta_sexual`) e normal (116 → 6,0 `base_padrao_r15`, `evidence.anterior` = a base 5,0 em 116/116); recálculo depois de cada uma. No final: treino 242, cvMAE 0,6590 (inalterado), nenhuma previsão principal mudou, a normal das 116 caiu 0,02–0,03. `STRUCTURAL_INFERENCE_AUTO_APPLY` ligado no código (branch `feat/ativar-inferencia-estrutural`; vale em produção a partir do deploy dela). O que sobra é curadoria — linha "Mixed ainda sem Nota Prevista principal". Registros: `Auditoria/edicoes-mixed-2026-10-15/` (`pre-legado-*`, `execucao-*`, `recalc-*`, `gate-*`).
- **Fase 2 das obras mixed (13/10/2026):** #562 publicado (Fly **v49**); migs 216 (`read_edition`; as 55 avaliações mixed da conta principal → R18) e 217 aplicadas; `attribute_bias` da dona recalculado; recálculo global v2 (1.065 linhas `edicao-v2` em `calculated_scores` e no espelho da dona; 47 mixed perderam a Nota Prevista por R18 `not_rated`, sem fallback — 59 ficam sem). **Mig 218 aplicada (05:42Z): o banco aceita só `s9-fantasy-b-edicao-v2`**; v1 e edicao-v1 bloqueados; linhas históricas com contrato NULO preservadas. 🔴 Voltar o app para a v48 ou anterior exige `scripts/rollback/218_rollback.sql` ANTES. Registros em `Auditoria/edicoes-mixed-fase2b-2026-10-11/publicacao/`.
- **Segurança do Next (09/10/2026):** `next` 16.2.11 → 16.4.0 e `eslint-config-next` 16.2.4 →
  16.4.0 (PR #548, merge `04884c2`), publicado na **v38**. Zero advisories críticos conhecidos do
  Next após o bump; `postcss` e `sharp` também saíram. O mesmo deploy publicou o #544 e o #545 — o
  Fly deixou de estar atrás do `main`.
- **Recalc/scoring:** guarda canônica do recalc (#545) e das chamadas pagas (#520); `recalc_pending`;
  contrato canônico `s9-fantasy-b-edicao-v2`, o único aceito (migs 202/217/218, `enforce=true`; v1 e edicao-v1 recusados desde 13/10); Nota.Calc aposentada
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
