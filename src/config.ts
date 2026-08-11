/**
 * Reads runtime settings from the environment.
 *
 * `load` takes the environment as a parameter rather than reading
 * `process.env` directly. That is the same seam as injecting fetch, applied to
 * configuration: the tests pass a plain object and can run in parallel, because
 * nothing mutates shared process state.
 */

export interface Config {
  port: number;
  upstreamUrl: string;
  apiKey: string;
  databaseUrl: string | undefined;
  requestTimeoutMs: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function load(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.WEATHER_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError('WEATHER_API_KEY is required');
  }

  const port = parsePositiveInt(env.PORT, 3000, 'PORT');
  const requestTimeoutMs = parsePositiveInt(
    env.REQUEST_TIMEOUT_MS,
    10_000,
    'REQUEST_TIMEOUT_MS',
  );

  return {
    port,
    upstreamUrl: env.WEATHER_UPSTREAM_URL?.trim() || 'https://api.openweathermap.org',
    apiKey,
    databaseUrl: env.DATABASE_URL?.trim() || undefined,
    requestTimeoutMs,
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);
  // Number('') is 0 and Number('12abc') is NaN — check both, and reject
  // floats, which would silently truncate later.
  if (!Number.isInteger(value)) {
    throw new ConfigError(`${name} must be an integer`);
  }
  if (value <= 0) {
    throw new ConfigError(`${name} must be positive`);
  }
  return value;
}
