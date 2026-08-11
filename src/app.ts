import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import {
  CityNotFoundError,
  InvalidCityError,
  InvalidUnitsError,
  parseUnits,
  type Report,
  type Units,
} from './weather/model';

export interface Describer {
  describe(city: string, units: Units): Promise<Report>;
}

const DEFAULT_CITY = 'Cape Canaveral, FL';

/**
 * Builds the Express app without starting a server.
 *
 * Returning the app rather than calling `listen` is what lets supertest drive
 * it in-process: no port is bound, nothing has to be torn down, and the tests
 * cannot collide with each other over a fixed port.
 */
export function createApp(service: Describer): Express {
  const app = express();

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.get('/weather', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const city = typeof req.query.city === 'string' && req.query.city !== ''
        ? req.query.city
        : DEFAULT_CITY;

      const units = parseUnits(
        typeof req.query.units === 'string' ? req.query.units : undefined,
      );

      res.json(await service.describe(city, units));
    } catch (error) {
      next(error);
    }
  });

  app.use(errorHandler);
  return app;
}

/**
 * Maps domain errors onto status codes in exactly one place.
 *
 * Note what the caller never sees: the underlying cause. It goes to the log;
 * the response gets a status code and a flat sentence. Echoing "connect
 * ECONNREFUSED 10.0.0.4:443" to a stranger is free reconnaissance.
 */
function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof InvalidCityError) {
    res.status(400).json({ error: 'city is required' });
    return;
  }
  if (error instanceof InvalidUnitsError) {
    res.status(400).json({ error: 'units must be metric or imperial' });
    return;
  }
  if (error instanceof CityNotFoundError) {
    res.status(404).json({ error: 'no weather for that city' });
    return;
  }

  console.error('unhandled error serving /weather', error);
  res.status(502).json({ error: 'weather is unavailable right now' });
}
