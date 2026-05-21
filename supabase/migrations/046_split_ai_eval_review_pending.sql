-- ============================================================
-- 046 - Split AI evaluation lifecycle pending/review_pending
-- ============================================================
-- pending        = never evaluated by AI / needs AI run
-- review_pending = completed AI evaluation exists / needs review accept
-- done           = scores accepted/saved
-- skipped        = intentionally ignored
-- ============================================================

ALTER TABLE works
  DROP CONSTRAINT IF EXISTS works_ai_eval_status_valid;

UPDATE works w
SET ai_eval_status = 'review_pending'
WHERE w.ai_eval_status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM ai_evaluations ae
    WHERE ae.work_id = w.id
      AND ae.status = 'completed'
  );

ALTER TABLE works
  ADD CONSTRAINT works_ai_eval_status_valid
  CHECK (ai_eval_status IN ('pending','review_pending','done','skipped'));

CREATE OR REPLACE FUNCTION enforce_work_ai_eval_pending_reality()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ai_eval_status = 'pending'
     AND EXISTS (
       SELECT 1
       FROM ai_evaluations ae
       WHERE ae.work_id = NEW.id
         AND ae.status = 'completed'
     )
  THEN
    NEW.ai_eval_status := 'review_pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_work_ai_eval_pending_reality ON works;
CREATE TRIGGER trg_enforce_work_ai_eval_pending_reality
  BEFORE INSERT OR UPDATE OF ai_eval_status ON works
  FOR EACH ROW
  EXECUTE FUNCTION enforce_work_ai_eval_pending_reality();

CREATE OR REPLACE FUNCTION mark_work_review_pending_after_completed_ai_eval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    UPDATE works
    SET ai_eval_status = 'review_pending'
    WHERE id = NEW.work_id
      AND ai_eval_status <> 'review_pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_work_review_pending_after_completed_ai_eval ON ai_evaluations;
CREATE TRIGGER trg_mark_work_review_pending_after_completed_ai_eval
  AFTER INSERT OR UPDATE OF status ON ai_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION mark_work_review_pending_after_completed_ai_eval();
