-- ============================================================
-- 178 — works.approved: obra criada por leitor espera aprovação do curador
-- ============================================================
-- Complemento da 177. A 177 deu ao leitor um canal para PEDIR; esta marca o que ele
-- CRIA. Motivo: `createWork` é aberto a qualquer logado (`own_state`), então a obra do
-- leitor entra no catálogo COMPARTILHADO na hora, visível para todos — e em produção a
-- busca só alcança 6 das 9 fontes, então ela pode nascer de um título que não existe em
-- lugar nenhum.
--
-- ⚠️ Isto é RÓTULO, não contenção: a obra continua no catálogo, na busca e nas contagens.
-- Ela só passa a se anunciar como não-aprovada. Conter de verdade exigiria a criação virar
-- pedido (o caminho "B" discutido em 2026-08-05), que é feature própria.
--
-- O papel é lido na CRIAÇÃO e não fica guardado: quem decide é `ensurePermission("curate_ai")`
-- no momento do insert, não um `created_by` na linha. Consequência aceita: leitor promovido a
-- curador depois não retroativa as obras antigas dele — elas de fato não foram validadas.
-- ============================================================

set lock_timeout = '5s';

do $$
declare
  ja_existia boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'works' and column_name = 'approved'
  ) into ja_existia;

  -- 🔴 O backfill mora DENTRO deste if de propósito. Solto, ele aprovaria em massa, a cada
  -- reexecução, exatamente as obras de leitor que estão esperando aprovação — e migration
  -- deste projeto é reaplicada na mão, sem `schema_migrations` confiável para impedir.
  if not ja_existia then
    -- `default false` e não `true`: se algum caminho de escrita esquecer de setar, o erro
    -- aparece como badge A MAIS (visível, corrigível) em vez de obra não-validada passando
    -- por validada (silencioso). Mesmo fail-closed do contexto de papel no cliente.
    alter table public.works add column approved boolean not null default false;
    alter table public.works add column approved_at timestamptz;

    -- Backfill das existentes. Em 2026-08-05 o app não tem outros usuários: as 981 obras
    -- foram todas criadas pelo curador, então "aprovada" é o valor verdadeiro para todas.
    -- Sem isto o catálogo inteiro amanhece marcado como não-aprovado — o que em produção
    -- parece bug, na escala toda.
    update public.works set approved = true, approved_at = now();
  end if;
end $$;

comment on column public.works.approved is
  'Curador validou a obra. Falso = criada por não-curador e ainda não revisada; a UI mostra '
  '"Aguardando aprovação". Setada no insert a partir do PAPEL de quem cria, nunca do form '
  '(é "use server", ou seja endpoint público — ver o strip das 9 notas em createWork).';
comment on column public.works.approved_at is
  'Quando virou aprovada. Sem `approved_by` de propósito: o papel é que decide, e atrelar a '
  'obra a um user_id específico foi recusado no desenho.';
