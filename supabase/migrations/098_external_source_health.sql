-- ============================================================
-- 098 - external_source_health: telemetria de saúde das fontes externas
-- ============================================================
-- Snapshot persistente do estado observado de cada fonte externa de scraping
-- (hoje só "comix"). Alimentado fire-and-forget pelo ComixGate
-- (lib/external/comix-gate.ts), que deriva o status do tráfego real. Persistir
-- dá visibilidade que sobrevive a restart e fica acessível fora do processo
-- (ex.: indicador no chrome / alerta de "Comix fora").
--
-- 1 linha por fonte (PRIMARY KEY = source); upsert onConflict=source. O ComixGate
-- só escreve em MUDANÇA de estado ou num heartbeat de 5min — não a cada chamada.
-- ============================================================

CREATE TABLE IF NOT EXISTS external_source_health (
  source TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_ok_at TIMESTAMPTZ,
  last_fail_at TIMESTAMPTZ,
  fail_reason TEXT,
  consecutive_fails INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE external_source_health IS
  'Snapshot de saúde por fonte externa de scraping (ex.: comix), alimentado fire-and-forget pelo ComixGate. 1 linha por fonte.';
COMMENT ON COLUMN external_source_health.status IS
  'Estado observado: ok | degraded | down | unknown.';
COMMENT ON COLUMN external_source_health.fail_reason IS
  'Motivo da última falha (ex.: api_auth_required, cloudflare_challenge, flaresolverr_unavailable, network_error).';
COMMENT ON COLUMN external_source_health.consecutive_fails IS
  'Falhas consecutivas desde o último sucesso (0 quando saudável).';

ALTER TABLE external_source_health ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).
