-- ============================================================
-- 191 - bucket "avatars": a metade de Storage da migration 090
--       nunca chegou a ESTE projeto.
-- ============================================================
-- Medido em 2026-08-14 contra a nuvem (obwlwu…pizd): `storage.buckets` tinha
-- APENAS `criteria-icons`. O `uploadAvatar` de `server/actions/account.ts` existe
-- desde a 090 e falharia em toda tentativa — botão que não funciona, com a
-- mensagem de erro do Storage.
--
-- Por que a 090 não basta: ela roda `INSERT INTO storage.buckets` com
-- `ON CONFLICT DO NOTHING`, e as migrations deste projeto são aplicadas à mão via
-- Management API (`[db.migrations] enabled = false` no config.toml). O projeto
-- atual foi criado DEPOIS daquela aplicação; o `avatar_url` do dono ainda apontava
-- para `djbreiyzwoevbmoscqiq.supabase.co`, um projeto que nem resolve mais em DNS.
-- Ou seja: o bucket existiu, mas no projeto anterior.
--
-- ⚠️ `db:pull` dumpa só o schema `public`, então o stack LOCAL também não tem o
-- bucket e nunca vai ter por replicação — quem quiser testar upload no local roda
-- este arquivo lá também.
--
-- ⚠️ Isto NÃO cobre o avatar montado em /conta: ele é desenhado pela rota
-- `/avatar.svg` a partir da query string e não toca Storage. O bucket serve só pra
-- quem envia uma imagem própria.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MiB; `MAX_AVATAR_BYTES` em server/actions/account.ts espelha este número
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Sem policy em `storage.objects` de propósito: o upload passa pela service role
-- (`createAdminClient`), que ignora RLS, e o bucket é público na leitura. É o mesmo
-- padrão "service-role-only" do resto do projeto — ver a 090.
