import { convertTemp, type Conditions, type Report, type Units } from './model';

/**
 * The interfaces the service needs, declared next to the consumer and kept as
 * narrow as the consumer actually requires. A one-method interface is one line
 * to fake in a test.
 */
export interface WeatherProvider {
  fetchConditions(city: string): Promise<Conditions>;
}

export interface ObservationRecorder {
  record(conditions: Conditions): Promise<void>;
}

export interface ServiceOptions {
  recorder?: ObservationRecorder;
  /** Injected so any assertion about elapsed time is deterministic. */
  now?: () => Date;
}

export class WeatherService {
  private readonly provider: WeatherProvider;
  private readonly recorder: ObservationRecorder | undefined;
  private readonly now: () => Date;

  constructor(provider: WeatherProvider, options: ServiceOptions = {}) {
    this.provider = provider;
    this.recorder = options.recorder;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Fetches conditions and renders them in the requested units.
   *
   * A failing recorder is swallowed deliberately: the caller asked for weather,
   * and a broken audit sink is not a reason to fail their request. That is a
   * product decision, so it has its own test rather than only this comment.
   */
  async describe(city: string, units: Units): Promise<Report> {
    const conditions = await this.provider.fetchConditions(city);

    if (this.recorder) {
      try {
        await this.recorder.record(conditions);
      } catch {
        // Intentionally ignored. See the note above.
      }
    }

    return {
      city: conditions.city,
      description: conditions.description,
      temp: convertTemp(conditions.tempC, units),
      units,
      humidity: conditions.humidity,
      observedAt: conditions.observedAt.toISOString(),
    };
  }

  /** How stale an observation is, in milliseconds, using the injected clock. */
  ageMs(conditions: Conditions): number {
    return this.now().getTime() - conditions.observedAt.getTime();
  }
}
