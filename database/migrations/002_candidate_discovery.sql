CREATE TABLE candidates (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL REFERENCES tokens(mint),
  source TEXT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('observing', 'rejected', 'released')),
  reason TEXT,
  liquidity_usd NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX candidates_status_discovered_idx
  ON candidates (status, discovered_at DESC);

CREATE UNIQUE INDEX candidates_active_token_idx
  ON candidates (token_mint)
  WHERE status = 'observing';
