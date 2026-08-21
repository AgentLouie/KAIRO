export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ranks: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel, sink: (line: string) => void = console.log): Logger {
  const write = (entryLevel: LogLevel, event: string, fields: Record<string, unknown> = {}): void => {
    if (ranks[entryLevel] < ranks[level]) return;
    sink(JSON.stringify({ timestamp: new Date().toISOString(), level: entryLevel, event, ...fields }));
  };

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields)
  };
}
