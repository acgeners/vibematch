-- ============================================================
-- 090 - user_settings: perfil editável (nome/email/avatar) +
--       bucket público de avatares no Storage.
-- ============================================================
-- A área /conta passa a ser editável (nome, email, imagem). Hoje
-- o app é single-user, então o perfil mora na linha singleton de
-- user_settings — mesma estratégia já usada por current_user_id
-- e user_plan. Quando o multi-user/auth entrar, a fonte desses
-- campos vira a sessão, sem tocar nos callers.
--
-- O avatar pode ser uma URL colada OU um arquivo enviado pro
-- bucket público 'avatars'. Bucket público => leitura sem auth
-- (servido em /storage/v1/object/public/...). O upload é feito
-- via service role, que bypassa RLS — então não precisamos de
-- policy em storage.objects e mantemos o padrão "service-role-only"
-- do projeto.
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS email        TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url   TEXT;

COMMENT ON COLUMN user_settings.display_name IS
  'Nome de exibição do usuário (editável em /conta). Vira o nome da sessão no futuro multi-user.';
COMMENT ON COLUMN user_settings.email IS
  'Email do usuário (informativo enquanto não há auth; editável em /conta).';
COMMENT ON COLUMN user_settings.avatar_url IS
  'URL do avatar: link colado OU arquivo no bucket público "avatars".';

-- Bucket público de avatares (idempotente). 2 MiB de limite e só imagens.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;
