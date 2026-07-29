-- 167_purge_orphan_work_list_items.sql
-- Limpeza pontual: apaga os membros de grupo que NÃO são mais favoritos do dono do grupo.
--
-- A migration 123 estabeleceu que **grupo ⊂ favoritos**, mas só metade da regra era aplicada:
-- adicionar ao grupo marcava `is_favorite`, e desfavoritar NÃO tirava do grupo. Só a página da
-- obra limpava as pastas (`unfavoriteWorkFromFolders`); o coração da tabela, o menu da linha e
-- o "Desfavoritar N" em lote (`toggleFavorite` / `setFavoriteMany`) não tocavam em
-- `work_list_items`.
--
-- Resultado: a obra saía dos favoritos e **continuava listada no grupo** — o estado órfão "está
-- na pasta mas não é favorita", que nem deveria existir. Medido antes desta migration: 13
-- linhas / 8 obras, todas do dono.
--
-- O lado da ESCRITA foi fechado no mesmo PR (`purgeWorksFromAllLists`, chamada por toda
-- superfície que desfavorita). Esta migration só apaga a dívida que já estava no banco — sem
-- ela, as 8 obras continuariam aparecendo nos grupos e o bug pareceria não ter sido corrigido.
--
-- Idempotente: rodar de novo não acha mais nada.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/167_purge_orphan_work_list_items.sql

-- A verdade sobre "é favorito" mora em `user_work_state` desde a Fase E — `works.is_favorite`
-- não recebe escrita de ninguém, nem do dono. Comparar contra a coluna de `works` aqui daria
-- um conjunto DIFERENTE (e desatualizado) de órfãos.
delete from public.work_list_items i
using public.work_lists l
where l.id = i.list_id
  and not exists (
    select 1
    from public.user_work_state s
    where s.user_id = l.user_id
      and s.work_id = i.work_id
      and s.is_favorite is true
  );

comment on table public.work_list_items is
  'Associação obra<->grupo (M-pra-N). Invariante grupo ⊂ favoritos, agora nas DUAS direções: adicionar marca is_favorite=TRUE; desfavoritar (qualquer superfície) apaga as linhas daqui, via purgeWorksFromAllLists. Migration 167 limpou os órfãos que a metade faltante deixou.';
