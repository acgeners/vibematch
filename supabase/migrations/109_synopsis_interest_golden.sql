-- ============================================================
-- 109 — synopsis_interest_golden (golden sample do experimento)  [Plano 3 Fase B]
-- ============================================================
-- ADITIVA. Armazena a GOLDEN SAMPLE de "Interesse na Sinopse" SEPARADA de
-- works.synopsis_quality (plano §1): rotular aqui NÃO atualiza o valor oficial.
--
-- Cada linha = um SLOT de rotulagem (slot_key opaco, mostrado ao avaliador). Uma
-- obra pode ter 2 slots: o único + uma repetição cega (is_repeat) p/ medir
-- consistência intra-avaliador. `stratum` = synopsis_quality no momento da
-- amostragem (bookkeeping; OCULTO durante a rotulagem). `human_label` é o rótulo
-- cego, preenchido só na importação.
--
-- Golden = revisão HUMANA. user_score NUNCA entra aqui. Numeração: 108 =
-- proveniência → esta é 109. RLS ligado sem policy (padrão do schema).
-- ============================================================

create table if not exists synopsis_interest_golden (
  id              uuid primary key default gen_random_uuid(),
  sample_version  text not null default 'pilot-1',
  slot_key        text not null,            -- id opaco mostrado ao avaliador (ex.: S001)
  work_id         uuid not null references works(id) on delete cascade,
  split           text not null check (split in ('development','holdout')),
  stratum         text,                     -- label atual no sorteio (bookkeeping; OCULTO na rotulagem)
  is_repeat       boolean not null default false,
  repeat_of       text,                     -- slot_key do original (consistência intra-avaliador)
  shuffle_order   integer not null,         -- ordem de apresentação (embaralhada)
  human_label     text check (human_label in ('♥','♥♥','♥♥♥','♥♥♥♥')),  -- rótulo cego (importação)
  labeled_at      timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),

  unique (sample_version, slot_key)
);

create index if not exists synopsis_interest_golden_sample_split_idx
  on synopsis_interest_golden (sample_version, split);
create index if not exists synopsis_interest_golden_work_idx
  on synopsis_interest_golden (work_id);

alter table synopsis_interest_golden enable row level security;

comment on table synopsis_interest_golden is
  'Golden sample (revisão humana) de Interesse na Sinopse. SEPARADA de works.synopsis_quality (não a atualiza). 1 linha = 1 slot de rotulagem (inclui repetições cegas). user_score NUNCA entra aqui. Plano 3 Fase B.';
comment on column synopsis_interest_golden.stratum is
  'synopsis_quality no momento da amostragem — só p/ garantir cobertura dos 4 níveis. OCULTO durante a rotulagem cega.';
