import type { WorkStatusValues } from "@/lib/validations/work.schema"
import type { TasteStatePatch } from "@/server/queries/user-work-state"

/**
 * O bloco de AVALIAÇÃO que o "Salvar" do formulário de status (página da obra) grava: as 8 notas
 * craft e, só quando elas existem, a nota pessoal (`user_score`) que o formulário calcula delas.
 *
 * 🔴 Sem craft, a nota vem de outro caminho (as categorias de gosto, a nota direta, a importação) e o
 * campo do formulário é só o valor de quando a página abriu. Gravá-lo apagaria uma nota dada DEPOIS,
 * na mesma página, por um "Salvar" de status ou de capítulos. Sem a coluna, o upsert parcial a deixa
 * intacta (`updateWorkStatus` já trata o patch como parcial no diff do recálculo).
 */
export function ratingPatchFrom(data: WorkStatusValues): TasteStatePatch {
  const craft = {
    post_story_score: data.post_story_score ?? null,
    post_fl_score: data.post_fl_score ?? null,
    post_ml_score: data.post_ml_score ?? null,
    post_character_development_score: data.post_character_development_score ?? null,
    post_pacing_score: data.post_pacing_score ?? null,
    post_art_visual_score: data.post_art_visual_score ?? null,
    post_impact_immersion_score: data.post_impact_immersion_score ?? null,
    post_originality_score: data.post_originality_score ?? null,
  }
  const hasCraft = Object.values(craft).some((v) => v != null)
  return hasCraft ? { user_score: data.user_score ?? null, ...craft } : craft
}
