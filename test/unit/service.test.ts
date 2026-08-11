import { CityNotFoundError, UpstreamError, type Conditions } from '../../src/weather/model';
import {
  WeatherService,
  type ObservationRecorder,
  type WeatherProvider,
} from '../../src/weather/service';

const SAMPLE: Conditions = {
  city: 'Cape Canaveral',
  description: 'Clouds',
  tempC: 27.5,
  humidity: 74,
  observedAt: new Date('2026-08-11T15:04:05.000Z'),
};

/**
 * Three ways to fake a dependency, in order of preference:
 *
 *   1. A plain object literal        — when you only need a return value
 *   2. jest.fn()                     — when you need to assert on the calls
 *   3. jest.mock('../module')        — only when the dependency is imported
 *                                      directly and cannot be injected
 *
 * This file uses 1 and 2. Number 3 appears in config.test.ts, with its caveats.
 */

function providerReturning(conditions: Conditions): WeatherProvider {
  return { fetchConditions: jest.fn().mockResolvedValue(conditions) };
}

function providerRejecting(error: Error): WeatherProvider {
  return { fetchConditions: jest.fn().mockRejectedValue(error) };
}

describe('WeatherService.describe', () => {
  it('renders imperial by converting the temperature', async () => {
    const service = new WeatherService(providerReturning(SAMPLE));

    await expect(service.describe('Cape Canaveral', 'imperial')).resolves.toEqual({
      city: 'Cape Canaveral',
      description: 'Clouds',
      temp: 81.5,
      units: 'imperial',
      humidity: 74,
      observedAt: '2026-08-11T15:04:05.000Z',
    });
  });

  it('renders metric by passing the temperature through', async () => {
    const service = new WeatherService(providerReturning(SAMPLE));

    const report = await service.describe('Cape Canaveral', 'metric');

    expect(report.temp).toBe(27.5);
    expect(report.units).toBe('metric');
  });

  it('passes the city straight to the provider', async () => {
    const provider = providerReturning(SAMPLE);
    const service = new WeatherService(provider);

    await service.describe('Orlando', 'metric');

    expect(provider.fetchConditions).toHaveBeenCalledWith('Orlando');
    expect(provider.fetchConditions).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not found', new CityNotFoundError('Atlantis')],
    ['upstream', new UpstreamError('upstream exploded')],
  ])('propagates a %s error from the provider', async (_name, error) => {
    const service = new WeatherService(providerRejecting(error));

    await expect(service.describe('Atlantis', 'metric')).rejects.toBe(error);
  });

  describe('with a recorder', () => {
    it('records the raw celsius conditions, not the converted report', async () => {
      const recorder: ObservationRecorder = { record: jest.fn().mockResolvedValue(undefined) };
      const service = new WeatherService(providerReturning(SAMPLE), { recorder });

      await service.describe('Cape Canaveral', 'imperial');

      // If the recorder saw the converted value, the stored history would
      // change meaning with whatever unit the caller happened to ask for.
      expect(recorder.record).toHaveBeenCalledWith(SAMPLE);
    });

    // This test pins a deliberate product decision. Without it, somebody
    // "fixes" the empty catch block and the API starts 502-ing whenever the
    // audit database hiccups.
    it('still serves the report when recording fails', async () => {
      const recorder: ObservationRecorder = {
        record: jest.fn().mockRejectedValue(new Error('database is on fire')),
      };
      const service = new WeatherService(providerReturning(SAMPLE), { recorder });

      const report = await service.describe('Cape Canaveral', 'metric');

      expect(report.city).toBe('Cape Canaveral');
      expect(recorder.record).toHaveBeenCalledTimes(1);
    });

    it('does not call the recorder when the provider fails', async () => {
      const recorder: ObservationRecorder = { record: jest.fn() };
      const service = new WeatherService(
        providerRejecting(new UpstreamError('nope')),
        { recorder },
      );

      await expect(service.describe('Orlando', 'metric')).rejects.toThrow(UpstreamError);
      expect(recorder.record).not.toHaveBeenCalled();
    });
  });
});

describe('WeatherService.ageMs', () => {
  it('uses the injected clock', () => {
    // Freezing the clock is what makes this assertion deterministic. Using the
    // real `new Date()` here would be a race against the wall clock: it passes
    // locally and fails in CI at an unlucky millisecond.
    const frozen = new Date('2026-08-11T16:04:05.000Z');
    const service = new WeatherService(providerReturning(SAMPLE), { now: () => frozen });

    expect(service.ageMs(SAMPLE)).toBe(60 * 60 * 1000);
  });

  it('can also be frozen with jest fake timers', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-11T16:04:05.000Z'));

    // With the system time faked, the DEFAULT clock is deterministic too, so
    // this works even for code you cannot inject into. Prefer injection where
    // you can: it is local to one object rather than global to the process.
    const service = new WeatherService(providerReturning(SAMPLE));

    expect(service.ageMs(SAMPLE)).toBe(60 * 60 * 1000);

    jest.useRealTimers();
  });
});
