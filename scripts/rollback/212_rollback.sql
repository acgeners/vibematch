-- Rollback da 212: apaga os 12 vínculos Smut/Pornographic que a curadoria decidiu (só os com
-- `source = 'curadoria'` registrados em `bkp.mig212_vinculos`) e devolve o `adult_auto/adult_reason`
-- das obras recalculadas — só das que continuam no valor que a 212 deixou (decisão posterior fica).
--
-- ⚠️ ORDEM: rode ANTES do rollback da 211 e do da 210. Sem a 212, essas 12 obras saem do 18+ assim que
-- a 210 e a 211 estiverem aplicadas — só faz sentido se a decisão da curadoria for revista.

set lock_timeout = '5s';

do $rb$
begin
  if to_regclass('bkp.mig212_vinculos') is null then
    raise exception 'rollback 212: bkp.mig212_vinculos não existe — a 212 não foi aplicada aqui';
  end if;
end
$rb$;

delete from public.work_tags wt using public.tags t, bkp.mig212_vinculos b
 where t.id = wt.tag_id and t.slug = b.tag_slug and wt.work_id = b.work_id and wt.source = 'curadoria';

update public.works w
   set adult_auto = b.adult_auto, adult_reason = b.adult_reason
  from bkp.mig212_works_antes b
 where w.id = b.work_id
   and (w.adult_auto, w.adult_reason) is not distinct from (b.adult_auto_depois, b.adult_reason_depois);

drop table bkp.mig212_works_antes;
drop table bkp.mig212_vinculos;
