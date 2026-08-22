CREATE TABLE paper_portfolios (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  starting_balance_sol NUMERIC NOT NULL CHECK (starting_balance_sol > 0),
  cash_balance_sol NUMERIC NOT NULL CHECK (cash_balance_sol >= 0),
  realized_pnl_sol NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE paper_positions (
  id BIGSERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL REFERENCES tokens(mint),
  signal_id BIGINT REFERENCES signals(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  entry_price_usd NUMERIC NOT NULL CHECK (entry_price_usd > 0),
  entry_sol_usd NUMERIC NOT NULL CHECK (entry_sol_usd > 0),
  entry_notional_sol NUMERIC NOT NULL CHECK (entry_notional_sol > 0),
  entry_fee_sol NUMERIC NOT NULL CHECK (entry_fee_sol >= 0),
  token_quantity NUMERIC NOT NULL CHECK (token_quantity > 0),
  stop_loss_price_usd NUMERIC NOT NULL CHECK (stop_loss_price_usd > 0),
  intended_loss_sol NUMERIC NOT NULL CHECK (intended_loss_sol > 0),
  execution_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX paper_positions_open_idx ON paper_positions (status, opened_at DESC);

CREATE TABLE paper_trades (
  id BIGSERIAL PRIMARY KEY,
  position_id BIGINT NOT NULL REFERENCES paper_positions(id),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  executed_at TIMESTAMPTZ NOT NULL,
  price_usd NUMERIC NOT NULL CHECK (price_usd > 0),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  notional_sol NUMERIC NOT NULL CHECK (notional_sol > 0),
  fee_sol NUMERIC NOT NULL CHECK (fee_sol >= 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
