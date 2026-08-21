import type { MarketDataProvider } from './contracts.js';

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class MarketDataProviderRegistry {
  private readonly providers = new Map<string, MarketDataProvider>();

  register(provider: MarketDataProvider): void {
    if (this.providers.has(provider.name)) {
      throw new ProviderUnavailableError(`Market provider ${provider.name} is already registered.`);
    }
    this.providers.set(provider.name, provider);
  }

  get(name: string): MarketDataProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ProviderUnavailableError(`Market provider ${name} is not configured.`);
    }
    return provider;
  }
}
