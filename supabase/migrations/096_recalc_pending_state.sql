-- ============================================================
-- 096 - Fila de recálculo: estado "recálculo pendente"
-- ============================================================
-- Antes, qualquer edição de nota disparava recalculateAll (re-treina
-- o Ridge global → re-prediz a Nota Prevista de TODA a base) na hora,
-- N vezes numa sessão de edição em lote. Agora as edições incidentais
-- só MARCAM a base como pendente; o recálculo roda quando o usuário
-- clica "Recalcular agora" ou, automaticamente, após 1h sem novas
-- edições (debounce lazy, disparado na carga de página).
--
--   recalc_pending       = há edições não recalculadas desde o último
--                          recalculateAll.
--   recalc_last_edit_at   = timestamp da última edição; a janela de 1h
--                          do auto-recalc conta a partir daqui (reseta
--                          a cada nova edição → "espera você terminar").
--
-- touch_recalc_pending() marca pendente em UMA round-trip (mira a
-- linha de config mais recente, igual ao recalculateAll). recalculateAll
-- zera o flag ao persistir o formula_config no fim.
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS recalc_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recalc_last_edit_at timestamptz;

CREATE OR REPLACE FUNCTION touch_recalc_pending()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE formula_config
  SET recalc_pending = true,
      recalc_last_edit_at = now()
  WHERE id = (SELECT id FROM formula_config ORDER BY updated_at DESC LIMIT 1);
$$;

COMMENT ON FUNCTION touch_recalc_pending() IS
  'Marca a base como recálculo pendente (edição de nota incidental). Mira a linha de formula_config mais recente.';
