-- Armazena os metadados e rubricas de cada critério de avaliação.
-- Sync via: npm run sync-constants
CREATE TABLE IF NOT EXISTS config_criteria (
  slug          TEXT PRIMARY KEY,
  display_order INT  NOT NULL DEFAULT 0,
  name          TEXT NOT NULL,
  emoji         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  rubric_title  TEXT,
  rubric_ranges TEXT[] NOT NULL DEFAULT '{}',
  rubric_note   TEXT
);

-- Labels dos status de publicação, pessoal, qualidade de sinopse e plataformas.
-- type: 'publication' | 'personal' | 'synopsis_quality' | 'platform'
CREATE TABLE IF NOT EXISTS config_labels (
  type          TEXT NOT NULL,
  code          TEXT NOT NULL,
  label         TEXT NOT NULL,
  display_order INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (type, code)
);

-- Seed com os valores atuais de criteria.ts
INSERT INTO config_criteria (slug, display_order, name, emoji, description, rubric_title, rubric_ranges) VALUES
  ('romance',          1, 'Romance',           '💕', 'Nível de romance da história',                      'Romance',            ARRAY[
    '0-3 | Ausente / irrelevante: não tem romance ou é totalmente secundário; pode ter crush leve que não impacta nada.',
    '4-6 | Subplot: romance existe, mas não guia a história; desenvolvimento lento ou pouco foco.',
    '7-8 | Core romance: romance é um dos pilares da história e impacta decisões, conflitos e evolução.',
    '9-10 | Romance-driven: a história é sobre o romance; o plot gira em torno do relacionamento.'
  ]),
  ('couple_dynamics',  2, 'Dinâmica do Casal', '💑', 'Química e desenvolvimento do casal principal',      'Dinâmica do Casal',  ARRAY[
    '0-3 | Dinâmica de obsessão, controle, toxicidade, abuso emocional, manipulação ou relação majoritariamente prejudicial.',
    '4-6 | Há mal-entendidos eventuais, ciúme e algum nível de conflito.',
    '7-8 | Relacionamento saudável, com alguns conflitos eventuais, mas trabalhados e resolvidos relativamente rápido.',
    '9-10 | Dinâmica leve, divertida e saudável; parceria, desenvolvimento mútuo e boa comunicação.'
  ]),
  ('fantasy_nobility', 3, 'Fantasia/Nobreza',  '👑', 'Elementos de fantasia, nobreza e mundo medieval',  'Fantasia/Nobreza',   ARRAY[
    '0-3 | Realista / residual: mundo normal ou fantasia irrelevante; fantasia como estética, por exemplo ''é príncipe'', mas isso não importa.',
    '4-6 | Presente: elementos de fantasia/nobreza existem e influenciam algumas partes da história.',
    '7-8 | Estrutural: sistema de magia, política nobre, aristocracia, reencarnação, nobreza ou fantasia afetam conflitos principais.',
    '9-10 | Dominante: o mundo é construído em cima disso; regras de fantasia/nobreza definem a história.'
  ]),
  ('action_adventure', 4, 'Ação/Aventura',     '⚔️', 'Cenas de ação, combate e aventura',                'Ação/Aventura',      ARRAY[
    '0-3 | Principalmente slice of life: ritmo mais parado, eventos cotidianos.',
    '4-6 | Ritmo um pouco mais agitado, mas sem grandes eventos ou desenrolar emocionante.',
    '7-8 | Presença constante de situações marcantes, ritmo acelerado, protagonistas envolvidos em eventos significativos para o mundo.',
    '9-10 | Raramente há momentos parados/cotidianos; protagonistas em missão para salvar/mudar o mundo/história ou centro de eventos extremamente marcantes.'
  ]),
  ('adult_content',    5, 'Conteúdo Adulto',   '🔥', 'Intensidade de conteúdo adulto',                   'Conteúdo Adulto',    ARRAY[
    '0-3 | Clean: sem sexualização relevante; no máximo beijo leve ou sugestão implícita.',
    '4-6 | Suggestive: insinuação clara, roupas/situações/tensão sexual; pode ter cena cortada/fade to black.',
    '7-8 | Mature: sexo parcialmente mostrado, sem foco explícito; nudez e contexto sexual relevante para a trama.',
    '9-10 | Smut: sexo explícito recorrente; foco no ato, não só na narrativa.'
  ]),
  ('protagonist',      6, 'Protagonista',      '🦸', 'Força e carisma da protagonista',                  'Protagonista Marcante', ARRAY[
    '0-3 | Fraco / genérico: esquecível, sem personalidade clara; poderia ser trocado sem grande diferença.',
    '4-6 | Funcional: tem personalidade básica e conduz a história, mas não brilha.',
    '7-8 | Forte: presença clara, decisões relevantes, personalidade consistente; destaca-se por força, inteligência ou habilidade.',
    '9-10 | Icônico / overpowered: carrega a obra; mesmo sem plot, o protagonista sustentaria o interesse.'
  ]),
  ('humor',            7, 'Humor',             '😂', 'Presença e qualidade do humor',                    'Humor',              ARRAY[
    '0-3 | Ausente: quase nenhum humor; tom sério o tempo todo.',
    '4-6 | Pontual: piadas ocasionais; alívio cômico, não base do tom.',
    '7-8 | Presente: humor aparece com frequência em diálogos ou estilo visual; parte importante do tom.',
    '9-10 | Dominante: comédia frequente, piadas, sátiras ou bom humor marcante; até cenas sérias podem ter humor.'
  ]),
  ('drama',            8, 'Drama',             '🎭', 'Nível de drama (penalidade acima de 5)',            'Drama',              ARRAY[
    '0-3 | Leve: pouco conflito emocional; problemas simples, resolução rápida.',
    '4-6 | Moderado: conflitos existem; emoção presente, mas controlada.',
    '7-8 | Intenso: conflitos profundos e recorrentes; impactam decisões e ritmo da história.',
    '9-10 | Dominante: emoção marcante durante toda a obra; alta carga emocional.'
  ]),
  ('tragedy',          9, 'Tragédia',          '💔', 'Nível de tragédia (penalidade acima de 3)',         'Tragédia',           ARRAY[
    '0-3 | Ausente: nada muito trágico acontece.',
    '4-6 | Leve: eventos tristes, reversíveis ou pouco impactantes; perdas e traumas aparecem como contexto/background, mas não são o foco.',
    '7-8 | Pesada: mortes ou perdas importantes acontecem no meio da obra e impactam o desenvolvimento dos personagens principais, causando vários capítulos de ruptura/conflito.',
    '9-10 | Brutal: sofrimento constante ou extremo; sensação forte de inevitabilidade ou injustiça.'
  ])
ON CONFLICT (slug) DO NOTHING;

UPDATE config_criteria
SET rubric_note = 'Considere tragédia apenas o que ocorre no meio do desenvolvimento da história, não apenas o cenário inicial/backstory.'
WHERE slug = 'tragedy';

-- Labels de publicação
INSERT INTO config_labels (type, code, label, display_order) VALUES
  ('publication', 'C',       'Completo',       1),
  ('publication', 'H',       'Hiato',          2),
  ('publication', 'O',       'Em andamento',   3),
  ('publication', 'D',       'Droppado',       4),
  ('publication', 'Unknown', 'Desconhecido',   5)
ON CONFLICT (type, code) DO NOTHING;

-- Labels de status pessoal
INSERT INTO config_labels (type, code, label, display_order) VALUES
  ('personal', 'Ler',           'Para ler',              1),
  ('personal', 'Finalizado',    'Finalizado',            2),
  ('personal', 'Lendo',         'Lendo',                 3),
  ('personal', 'Retomar',       'Retomar',               4),
  ('personal', 'Retomar (tenso)', 'Retomar (tenso)',     5),
  ('personal', 'Droppado',      'Droppado',              6),
  ('personal', 'Pausado',       'Pausado',               7),
  ('personal', 'Esp. Temp',     'Esperando temporada',   8)
ON CONFLICT (type, code) DO NOTHING;

-- Labels de qualidade de sinopse
INSERT INTO config_labels (type, code, label, display_order) VALUES
  ('synopsis_quality', '♥',    'Fraca',   1),
  ('synopsis_quality', '♥♥',   'Regular', 2),
  ('synopsis_quality', '♥♥♥',  'Boa',     3),
  ('synopsis_quality', '♥♥♥♥', 'Ótima',   4)
ON CONFLICT (type, code) DO NOTHING;

-- Labels de plataformas
INSERT INTO config_labels (type, code, label, display_order) VALUES
  ('platform', 'mangaupdates',   'MangaUpdates', 1),
  ('platform', 'manga-updates',  'MangaUpdates', 2),
  ('platform', 'animeplanet',    'AnimePlanet',  3),
  ('platform', 'anime-planet',   'AnimePlanet',  4),
  ('platform', 'comick',         'ComicK',       5),
  ('platform', 'ani-list',       'AniList',      6),
  ('platform', 'anilist',        'AniList',      7),
  ('platform', 'comix',          'Comix',        8)
ON CONFLICT (type, code) DO NOTHING;
