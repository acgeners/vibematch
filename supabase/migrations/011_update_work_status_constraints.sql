-- Keep works status constraints aligned with the canonical status values
-- generated from Supabase constants.

ALTER TABLE works
  DROP CONSTRAINT IF EXISTS works_publication_status_valid;

ALTER TABLE works
  ADD CONSTRAINT works_publication_status_valid
  CHECK (
    publication_status IN (
      'Completed',
      'Ongoing',
      'Hiatus',
      'Cancelled',
      'Unknown',
      'C',
      'H',
      'O',
      'D'
    )
  );

ALTER TABLE works
  ALTER COLUMN publication_status SET DEFAULT 'Unknown';

ALTER TABLE works
  DROP CONSTRAINT IF EXISTS works_personal_status_valid;

ALTER TABLE works
  ADD CONSTRAINT works_personal_status_valid
  CHECK (
    personal_status IN (
      'Completed',
      'Reading',
      'Started',
      'Stalled',
      'Paused',
      'Hiatus',
      'On-hold',
      'To read',
      'Dropped',
      'Finalizado',
      'Lendo',
      'Pausado',
      'Retomar',
      'Retomar (tenso)',
      'Esp. Temp',
      'Lendo (antigo)',
      'Ler',
      'Droppado'
    )
  );

ALTER TABLE works
  ALTER COLUMN personal_status SET DEFAULT 'To read';
