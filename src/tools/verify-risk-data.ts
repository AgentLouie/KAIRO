import { loadAppConfig } from '../config/env.js';
import { BirdeyeHolderProvider } from '../providers/birdeye/birdeye-holder-provider.js';
import { HeliusMintAuthorityProvider } from '../providers/helius/helius-mint-authority-provider.js';

const app = loadAppConfig();
if (!app.birdeyeApiKey || !app.heliusApiKey) throw new Error('BIRDEYE_API_KEY and HELIUS_API_KEY are required for risk-data verification.');
const mint = process.argv[2] ?? 'So11111111111111111111111111111111111111112';
const [authorities, concentration] = await Promise.all([
  new HeliusMintAuthorityProvider(app.heliusApiKey).getMintAuthorities(mint),
  new BirdeyeHolderProvider(app.birdeyeApiKey).getConcentration(mint)
]);
console.log(JSON.stringify({
  mint,
  mintAuthority: authorities.data.mintAuthority,
  freezeAuthority: authorities.data.freezeAuthority,
  holderCount: concentration.holderCount,
  top10HoldPct: concentration.top10HoldPct,
  observedAt: concentration.observedAt.toISOString()
}, null, 2));
