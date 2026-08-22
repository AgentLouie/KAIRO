CREATE TABLE feature_sets (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL REFERENCES tokens(mint),
  observed_at TIMESTAMPTZ NOT NULL,
  engine_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'insufficient_data')),
  momentum_score INTEGER CHECK (momentum_score >= 0 AND momentum_score <= 100),
  metrics JSONB NOT NULL,
  reasons JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX feature_sets_token_observed_idx
  ON feature_sets (token_mint, observed_at DESC);
