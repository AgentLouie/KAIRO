CREATE TABLE risk_assessments (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL REFERENCES tokens(mint),
  observed_at TIMESTAMPTZ NOT NULL,
  engine_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('assessed', 'insufficient_data', 'rejected')),
  risk_score INTEGER CHECK (risk_score >= 0 AND risk_score <= 100),
  evidence JSONB NOT NULL,
  reasons JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX risk_assessments_token_observed_idx ON risk_assessments (token_mint, observed_at DESC);
