import { describe, test, expect } from 'vitest';
import dayjs from 'dayjs';
import { parseDateInput, isIntegerInput } from '../src/utils/dateParser.js';

describe('parseDateInput', () => {
  describe('integer inputs (days ago)', () => {
    test('parses 0 as today', () => {
      const result = parseDateInput("0");
      expect(result.format("YYYY-MM-DD")).toBe(dayjs().format("YYYY-MM-DD"));
    });

    test('parses 7 as 7 days ago', () => {
      const result = parseDateInput("7");
      const expected = dayjs().subtract(7, 'day').format("YYYY-MM-DD");
      expect(result.format("YYYY-MM-DD")).toBe(expected);
    });

    test('accepts maximum 365 days', () => {
      const result = parseDateInput("365");
      const expected = dayjs().subtract(365, 'day').format("YYYY-MM-DD");
      expect(result.format("YYYY-MM-DD")).toBe(expected);
    });

    test('rejects days > 365', () => {
      expect(() => parseDateInput("366")).toThrow("Maximum is 365 days");
    });

    test('rejects negative integers', () => {
      expect(() => parseDateInput("-5")).toThrow("non-negative integer");
    });

    test('trims whitespace from integers', () => {
      const result = parseDateInput(" 7 ");
      const expected = dayjs().subtract(7, 'day').format("YYYY-MM-DD");
      expect(result.format("YYYY-MM-DD")).toBe(expected);
    });

    test('returns start of day for integer inputs', () => {
      const result = parseDateInput("1");
      expect(result.format("HH:mm:ss")).toBe("00:00:00");
    });
  });

  describe('date string inputs', () => {
    test('parses valid YYYY-MM-DD format', () => {
      const result = parseDateInput("2024-01-15");
      expect(result.format("YYYY-MM-DD")).toBe("2024-01-15");
      expect(result.isValid()).toBe(true);
    });

    test('returns invalid for malformed dates', () => {
      const result = parseDateInput("invalid-date");
      expect(result.isValid()).toBe(false);
    });

    test('treats float strings as date input (not days ago)', () => {
      const result = parseDateInput("3.5");
      expect(isIntegerInput("3.5")).toBe(false);
    });

    test('parses various valid date formats', () => {
      const result1 = parseDateInput("2024-12-11");
      expect(result1.isValid()).toBe(true);

      const result2 = parseDateInput("2024-01-01");
      expect(result2.isValid()).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('throws error for empty string', () => {
      expect(() => parseDateInput("")).toThrow("Date input is required");
    });

    test('throws error for null', () => {
      expect(() => parseDateInput(null)).toThrow("Date input is required");
    });

    test('throws error for undefined', () => {
      expect(() => parseDateInput(undefined)).toThrow("Date input is required");
    });

    test('handles numeric input (not string)', () => {
      const result = parseDateInput(7);
      const expected = dayjs().subtract(7, 'day').format("YYYY-MM-DD");
      expect(result.format("YYYY-MM-DD")).toBe(expected);
    });

    test('treats mixed alphanumeric as date string', () => {
      const result = parseDateInput("5days");
      expect(result.isValid()).toBe(false);
    });
  });
});

describe('isIntegerInput', () => {
  test('identifies integer strings', () => {
    expect(isIntegerInput("0")).toBe(true);
    expect(isIntegerInput("7")).toBe(true);
    expect(isIntegerInput("365")).toBe(true);
  });

  test('rejects non-integers', () => {
    expect(isIntegerInput("2024-01-01")).toBe(false);
    expect(isIntegerInput("3.5")).toBe(false);
    expect(isIntegerInput("-5")).toBe(false);
    expect(isIntegerInput("5days")).toBe(false);
  });

  test('handles whitespace', () => {
    expect(isIntegerInput(" 7 ")).toBe(true);
    expect(isIntegerInput(" 2024-01-01 ")).toBe(false);
  });
});
