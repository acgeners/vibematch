-- Timestamp do último "Atualizar dados" (refresh de fontes externas).
-- Separado de updated_at, que o trigger trg_works_updated_at toca em QUALQUER
-- edição da linha (status, favorito, edição manual, etc.). Permite mostrar na
-- página da obra "Atualizada em" refletindo só o refresh de dados, distinto de
-- "Última avaliação" (data da avaliação IA). Mesmo padrão da migration 034.
ALTER TABLE works ADD COLUMN IF NOT EXISTS data_refreshed_at TIMESTAMPTZ;

COMMENT ON COLUMN works.data_refreshed_at IS
  'Timestamp do último "Atualizar dados" (updateWorkExternalData). Não é tocado por edições manuais nem pelo trigger de updated_at.';
