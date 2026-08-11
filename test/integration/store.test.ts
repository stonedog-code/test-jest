import { Pool } from 'pg';
import request from 'supertest';

import { createApp } from '../../src/app';
import {
  DuplicateObservationError,
  ObservationStore,
} from '../../src/store/observations';
import { WeatherClient } from '../../src/weather/client';
import { CityNotFoundError, type Conditions } from '../../src/weather/model';
import { WeatherService } from '../../src/weather/service';
import { startStubUpstream, type StubUpstream } from '../helpers/stub-upstream';

/**
 * Everything here runs against a real Postgres started by globalSetup.
 *
 * `describeIfDatabase` skips the whole block when Docker is unavailable rather
 * than failing it. A skipped block is visible in the output; a failure would
 * teach people that red is normal.
 */
const describeIfDatabase =
  process.env.HAS_DATABASE === 'true' ? describe : describe.skip;

let pool: Pool;
let store: ObservationStore;

beforeAll(async () => {
  if (process.env.HAS_DATABASE !== 'true') return;

  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  store = new ObservationStore(pool);
  await store.migrate();
});

afterAll(async () => {
  // Closing the pool matters: an open pool keeps the event loop alive and Jest
  // reports "did not exit one second after the test run completed", which is
  // usually blamed on the test framework and is almost always a leaked handle.
  await pool?.end();
});

/** A city unique to each test, so tests never see each other's rows. */
function uniqueCity(name: string): string {
  return `City-${name}-${process.pid}`;
}

function conditionsFor(city: string, overrides: Partial<Conditions> = {}): Conditions {
  return {
    city,
    description: 'Clouds',
    tempC: 27.5,
    humidity: 74,
    observedAt: new Date('2026-08-11T15:04:05.000Z'),
    ...overrides,
  };
}

describeIfDatabase('ObservationStore', () => {
  it('round-trips an observation through real SQL', async () => {
    const city = uniqueCity('roundtrip');
    const written = conditionsFor(city);

    await store.record(written);
    const read = await store.latest(city);

    // This is exactly what an in-memory fake cannot tell you: NUMERIC(5,2)
    // comes back as a STRING from node-postgres, and TIMESTAMPTZ comes back as
    // a Date in UTC. A fake would have handed back the object it was given.
    expect(read.tempC).toBe(27.5);
    expect(typeof read.tempC).toBe('number');
    expect(read.observedAt).toEqual(written.observedAt);
    expect(read.description).toBe('Clouds');
  });

  it('returns the most recent row, not the warmest', async () => {
    const city = uniqueCity('latest');
    const base = new Date('2026-08-11T12:00:00.000Z');

    for (const [index, tempC] of [20, 25, 22].entries()) {
      await store.record(
        conditionsFor(city, {
          tempC,
          observedAt: new Date(base.getTime() + index * 3_600_000),
        }),
      );
    }

    await expect(store.latest(city)).resolves.toMatchObject({ tempC: 22 });
  });

  // The unique constraint exists only in the database. Nothing in TypeScript
  // enforces it, so nothing but a real database can prove it works.
  it('rejects a duplicate observation', async () => {
    const city = uniqueCity('duplicate');
    const observation = conditionsFor(city);

    await store.record(observation);

    await expect(store.record(observation)).rejects.toThrow(DuplicateObservationError);
    await expect(store.countForCity(city)).resolves.toBe(1);
  });

  // Likewise the CHECK constraint: a humidity of 150 is a bug upstream, and the
  // database is the last line that catches it.
  it('rejects an impossible humidity', async () => {
    const city = uniqueCity('humidity');

    await expect(
      store.record(conditionsFor(city, { humidity: 150 })),
    ).rejects.toThrow();
  });

  it('throws CityNotFoundError for a city with no rows', async () => {
    await expect(store.latest('no-such-city-anywhere')).rejects.toThrow(
      CityNotFoundError,
    );
  });

  it('handles a city name containing a quote without breaking the query', async () => {
    // Parameterised queries, not string concatenation. If this test ever fails
    // with a syntax error, somebody has introduced an injection vector.
    const city = uniqueCity("O'Fallon; DROP TABLE observations;--");

    await store.record(conditionsFor(city));

    await expect(store.latest(city)).resolves.toMatchObject({ city });
    await expect(store.countForCity(city)).resolves.toBe(1);
  });
});

describeIfDatabase('the full vertical slice', () => {
  let upstream: StubUpstream;

  beforeAll(async () => {
    upstream = await startStubUpstream();
  });

  afterAll(async () => {
    await upstream.close();
  });

  // HTTP request in, row in Postgres out. This is the only tier that proves the
  // service actually wires the recorder through to the store.
  it('persists an observation as a side effect of a request', async () => {
    const client = new WeatherClient({ baseUrl: upstream.url, apiKey: 'k' });
    const service = new WeatherService(client, { recorder: store });

    const response = await request(createApp(service)).get(
      '/weather?city=Cape+Canaveral&units=imperial',
    );

    expect(response.status).toBe(200);
    expect(response.body.temp).toBeCloseTo(81.5, 5);

    const stored = await store.latest('Cape Canaveral');

    // Celsius in the database, Fahrenheit in the response. The store must hold
    // the canonical value, not whatever unit the caller happened to ask for.
    expect(stored.tempC).toBe(27.5);
  });
});
