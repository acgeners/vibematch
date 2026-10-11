-- Rollback da 211: devolve os vínculos R19 apagados (com o `source`, a `confidence` e o `created_at`
-- originais, de `bkp.mig211_r19_vinculos`) e o `adult_auto/adult_reason` das obras recalculadas — só
-- das que continuam no valor que a 211 deixou (decisão posterior fica).
--
-- ⚠️ ORDEM: rode ANTES do rollback da 210. Este rollback devolve a nota inventada às 49 obras (o R19
-- injetado volta a ser tag forte e a ligar o gate) — só faz sentido se a decisão da limpeza for revista.

set lock_timeout = '5s';

do $rb$
begin
  if to_regclass('bkp.mig211_r19_vinculos') is null then
    raise exception 'rollback 211: bkp.mig211_r19_vinculos não existe — a 211 não foi aplicada aqui';
  end if;
end
$rb$;

insert into public.work_tags (work_id, tag_id, source, confidence, created_at)
select b.work_id, b.tag_id, b.source, b.confidence, b.created_at from bkp.mig211_r19_vinculos b
on conflict (work_id, tag_id) do nothing;

update public.works w
   set adult_auto = b.adult_auto, adult_reason = b.adult_reason
  from bkp.mig211_works_antes b
 where w.id = b.work_id
   and (w.adult_auto, w.adult_reason) is not distinct from (b.adult_auto_depois, b.adult_reason_depois);

drop table bkp.mig211_works_antes;
drop table bkp.mig211_r19_vinculos;
