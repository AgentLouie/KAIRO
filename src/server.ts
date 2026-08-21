import { createServer, type Server } from 'node:http';
import type { AppConfig } from './config/env.js';
import type { PaperPortfolioConfig } from './config/paper-portfolio.js';
import { healthReport } from './api/health.js';
import type { Logger } from './logging/logger.js';

export function createAppServer(config: AppConfig, portfolio: PaperPortfolioConfig, logger: Logger, startedAt = new Date()): Server {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(healthReport(config, portfolio, startedAt)));
      return;
    }
    logger.warn('http.not_found', { method: request.method, url: request.url });
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });
}
