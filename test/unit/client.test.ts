import { WeatherClient, type FetchLike } from '../../src/weather/client';
import {
  CityNotFoundError,
  InvalidCityError,
  UpstreamError,
} from '../../src/weather/model';

/**
 * Every test here injects a fake fetch. Nothing is mocked globally, so these
 * tests cannot leak state into another file — the most common cause of "passes
 * alone, fails in the suite".
 */

const VALID_PAYLOAD = {
  name: 'Cape Canaveral',
  weather: [{ main: 'Clouds', description: 'broken clouds' }],
  main: { temp: 27.5, humidity: 74 },
  dt: 1_723_400_000,
};

/** Builds a fetch stub returning the given status and body. */
function stubFetch(status: number, body: unknown): jest.MockedFunction<FetchLike> {
  // Typing the mock as FetchLike (rather than letting jest.fn infer) is what
  // makes fetchImpl.mock.calls[0] typed as [url, init] further down. An
  // untyped jest.fn() gives you `any` there, and a typo in a property name
  // then passes silently.
  // Not `async () =>` with no await inside: that is what require-await flags,
  // and Promise.resolve says the same thing more honestly.
  const impl: FetchLike = () =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

  return jest.fn(impl);
}

function newClient(fetchImpl: FetchLike, apiKey = 'test-key'): WeatherClient {
  return new WeatherClient({ baseUrl: 'https://upstream.test', apiKey, fetchImpl });
}

describe('WeatherClient.fetchConditions', () => {
  it('returns normalised conditions on success', async () => {
    const client = newClient(stubFetch(200, VALID_PAYLOAD));

    const conditions = await client.fetchConditions('Cape Canaveral');

    // toEqual compares structurally and ignores undefined properties;
    // toStrictEqual also checks class identity and undefined keys. Prefer
    // toEqual unless you specifically care about the class.
    expect(conditions).toEqual({
      city: 'Cape Canaveral',
      description: 'Clouds',
      tempC: 27.5,
      humidity: 74,
      observedAt: new Date(1_723_400_000 * 1000),
    });
  });

  it('sends the city, key and units the upstream expects', async () => {
    const fetchImpl = stubFetch(200, VALID_PAYLOAD);
    const client = newClient(fetchImpl);

    await client.fetchConditions('  Cape   Canaveral  ');

    // Assert on the request that went OUT, not only the response parsed. A
    // client that silently drops the city parameter passes every
    // response-shaped assertion above this one.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const parsed = new URL(url as string);

    expect(parsed.pathname).toBe('/data/2.5/weather');
    expect(parsed.searchParams.get('q')).toBe('Cape Canaveral'); // normalised
    expect(parsed.searchParams.get('appid')).toBe('test-key');
    expect(parsed.searchParams.get('units')).toBe('metric');
    expect(init?.headers).toEqual({ Accept: 'application/json' });
  });

  it('throws CityNotFoundError on 404', async () => {
    const client = newClient(stubFetch(404, { cod: '404', message: 'city not found' }));

    // `rejects` is required for async assertions. Forgetting it is the classic
    // Jest bug: expect(promise).toThrow() passes unconditionally because a
    // Promise is not a function that throws, so the test proves nothing.
    await expect(client.fetchConditions('Atlantis')).rejects.toThrow(CityNotFoundError);
  });

  it.each([401, 429, 500, 503])('throws UpstreamError on %i', async (status) => {
    const client = newClient(stubFetch(status, 'upstream said no'));

    await expect(client.fetchConditions('Orlando')).rejects.toThrow(UpstreamError);
  });

  it('throws UpstreamError on malformed JSON', async () => {
    const client = newClient(stubFetch(200, '{"name": "Orlando", "main": {'));

    await expect(client.fetchConditions('Orlando')).rejects.toThrow(UpstreamError);
  });

  it('throws UpstreamError when the payload carries no weather entries', async () => {
    const client = newClient(stubFetch(200, { name: 'Orlando', weather: [] }));

    await expect(client.fetchConditions('Orlando')).rejects.toThrow(
      /no weather entries/,
    );
  });

  it('throws before touching the network for an empty city', async () => {
    const fetchImpl = stubFetch(200, VALID_PAYLOAD);
    const client = newClient(fetchImpl);

    await expect(client.fetchConditions('   ')).rejects.toThrow(InvalidCityError);

    // The important half of this test: validation must happen BEFORE the
    // request, or every bad input costs an upstream call and a rate limit.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('wraps a transport failure and keeps the cause', async () => {
    const boom = new Error('connect ECONNREFUSED 10.0.0.4:443');
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
      .mockRejectedValue(boom);

    const client = newClient(fetchImpl);

    await expect(client.fetchConditions('Orlando')).rejects.toMatchObject({
      name: 'UpstreamError',
      cause: boom, // the cause survives, so an operator can still read it
    });
  });

  it('aborts the request when the timeout elapses', async () => {
    // Fake timers make this instant and deterministic. Waiting for a real
    // timeout would make the suite slower and flakier for no extra coverage.
    jest.useFakeTimers();

    let capturedSignal: AbortSignal | undefined;
    const fetchImpl: FetchLike = (_url, init) => {
      capturedSignal = init?.signal;
      // Never resolves, so only the abort can end it.
      return new Promise<Response>(() => {});
    };

    const client = new WeatherClient({
      baseUrl: 'https://upstream.test',
      apiKey: 'k',
      fetchImpl,
      timeoutMs: 1_000,
    });

    void client.fetchConditions('Orlando').catch(() => undefined);

    // Let the microtask queue run so fetchImpl has actually been called.
    await Promise.resolve();
    expect(capturedSignal?.aborted).toBe(false);

    jest.advanceTimersByTime(1_000);
    expect(capturedSignal?.aborted).toBe(true);

    // Always restore. A leaked fake-timer state breaks every later test file
    // in the same worker, and the failure appears somewhere unrelated.
    jest.useRealTimers();
  });

  /**
   * The defensive `??` fallbacks in client.ts have their own tests, because an
   * untested defensive branch is where bugs hide: it only runs when something
   * upstream has already gone wrong, which is the worst moment to discover it
   * was written incorrectly.
   */
  it('fills in defaults when the payload omits optional fields', async () => {
    const client = newClient(
      stubFetch(200, { weather: [{ main: 'Fog' }] }), // no name, main, or dt
    );

    const conditions = await client.fetchConditions('Orlando');

    expect(conditions).toEqual({
      city: 'Orlando', // falls back to the requested city
      description: 'Fog',
      tempC: 0,
      humidity: 0,
      observedAt: new Date(0),
    });
  });

  it('falls back to the global fetch when none is injected', async () => {
    const globalFetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }),
      );

    // No fetchImpl passed, so the constructor must reach for globalThis.fetch.
    const client = new WeatherClient({ baseUrl: 'https://upstream.test', apiKey: 'k' });
    await client.fetchConditions('Orlando');

    expect(globalFetch).toHaveBeenCalledTimes(1);

    // restoreMocks in jest.config.ts also handles this; restoring explicitly
    // keeps the test readable in isolation.
    globalFetch.mockRestore();
  });

  it('clears the timeout when the request succeeds', async () => {
    jest.useFakeTimers();
    const clearSpy = jest.spyOn(global, 'clearTimeout');

    const client = newClient(stubFetch(200, VALID_PAYLOAD));
    await client.fetchConditions('Orlando');

    // Without the finally block in client.ts, a successful request leaves a
    // pending timer and the process hangs on exit. Jest reports that as
    // "did not exit one second after the test run completed".
    expect(clearSpy).toHaveBeenCalled();

    clearSpy.mockRestore();
    jest.useRealTimers();
  });
});
