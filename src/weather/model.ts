/**
 * Pure values, parsing and conversion. No I/O, no dependencies, no clock.
 *
 * This file is the cheapest thing in the repo to test and the most valuable to
 * get right: everything above it assumes these functions are correct.
 */

/** Error subclasses, so callers can branch on type rather than message text. */
export class InvalidCityError extends Error {
  constructor(message = 'city must not be empty') {
    super(message);
    this.name = 'InvalidCityError';
  }
}

export class CityNotFoundError extends Error {
  constructor(city: string) {
    super(`no weather for city: ${city}`);
    this.name = 'CityNotFoundError';
  }
}

export class UpstreamError extends Error {
  // `override` is required: Error already declares `cause`. Without the
  // modifier, noImplicitOverride rejects it — which is the point of that flag,
  // since silently shadowing a base member is rarely intended.
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'UpstreamError';
    this.cause = cause;
  }
}

export class InvalidUnitsError extends Error {
  constructor(units: string) {
    super(`unknown units: ${units}`);
    this.name = 'InvalidUnitsError';
  }
}

export type Units = 'metric' | 'imperial';

export interface Conditions {
  city: string;
  description: string;
  tempC: number;
  humidity: number;
  observedAt: Date;
}

export interface Report {
  city: string;
  description: string;
  temp: number;
  units: Units;
  humidity: number;
  observedAt: string;
}

/**
 * Maps a query-string value onto Units. An empty string is not an error: it
 * means the caller did not care, so the default applies.
 */
export function parseUnits(value: string | undefined): Units {
  // Normalise once, up front. Writing `value ?? ''` again in the throw below
  // would look defensive and be dead code: the default branch is only
  // reachable with a non-empty string, so that fallback could never run — and
  // an unreachable branch is a branch coverage can never reach either.
  const normalised = (value ?? '').trim().toLowerCase();

  switch (normalised) {
    case '':
    case 'imperial':
    case 'f':
    case 'fahrenheit':
      return 'imperial';
    case 'metric':
    case 'c':
    case 'celsius':
      return 'metric';
    default:
      throw new InvalidUnitsError(normalised);
  }
}

export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

/** Returns tempC in the requested units, rounded to one decimal place. */
export function convertTemp(tempC: number, units: Units): number {
  const value = units === 'imperial' ? celsiusToFahrenheit(tempC) : tempC;
  return roundTo(value, 1);
}

/**
 * Rounds half away from zero.
 *
 * Math.round(-0.05 * 10) / 10 gives -0 because Math.round rounds half UP, which
 * for negatives means towards zero. The epsilon-free sign-aware form below is
 * what the tests pin.
 */
export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  const scaled = value * factor;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return rounded / factor;
}

/** Trims and collapses whitespace, so "  cape   canaveral " normalises. */
export function normaliseCity(city: string): string {
  const collapsed = city.trim().split(/\s+/).filter(Boolean).join(' ');
  if (collapsed === '') {
    throw new InvalidCityError();
  }
  return collapsed;
}
