-- 118: fingerprint heurístico do perfil de gosto (drift method-free).
--
-- Gravado no momento da geração do perfil (insertNewTasteProfile): o perfil
-- heurístico determinístico (loved/avoided tags + critérios) calculado das MESMAS
-- obras rotuladas que geraram o perfil LLM. Depois, `getProfileDrift()` recomputa o
-- heurístico atual e compara — a diferença (heurístico×heurístico) isola o quanto as
-- mudanças acumuladas moveram o gosto, sem o ruído de método heurístico×LLM. Serve
-- pra: (a) um indicador "perfil ~X% defasado"; (b) decidir se vale o regen pago (~$0,40).
--
-- Aditiva e tolerante: o código grava best-effort (warn se a coluna não existir) e
-- `getProfileDrift` retorna available=false quando ausente. Perfis antigos ficam sem
-- fingerprint até o próximo regen.

ALTER TABLE public.taste_profile
  ADD COLUMN IF NOT EXISTS heuristic_fingerprint jsonb;

COMMENT ON COLUMN public.taste_profile.heuristic_fingerprint IS
  'Fingerprint heurístico determinístico (loved/avoided tags + critérios) das obras rotuladas no momento da geração. Base do drift method-free (getProfileDrift).';
