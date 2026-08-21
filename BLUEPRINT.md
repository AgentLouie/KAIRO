# Pump Momentum Scout — Technical Blueprint

## 1. Goal and boundaries

Pump Momentum Scout is a server-side research engine for Solana memecoin strategies. It must discover candidates, observe them, produce deterministic paper-trading signals, simulate realistic execution, and retain enough data to evaluate a strategy honestly.

The MVP is **paper trading only**. It will not request, store, or use a wallet private key. A future live-execution adapter may exist behind an interface, but it is deliberately out of scope.

The existing Paper Trader Chrome extension remains an independent manual-trading UI. Later, it can read positions and signals through an HTTP/WebSocket API, but the scout must run without a browser.

## 2. Key engineering decisions

| Concern | Decision | Reason |
| --- | --- | --- |
| Runtime | Node.js 22 + strict TypeScript | One reliable language for real-time processing, API, jobs, and tests. |
| Application style | Modular monolith | Easier to build, debug, and deploy than microservices; modules retain clean boundaries. |
| Database | PostgreSQL 16 | Durable transactional trade records, time-series queries, JSON evidence, and migrations. |
| ORM/migrations | Prisma | Type-safe database access and repeatable schema migrations. |
| HTTP/API | Fastify | Lightweight health, dashboard, and integration endpoints. |
| Market provider | Birdeye primary adapter | Suitable unified market, token, and real-time feed layer, subject to plan limits. |
| Chain verification | Helius primary adapter | Enhanced transactions, RPC, and WebSocket subscriptions for Solana verification. |
| GMGN | Optional enrichment only | Do not depend on scraping or a non-guaranteed public data API. |
| Logging | Pino JSON logs | Searchable structured events with correlation IDs. |
| Config validation | Zod | Reject missing or unsafe settings before the process starts. |
| Test framework | Vitest | Fast unit and integration test runner for TypeScript. |

## 3. Provider reality check

Provider data is not truth by itself. Every normalized value carries its source and observation time.

- Birdeye is the preferred initial source for discovery, prices, liquidity, OHLCV, token statistics, and trade-flow data. Its live capabilities and token/concurrent-connection limits depend on the selected plan.
- Helius provides Solana RPC, enhanced transaction interpretation, and subscriptions. It is best used to verify important chain facts and observe selected tokens rather than to poll every token continuously.
- GMGN is useful to a human but must remain an optional enrichment adapter. The system must still operate if it is unavailable.
- Wallet clusters, insider labels, and developer attribution are estimates. They may be missing or wrong, so they must be stored as evidence with confidence—not used as asserted facts.

## 4. Architecture

```text
Provider WebSockets / REST / RPC
             |
             v
  Provider adapters -> Normalizer -> Event bus
                                      |
      +-------------------------------+-------------------------------+
      |                               |                               |
      v                               v                               v
 Discovery service              Snapshot writer                 Data-quality guard
      |                               |                               |
      v                               v                               v
 Candidate monitor ----> Feature engine ----> Risk engine ----> Strategy engine
                                                                  |
                                                                  v
                                                          Signal / rejection log
                                                                  |
                                                                  v
                                                          Paper execution engine
                                                                  |
                                                                  v
                                                  Position manager + performance metrics
                                                                  |
                                                                  v
                                                   PostgreSQL <-> Fastify API / dashboard
```

All modules communicate with typed domain events. Database writes are durable, while the in-process event bus is only a delivery mechanism; a restart must reconstruct active monitors and positions from PostgreSQL.

## 5. Project layout

```text
src/
  api/                 # REST, WebSocket and health endpoints
  config/              # Environment validation and strategy configuration
  core/                # Domain models, errors, clocks, event contracts
  providers/           # birdeye/, helius/, solana-rpc/, optional gmgn/
  discovery/           # New-token feed and candidate lifecycle
  market-data/         # Normalization, snapshot collection, freshness checks
  features/            # Windowed volume, trade-flow, price and liquidity features
  wallet-analysis/     # Holder concentration and attribution evidence
  risk/                # Deterministic rejection rules and risk scoring
  strategies/          # Strategy interface and implementations
  signals/             # Explainable signal persistence and deduplication
  execution/paper/     # Fill, fee, slippage and partial-exit simulation
  positions/           # Stops, targets, trailing logic and portfolio limits
  analytics/           # Run and trade metrics
  backtesting/         # Historical replay using stored canonical events
  database/            # Prisma client, repositories, migrations
  workers/             # Feed connections, scheduler and graceful shutdown
  observability/       # Logging, metrics and alert hooks
tests/
  unit/
  integration/
  fixtures/
```

## 6. Canonical internal models

Provider-specific responses never reach strategy code directly. They are normalized into these concepts:

```ts
Token {
  mint: string;
  symbol?: string;
  createdAt?: Date;
  source: 'pump_fun' | 'unknown';
}

MarketSnapshot {
  tokenMint: string;
  observedAt: Date;
  source: string;
  priceUsd?: number;
  marketCapUsd?: number;
  liquidityUsd?: number;
  volume1mUsd?: number;
  buys1m?: number;
  sells1m?: number;
  uniqueBuyers1m?: number;
  uniqueSellers1m?: number;
  freshnessMs: number;
}

FeatureSet {
  tokenMint: string;
  observedAt: Date;
  priceReturn30s: number;
  volumeAcceleration: number;
  tradeAcceleration: number;
  buyVolumeRatio: number;
  liquidityGrowth: number;
  buyerConcentration?: number;
  dataQuality: 'good' | 'degraded' | 'stale';
}

Decision {
  action: 'buy' | 'ignore' | 'exit';
  strategyId: string;
  score: number;
  reasons: Reason[];
  observedAt: Date;
}
```

Numeric market data uses decimals in code/database, never JavaScript floating-point values for balances or fills. USD display formatting happens only at the UI boundary.

## 7. Candidate discovery and lifecycle

1. Receive a candidate from the discovery provider.
2. Validate the mint address and deduplicate it.
3. Create a `candidate` record and start a short observation session; do not buy.
4. Collect snapshots over configured windows, initially 15 seconds, 30 seconds, 1 minute, and 3 minutes.
5. Reject immediately only for hard safety/data-quality failures.
6. Compute features, risk, and strategy decisions after the minimum observation period.
7. Start a paper position only when one configured strategy emits an allowed buy signal.
8. Stop monitoring after its configured observation window unless it has an open position.

Lifecycle states:

```text
discovered -> observing -> eligible -> signaled -> positioned -> closed
                       \-> rejected
```

A token can have only one active candidate session and one active position in the MVP. Re-entry is a later strategy feature.

## 8. Momentum and buy-pressure features

The initial strategy measures *change*, not only large raw values. Every measure uses configurable windows and minimum sample counts.

Core features:

- Price return and price acceleration across 15-second, 30-second, and 60-second windows.
- Buy volume / (buy volume + sell volume), with a minimum total-volume gate.
- Transaction-rate acceleration: recent trades per second compared with the prior same-duration window.
- Volume acceleration: recent notional volume compared with prior window.
- Unique-buyer growth and buyer/seller balance.
- Liquidity and market-cap growth, where trustworthy values exist.
- Concentration penalty when a small set of wallets accounts for the activity.

Initial formulae must be simple and inspectable. For example, `volumeAcceleration = (recentVolume - priorVolume) / max(priorVolume, floor)`. Features are clipped to safe ranges and stored before being scored.

No fixed score claims profitability. Thresholds, weights, and windows live in versioned strategy configuration.

## 9. Risk engine

Risk uses the convention **higher score = more dangerous** (0–100). A candidate is rejected when a hard rule fails or when risk exceeds the configured maximum.

Hard rules for the first strategy:

- Required market data is stale, inconsistent, or missing.
- Liquidity is under the configured minimum.
- Market cap/liquidity relationship is extreme according to a configurable guardrail.
- A required authority/supply check explicitly fails.
- A known critical provider safety flag is present.

Soft risk components:

| Component | Example evidence |
| --- | --- |
| Holder concentration | Top holders or clusters own a large supply percentage. |
| Developer risk | Attributed developer receives/sells a large share. |
| Trade concentration | Few wallets account for volume or buys. |
| Liquidity fragility | Liquidity falls quickly or is small relative to intended position. |
| Manipulation pattern | Repeated spikes, rapid reversals, or abnormal wallet coordination. |
| Data uncertainty | Providers disagree or observations are incomplete. |

Each component returns `score`, `confidence`, and human-readable evidence. A missing metric raises uncertainty; it must not quietly be interpreted as safe.

## 10. Strategy interface and initial strategy

Strategies consume only a normalized `StrategyContext` and return an explainable decision:

```ts
interface Strategy {
  id: string;
  evaluate(context: StrategyContext): Decision;
}
```

Initial strategy: **Confirmed Momentum v1**.

It requires all of the following:

- Minimum observation duration and complete recent data windows.
- Minimum liquidity and minimum real trading activity.
- Positive volume and trade-rate acceleration.
- Buy-pressure ratio above a configured threshold.
- Positive short-window price momentum, without an excessive one-candle spike.
- Holder/risk score within allowed limits.
- Portfolio-level risk limits allow a new position.

The decision persists each measured value and each pass/fail reason. Rejected candidates are just as important as buys.

## 11. Paper execution and position management

The simulator uses an executable mark rather than assuming the signal price is guaranteed.

For every fill:

```text
buy fill = reference ask * (1 + configured buy slippage) + fees
sell fill = reference bid * (1 - configured sell slippage) - fees
```

The MVP uses a conservative configurable spread/slippage model. If later data provides pool depth and route simulation, a liquidity-aware impact model can replace it. A fill is rejected when no fresh, credible price exists.

Position configuration is versioned per strategy run:

- Starting paper balance and maximum position size.
- Risk per trade and maximum concurrent positions.
- Maximum daily loss, total exposure, and consecutive-loss circuit breaker.
- Initial stop loss.
- Up to three partial take-profit levels.
- Break-even stop after a configurable milestone.
- Trailing stop on the remaining quantity.
- Maximum hold duration and emergency exit for data failure or liquidity collapse.

The position manager evaluates every relevant fresh snapshot. It records exit reason, realized and unrealized PnL, maximum favorable excursion, and maximum adverse excursion.

## 12. Database model

PostgreSQL tables for MVP:

| Table | Purpose |
| --- | --- |
| `tokens` | Canonical mint and metadata. |
| `candidates` | Monitoring lifecycle and final disposition. |
| `market_snapshots` | Append-only normalized observations. |
| `wallet_metrics` | Holder/wallet evidence and confidence. |
| `feature_sets` | Computed values fed to strategies. |
| `strategy_configs` | Immutable versioned strategy settings. |
| `strategy_runs` | A named forward-test or backtest execution. |
| `signals` | Buy/ignore/exit decisions with reasons JSON. |
| `paper_positions` | Position state and aggregate PnL. |
| `paper_fills` | Every simulated partial entry/exit. |
| `performance_metrics` | Aggregated run metrics. |
| `system_events` | Provider errors, reconnects, guards, and audits. |

Snapshots are append-only. Derived tables can be recomputed if a feature formula changes. Index `market_snapshots(token_mint, observed_at)` and all active-position/run lookup paths.

## 13. Forward testing and backtesting

### Forward paper testing

Forward mode consumes live normalized events, stores the source data first, and executes paper trades using the same strategy and position interfaces as backtesting. It is the first source of trusted historical fixtures.

### Backtesting

The backtester replays immutable stored snapshots/events ordered by observation time. It must use only data available at that historical instant and must model the same delayed fills, fees, slippage, and stop logic as forward mode.

Do not claim a tick-accurate backtest until a provider supplies complete ordered trade data. Candle-only data cannot correctly prove intrabar stop/target ordering; such results must be labelled approximate.

Evaluation splits data into development, validation, out-of-sample, then forward testing. Use walk-forward tests for any parameter tuning. Report number of trades and confidence intervals alongside win rate, profit factor, expectancy, drawdown, holding time, fees, and false-signal rate.

## 14. Data quality, reliability, and rate limits

Each adapter declares its rate limits, freshness guarantees, and supported capabilities. A provider coordinator applies:

- Token-bucket rate limiting per provider/API key.
- Bounded concurrency and request queues.
- Exponential backoff with jitter for transient errors.
- Circuit breaker after repeated provider failures.
- WebSocket heartbeat, reconnect, and subscription restoration.
- Schema validation for every provider response.
- A freshness deadline; stale data blocks new entries and can trigger emergency exits.
- Cached recent responses only when they meet the requested data-freshness limit.

Do not retry unsafe writes blindly. Persist external request IDs and idempotency keys where applicable.

## 15. API and dashboard boundary

The first API is read-only except for starting/stopping named paper runs:

```text
GET /health
GET /runs
GET /runs/:id/summary
GET /positions?status=open
GET /signals
GET /tokens/:mint
GET /metrics
WS  /stream  # snapshots, signals, position updates
```

The dashboard comes after data collection is reliable. It consumes this API; it does not contain strategy logic.

## 16. Security and operations

- Store provider credentials only in environment variables or a secret manager; never commit `.env`.
- Do not implement wallet signing or accept private keys in this project.
- Validate configuration at startup and redact secrets from logs/errors.
- Protect dashboard/API access with authentication before exposing it beyond localhost.
- Use database backups, retention rules, and an audit log for config changes.
- Run the process under a non-admin user in Docker or a small VPS service.
- Graceful shutdown stops intake, persists active state, and closes DB/WebSocket connections.

## 17. Testing strategy

- Unit tests: scoring math, risk gates, fills, stop/TP/trailing transitions, sizing, and time windows.
- Provider contract tests: recorded provider payload fixtures normalize correctly; malformed payloads fail safely.
- Repository integration tests: migrations and essential Postgres queries against a temporary test database.
- Scenario tests: deterministic token event streams produce known signal/position outcomes.
- Replay tests: a saved forward-test stream creates the same trades after code changes unless intentionally versioned.
- Failure tests: 429s, stale data, disconnects, provider disagreement, and duplicate events cannot create duplicate trades.

## 18. Deployment

For MVP, deploy one Dockerized Node process plus PostgreSQL:

```text
Docker host / small VPS
  ├── scout-app (workers + API)
  └── postgres (or managed PostgreSQL)
```

Use separate environment configuration for local development and forward testing. Metrics/alerts can initially be log-based, then add Prometheus/OpenTelemetry after the main loop is stable.

## 19. Milestones

### Milestone 0 — Blueprint (current)

Approve this document, select providers and paid-plan budget, and define one initial strategy hypothesis. No code or keys required.

### Milestone 1 — Foundation

Create TypeScript project, config validation, Docker/Postgres, Prisma schema, structured logger, health endpoint, and tests.

### Milestone 2 — Normalized market pipeline

Implement provider interfaces and one market-data adapter. Save canonical tokens/snapshots and expose data-quality status.

### Milestone 3 — Discovery and observation

Discover candidates, deduplicate, manage monitoring windows, and persist accepted/rejected lifecycle records.

### Milestone 4 — Features and risk

Build windowed momentum features, initial safety checks, risk score, and explainable rejection records.

### Milestone 5 — Strategy and paper execution

Implement Confirmed Momentum v1, portfolio limits, realistic paper fills, positions, stops, targets, and trade metrics.

### Milestone 6 — Forward test

Run continuously with simulated capital, inspect provider quality and execution assumptions, and collect a clean dataset.

### Milestone 7 — Backtesting and research

Replay stored events, compare versioned strategies, use out-of-sample and walk-forward evaluation.

### Milestone 8 — API/dashboard

Expose read-only run, signal, position, and performance data; optionally connect the existing Chrome extension.

## 20. Decisions needed before Milestone 1

1. Which initial data-provider plan/API keys are available (Birdeye and Helius)?
2. What paper starting balance, maximum concurrent positions, and intended risk per trade should the first forward test use?
3. How many newly launched tokens should be observed concurrently? This determines provider cost and connection requirements.
4. Should deployment begin locally on this PC or on a small always-on VPS?

Until these are decided, the only safe next action is the Foundation setup without connecting to real provider accounts.
