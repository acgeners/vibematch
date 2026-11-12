-- Rollback da 220. Rode ANTES de voltar o app para um código anterior a ela: o painel "Reviews do
-- catálogo" lê `works.reviews_checked_at` e a fila de /curation/works chama `work_review_growth`.
-- Apagar a coluna perde só as datas de última busca (o lote volta a considerar tudo "nunca buscado").
-- O ajuste de `work_reviews.created_at` das reviews da criação NÃO volta por aqui: ele deixa a data
-- verdadeira (a da avaliação que as leu), e o valor anterior está no backup.

drop function if exists public.work_review_growth(uuid[]);
alter table public.works drop column if exists reviews_checked_at;
