import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const loadJson = async (relativePath) => {
  const filePath = join(repoRoot, relativePath);
  const contents = await readFile(filePath, 'utf8');
  return JSON.parse(contents);
};

const isString = (value) => typeof value === 'string' && value.length > 0;
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNullableNumber = (value) => value === null || isNumber(value);
const isNonNegativeIntegerOrNull = (value) => value === null || (Number.isInteger(value) && value >= 0);

const expectLoanableShape = (data: any) => {
  expect(typeof data).toBe('object');
  expect(isString(data.source)).toBe(true);
  expect(isString(data.fetchedAt)).toBe(true);
  expect(Number.isInteger(data.total) && data.total >= 0).toBe(true);
  expect(Array.isArray(data.rows)).toBe(true);
  data.rows.forEach((row: any, index: number) => {
    expect(typeof row).toBe('object');
    expect(isString(row.loanCoin)).toBe(true);
    expect(isNumber(row.yearlyInterestRate)).toBe(true);
    expect(isNumber(row.hourlyInterestRate)).toBe(true);
    expect(isNullableNumber(row.vipYearlyInterestRate)).toBe(true);
    const unexpectedKeys = Object.keys(row).filter((key) => !['loanCoin', 'yearlyInterestRate', 'hourlyInterestRate', 'vipYearlyInterestRate'].includes(key));
    expect(unexpectedKeys, `row ${index} contiene claves inesperadas: ${unexpectedKeys.join(', ')}`).toEqual([]);
  });
  expect(data.rows.length).toBe(data.total);
};

const expectCollateralShape = (data: any) => {
  expect(typeof data).toBe('object');
  expect(isString(data.source)).toBe(true);
  expect(isString(data.fetchedAt)).toBe(true);
  expect(Number.isInteger(data.total) && data.total >= 0).toBe(true);
  expect(Array.isArray(data.rows)).toBe(true);
  data.rows.forEach((row: any, index: number) => {
    expect(typeof row).toBe('object');
    expect(isString(row.collateralCoin)).toBe(true);
    expect(isNumber(row.initialLTV)).toBe(true);
    expect(isNumber(row.marginCallLTV)).toBe(true);
    expect(isNumber(row.liquidationLTV)).toBe(true);
    const unexpectedKeys = Object.keys(row).filter((key) => !['collateralCoin', 'initialLTV', 'marginCallLTV', 'liquidationLTV'].includes(key));
    expect(unexpectedKeys, `row ${index} contiene claves inesperadas: ${unexpectedKeys.join(', ')}`).toEqual([]);
  });
  expect(data.rows.length).toBe(data.total);
};

const expectAdminStateShape = (data: any) => {
  expect(typeof data).toBe('object');
  expect(typeof data.hasCache).toBe('boolean');
  expect(isNonNegativeIntegerOrNull(data.ageMs)).toBe(true);
  expect(data.cacheTs === null || isString(data.cacheTs)).toBe(true);
  expect(isString(data.cacheSource)).toBe(true);
  const unexpectedKeys = Object.keys(data).filter((key) => !['hasCache', 'cacheTs', 'ageMs', 'cacheSource'].includes(key));
  expect(unexpectedKeys, `El estado contiene claves inesperadas: ${unexpectedKeys.join(', ')}`).toEqual([]);
};

describe('binance API snapshots', () => {
  it('loanable snapshot matches schema', async () => {
    const data = await loadJson('api/binance/loanable.json');
    expectLoanableShape(data);
  });

  it('collateral snapshot matches schema', async () => {
    const data = await loadJson('api/binance/collateral.json');
    expectCollateralShape(data);
  });

  it('admin state snapshot matches schema', async () => {
    const data = await loadJson('api/admin/state.json');
    expectAdminStateShape(data);
  });
});
