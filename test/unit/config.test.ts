import { ConfigError, load } from '../../src/config';

/**
 * Every test passes an env object rather than mutating process.env. That is why
 * `load` takes a parameter: tests stay independent and parallel-safe, and no
 * test can leave a variable set for the next one.
 */
describe('config.load', () => {
  const MINIMAL = { WEATHER_API_KEY: 'abc123' } as NodeJS.ProcessEnv;

  it('applies defaults', () => {
    expect(load(MINIMAL)).toEqual({
      port: 3000,
      upstreamUrl: 'https://api.openweathermap.org',
      apiKey: 'abc123',
      databaseUrl: undefined,
      requestTimeoutMs: 10_000,
    });
  });

  it('honours overrides', () => {
    const config = load({
      WEATHER_API_KEY: 'abc123',
      PORT: '9999',
      WEATHER_UPSTREAM_URL: 'http://127.0.0.1:1234',
      DATABASE_URL: 'postgres://localhost/test',
      REQUEST_TIMEOUT_MS: '3000',
    });

    expect(config.port).toBe(9999);
    expect(config.upstreamUrl).toBe('http://127.0.0.1:1234');
    expect(config.databaseUrl).toBe('postgres://localhost/test');
    expect(config.requestTimeoutMs).toBe(3000);
  });

  it.each<[string, NodeJS.ProcessEnv, string | RegExp]>([
    ['missing api key', {}, 'WEATHER_API_KEY is required'],
    ['empty api key', { WEATHER_API_KEY: '' }, 'WEATHER_API_KEY is required'],
    ['whitespace api key', { WEATHER_API_KEY: '   ' }, 'WEATHER_API_KEY is required'],
    ['non-numeric port', { ...MINIMAL, PORT: 'soon' }, /must be an integer/],
    ['float port', { ...MINIMAL, PORT: '80.5' }, /must be an integer/],
    ['zero port', { ...MINIMAL, PORT: '0' }, /must be positive/],
    ['negative timeout', { ...MINIMAL, REQUEST_TIMEOUT_MS: '-5' }, /must be positive/],
  ])('rejects %s', (_name, env, expected) => {
    expect(() => load(env)).toThrow(expected);
    expect(() => load(env)).toThrow(ConfigError);
  });

  it('treats an empty string as unset rather than as a value', () => {
    const config = load({ ...MINIMAL, WEATHER_UPSTREAM_URL: '', DATABASE_URL: '' });

    expect(config.upstreamUrl).toBe('https://api.openweathermap.org');
    expect(config.databaseUrl).toBeUndefined();
  });

  // Worth writing in every repo: an error must not echo the secret it read.
  it('does not echo the api key in an error message', () => {
    const secret = 'super-secret-key-value';

    const attempt = (): unknown => load({ WEATHER_API_KEY: secret, PORT: 'not-a-number' });

    expect(attempt).toThrow(ConfigError);

    // Capture the message OUTSIDE the assertion. An `expect` inside a catch
    // block never runs when the code unexpectedly succeeds, so the test would
    // pass while proving nothing — which is what jest/no-conditional-expect
    // exists to catch.
    let message = '';
    try {
      attempt();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain(secret);
  });

  /**
   * The one case where reading process.env directly is unavoidable.
   *
   * Note the save/restore: without it, this test leaks a variable into every
   * later test in the same worker. Jest's `clearMocks` does not help — it
   * resets mocks, not the process environment.
   */
  describe('reading the real process.env', () => {
    const original = process.env.WEATHER_API_KEY;

    afterEach(() => {
      if (original === undefined) {
        delete process.env.WEATHER_API_KEY;
      } else {
        process.env.WEATHER_API_KEY = original;
      }
    });

    it('defaults to process.env when called with no argument', () => {
      process.env.WEATHER_API_KEY = 'from-the-real-env';

      expect(load().apiKey).toBe('from-the-real-env');
    });
  });
});
