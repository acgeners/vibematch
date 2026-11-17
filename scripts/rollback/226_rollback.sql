-- Rollback da 226. Devolve o status de leitura "Hiatus" e as obras que estavam nele, a partir das
-- cópias que a própria 226 gravou. Rode ANTES de voltar o app para um código anterior a ela: as
-- constantes antigas ainda oferecem "Hiatus" no seletor de status, e escolher ele falharia na FK de
-- `user_work_state.personal_status_id`.
--
-- Só volta a obra que AINDA está em "Reading": se a pessoa mudou o status depois da 226, a escolha
-- dela vence.

insert into public.personal_status
  select * from public.personal_status_hiatus_226
  on conflict (id) do nothing;

update public.user_work_state s
   set personal_status_id = b.personal_status_id
  from public.user_work_state_hiatus_226 b
 where s.user_id = b.user_id
   and s.work_id = b.work_id
   and s.personal_status_id = (select id from public.personal_status where slug = 'reading');
