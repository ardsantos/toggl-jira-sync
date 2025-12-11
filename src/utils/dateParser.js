import dayjs from "dayjs";

export function parseDateInput(input) {
  if (!input && input !== 0) {
    throw new Error("Date input is required");
  }

  const inputStr = String(input).trim();

  const integerPattern = /^\d+$/;
  const negativeIntegerPattern = /^-\d+$/;

  if (negativeIntegerPattern.test(inputStr)) {
    const daysAgo = parseInt(inputStr, 10);
    throw new Error(
      `Invalid days ago: ${daysAgo}. Must be a non-negative integer.`
    );
  }

  if (integerPattern.test(inputStr)) {
    const daysAgo = parseInt(inputStr, 10);

    if (daysAgo > 365) {
      throw new Error(
        `Invalid days ago: ${daysAgo}. Maximum is 365 days.`
      );
    }

    return dayjs().subtract(daysAgo, 'day').startOf('day');
  }

  return dayjs(inputStr);
}

export function isIntegerInput(input) {
  return /^\d+$/.test(String(input).trim());
}
