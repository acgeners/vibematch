-- ============================================================
-- 168 — descarte de medição prospectiva (prediction_snapshots + prediction_ledger)
-- ============================================================
-- ADITIVA. Duas colunas novas, nenhum dado tocado.
--
-- POR QUE: faltava distinguir DUAS coisas que o schema tratava como uma só.
--
--   • `superseded` = "editei a nota". A medição original é preservada DE PROPÓSITO
--     (a 1ª nota vence; ver decideResolution) e a nova a supersede. Está certo.
--
--   • Apagar a nota é OUTRA coisa: não existe rótulo novo nenhum. `clearUserRating`
--     carimbava `label_changed_at`, mas NENHUMA métrica filtra por essa coluna — só
--     por `superseded` (prediction-metrics.ts). Então uma previsão continuava sendo
--     medida contra um gabarito que o usuário RETIROU: acerto ou erro fabricado
--     entrando na métrica que a tela de calibração chama de "a evidência mais forte
--     de que o modelo funciona em uso real".
--
--   Medido em 2026-07-29: 35 dos 237 snapshots resolvidos (15%) pertencem às 42 obras
--   cuja nota não tinha leitura que a sustentasse — todos os 35 já com
--   `label_changed_at` carimbado, e todos contando integralmente.
--
-- Sem rótulo não há o que medir. `discarded_at` marca a medição como inválida, e os
-- leitores passam a filtrá-la. NÃO apaga a linha: o snapshot segue imutável e
-- auditável (dá pra responder "por que a métrica mudou em tal dia?").
--
-- Aplicar com: node scripts/apply-migration.mjs 168_prediction_discarded_at.sql
-- ============================================================

alter table prediction_snapshots
  add column if not exists discarded_at timestamptz;

comment on column prediction_snapshots.discarded_at is
  'Quando a medição foi invalidada porque o rótulo real foi APAGADO (não editado). Linha preservada para auditoria; as métricas a excluem. Distinto de superseded (= rótulo editado, medição original preservada de propósito).';

-- Só faz sentido descartar o que chegou a ser resolvido — igual ao check de
-- `label_changed_at`. Um snapshot ainda pendente simplesmente nunca resolve.
alter table prediction_snapshots
  drop constraint if exists prediction_snapshots_discarded_requires_resolved;

alter table prediction_snapshots
  add constraint prediction_snapshots_discarded_requires_resolved
  check (discarded_at is null or resolved_at is not null);

create index if not exists prediction_snapshots_active_idx
  on prediction_snapshots (user_id, work_id)
  where discarded_at is null;

-- O ledger 101 é append-only e hoje só tem escritor (nenhuma métrica do app o lê;
-- só `scripts/measure-audit-staleness.mjs`). A coluna entra pelo mesmo motivo: a
-- linha afirma `user_score NOT NULL` — "o rótulo verdadeiro foi X" — e isso deixa
-- de ser verdade quando a nota é apagada.
alter table prediction_ledger
  add column if not exists discarded_at timestamptz;

comment on column prediction_ledger.discarded_at is
  'Quando o rótulo desta linha foi APAGADO pelo usuário. A linha continua (log append-only), mas não vale como medição.';
