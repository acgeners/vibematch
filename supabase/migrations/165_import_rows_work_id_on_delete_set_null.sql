-- 165_import_rows_work_id_on_delete_set_null.sql
-- Conserta o `deleteWork` pra obras que vieram de import.
--
-- Sintoma: apagar obra falhava com
--   `update or delete on table "works" violates foreign key constraint
--    "import_rows_work_id_fkey" on table "import_rows"`
--
-- Causa: das 29 FKs que apontam pra `works`, 28 foram criadas com `ON DELETE CASCADE`.
-- A de `import_rows.work_id` (migration 001, linha 186) saiu SEM cláusula de delete —
-- logo `NO ACTION`, que BLOQUEIA o delete do pai. Não era escolha de design, era
-- omissão: a coluna nasceu nullable e o app já grava `work_id: null` nas linhas que
-- não viraram obra (`recordRow` em server/actions/external-list-import.ts).
-- Consequência: toda obra que passou por algum dos imports ficava INDELETÁVEL — hoje
-- 73 das 74 linhas de `import_rows` apontam pra uma obra.
--
-- Por que SET NULL e não CASCADE: `import_rows` é o log linha-a-linha de um import, e
-- `imports.total_rows` conta essas linhas. CASCADE apagaria o registro histórico e
-- deixaria um import de N linhas mostrando menos de N — perda de auditoria silenciosa
-- por um evento (apagar obra) que não tem nada a ver com o import. SET NULL preserva
-- a linha e só desfaz o vínculo, que é exatamente o que aconteceu no mundo real.
--
-- Não toca em dado (só troca a regra da constraint). `lock_timeout` porque
-- `add constraint` pega ShareRowExclusive em `works` e em `import_rows`: com o app
-- escrevendo em `works` isso pode ficar em fila (ver o aviso na migration 142) —
-- melhor falhar em 5s e repetir com o dev server parado do que travar o app.

set local lock_timeout = '5s';

alter table import_rows
  drop constraint import_rows_work_id_fkey;

alter table import_rows
  add constraint import_rows_work_id_fkey
  foreign key (work_id) references works(id) on delete set null;
