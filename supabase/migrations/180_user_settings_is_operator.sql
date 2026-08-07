-- 180: user_settings.is_operator — qual linha guarda o saldo da conta Anthropic
--
-- `user_settings` guarda DUAS naturezas de dado na mesma tabela: o pessoal (nome,
-- avatar, preferências, papel) e o do OPERADOR (o saldo da conta Anthropic que banca o
-- app inteiro). Até aqui, só uma CONVENÇÃO distinguia as duas — "a linha mais antiga" —
-- resolvida por `order by created_at asc limit 1` espalhado no código.
--
-- Isso já custou um bug: a leitura do saldo pegava a linha mais antiga e a escrita
-- gravava na linha do usuário LOGADO (via um helper chamado `getSingletonId` que não era
-- singleton). Para o dono as duas coincidem e nada aparece; com um segundo curador a UI
-- diria "salvo" e o valor nunca mudaria. Corrigido no código, mas a convenção seguia de
-- pé — e convenção não sobrevive a quem não a conhece.
--
-- Aditiva e idempotente. O backfill marca exatamente a linha que o código já resolve
-- hoje, então o comportamento é IDÊNTICO antes e depois de aplicar.

alter table public.user_settings
  add column if not exists is_operator boolean not null default false;

-- Exatamente UM operador, garantido pelo banco. Sem isto, dois `true` fariam qualquer
-- `limit 1` voltar a ser sorteio — o mesmo problema de antes, com outra cara.
create unique index if not exists user_settings_single_operator_idx
  on public.user_settings (is_operator)
  where is_operator;

-- Backfill: a linha mais antiga é a que leitura e escrita já resolvem. O `not exists`
-- torna o script re-executável sem erro (o índice único recusaria um segundo true).
update public.user_settings
set is_operator = true
where id = (select id from public.user_settings order by created_at asc limit 1)
  and not exists (select 1 from public.user_settings where is_operator);

comment on column public.user_settings.is_operator is
  'Marca a UNICA linha que guarda o saldo da conta Anthropic do app - dado do operador, nao pessoal. Ver fetchOperatorSettingsRow em server/queries/ai-usage.ts.';
