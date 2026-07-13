-- 148_taste_profile_drop_global_unique.sql
--
-- Remove `taste_profile_current_unique` — o bug do perfil global, esculpido no SCHEMA:
--
--   CREATE UNIQUE INDEX taste_profile_current_unique
--     ON taste_profile (is_current) WHERE (is_current = true);
--
-- Um índice único sobre uma coluna BOOLEANA, filtrado nos `true`, significa: **existe no máximo
-- UMA linha corrente no banco inteiro**. Não é um detalhe de performance — é uma regra de
-- negócio: "o app tem um perfil de gosto". Fazia sentido no tempo do usuário único.
--
-- Com ela de pé, dois usuários com perfil são IMPOSSÍVEIS: o segundo insert estoura
-- `duplicate key`. A mig 147 deu dono ao perfil e criou o índice certo — um corrente POR
-- PESSOA (`uniq_taste_profile_current_per_user`) —, mas deixou este aqui vivo. O teste pegou:
-- ao simular a Leitora gerando o perfil dela, o insert foi recusado pelo banco.
--
-- Repare no que isso quer dizer: enquanto o índice existia, o código NÃO PODIA nem chegar a
-- derrubar o perfil do dono — ele quebrava antes. O bug real era pior do que "sobrescreve":
-- era "o segundo usuário simplesmente não consegue ter perfil".
--
-- O índice novo (147) já garante a unicidade que importa. Este é seguro de remover.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/148_taste_profile_drop_global_unique.sql

drop index if exists public.taste_profile_current_unique;

-- Confere: tem que sobrar só o índice POR USUÁRIO.
--   select indexname, indexdef from pg_indexes
--   where tablename = 'taste_profile' and indexdef ilike '%is_current%';
