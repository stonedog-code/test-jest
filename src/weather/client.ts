import {
  CityNotFoundError,
  UpstreamError,
  normaliseCity,
  type Conditions,
} from './model';

/**
 * The seam.
 *
 * Typing the dependency as "something shaped like fetch" rather than reaching
 * for the global means a test injects a stub with no module mocking, no
 * `jest.mock`, and no global patching that leaks between test files.
 */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<Response>;

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** The upstream wire format. Not exported: it is somebody else's contract. */
interface UpstreamPayload {
  name?: string;
  weather?: Array<{ main?: string; description?: string }>;
  main?: { temp?: number; humidity?: number };
  dt?: number;
}

export class WeatherClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor({ baseUrl, apiKey, fetchImpl, timeoutMs = 10_000 }: ClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    this.timeoutMs = timeoutMs;
  }

  /** Fetches current conditions, always in Celsius. */
  async fetchConditions(city: string): Promise<Conditions> {
    const normalised = normaliseCity(city);

    const url = new URL(`${this.baseUrl}/data/2.5/weather`);
    url.searchParams.set('q', normalised);
    url.searchParams.set('appid', this.apiKey);
    url.searchParams.set('units', 'metric');

    // A request with no timeout is a request that can hang forever, and one
    // hung upstream call is enough to exhaust the connection pool.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      throw new UpstreamError('weather request failed', error);
    } finally {
      // finally, not after the await: an exception must not leak the timer.
      clearTimeout(timer);
    }

    if (response.status === 404) {
      throw new CityNotFoundError(normalised);
    }
    if (!response.ok) {
      throw new UpstreamError(`upstream returned ${response.status}`);
    }

    let payload: UpstreamPayload;
    try {
      payload = (await response.json()) as UpstreamPayload;
    } catch (error) {
      throw new UpstreamError('upstream returned invalid JSON', error);
    }

    const first = payload.weather?.[0];
    if (!first?.main) {
      throw new UpstreamError('upstream payload carried no weather entries');
    }

    return {
      city: payload.name ?? normalised,
      description: first.main,
      tempC: payload.main?.temp ?? 0,
      humidity: payload.main?.humidity ?? 0,
      observedAt: new Date((payload.dt ?? 0) * 1000),
    };
  }
}
