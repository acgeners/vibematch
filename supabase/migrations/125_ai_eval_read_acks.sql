-- ============================================================
-- 125 - Marcar pendências de /ai-evaluation como "lidas"
-- ============================================================
-- Permite silenciar os contadores de /ai-evaluation (o badge da barra
-- lateral + os contadores das abas) SEM resolver as pendências: o
-- usuário marca como "lida" e a obra continua na fila, mas deixa de
-- contar como não-lida.
--
-- Modelo: 1 linha por (obra, fila). A obra é "lida" naquela fila se
-- existe uma ack correspondente. A ação é binária/global (marcar tudo /
-- desmarcar tudo) + desmarcar individual (clicar no selo "Lida" do card).
--
-- "Contar só as novas" na fila de atributos: o trigger abaixo apaga a
-- ack de 'attr' sempre que works.ai_eval_status muda. Assim, quando uma
-- obra 'pending' marcada como lida recebe uma avaliação (vira
-- 'review_pending', com notas NOVAS a revisar), ela some do "lido" e
-- volta a contar no badge. Nas demais filas, "novo" = obra que ENTRA na
-- fila (sem ack) — de propósito NÃO re-notifica re-staleness, pra não
-- re-inflar o badge numa regeneração de perfil (que marca centenas de
-- alignment_stale de uma vez).
--
-- queue: 'attr' | 'veredito' | 'interesse' | 'tags_reviews' | 'untracked'
-- ============================================================

create table if not exists public.ai_eval_read_acks (
  work_id uuid not null references public.works(id) on delete cascade,
  queue text not null check (queue in ('attr', 'veredito', 'interesse', 'tags_reviews', 'untracked')),
  acked_at timestamptz not null default now(),
  primary key (work_id, queue)
);

create index if not exists ai_eval_read_acks_queue_idx on public.ai_eval_read_acks (queue);

alter table public.ai_eval_read_acks enable row level security;
-- RLS ligado, sem policies permissivas: acesso só via service role (padrão do projeto).

-- Re-notificação da fila de atributos: ao mudar ai_eval_status, some a ack de 'attr'
-- daquela obra (pending -> review_pending re-surge; e leaving a fila limpa a ack).
create or replace function public.drop_attr_read_ack_on_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.ai_eval_status is distinct from old.ai_eval_status then
    delete from public.ai_eval_read_acks
    where work_id = new.id and queue = 'attr';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_drop_attr_read_ack on public.works;
create trigger trg_drop_attr_read_ack
  after update of ai_eval_status on public.works
  for each row
  execute function public.drop_attr_read_ack_on_status_change();
