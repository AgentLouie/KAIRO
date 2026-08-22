CREATE TABLE signals (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL REFERENCES tokens(mint),
  observed_at TIMESTAMPTZ NOT NULL,
  strategy_version TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('paper_buy', 'watch', 'reject')),
  reasons JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX signals_token_observed_idx ON signals (token_mint, observed_at DESC);
