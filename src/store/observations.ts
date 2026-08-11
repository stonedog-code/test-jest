import type { Pool } from 'pg';

import { CityNotFoundError, type Conditions } from '../weather/model';

/**
 * Postgres persistence.
 *
 * This class exists so the integration tier has a real dependency to run
 * against. A repository tested only against an in-memory fake proves the fake
 * works; it says nothing about whether the SQL parses, the column types line
 * up, or the constraints fire.
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS observations (
  id          BIGSERIAL PRIMARY KEY,
  city        TEXT         NOT NULL,
  description TEXT         NOT NULL,
  temp_c      NUMERIC(5,2) NOT NULL,
  humidity    INT          NOT NULL CHECK (humidity BETWEEN 0 AND 100),
  observed_at TIMESTAMPTZ  NOT NULL,
  UNIQUE (city, observed_at)
);`;

export class DuplicateObservationError extends Error {
  constructor() {
    super('observation already recorded');
    this.name = 'DuplicateObservationError';
  }
}

interface ObservationRow {
  city: string;
  description: string;
  temp_c: string; // NUMERIC comes back as a string from node-postgres
  humidity: number;
  observed_at: Date;
}

export class ObservationStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async record(conditions: Conditions): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO observations (city, description, temp_c, humidity, observed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (city, observed_at) DO NOTHING`,
      [
        conditions.city,
        conditions.description,
        conditions.tempC,
        conditions.humidity,
        conditions.observedAt,
      ],
    );

    if (result.rowCount === 0) {
      throw new DuplicateObservationError();
    }
  }

  async latest(city: string): Promise<Conditions> {
    const result = await this.pool.query<ObservationRow>(
      `SELECT city, description, temp_c, humidity, observed_at
       FROM observations
       WHERE city = $1
       ORDER BY observed_at DESC
       LIMIT 1`,
      [city],
    );

    const row = result.rows[0];
    if (!row) {
      throw new CityNotFoundError(city);
    }

    return {
      city: row.city,
      description: row.description,
      // NUMERIC arrives as a string. Forgetting this Number() is the classic
      // node-postgres bug: everything type-checks, and the value silently
      // becomes "27.50" wherever a number was expected.
      tempC: Number(row.temp_c),
      humidity: row.humidity,
      observedAt: row.observed_at,
    };
  }

  async countForCity(city: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM observations WHERE city = $1',
      [city],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
