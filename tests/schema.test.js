import { test } from 'node:test';
import assert from 'node:assert/strict';
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

const expectLoanableShape = (data) => {
  assert.equal(typeof data, 'object');
  assert.ok(isString(data.source), 'source debe ser string');
  assert.ok(isString(data.fetchedAt), 'fetchedAt debe ser string ISO');
  assert.ok(Number.isInteger(data.total) && data.total >= 0, 'total debe ser entero >= 0');
  assert.ok(Array.isArray(data.rows), 'rows debe ser array');
  data.rows.forEach((row, index) => {
    assert.equal(typeof row, 'object', `row ${index} debe ser objeto`);
    assert.ok(isString(row.loanCoin), `loanCoin inválido en row ${index}`);
    assert.ok(isNumber(row.yearlyInterestRate), `yearlyInterestRate inválido en row ${index}`);
    assert.ok(isNumber(row.hourlyInterestRate), `hourlyInterestRate inválido en row ${index}`);
    assert.ok(isNullableNumber(row.vipYearlyInterestRate), `vipYearlyInterestRate inválido en row ${index}`);
    const unexpectedKeys = Object.keys(row).filter((key) => !['loanCoin', 'yearlyInterestRate', 'hourlyInterestRate', 'vipYearlyInterestRate'].includes(key));
    assert.deepEqual(unexpectedKeys, [], `row ${index} contiene claves inesperadas: ${unexpectedKeys.join(', ')}`);
  });
  assert.equal(data.rows.length, data.total, 'Total debe coincidir con filas reportadas');
};

const expectCollateralShape = (data) => {
  assert.equal(typeof data, 'object');
  assert.ok(isString(data.source), 'source debe ser string');
  assert.ok(isString(data.fetchedAt), 'fetchedAt debe ser string ISO');
  assert.ok(Number.isInteger(data.total) && data.total >= 0, 'total debe ser entero >= 0');
  assert.ok(Array.isArray(data.rows), 'rows debe ser array');
  data.rows.forEach((row, index) => {
    assert.equal(typeof row, 'object', `row ${index} debe ser objeto`);
    assert.ok(isString(row.collateralCoin), `collateralCoin inválido en row ${index}`);
    assert.ok(isNumber(row.initialLTV), `initialLTV inválido en row ${index}`);
    assert.ok(isNumber(row.marginCallLTV), `marginCallLTV inválido en row ${index}`);
    assert.ok(isNumber(row.liquidationLTV), `liquidationLTV inválido en row ${index}`);
    const unexpectedKeys = Object.keys(row).filter((key) => !['collateralCoin', 'initialLTV', 'marginCallLTV', 'liquidationLTV'].includes(key));
    assert.deepEqual(unexpectedKeys, [], `row ${index} contiene claves inesperadas: ${unexpectedKeys.join(', ')}`);
  });
  assert.equal(data.rows.length, data.total, 'Total debe coincidir con filas reportadas');
};

const expectAdminStateShape = (data) => {
  assert.equal(typeof data, 'object');
  assert.equal(typeof data.hasCache, 'boolean', 'hasCache debe ser booleano');
  assert.ok(isNonNegativeIntegerOrNull(data.ageMs), 'ageMs debe ser entero >= 0 o null');
  assert.ok(data.cacheTs === null || isString(data.cacheTs), 'cacheTs debe ser string o null');
  assert.ok(isString(data.cacheSource), 'cacheSource debe ser string');
  const unexpectedKeys = Object.keys(data).filter((key) => !['hasCache', 'cacheTs', 'ageMs', 'cacheSource'].includes(key));
  assert.deepEqual(unexpectedKeys, [], `El estado contiene claves inesperadas: ${unexpectedKeys.join(', ')}`);
};

test('loanable snapshot matches schema', async () => {
  const data = await loadJson('api/binance/loanable.json');
  expectLoanableShape(data);
});

test('collateral snapshot matches schema', async () => {
  const data = await loadJson('api/binance/collateral.json');
  expectCollateralShape(data);
});

test('admin state snapshot matches schema', async () => {
  const data = await loadJson('api/admin/state.json');
  expectAdminStateShape(data);
});
