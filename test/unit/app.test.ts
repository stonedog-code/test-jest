import request from 'supertest';

import { createApp, type Describer } from '../../src/app';
import {
  CityNotFoundError,
  InvalidCityError,
  UpstreamError,
  type Report,
  type Units,
} from '../../src/weather/model';

/**
 * supertest drives the Express app in-process: no port is bound, nothing needs
 * tearing down, and the tests cannot collide over a fixed port. That is why
 * createApp returns the app instead of calling listen.
 */

const SAMPLE_REPORT: Report = {
  city: 'Cape Canaveral',
  description: 'Clouds',
  temp: 81.5,
  units: 'imperial',
  humidity: 74,
  observedAt: '2026-08-11T15:04:05.000Z',
};

function fakeService(overrides: Partial<Describer> = {}): Describer {
  return {
    describe: jest.fn().mockResolvedValue(SAMPLE_REPORT),
    ...overrides,
  };
}

describe('GET /healthz', () => {
  it('answers 200 without touching the service', async () => {
    const service = fakeService();

    const response = await request(createApp(service)).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    // A health check that depends on a downstream dependency pulls every
    // instance out of the load balancer during an upstream blip.
    expect(service.describe).not.toHaveBeenCalled();
  });
});

describe('GET /weather', () => {
  it('returns the report as JSON', async () => {
    const response = await request(createApp(fakeService())).get(
      '/weather?city=Cape+Canaveral',
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual(SAMPLE_REPORT);
  });

  describe('query parsing', () => {
    it.each<[string, string, Units]>([
      ['/weather?city=Orlando&units=metric', 'Orlando', 'metric'],
      ['/weather?city=Orlando', 'Orlando', 'imperial'],
      ['/weather', 'Cape Canaveral, FL', 'imperial'],
      ['/weather?city=Cape%20Canaveral%2C%20FL', 'Cape Canaveral, FL', 'imperial'],
      ['/weather?city=', 'Cape Canaveral, FL', 'imperial'],
    ])('%s calls describe(%p, %p)', async (path, city, units) => {
      const service = fakeService();

      await request(createApp(service)).get(path);

      expect(service.describe).toHaveBeenCalledWith(city, units);
    });
  });

  describe('status codes', () => {
    it.each<[string, Error, number, string]>([
      [
        'unknown city',
        new CityNotFoundError('Atlantis'),
        404,
        'no weather for that city',
      ],
      ['invalid city', new InvalidCityError(), 400, 'city is required'],
      [
        'upstream failure',
        new UpstreamError('connect ECONNREFUSED'),
        502,
        'weather is unavailable right now',
      ],
    ])('%s becomes %i', async (_name, error, status, message) => {
      const service = fakeService({ describe: jest.fn().mockRejectedValue(error) });

      const response = await request(createApp(service)).get('/weather?city=x');

      expect(response.status).toBe(status);
      expect(response.body).toEqual({ error: message });
    });

    it('rejects unknown units with 400 before calling the service', async () => {
      const service = fakeService();

      const response = await request(createApp(service)).get('/weather?units=kelvin');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'units must be metric or imperial' });
      expect(service.describe).not.toHaveBeenCalled();
    });
  });

  // A regression test for the rule that internal detail never reaches a caller.
  it('does not leak upstream detail into the response', async () => {
    const service = fakeService({
      describe: jest
        .fn()
        .mockRejectedValue(new UpstreamError('connect ECONNREFUSED 10.0.0.4:443')),
    });

    // The handler logs the cause; that is correct, and it must not pollute the
    // test output, so silence it for this test only.
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(createApp(service)).get('/weather?city=Orlando');

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('10.0.0.4');
    expect(body).not.toContain('ECONNREFUSED');

    // ...but it must still have been logged, or operators are blind.
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not crash on an array-valued query parameter', async () => {
    const service = fakeService();

    // ?city=a&city=b makes req.query.city an array, not a string. Express
    // parses this by default and it is a common source of 500s.
    const response = await request(createApp(service)).get('/weather?city=a&city=b');

    expect(response.status).toBe(200);
    expect(service.describe).toHaveBeenCalledWith('Cape Canaveral, FL', 'imperial');
  });
});
