import { loadAppConfig } from '../config/env.js';
import { BirdeyeHolderProvider } from '../providers/birdeye/birdeye-holder-provider.js';
import { HeliusWalletAgeProvider } from '../providers/helius/helius-wallet-age-provider.js';
import { FreshWalletAnalyzer } from '../risk/fresh-wallet-analyzer.js';

const app = loadAppConfig();
if (!app.birdeyeApiKey || !app.heliusApiKey) throw new Error('BIRDEYE_API_KEY and HELIUS_API_KEY are required for fresh-wallet verification.');
const mint = process.argv[2];
if (!mint) throw new Error('Usage: npm run verify:fresh-wallets -- <token-mint>');
console.log(JSON.stringify(await new FreshWalletAnalyzer(
  new BirdeyeHolderProvider(app.birdeyeApiKey),
  new HeliusWalletAgeProvider(app.heliusApiKey)
).analyze(mint), null, 2));
