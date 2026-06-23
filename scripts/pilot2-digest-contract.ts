/**
 * CLI — escreve SOMENTE o manifesto local do CONTRATO do digest `text-only-v1` (Plano 3 B2.2Q
 * §14). Puro/local: NÃO acessa o banco, NÃO chama LLM, NÃO gera plano/planSignature/custo, NÃO
 * cria digests. Lê a `base2r1Signature` esperada do snapshot local e congela as assinaturas do
 * contrato. Idempotente (escrita atômica).
 *
 * Uso: npm run pilot2:digest-contract
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs"
import { resolve } from "node:path"
import {
  EXPERIMENT_DIGEST_VERSION,
  EXPERIMENT_DIGEST_PROMPT_VERSION,
  EXPERIMENT_DIGEST_SCHEMA_VERSION,
  EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION,
  EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION,
  EXPERIMENT_DIGEST_MODEL,
  EXPERIMENT_DIGEST_MAX_TOKENS,
  EXPERIMENT_DIGEST_TEMPERATURE_POLICY,
  EXPERIMENT_DIGEST_PRICING_VERSION,
  PROMPT_TEXT_CANONICALIZATION_VERSION,
  PROMPT_TEMPLATE_HASH,
  SCHEMA_HASH,
  computeDigestContractSignature,
  computeDigestImplementationSignature,
} from "@/lib/synopsis-interest/digest-text-only"

const DIR = ".local-experiments/plan3/digest-exp-1/pilot-2/base-2r1"
const SNAP = resolve(DIR, "base-2r1-snapshot.json")
const OUT = resolve(DIR, "digests-text-only-v1")

function main(): void {
  const snap = JSON.parse(readFileSync(SNAP, "utf8")) as { base2r1Signature: string }
  const contractSignature = computeDigestContractSignature()
  const implementationSignature = computeDigestImplementationSignature()
  const manifest = {
    kind: "digest-text-only-contract",
    executorStatus: "implemented-not-planned",
    adapterStatus: "implemented-not-executed",
    networkCalls: 0,
    digestContractSignature: contractSignature,
    digestImplementationSignature: implementationSignature,
    versions: {
      digestVersion: EXPERIMENT_DIGEST_VERSION,
      promptVersion: EXPERIMENT_DIGEST_PROMPT_VERSION,
      schemaVersion: EXPERIMENT_DIGEST_SCHEMA_VERSION,
      selectionPolicyVersion: EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION,
      corpusPolicyVersion: EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION,
      promptTextCanonicalizationVersion: PROMPT_TEXT_CANONICALIZATION_VERSION,
    },
    model: EXPERIMENT_DIGEST_MODEL,
    maxTokens: EXPERIMENT_DIGEST_MAX_TOKENS,
    temperaturePolicy: EXPERIMENT_DIGEST_TEMPERATURE_POLICY,
    pricingVersion: EXPERIMENT_DIGEST_PRICING_VERSION,
    promptTemplateHash: PROMPT_TEMPLATE_HASH,
    schemaHash: SCHEMA_HASH,
    corpusPolicyVersion: EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION,
    selectionPolicyVersion: EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION,
    expectedBase2r1Signature: snap.base2r1Signature,
    note: "Contrato congelado — NÃO é plano/planSignature/custo/autorização. Execução paga NÃO autorizada.",
  }

  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })
  const final = resolve(OUT, "digest-text-only-contract.json")
  const tmp = `${final}.tmp`
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n")
  renameSync(tmp, final)

  console.log("=== contrato digest text-only-v1 (manifesto local, $0) ===")
  console.log(`digestContractSignature:       ${contractSignature}`)
  console.log(`digestImplementationSignature: ${implementationSignature}`)
  console.log(`promptTextCanonicalizationVersion: ${PROMPT_TEXT_CANONICALIZATION_VERSION}`)
  console.log(`model=${EXPERIMENT_DIGEST_MODEL} maxTokens=${EXPERIMENT_DIGEST_MAX_TOKENS} temp=${EXPERIMENT_DIGEST_TEMPERATURE_POLICY} pricing=${EXPERIMENT_DIGEST_PRICING_VERSION}`)
  console.log(`expectedBase2r1Signature: ${snap.base2r1Signature}`)
  console.log(`executorStatus: implemented-not-planned · adapterStatus: implemented-not-executed · networkCalls: 0`)
  console.log(`artefato: ${final}`)
  console.log(`SEM plano/planSignature/custo/LLM/job. base-2/base-2r1/digests de produção intocados.`)
}

main()
