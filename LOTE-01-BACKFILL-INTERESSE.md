# Lote 01 — backfill de Potencial de Interesse (100 obras)

```
STATUS: NÃO EXECUTADO — AGUARDANDO APROVAÇÃO DE CUSTO
```

> Etapa 2C.0 — preparação **read-only** do primeiro lote controlado (100 obras) após o
> piloto de 12 (2B.1) e a recuperação headless (2B.2). **Nenhuma** execução/`--execute`/LLM/
> previsão/perfil/recalc/job. Dados medidos por `SELECT` + dry-run read-only em **2026-06-19**.
> Proveniência: 🟦 código · 🟩 banco (read-only) · 🟨 inferência · 🟧 decisão proposta.

## 1. Estado global anterior (🟩)
- **taste_profile:** 7 versões; **current = v7** (exatamente 1), `is_stub=false`, `input_hash=210021707a97…`. Perfil **fresh** (dry-run confirma `profileAction=none`).
- **recalc_pending = false** · `recalc_last_edit_at = null`.
- **synopsis_quality_predictions:** 1026 linhas · **12 modernas fresh** (input_signature, vs v7) · stale=1014 / fresh=12.
- **Obras pendentes de previsão:** ~**722** (734 − 12).
- **jobs (14):** `ensure_taste_profile/succeeded` 1 · `predict_interest_potential/succeeded` 12 · `recalculate_scores/succeeded` 1 · **0 queued/running**.

Pré-condições da etapa: perfil fresh ✅ · não-stub ✅ · 1 current ✅ · recalc_pending=false ✅ · sem job queued/running das 3 ações ✅. (Se qualquer uma falhasse, a etapa pararia.)

## 2. Critérios de seleção (🟧/🟩)
- **Método determinístico:** `--limit=100` → ordenação **`work_id` ASC** (estável, documentada). As 100 primeiras obras ativas por id.
- Por que essas: começar pelo "início" canônico do catálogo garante reprodutibilidade e nenhuma escolha acidental por título/score. O lote é **homogêneo por construção** (todas elegíveis, stale, com sinopse).
- **As 12 obras do piloto NÃO entram:** elas já são fresh (input_signature vs v7) e, por estarem fresh, jamais viram item; confirmado por **interseção `{100} ∩ {12-piloto} = 0`** (🟩) e por `fresh=0` no dry-run.

## 3. Snapshot resumido das 100 (🟩)
Conferência: **100 obras · 0 arquivadas · 0 sem sinopse · 0 já modernas (sig=set) · 0 fresh · 0 bloqueadas · 0 ausentes**.

| Campo | Distribuição nas 100 |
|---|---|
| estado atual | **100 stale_legacy** (todas) |
| stale flag (v2) | true: 100 |
| prompt_version | v2: 100 |
| input_signature | **null: 100** (todas legadas — alvo da transição) |
| synopsis source | canonical: 100 |
| taste_profile_hash (v2) | v5 `2171280025`: 44 · v4 `840e2b9402`: 33 · v6 `ef9f412261`: 22 · v6-input `7099c18dc8`: 1 (**nenhum == v7** ⇒ todas stale) |
| nível atual de Interesse | ♥♥♥: 39 · ♥♥: 35 · ♥♥♥♥: 19 · ♥: 7 |
| tags | min 0 · max 148 · 45 com 0 tags |
| reviews (texto úteis) | 68 com · 32 sem |

**Amostra (12 primeiras por id):**
| work_id | título | stale | sig | tph(v2) | interest | tags | rev |
|---|---|:--:|:--:|---|:--:|--:|--:|
| `00cc5da6…` | I Swapped My Husband at the Wedding | true | null | 840e2b94 | ♥♥♥ | 11 | 2 |
| `00cea638…` | A Talented Maid | true | null | ef9f4122 | ♥♥♥ | 33 | 42 |
| `0129dd51…` | I Don't Want the Male Lead's Child | true | null | 21712800 | ♥♥♥ | 20 | 0 |
| `01a765c5…` | Saving the Villain from the Heroine | true | null | 21712800 | ♥♥♥ | 28 | 36 |
| `01d906b3…` | The Newlywed Life of a Witch and a Dragon | true | null | 21712800 | ♥♥♥ | 63 | 47 |
| `01dfd39b…` | Struck by an Obscene Curse | true | null | ef9f4122 | ♥♥ | 34 | 4 |
| `01ffbe34…` | Princess Villainess | true | null | ef9f4122 | ♥♥♥♥ | 11 | 15 |
| `02a0ed30…` | The Empress's Two Wolves | true | null | 21712800 | ♥♥ | 20 | 1 |
| `02c930cb…` | I Couldn't Care Less About the Original… | true | null | 840e2b94 | ♥♥♥ | 19 | 3 |
| `0319d2b7…` | You Are at the End of the Downfall | true | null | 21712800 | ♥♥ | 9 | 0 |
| `038a4e0b…` | I Wasn't the Cinderella | true | null | 840e2b94 | ♥♥♥ | 57 | 9 |
| `03a55403…` | The World's Strongest Are Obsessed With Me | true | null | 21712800 | ♥♥ | 37 | 12 |

Razão de inclusão (todas): **previsão legada stale (input_signature=null, hash ≠ v7), elegível (sinopse canonical), fora das 12 já processadas** — alvo da transição legada→moderna vs perfil v7.

**Integridade da lista:** sha256 dos 100 IDs ordenados = `aa37ac8dc4dce67f2c427328941d5c38dd17524a1ab1e599ebeaf1d8f52a4482`.

## 4. Dry-runs (🟩, read-only)
**4.1 `--limit=100` (seleção determinística):** perfil fresh v7 · total=100 elegíveis=100 · fresh=0 stale=100 ausente=0 bloqueadas=0 · 100 previsões · recalc não · likely $1.050 / upper $1.575 · planSignature `4b65072fc7ae6c0204ebed476a336f76993d8035cc9e23d3d8d8774ae419480f` (**não é o plano oficial** — só seleção).

**4.2 OFICIAL — IDs explícitos (100):** total=100 elegíveis=100 · **fresh=0 stale=100 ausente=0 bloqueadas=0** · profileAction=**none** · 100 previsões · **recalc final: não** · likely $1.050 / upper $1.575.
- **planSignature OFICIAL:** `0711bed4729335d70cc56e704c5ef6d0a0393875211fd0e3efa5fba276f2802a`
- **Estável à ordem:** IDs invertidos → **mesma assinatura** `0711bed4…` (🟩 verificado).

> Diferença de assinatura entre `--limit` (`4b65072f…`) e IDs explícitos (`0711bed4…`) é esperada: a assinatura embute `scope.kind`. **O comando pago usa SEMPRE os IDs explícitos**, nunca `--limit`.

## 5. Custos (🟩 do dry-run)
| Operação | Qtd | Likely | Upper (autorização) |
|---|--:|--:|--:|
| ensure_taste_profile | 0 | $0 | $0 |
| predict_interest_potential | 100 | **$1.050** | **$1.575** |
| recalculate_scores | 0 | $0 | $0 |
| **Total** | 100 | **$1.050** | **$1.575** |

- **Custo histórico aprox. (diagnóstico):** ~$0.97–$0.99 (100 × $0.0097/call histórico; pilot real $0.00994/previsão). **Não** substitui o upper.
- **Comparação piloto × histórico:** piloto 2B.1 = $0.1193/12 = **$0.00994/previsão**; histórico (n=1089) = $0.0097/call → consistentes.
- **Upper contratual (autorização):** **$1.575** (= likely × 1.5).
- **Teto MÍNIMO técnico:** **$1.58** (o gate bloqueia se `upper > teto`; `1.575 > 1.57` ⇒ 1.57 rejeitado; `1.575 > 1.58` é falso ⇒ aceito).
- **Teto proposto p/ aprovação (🟧): $1.60** (margem humana acima do mínimo $1.58).
- ✅ **Bug corrigido (Etapa 2C.1):** a CLI sugeria `--max-cost-usd=1.57` (`1.575.toFixed(2)` arredondava p/ baixo) — seria **rejeitada** pelo gate. Agora a CLI usa `ceilUsdToCents` (arredonda p/ CIMA ao centavo) e sugere **`--max-cost-usd=1.58`**; o upper real é exibido com 4 casas (`$1.5750`) para não esconder a diferença. O **gate e a assinatura seguem usando o upper REAL** (sem arredondamento destrutivo); a `planSignature` permanece `0711bed4…`.

## 6. Comando futuro (NÃO executado — proposta para aprovação)
```bash
npm run backfill:interest -- \
  --execute \
  --work-id=00cc5da6-cb7b-44b5-9268-0e6874f162c0,00cea638-0738-4df2-9ee5-76af30730d78,0129dd51-e343-4627-a49e-f84aa033c92b,01a765c5-ea1f-4f72-9f12-4954955dc7f3,01d906b3-1906-4176-9315-177b544e5f76,01dfd39b-20db-45e5-890b-75ee4dbf2527,01ffbe34-e4b0-4f0c-838f-f66ca713eab1,02a0ed30-9be0-45b1-ad97-f203b8644818,02c930cb-1045-47e0-bb72-2c686f8ddc11,0319d2b7-830b-42a4-8460-cdf7db8eef99,038a4e0b-4609-4f28-85c2-304d50475d38,03a55403-893e-46fb-a49c-e2d990470afd,03eb0ce5-7f07-4e23-b8fd-72ca5f6d1278,041b3f7f-500c-4dbb-9517-4f1f76096034,04d015be-eaf0-498f-90af-dacf11f8e6c2,04d30ade-6087-404e-a51f-c06f5bf419dd,0559876a-db85-41d5-9bb4-a5c0301a2930,05de6004-7103-4fc7-a0ca-534307196ad3,05e7ce25-bb3d-4b29-8101-aa1c8f5bac3f,075f0386-d9bf-40b5-ad16-047640800111,083b98e5-26db-46c5-af13-af14d598096f,08424ef1-7b17-4c92-9edd-1790272f9630,0863d402-45c3-446d-b590-7c8e744be858,0869e543-716c-4b10-bbda-f8339be4f6f4,08c7b42a-a850-4a4a-9f4c-b00367635e3c,08ce2ba1-544c-4bf3-9100-5956a17c4f68,08f426d8-0370-43e0-bdb2-90f07e0af468,0907dc04-99c0-4393-b2b8-d9663b07d356,09bf3743-456c-474b-96a6-ee68d61f7ecc,09dc3ba1-0698-4a27-87a2-e534dbbf4175,0a000d5a-c66c-4e54-818b-3595f29ed26e,0aa7bda5-cae6-4309-adab-fc5100ae3362,0acdcd9c-f5a6-4f0e-9a65-3db34753447d,0bc83405-2920-40f8-a890-67543cf00550,0bd2d176-27fb-4d6a-8cf7-94dfa4615aa7,0c321cc1-6418-4987-b446-0df5bfbe9f54,0c3d74a0-4587-4f05-89d3-dfb482cc81e2,0d217b26-542e-492c-816b-c95e7d3210c5,0d842f95-edf3-40e0-a6c4-28e9ab90e6d1,0ddf4058-5f45-4772-ac14-efa207a9f524,0e0466fd-ebbd-4d1f-92bb-095b3582c9ab,0e10be80-d1e4-4822-afa3-efa9cfaa220d,0e765fc5-f331-452f-8fd9-873b68a3519e,0e7b07f6-fa3f-4712-8f90-c91aed683575,0f15067a-a7be-494e-9e04-191b652f81cb,0f26cd5b-8885-443a-9baf-b3757b791eaf,0f5c750d-6930-4384-95ce-e9f829a8409e,0fc4fbb3-4a63-4edd-a1b3-cf87cf2f72f6,101bc8ed-c158-43c7-ad54-97b6539f5efb,101db356-e078-4591-bf8d-d75e5300f0f8,110b1d9f-0d0e-455c-a1a0-f3e53558b8b9,111ca843-0f45-4c26-8a88-5b7eaa9fe06c,1213bb5c-f612-4148-bbc4-a8e4e9ce70d0,12360348-ae7c-41be-bdbb-bd70ab262387,127b0e76-d48b-4945-aefc-9493ea3b1f25,127f6eeb-3554-4b0c-a1b1-c8351d81b964,128b9ccf-f9e0-42c2-bc54-13b2652204c5,129dfb09-fa48-4c42-bfa2-2990b858612e,12ca0fb9-4d37-429f-8f23-045f79fb33ca,12d8fd23-98e2-4dfc-af93-f9acf1816e1d,136949d6-cfa7-4cf0-9e8f-0bce1b6c44ac,13790b32-d3ce-4ba9-a600-2ed25d040467,1385c6bf-d44c-437e-9a85-ddc2214b238e,14109923-0840-447e-a78f-96f6bf211c32,14f64372-0cbf-4739-bcc4-d5158f64e715,153bd79c-6347-4f2a-9543-a0e480c91bb6,1552c255-c0ce-42f9-9881-82149142a572,15818020-77cc-4430-a25b-0bc9f403ffa0,16080ccb-6a68-418c-a027-98c304944b75,161e5582-e440-43fd-8e31-7941b50be13b,170b21e6-8eb4-48ae-9de6-89be0d717247,170c1f94-7dc5-4dc6-94a0-a563720c6658,1763528c-bb1a-4ec7-b737-c2a77e3ffec6,17a05dc6-3ad5-40be-a087-62501b3032b5,18c0456f-9540-45c3-8084-6551527107a6,18f9fd16-c85b-4358-b8e6-eb2355fea7fc,18fdbcce-7b8d-40cc-9737-c6e538d65bb7,19199742-e6b4-4f6a-bb6c-e6865c1b0ad7,191f4fc4-4cca-47f7-a8d1-e3ede6e83082,198a1ed5-5a89-49c5-a7a9-0307b2dd06fb,19c06f7c-d4aa-424d-85ac-527e304c1ff2,1a1bf7d2-0f5e-467c-b074-6590a04fde80,1a8ec6b3-ad81-49f6-adb2-11e5ea9cb57f,1aaa92d2-a4c1-4c5b-8e71-fd6af3508329,1ad044fe-526b-47e0-997d-3f43507a5315,1c338045-f1d4-4bb2-afd1-6c2424a8ee2b,1c81e6f3-ad1f-4a95-9e4a-828513244ad9,1cc6ee46-43c9-4658-bbb6-b757e0ec17e6,1cf09135-95a4-4248-a35f-0f3d5122abe2,1d2c5b07-407e-472e-a970-f69209f5cfc7,1d68412f-1b2e-40c3-a137-0a4fecc21060,1e10413d-1b10-4d47-ae0f-654c0a5d0bde,1e4dc6ba-9d0c-474c-a96c-082546fe3445,1ea764da-f9b8-4560-b332-977895b8d049,1ed45f04-40f7-4d8a-8d74-60a387605969,1fe9bae0-da5a-40ad-9844-505538426def,20024e21-bbe7-490c-9a6a-892db1d7f67d,20130c18-8ff4-4439-83b1-c2d94ccf4f80,205f28ba-1912-40fa-b705-e017c42c9454,20714b59-9270-41c8-a972-de2c2b79bb2f \
  --plan-signature=0711bed4729335d70cc56e704c5ef6d0a0393875211fd0e3efa5fba276f2802a \
  --max-cost-usd=1.60 \
  --concurrency=2
```
- **SEM** `--retry-failed` · concorrência **2** · sem profile refresh · sem recalc.
- ⚠️ Qualquer mudança no perfil/biblioteca/obras invalida a assinatura ⇒ exige novo dry-run e nova assinatura. **NÃO** usar `--limit` no comando pago.

## 7. Critérios de interrupção (futura execução)
A execução paga **para ou não começa** quando: perfil v7 deixar de ser fresh; `input_hash` da biblioteca mudar; plano mudar; **assinatura divergir** (re-plano antes da 1ª chamada paga ⇒ `plan_changed`, zero custo); upper > teto; algum ID sair do escopo; item bloqueado; job `running` inesperado; **`custo_real_acumulado + upper_próximo > teto`** (soft-cap ⇒ `stoppedByCost`); ou **SIGINT/SIGTERM** (para de iniciar novos; em-voo terminam). **Falha de uma previsão NÃO apaga as anteriores; sem retry pago automático.**

## 8. Estado esperado após o lote (🟨, projeção do estado real medido)
| Métrica | Antes (🟩) | Depois (projeção) |
|---|--:|--:|
| Obras com previsão **moderna fresh** (input_signature, vs v7) | 12 | **112** |
| Obras ainda pendentes (stale/ausentes) | 722 | **~622** |
| `input_signature` preenchida (v2) | 12 | **112** |
| Perfil | v7 | **v7** (inalterado) |
| `recalc_pending` | false | **false** (inalterado) |
| novos jobs `predict_interest_potential/succeeded` | — | **100** |

**Sem recálculo:** 🟦 reconfirmado — `recalculateAll`/`expected`/`score`/`personal-fit` **não** leem `synopsis_quality_predictions` (grep sem matches). Previsões **não** são entrada do recalc ⇒ este lote **não marca nem executa** recálculo.

## 9. Checklist de integridade do executor (revisão estática 🟦)
| # | Garantia | OK |
|--:|---|:--:|
| 1 | execução exige `--execute` (dry-run é o default) | ✅ |
| 2 | exige `--plan-signature` | ✅ |
| 3 | exige `--max-cost-usd` | ✅ |
| 4 | recomputa o plano antes da 1ª chamada paga | ✅ |
| 5 | perfil alterado ⇒ `plan_changed` (bloqueia) | ✅ |
| 6 | obra alterada ⇒ assinatura diverge/`plan_changed` | ✅ |
| 7 | escopo não pode aumentar (itera só `itemsToPredict`) | ✅ |
| 8 | nenhuma obra fora dos 100 é prevista | ✅ |
| 9 | micro-threshold individual NÃO autoriza o lote (gate agregado) | ✅ |
| 10 | soft-cap (`acc+upper>teto` ⇒ stoppedByCost) | ✅ |
| 11 | sem retry pago automático (sem `--retry-failed`) | ✅ |
| 12 | nenhuma operação de perfil (profileAction=none) | ✅ |
| 13 | nenhuma operação de recálculo (recalcPlanned=false) | ✅ |
| 14 | status parcial/falho ⇒ exit ≠ 0 (`completed_with_failures`) | ✅ |
| 15 | import/build/render não executam o lote (`isProductionBuildPhase` + sem efeito por import) | ✅ |

Verificado no código (etapas 2A/2A.1/2B.2) + neste dry-run (#12/#13: `profileAction=none`, `recalc final: não`). **Nenhum bug bloqueante.** (Caveat menor não-bloqueante: §5 — sugestão `1.57` da CLI.)

## 10. Riscos
| Risco | Sev | Mitigação |
|---|:--:|---|
| Perfil/biblioteca mudarem entre dry-run e execução | 🟢 | re-plano + assinatura ⇒ `plan_changed`, zero custo |
| Custo real acima do esperado | 🟢 | gate por upper ($1.575) + teto $1.60 + soft-cap |
| Sugestão `1.57` da CLI rejeitada pelo gate | 🟢 | usar `--max-cost-usd=1.60` (documentado) |
| Falha parcial de previsões | 🟢 | isoladas; sem retry pago; resultados anteriores preservados; resume por novo dry-run |
| Job `running` órfão | 🟢 | 0 jobs ativos hoje; dry-run avisaria |

## 11. Checklist de verificação posterior (futuro)
**Perfil:** segue v7, 1 current, fresh, não-stub. **As 100:** `stale=false`, `input_signature` preenchida, `taste_profile_hash` = assinatura v7, prompt v2/model/schema corretos, sem duplicação. **Fora do escopo:** nenhuma obra fora das 100 alterada; total de linhas inalterado (upsert in-place). **Agregados:** modernas fresh 112; pendentes ~622. **Scores:** `recalc_pending` segue false; nenhum recalc disparado. **Jobs:** +100 `predict_interest_potential/succeeded`; sem queued/running abandonado; custo real ≤ teto. **UI (manual):** página de obra do lote, tela de Potencial de Interesse, ranking (regressão visual).

## 12. GO / NO-GO
### ✅ GO se (todos): perfil v7 fresh (✅) · recalc_pending=false (✅) · exatamente 100 elegíveis (✅) · 0 fresh/arquivada/bloqueada/missing (✅) · 0 ∩ 12-piloto (✅) · sem profile/recalc no plano (✅) · plano assinado `0711bed4…` (✅) · teto ≥ upper definido ($1.60 ≥ $1.575) · nenhuma mudança externa desde o dry-run.
### ⛔ NO-GO se: perfil voltar a stale · `input_hash` mudar · plano/assinatura divergir · upper > teto · ID fora do escopo · item bloqueado · job running inesperado · qualquer teste falhar.
### Recomendação técnica (🟧)
**GO técnico** — lote homogêneo (100 stale elegíveis), só previsões (perfil v7 fresh, sem regen/recalc), custo trivial (~$1 real / $1.575 upper), executor 15/15 na revisão, transição já validada no piloto. **Decisão da usuária:** aprovar o **upper $1.575** com teto **$1.60**. Recomendo rodar **um** lote de 100, verificar (§11), e só então decidir os próximos (~622) — em lotes controlados, não o restante de uma vez.

---

### Banco (somente SELECT — antes/depois idênticos)
```
taste_profile 7 · current v7 · synopsis_quality_predictions 1026 · input_signature(v2) 12
stale=true 1014 · stale=false 12 · recalc_pending false · jobs 14 (0 queued/running)
zero chamadas pagas · zero LLM · zero previsões/perfis alterados · zero jobs criados · nenhuma migration
```

---

## Nota — Etapa 2C.1 (correção do arredondamento financeiro, 2026-06-19)
- **Upper bound real:** US$ **1,575** (inalterado; usado pelo gate e pela assinatura).
- **Bug anterior:** a CLI sugeria `--max-cost-usd=1.57` (`toFixed(2)` arredondava p/ baixo) — abaixo do upper ⇒ o gate rejeitaria.
- **Correção aplicada:** helper `ceilUsdToCents` (lib/orchestration/cost.ts) arredonda o teto **sugerido** para cima ao centavo; a CLI passou a sugerir **$1,58** e a exibir o upper real com 4 casas.
- **Teto mínimo técnico:** US$ **1,58**. **Teto proposto p/ aprovação:** US$ **1,60**.
- **Plano inalterado:** `planSignature` segue `0711bed4729335d70cc56e704c5ef6d0a0393875211fd0e3efa5fba276f2802a`; os 100 IDs e o upper real não mudaram.
- **Lote AINDA NÃO EXECUTADO** — aguardando aprovação de custo.
