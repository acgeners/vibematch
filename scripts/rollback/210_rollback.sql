-- Rollback da 210: devolve as 112 tags tocadas (108 do eixo adulto + as 4 falsamente avaliadas em
-- 08/10), os 28 aliases e as 47 obras recalculadas pela regra "≥1 tag forte" ao estado de antes, a
-- partir de `bkp.mig210_*`, apaga a tag "Mature" que a 210 criou e remove as colunas de proveniência
-- do enriquecimento. ⚠️ Reverter devolve também a regra antiga às obras (as 25 que estavam 18+ por
-- tag fraca + nota voltam a estar) — só faz sentido junto com o revert do código.
-- ⚠️ Se a 211 foi aplicada, rode o rollback DELA antes (scripts/rollback/211_rollback.sql).
--
-- ⚠️ ORDEM: reverta o CÓDIGO antes (ou junto). O `enrichNewTags` desta frente grava
-- `tags.enrichment_status`; sem a coluna, a gravação de "done" falha e a tag nova fica sem a marca
-- de revisão do piso (falha segura, mas ruidosa).
--
-- Só restaura obra cujo `adult_auto/adult_reason` continua no valor que a 210 deixou (uma decisão
-- posterior fica). Aborta se a tag "Mature" já tiver vínculo ou alias de fora (alguém passou a usá-la).

set lock_timeout = '5s';

do $rb$
declare n int;
begin
  if to_regclass('bkp.mig210_tags_antes') is null then
    raise exception 'rollback 210: bkp.mig210_tags_antes não existe — a 210 não foi aplicada aqui';
  end if;

  select count(*) into n from public.work_tags wt join public.tags t on t.id = wt.tag_id where t.slug = 'mature';
  if n > 0 and exists (select 1 from bkp.mig210_tags_antes where slug = 'mature' and not existia) then
    raise exception 'rollback 210: a tag "Mature" criada pela 210 já tem % vínculo(s) — decidir à mão', n;
  end if;
end
$rb$;

-- Obras: só as que continuam como a 210 deixou.
update public.works w
   set adult_auto = b.adult_auto, adult_reason = b.adult_reason
  from bkp.mig210_works_antes b
 where w.id = b.work_id
   and (w.adult_auto, w.adult_reason) is not distinct from (b.adult_auto_depois, b.adult_reason_depois);

-- Aliases: volta cada um ao destino de antes (NULL = não existia).
delete from public.tag_alias x using bkp.mig210_alias_antes b
 where x.alias_slug = b.alias_slug;
insert into public.tag_alias (alias_slug, canonical_tag_id)
select b.alias_slug, t.id from bkp.mig210_alias_antes b join public.tags t on t.slug = b.destino_slug
 where b.destino_slug is not null;

-- Tags que existiam: flags, grupo e marca de revisão do piso.
update public.tags t
   set adult_indicator = b.adult_indicator, adult_indicator_strong = b.adult_indicator_strong,
       tag_group_id = b.tag_group_id, adult_score_tier_reviewed_at = b.adult_score_tier_reviewed_at
  from bkp.mig210_tags_antes b
 where t.slug = b.slug and b.existia;

-- "Mature": só apaga se foi a 210 que criou (e, pela guarda, sem vínculo).
delete from public.tags t using bkp.mig210_tags_antes b
 where t.slug = b.slug and b.slug = 'mature' and not b.existia;

alter table public.tags drop constraint if exists tags_enrichment_status_check;
alter table public.tags drop column if exists enrichment_detail;
alter table public.tags drop column if exists enrichment_at;
alter table public.tags drop column if exists enrichment_status;

drop table bkp.mig210_works_antes;
drop table bkp.mig210_alias_antes;
drop table bkp.mig210_tags_antes;
