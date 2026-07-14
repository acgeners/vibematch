-- 156 — os conceitos que faltaram na 155.
--
-- A 155 tirou do código os nomes que tinham QUEBRADO (os "Completed"). Sobraram ~60 nomes de status
-- ainda escritos à mão em ~40 arquivos — não quebrados, porque esses nomes não mudaram, mas a mesma
-- bomba armada: `"Want to Read"` aparecia 26 vezes.
--
-- Esta migration é REFATORAÇÃO: nenhuma mudança de comportamento. As flags abaixo foram derivadas
-- do que o código JÁ fazia, não de uma opinião nova.
--
-- Três conceitos que ninguém tinha nomeado:
--
--   is_default_unset — o status que a obra APARENTA quando não há linha no espelho. O código
--                      escrevia `getPersonalStatusNameById(id) ?? "Want to Read"` em 8 lugares.
--                      NÃO confundir com `Untracked`, que é uma escolha EXPLÍCITA do usuário
--                      (667 obras hoje). Os dois coexistiam sem nome, e por isso pareciam
--                      contradição: o Zod default era "Untracked" e a exibição caía em
--                      "Want to Read".
--
--   is_following     — "estou acompanhando" (o KPI da home, o widget de progresso). Era
--                      `name === "Reading" || name === "Started"`, repetido em 3 lugares.
--
--   is_unread        — "ainda não comecei". Era `["Want to Read", "Untracked"]` — o filtro padrão
--                      do /ranking (3 cópias) e o seed "unread" da auditoria de leitura.

alter table public.personal_status
  add column if not exists is_default_unset boolean not null default false,
  add column if not exists is_following     boolean not null default false,
  add column if not exists is_unread        boolean not null default false;

comment on column public.personal_status.is_default_unset is
  'O status que a obra APARENTA quando o usuário não tem linha no espelho. Exatamente um. Não é o mesmo que Untracked (escolha explícita).';
comment on column public.personal_status.is_following is
  '"Estou acompanhando" — alimenta o KPI da home e o widget de progresso.';
comment on column public.personal_status.is_unread is
  '"Ainda não comecei" — filtro padrão do ranking e seed da auditoria de leitura.';

update public.personal_status set
  is_default_unset = slug in ('want-to-read'),
  is_following     = slug in ('reading', 'started'),
  is_unread        = slug in ('want-to-read', 'untracked');

-- Exatamente UM status pode ser o padrão-sem-estado: com zero, a obra sem linha não teria nome;
-- com dois, qual deles? O código lê isto como um valor único (`DEFAULT_PERSONAL_STATUS`), então a
-- ambiguidade tem que estourar aqui, na migration, e não em runtime.
do $$
declare n integer;
begin
  select count(*) into n from public.personal_status where is_default_unset;
  if n <> 1 then
    raise exception 'personal_status precisa de EXATAMENTE um is_default_unset; achei %', n;
  end if;
end $$;
