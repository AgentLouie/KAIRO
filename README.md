# KAIRO

KAIRO is an independent **Pump.fun paper-trading research engine** for Solana. It discovers eligible tokens, excludes Mayhem Mode, gathers market data, and stores research data to determine whether a transparent strategy has an edge.

It is separate from the Paper Trader Chrome extension. KAIRO can run without GMGN, Axiom, Padre, or a browser open.

## Safety boundary

- Paper trading only; no wallet connection, private key, signing, swaps, or real SOL spending.
- Pump.fun-origin candidates only.
- Mayhem Mode tokens are hard-excluded through on-chain verification.
- Missing or failed Mayhem checks fail closed: the token cannot reach monitoring or a future paper-buy decision.

## Current capabilities

- Birdeye live token overview and Pump.fun new-listing discovery.
- PostgreSQL persistence with Docker Compose.
- Restart-safe PostgreSQL candidate queue capped at 20 monitored tokens.
- Configurable preliminary liquidity threshold.
- Helius Mayhem Mode detector (requires `HELIUS_API_KEY`).
- Controlled background discovery, market snapshots, Momentum v1 scoring, and one paced risk assessment every 15 minutes, with retry/backoff and no overlapping runs.

Momentum v1 saves explainable, non-trading scores from two recent snapshots. Risk v1 now has fail-closed scoring rules. Helius verifies mint/freeze authority and conservatively estimates top-holder wallet age; Birdeye supplies wallet-level holder concentration plus tagged bundler, insider, and developer cohorts. The fresh-wallet estimate is explicitly limited to the top-ten holder sample. Trade signals and paper execution are not implemented.

## Setup

1. Copy `.env.example` to `.env`.
2. Add your provider keys only to `.env`—never commit this file.
3. Start PostgreSQL:

   ```powershell
   docker compose up -d
   npm run db:migrate
   ```

4. Verify the connections:

   ```powershell
   npm run verify:birdeye
   npm run verify:postgres
    npm run discover:once
    npm run monitor:once
    npm run momentum:once
   ```

## Development

```powershell
npm run check
npm test
```

Read [BLUEPRINT.md](BLUEPRINT.md) for the technical architecture and milestones.
