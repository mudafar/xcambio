const test = require('node:test');
const assert = require('node:assert/strict');

const { computeConversion, getUpdatedPair } = require('./app.js');

test('computeConversion converts bolivares to usdt', () => {
  assert.equal(computeConversion(1000, 50), 20);
});

test('getUpdatedPair auto-updates the opposite field based on which one was edited', () => {
  assert.deepEqual(getUpdatedPair({ source: 'bs', value: 1000, rate: 50 }), {
    amount: 1000,
    result: 20,
    source: 'bs'
  });

  assert.deepEqual(getUpdatedPair({ source: 'usdt', value: 20, rate: 50 }), {
    amount: 1000,
    result: 20,
    source: 'usdt'
  });
});
