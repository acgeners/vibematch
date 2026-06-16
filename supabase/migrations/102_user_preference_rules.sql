-- ============================================================
-- 102 — user_settings.preference_rules (Item B: preferências/regras livres)
-- ============================================================
-- Texto livre (condicional OU geral) que alimenta SÓ o consultor LLM
-- (Recomendar / Deep Dive / Desempatar / Chat) — NUNCA o modelo offline.
-- A trava do plano: efeitos cruzados/condicionais não viram feature do Ridge
-- (esparsidade → colapso). Lido AO VIVO na chamada IA (sem recalc).
--
-- Shape: array de { id, text, enabled }. jsonb (não tabela) porque é um
-- value-object list curto, lido sempre junto e editado em lote — sem
-- precedência/join como o user_tag_preferences (Item A). user_settings já é
-- o singleton per-user (vira a linha do usuário quando multi-user ligar).
-- ============================================================

alter table user_settings
  add column if not exists preference_rules jsonb not null default '[]'::jsonb;

comment on column user_settings.preference_rules is
  'Item B — preferências/regras livres (texto) pro consultor LLM. Array de {id,text,enabled}. Pago-only na UI. NUNCA alimenta o modelo offline.';
