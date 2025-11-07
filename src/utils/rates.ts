export const HOURS_IN_YEAR = 365 * 24;

export const annualToHourly = (apr: number): number => {
  const normalized = Number(apr);
  if (!Number.isFinite(normalized)) return 0;
  if (normalized <= -0.9999) return 0;
  if (normalized === 0) return 0;
  return Math.pow(1 + normalized, 1 / HOURS_IN_YEAR) - 1;
};
