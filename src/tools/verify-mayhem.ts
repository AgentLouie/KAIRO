import { loadAppConfig } from '../config/env.js';
import { HeliusMayhemModeDetector } from '../providers/helius/helius-mayhem-mode-detector.js';

const mint = process.argv[2];
if (!mint) throw new Error('Usage: npm run verify:mayhem -- <token-mint>');
const config = loadAppConfig();
if (!config.heliusApiKey) throw new Error('HELIUS_API_KEY is missing from .env.');

const detector = new HeliusMayhemModeDetector(config.heliusApiKey);
console.log(JSON.stringify({ mint, isMayhemMode: await detector.isMayhemMode(mint) }, null, 2));
