// Bet log math: grading, profit, closing line value and fair price at a moved line. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const FL = require('../assets/engine.js');

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('normal distribution helpers', () => {
  near(FL.ncdf(0), 0.5, 1e-7);
  near(FL.ncdf(1.959964), 0.975, 1e-5);
  for (const p of [0.01, 0.2, 0.5, 0.73, 0.99]) near(FL.ncdf(FL.ninv(p)), p, 2e-6);
});

test('grading from final scores', () => {
  const base = { home: 'Philadelphia Eagles', away: 'Dallas Cowboys', stake: 100 };
  const fin = (h, a) => ({ completed: true, scores: [{ name: 'Philadelphia Eagles', score: String(h) }, { name: 'Dallas Cowboys', score: String(a) }] });
  const g = (b, h, a) => FL.gradeBet({ ...base, ...b }, fin(h, a)).result;
  assert.strictEqual(g({ type: 'spreads', name: 'Philadelphia Eagles', line: -4.5 }, 27, 21), 'win');
  assert.strictEqual(g({ type: 'spreads', name: 'Philadelphia Eagles', line: -4.5 }, 24, 21), 'loss');
  assert.strictEqual(g({ type: 'spreads', name: 'Dallas Cowboys', line: -4.5 }, 24, 21), 'win');
  assert.strictEqual(g({ type: 'spreads', name: 'Dallas Cowboys', line: -3 }, 24, 21), 'push');
  assert.strictEqual(g({ type: 'totals', name: 'Over', line: 44.5 }, 24, 21), 'win');
  assert.strictEqual(g({ type: 'totals', name: 'Under', line: 45 }, 24, 21), 'push');
  assert.strictEqual(g({ type: 'h2h', name: 'Dallas Cowboys' }, 24, 21), 'loss');
  assert.strictEqual(g({ type: 'h2h', name: 'Dallas Cowboys' }, 21, 21), 'push');
  assert.strictEqual(g({ type: 'h2h', name: 'Dallas Cowboys', threeWay: true }, 1, 1), 'loss');
  assert.strictEqual(g({ type: 'h2h', name: 'Draw', threeWay: true }, 1, 1), 'win');
  assert.strictEqual(FL.gradeBet({ ...base, type: 'h2h', name: 'Dallas Cowboys' }, { completed: false, scores: null }), null);
});

test('profit and closing line value', () => {
  near(FL.betPL({ result: 'win', stake: 100, dec: 2.6 }), 160);
  near(FL.betPL({ result: 'loss', stake: 100, dec: 2.6 }), -100);
  assert.strictEqual(FL.betPL({ result: 'open', stake: 100, dec: 2.6 }), null);
  near(FL.betCLV({ dec: 2.6, close: { p: 0.42 } }), 0.092);
});

test('fair price at a moved line', () => {
  const now = Date.now();
  const ev = [{
    id: 'e1', sport_key: 'americanfootball_nfl', sport_title: 'NFL', home_team: 'Philadelphia Eagles', away_team: 'Dallas Cowboys',
    commence_time: new Date(now + 3600e3).toISOString(),
    bookmakers: [{ key: 'pinnacle', title: 'Pinnacle', markets: [
      { key: 'spreads', last_update: new Date(now).toISOString(), outcomes: [{ name: 'Dallas Cowboys', price: 1.952, point: 3 }, { name: 'Philadelphia Eagles', price: 1.952, point: -3 }] },
      { key: 'totals', last_update: new Date(now).toISOString(), outcomes: [{ name: 'Over', price: 1.952, point: 45.5 }, { name: 'Under', price: 1.952, point: 45.5 }] }
    ] }]
  }];
  const groups = FL.buildGroups(ev);
  const cfg = { now, refBook: 'pinnacle', refMode: 'book+consensus', method: 'power', staleMs: 0 };
  const bet = (name, type, line) => ({ eventId: 'e1', sportKey: 'americanfootball_nfl', type, name, line });
  const exact = FL.fairAtLine(groups, bet('Philadelphia Eagles', 'spreads', -3), cfg);
  near(exact.p, 0.5, 1e-9); assert.strictEqual(exact.est, false);
  const moved = FL.fairAtLine(groups, bet('Philadelphia Eagles', 'spreads', -4.5), cfg);
  assert.ok(moved.est && moved.p < 0.5);
  near(moved.p, FL.ncdf(-1.5 / 13.5), 1e-9);
  near(FL.fairAtLine(groups, bet('Dallas Cowboys', 'spreads', -4.5), cfg).p, 1 - moved.p, 1e-12);
  const ov = FL.fairAtLine(groups, bet('Over', 'totals', 47.5), cfg);
  assert.ok(ov.est && ov.p < 0.5);
  near(ov.p, FL.ncdf(-2 / 13.5), 1e-9);
});

test('log stats', () => {
  const s = FL.logStats([
    { stake: 100, dec: 2.0, fairAtBet: 0.52, close: { p: 0.53 }, result: 'win' },
    { stake: 100, dec: 2.0, fairAtBet: 0.52, close: { p: 0.49 }, result: 'loss' },
    { stake: 50, dec: 1.91, fairAtBet: 0.55, close: null, result: 'open' }
  ]);
  assert.strictEqual(s.n, 3); assert.strictEqual(s.open, 1); assert.strictEqual(s.settled, 2);
  near(s.pl, 0);
  near(s.avgCLV, 0.02);
  near(s.beatRate, 0.5);
  near(s.expPL, 100 * (0.53 * 2 - 1) + 100 * (0.49 * 2 - 1));
  near(s.expVar, 1e4 * 4 * 0.53 * 0.47 + 1e4 * 4 * 0.49 * 0.51);
  // no fair line at all: price treated as fair, so expected profit is zero
  near(FL.logStats([{ stake: 100, dec: 2.5, fairAtBet: null, close: null, result: 'loss' }]).expPL, 0);
});
