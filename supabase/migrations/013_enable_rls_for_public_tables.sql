-- Enable RLS for every public table used by the app.
-- The app accesses Supabase from server-only code with the service role key, so
-- regular anon/authenticated clients should not receive broad table policies.

DO $$
DECLARE
  table_record RECORD;
  policy_record RECORD;
BEGIN
  FOR table_record IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_record.tablename);

    FOR policy_record IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_record.tablename
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy_record.policyname,
        table_record.tablename
      );
    END LOOP;
  END LOOP;
END $$;
