-- ============================================================
-- 172 — funde o gênero duplicado "Science Fiction" em "Sci-Fi"
-- ============================================================
-- Achado na decisão dos chips do onboarding (2026-07-31): a tabela `genres` tem as
-- DUAS grafias (Sci-Fi com 11 obras, Science Fiction com 5). O deck do onboarding
-- amostra por gênero — com a dupla grafia, "Sci-Fi" cobriria só metade do acervo.
--
-- Remapeia work_genres (PK work_id+genre_id → upsert-like com dedup) e apaga a
-- linha duplicada. Idempotente: com "Science Fiction" ausente, é no-op.
-- O lib/constants/tags.ts (GERADO) mantém a grafia antiga até o próximo
-- `npm run sync-constants` — só autocomplete, sem efeito funcional.
-- ============================================================

set lock_timeout = '5s';

do $$
declare
  keep_id uuid;
  dupe_id uuid;
begin
  select id into keep_id from public.genres where name = 'Sci-Fi' limit 1;
  select id into dupe_id from public.genres where name = 'Science Fiction' limit 1;

  if keep_id is null or dupe_id is null then
    raise notice 'fusão Sci-Fi: nada a fazer (keep=%, dupe=%)', keep_id, dupe_id;
    return;
  end if;

  -- Remapeia; pares que já existem com o id certo são pulados (PK work_id+genre_id).
  insert into public.work_genres (work_id, genre_id)
    select work_id, keep_id from public.work_genres where genre_id = dupe_id
  on conflict (work_id, genre_id) do nothing;

  delete from public.work_genres where genre_id = dupe_id;
  delete from public.genres where id = dupe_id;

  raise notice 'fusão Sci-Fi: concluída (dupe % removido)', dupe_id;
end $$;
