CREATE TABLE tokens (
  mint TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL REFERENCES tokens(mint),
  observed_at TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL,
  price_usd NUMERIC,
  market_cap_usd NUMERIC,
  liquidity_usd NUMERIC,
  volume_1m_usd NUMERIC,
  buy_volume_1m_usd NUMERIC,
  sell_volume_1m_usd NUMERIC,
  buys_1m INTEGER,
  sells_1m INTEGER,
  unique_traders_1m INTEGER,
  unique_buyers_1m INTEGER,
  unique_sellers_1m INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX market_snapshots_token_observed_idx
  ON market_snapshots (token_mint, observed_at DESC);

CREATE TABLE strategy_configs (
  id UUID PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(strategy_id, version)
);

CREATE TABLE strategy_runs (
  id UUID PRIMARY KEY,
  strategy_config_id UUID NOT NULL REFERENCES strategy_configs(id),
  mode TEXT NOT NULL CHECK (mode IN ('forward-paper', 'backtest')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE system_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level TEXT NOT NULL,
  event_type TEXT NOT NULL,
  correlation_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB
);
