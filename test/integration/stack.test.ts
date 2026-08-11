import request from 'supertest';

import { createApp } from '../../src/app';
import { WeatherClient } from '../../src/weather/client';
import { WeatherService } from '../../src/weather/service';
import { startStubUpstream, type StubUpstream } from '../helpers/stub-upstream';

/**
 * The integration tier: real client, real service, real Express app, real HTTP
 * over a real socket, real JSON parsing. Only the third-party API is replaced,
 * and it is replaced by a real server rather than a stub function.
 *
 * Everything asserted here is a seam. A unit test can prove each layer behaves;
 * only this tier can prove they agree with each other.
 */

let upstream: StubUpstream;

beforeAll(async () => {
  upstream = await startStubUpstream();
});

afterAll(async () => {
  await upstream.close();
});

function buildApp(apiKey = 'integration-key') {
  const client = new WeatherClient({ baseUrl: upstream.url, apiKey });
  return createApp(new WeatherService(client));
}

describe('the assembled stack', () => {
  it('serves weather end to end in metric', async () => {
    const response = await request(buildApp()).get(
      '/weather?city=Cape+Canaveral&units=metric',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      city: 'Cape Canaveral',
      description: 'Clouds',
      temp: 27.5,
      units: 'metric',
      humidity: 74,
      observedAt: '2024-08-11T18:13:20.000Z',
    });
  });

  it('converts to imperial through the whole stack', async () => {
    const response = await request(buildApp()).get('/weather?city=Orlando&units=imperial');

    expect(response.status).toBe(200);
    expect(response.body.temp).toBeCloseTo(75.2, 5);
    expect(response.body.units).toBe('imperial');
  });

  it('sends the upstream the parameters it expects', async () => {
    const before = upstream.requests.length;

    await request(buildApp()).get('/weather?city=Orlando');

    const sent = upstream.requests.slice(before);
    expect(sent).toHaveLength(1);

    const query = new URL(sent[0] ?? '', 'http://localhost').searchParams;
    expect(query.get('q')).toBe('Orlando');
    expect(query.get('units')).toBe('metric'); // always metric on the wire
    expect(query.get('appid')).toBe('integration-key');
  });

  it('turns an unknown city into a 404', async () => {
    const response = await request(buildApp()).get('/weather?city=Atlantis');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'no weather for that city' });
  });

  /**
   * The seam a unit test structurally cannot reach: the upstream rejects the
   * credential, the client turns that into an UpstreamError, and the app turns
   * that into a 502 whose body mentions no API key.
   */
  it('turns an upstream auth failure into a 502 that leaks nothing', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(buildApp('')).get('/weather?city=Orlando');

    expect(response.status).toBe(502);

    const body = JSON.stringify(response.body);
    for (const forbidden of ['API key', 'appid', '401', 'Invalid']) {
      expect(body).not.toContain(forbidden);
    }

    errorSpy.mockRestore();
  });

  it('turns an unreachable upstream into a 502', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const client = new WeatherClient({
      baseUrl: 'http://127.0.0.1:1', // nothing listens here
      apiKey: 'k',
      timeoutMs: 2_000,
    });
    const app = createApp(new WeatherService(client));

    const response = await request(app).get('/weather?city=Orlando');

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'weather is unavailable right now' });

    errorSpy.mockRestore();
  });

  /**
   * A snapshot pins the exact serialised response, catching a renamed field or
   * a changed number format that a field-by-field assertion would miss.
   *
   * The cost: `--updateSnapshot` makes any failure disappear, so a wrong
   * snapshot still "passes". Review the diff every single time, and never
   * snapshot anything containing a timestamp, an id, or a random value.
   */
  it('matches the recorded response shape', async () => {
    const response = await request(buildApp()).get('/weather?city=Orlando&units=metric');

    // Jest wrote everything below on the first run, from an empty
    // toMatchInlineSnapshot(). Never hand-write one — a hand-written snapshot
    // that happens to be wrong turns the test into a permanent lie.
    expect(response.body).toMatchInlineSnapshot(`
{
  "city": "Orlando",
  "description": "Rain",
  "humidity": 88,
  "observedAt": "2024-08-11T18:21:40.000Z",
  "temp": 24,
  "units": "metric",
}
`);
  });
});
