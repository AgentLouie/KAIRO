import { loadAppConfig } from '../config/env.js';
import { BirdeyeHolderProfileProvider } from '../providers/birdeye/birdeye-holder-profile-provider.js';

const app = loadAppConfig();
if (!app.birdeyeApiKey) throw new Error('BIRDEYE_API_KEY is required for tagged holder-profile verification.');
const mint = process.argv[2];
if (!mint) throw new Error('Usage: npm run verify:holder-profile -- <token-mint>');
console.log(JSON.stringify(await new BirdeyeHolderProfileProvider(app.birdeyeApiKey).getProfile(mint), null, 2));
