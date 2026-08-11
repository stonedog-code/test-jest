import {
  InvalidCityError,
  InvalidUnitsError,
  celsiusToFahrenheit,
  convertTemp,
  normaliseCity,
  parseUnits,
  roundTo,
  type Units,
} from '../../src/weather/model';

/**
 * `describe` groups; `it` states a behaviour. Read the name out loud with the
 * describe in front of it: "parseUnits defaults to imperial when empty". A test
 * name that does not survive that reading is a test nobody will understand at
 * 3am.
 */
describe('parseUnits', () => {
  // it.each is Jest's table-driven form. One row per case, and the $variables
  // are interpolated into the test name so a failure names the case.
  it.each<[string, string | undefined, Units]>([
    ['empty string defaults to imperial', '', 'imperial'],
    ['undefined defaults to imperial', undefined, 'imperial'],
    ['metric', 'metric', 'metric'],
    ['celsius alias', 'celsius', 'metric'],
    ['single letter c', 'c', 'metric'],
    ['imperial', 'imperial', 'imperial'],
    ['fahrenheit alias', 'fahrenheit', 'imperial'],
    ['mixed case is accepted', 'MeTrIc', 'metric'],
    ['surrounding whitespace is trimmed', '  metric  ', 'metric'],
  ])('%s', (_name, input, expected) => {
    expect(parseUnits(input)).toBe(expected);
  });

  it.each(['kelvin', 'rankine', '!!', '0'])('rejects %p', (input) => {
    // toThrow with a constructor asserts the TYPE. Asserting the message
    // string instead breaks the moment somebody rewords it.
    expect(() => parseUnits(input)).toThrow(InvalidUnitsError);
  });
});

describe('convertTemp', () => {
  it.each<[number, Units, number]>([
    [0, 'imperial', 32],
    [100, 'imperial', 212],
    [-40, 'imperial', -40], // the crossover point
    [21.5, 'metric', 21.5],
    [21.44, 'metric', 21.4],
    [21.45, 'metric', 21.5],
  ])('converts %p °C in %s to %p', (tempC, units, expected) => {
    // toBeCloseTo, never toBe, for floating point. `0.1 + 0.2 === 0.3` is false
    // in every language with IEEE 754 doubles, and this is where it bites.
    expect(convertTemp(tempC, units)).toBeCloseTo(expected, 9);
  });

  it('rounds negatives away from zero', () => {
    expect(convertTemp(-0.05, 'metric')).toBeCloseTo(-0.1, 9);
  });

  it('never returns negative zero', () => {
    // Object.is distinguishes 0 from -0 where === does not. A -0 in a JSON
    // response serialises as "0" but compares unequal in a snapshot.
    expect(Object.is(convertTemp(0, 'metric'), -0)).toBe(false);
  });
});

describe('celsiusToFahrenheit', () => {
  it('is exact at the well-known points', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
  });
});

describe('roundTo', () => {
  it.each<[number, number, number]>([
    [1.234, 2, 1.23],
    [1.235, 2, 1.24],
    [-1.235, 2, -1.24],
    [1.5, 0, 2],
    [-1.5, 0, -2],
  ])('rounds %p to %p places as %p', (value, places, expected) => {
    expect(roundTo(value, places)).toBe(expected);
  });
});

describe('normaliseCity', () => {
  it.each<[string, string]>([
    ['Orlando', 'Orlando'],
    ['  Orlando  ', 'Orlando'],
    ['Cape   Canaveral', 'Cape Canaveral'],
    ['Cape\t\nCanaveral', 'Cape Canaveral'],
  ])('normalises %p to %p', (input, expected) => {
    expect(normaliseCity(input)).toBe(expected);
  });

  it.each(['', '   ', '\t\n'])('throws on %p', (input) => {
    expect(() => normaliseCity(input)).toThrow(InvalidCityError);
  });

  // A property test, hand-rolled. Whatever the input, the output must never
  // have leading, trailing, or doubled whitespace.
  it('output is always already normalised', () => {
    const inputs = ['a b', ' a  b ', 'x', '日本  東京', 'a b'];
    for (const input of inputs) {
      const once = normaliseCity(input);
      expect(normaliseCity(once)).toBe(once);
    }
  });
});
