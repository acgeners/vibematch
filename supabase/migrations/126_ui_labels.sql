-- 126_ui_labels.sql
-- Nomes de exibição + tooltips "soltos" da UI (que NÃO têm casa em outra tabela),
-- com o Supabase como fonte da verdade. `npm run sync-constants` lê esta tabela e
-- gera lib/constants/ui-labels.ts (constante LABELS).
--
--   field = nome da variável usada nas fórmulas (ex.: synopsis_pred). PK.
--           Vira LABELS.<field> no código → precisa ser identificador JS válido.
--   name_full / name_short / name_abbrev = 3 formas do nome (completo/curto/abreviado).
--     (prefixo name_ evita a palavra reservada `full`; no TS vira full/short/abbrev)
--   tooltip_full  = tooltip canônica/completa (explica o CONCEITO do campo).
--   tooltip_short = tooltip resumida.
--
-- NÃO colocar aqui labels que já vêm de outra tabela (criteria/status/source) —
-- duplicaria e criaria drift. Ver PLANO-LABELS-CENTRALIZADOS.md.

-- Recria do zero: uma versão ANTIGA (group/key/label) chegou a ser aplicada, e
-- `create table if not exists` não corrige o schema por cima. Re-rodar esta
-- migration RESETA a tabela pros valores-semente abaixo — depois de começar a
-- editar labels direto no Supabase, NÃO re-rode (perderia as edições).
drop table if exists ui_labels;

create table ui_labels (
  field         text primary key,
  category      text,
  name_full     text not null,
  name_short    text not null,
  name_abbrev   text not null,
  tooltip_full  text,
  tooltip_short text,
  sort_order    int  not null default 0,
  updated_at    timestamptz not null default now()
);

comment on table ui_labels is
  'Nomes de exibição + tooltips soltos da UI. Fonte de LABELS via sync-constants (lib/constants/ui-labels.ts). field = nome da variável no código.';

-- Consistente com o resto do schema: RLS ligado, sem policy (anon bloqueado;
-- o service role do sync-constants bypassa RLS).
alter table ui_labels enable row level security;

insert into ui_labels (field, category, name_full, name_short, name_abbrev, tooltip_full, tooltip_short, sort_order) values
  ('decision',            'score', 'Prioridade de leitura',      'Prioridade',         'Prior.',      'Quão provável que você goste — número único (0–10) pra priorizar o que ler primeiro. Ancorado na Nota Prevista (que já embute o Alinhamento) e ajustado pelo Veredito IA quando existe. É PRIORIDADE, não previsão de nota.', 'Número pra priorizar o que ler primeiro (não é previsão de nota).', 1),
  ('expected_score',      'score', 'Nota Prevista',              'Prevista',           'Prev.',       'Nota que o modelo prevê que você daria à obra (0–10). É a âncora calibrada — uma regressão Ridge treinada nas suas notas.', 'Nota que o modelo prevê que você daria (0–10).', 2),
  ('calc_score',          'score', 'Nota.Calc',                  'Nota.Calc',          'Calc',        'Nota determinística de ensemble — âncora interna do preditor, não é a nota headline.', 'Âncora interna do preditor.', 3),
  ('personal_fit',        'score', 'Alinhamento',                'Alinhamento',        'Alinh.',      'O quanto a obra combina com seu perfil de gosto, como percentil na sua biblioteca (0–100; Top 25% = ≥75). Junta tags amadas/evitadas, faixas ideais de critério e consistência geral.', 'O quanto a obra combina com seu perfil (percentil 0–100).', 4),
  ('platform_avg',        'score', 'Média externa',              'Nota.M',             'N.M',         'Média ponderada das notas das plataformas externas (AniList, MAL, etc.), 0–10. Pondera mais as fontes com mais votos.', 'Média ponderada das notas externas (0–10).', 5),
  ('total_votes',         'score', 'Votos externos',             'Votos',              'Votos',       'Total de votos/avaliações somados nas plataformas externas. Quanto maior, mais confiável é a Nota.M.', 'Total de votos nas plataformas externas.', 6),
  ('alignment_score',     'score', 'Veredito IA',                'Veredito',           'Ver.',        'Veredito do consultor IA (0–100), gerado sob demanda. Reordena as recomendações e ajusta a Prioridade — a maioria das obras fica sem valor até passar pelo Rankear.', 'Veredito do consultor IA (0–100).', 7),
  ('synopsis_q',          'score', 'Interesse na obra (user)',   'Interesse',          'Sinopse',     'O quanto a obra te interessou (♥ a ♥♥♥♥), informado por você na triagem/avaliação.', 'Seu interesse informado (♥ a ♥♥♥♥).', 8),
  ('synopsis_pred',       'score', 'Interesse na obra previsto', 'Interesse previsto', 'Int. Prev.',  'Previsão da IA de quanto a obra vai te interessar (♥ a ♥♥♥♥), com base no seu perfil. Diferente de "Interesse na obra (user)", que é o que você informou. Só na feature Paga.', 'Previsão da IA do seu interesse (♥ a ♥♥♥♥).', 9),
  ('fav',                 'basic', 'Favorito',                   'Favorito',           'Fav',         'Indica se a obra está marcada como favorita.', 'Marcada como favorita.', 10),
  ('title',               'basic', 'Título',                     'Título',             'Título',      null, null, 11),
  ('publication_status',  'basic', 'Status de publicação',       'Publicação',         'Pub.',        'Status de publicação da obra na fonte (em andamento, concluída, hiato, cancelada).', 'Status de publicação na fonte.', 12),
  ('personal_status',     'basic', 'Status pessoal',             'Status pessoal',     'Status',      'Seu status de leitura para a obra (pra ler, lendo, concluída, etc.).', 'Seu status de leitura.', 13),
  ('chapters_total',      'basic', 'Capítulos totais',           'Capítulos',          'Caps.',       'Número total de capítulos da obra, quando conhecido.', 'Total de capítulos.', 14),
  ('chapters_read',       'basic', 'Capítulos lidos',            'Lidos',              'Lidos',       'Quantos capítulos você já marcou como lidos.', 'Capítulos que você leu.', 15),
  ('chapters_progress',   'basic', 'Progresso de leitura',       '% lido',             '% Lido',      'Progresso de leitura: capítulos lidos ÷ total de capítulos.', 'Capítulos lidos ÷ total.', 16),
  ('year',                'basic', 'Ano de lançamento',          'Ano',                'Ano',         'Ano de lançamento/início da publicação.', 'Ano de lançamento.', 17),
  ('ai_status',           'basic', 'Status da avaliação IA',     'Avaliação IA',       'IA',          'Estágio da avaliação por IA: pendente de atributos, pendente de Veredito IA, avaliado ou pulado.', 'Estágio da avaliação por IA.', 18),
  ('updated_at',          'basic', 'Atualizado em',              'Atualizado',         'Atual.',      'Quando o registro da obra foi atualizado pela última vez.', 'Última atualização do registro.', 19),
  ('last_read_at',        'basic', 'Última leitura',             'Última leitura',     'Últ. leit.',  'Data da última vez que você leu algum capítulo desta obra.', 'Sua última leitura.', 20)
on conflict (field) do nothing;
