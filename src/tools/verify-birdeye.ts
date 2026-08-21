import { loadAppConfig } from '../config/env.js';
import { BirdeyeMarketDataProvider } from '../providers/birdeye/birdeye-market-data-provider.js';

const config = loadAppConfig();
if (!config.birdeyeApiKey) {
  throw new Error('BIRDEYE_API_KEY is missing from .env.');
}

const provider = new BirdeyeMarketDataProvider(config.birdeyeApiKey);
const result = await provider.getTokenSnapshot('So11111111111111111111111111111111111111112');

console.log(JSON.stringify({
  provider: result.source,
  token: result.data.token.symbol ?? result.data.token.mint,
  priceUsd: result.data.priceUsd,
  liquidityUsd: result.data.liquidityUsd,
  marketCapUsd: result.data.marketCapUsd,
  observedAt: result.data.observedAt.toISOString()
}, null, 2));
