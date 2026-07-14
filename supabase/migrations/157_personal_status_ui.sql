-- 157 — a cor e a descrição de cada status também são dados do Supabase.
--
-- Dois mapas no código estavam MORTOS e ninguém tinha percebido:
--
--   components/dashboard/status-distribution.tsx — cores por NOME, com entrada para "Completed".
--     Como o status virou "Finished", as 74 obras terminadas estão HOJE sem cor no gráfico do
--     dashboard (caem no fallback). Um bug visível que ninguém reportou.
--
--   lib/constants/personal-status-descriptions.ts — descrições por NOME, com entrada para
--     "Paused" (um status que NUNCA existiu nesta tabela) e SEM entrada para "Finished",
--     "Read Again", "Not Now" e "Untracked".
--
-- Os valores abaixo preservam o que o código já usava. As lacunas (os 4 status sem descrição, e o
-- "Completed" que virou "Finished") foram preenchidas aqui — é a primeira vez que esses status
-- ganham cor/descrição de verdade.

alter table public.personal_status
  add column if not exists bg_class       text,
  add column if not exists description_pt text;

comment on column public.personal_status.bg_class is
  'Classe Tailwind de fundo (gráfico de distribuição do dashboard). Vem daqui, não de um mapa por nome no código.';
comment on column public.personal_status.description_pt is
  'Descrição em PT exibida no seletor de status. O `comment` é a nota interna em EN; esta é a voltada ao usuário.';

update public.personal_status set bg_class = case slug
  when 'reading'      then 'bg-emerald-500'   -- já era
  when 'started'      then 'bg-violet-500'    -- já era
  when 'want-to-read' then 'bg-slate-400'     -- já era
  when 'on-hold'      then 'bg-slate-500'     -- já era
  when 'stalled'      then 'bg-orange-500'    -- já era
  when 'hiatus'       then 'bg-cyan-500'      -- já era
  when 'dropped'      then 'bg-red-500'       -- já era
  when 'finished'     then 'bg-blue-500'      -- era a cor de "Completed"; estava sem cor desde o rename
  when 'read_again'   then 'bg-teal-500'      -- NOVO (status criado em 2026-07-12, nunca teve cor)
  when 'not_now'      then 'bg-stone-400'     -- NOVO
  when 'untracked'    then 'bg-zinc-400'      -- NOVO (667 obras, e nunca teve cor)
end;

update public.personal_status set description_pt = case slug
  when 'started'      then 'Comecei a leitura recentemente, ainda não terminei'
  when 'stalled'      then 'Comecei e pausei por tensão na história — pretendo terminar'
  when 'hiatus'       then 'Aguardando nova temporada / retorno do título'
  when 'on-hold'      then 'Comecei, planejo retomar, mas preciso reler antes'
  when 'want-to-read' then 'Não comecei — está na lista de leitura'
  when 'dropped'      then 'Abandonado, não pretendo continuar'
  when 'reading'      then 'Estou lendo e acompanhando os capítulos novos'
  when 'finished'     then 'Terminei de ler'                                      -- NOVO
  when 'read_again'   then 'Já li e estou relendo'                                -- NOVO
  when 'not_now'      then 'Não me interessa agora, mas não descartei de vez'     -- NOVO
  when 'untracked'    then 'Está no catálogo, sem status de leitura ativo'        -- NOVO
end;

-- Nenhum status pode ficar sem cor/descrição: o gráfico do dashboard e o seletor de status
-- percorrem TODOS os status da tabela. Um buraco aqui é uma fatia sem cor e um item sem texto —
-- exatamente o que acontecia com "Finished" e não estourava em lugar nenhum.
do $$
declare n integer;
begin
  select count(*) into n from public.personal_status
   where bg_class is null or description_pt is null;
  if n > 0 then
    raise exception '% status sem bg_class/description_pt', n;
  end if;
end $$;
