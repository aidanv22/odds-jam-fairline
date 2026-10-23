// Odds math, devig, +EV and arbitrage checks against hand calculations. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const FL = require('../assets/engine.js');
const SAMPLE = require('../assets/sample-data.js');

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// rebase the sample slate to "now" the same way the page does
function sampleEvents(now) {
  return SAMPLE.map(e => ({
    ...e, commence_time: new Date(now + e.t * 60000).toISOString(),
    bookmakers: e.bookmakers.map(b => ({ ...b, markets: b.markets.map(m => ({ ...m, last_update: new Date(now - m.u * 60000).toISOString() })) }))
  }));
}
const myBooks = new Set(['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'espnbet', 'fanatics', 'betrivers', 'hardrockbet']);
const baseCfg = now => ({
  now, refBook: 'pinnacle', refMode: 'book+consensus', method: 'power', myBooks, minEV: 0.015, maxDec: 6,
  staleMs: 10 * 60000, includeLive: false, bankroll: 1000, kelly: 0.25, verifyEV: 0.12, arbBooks: myBooks, minConsensus: 3
});

test('odds conversions', () => {
  near(FL.toDec(-110), 1.909090909);
  near(FL.toDec(150), 2.5);
  near(FL.toDec(2.5), 2.5);
  assert.strictEqual(FL.fmtAm(1.909090909), '−110');
  assert.strictEqual(FL.fmtAm(2.5), '+150');
  assert.strictEqual(FL.fmtAm(2.0), '+100');
});

test('devig methods', () => {
  for (const m of ['multiplicative', 'additive', 'power', 'worst']) {
    const f = FL.devig([FL.toDec(-110), FL.toDec(-110)], m);
    near(f[0], 0.5); near(f[1], 0.5);
  }
  const pw = FL.devig([FL.toDec(-300), FL.toDec(240)], 'power');
  near(pw[0] + pw[1], 1, 1e-9);
  const mu = FL.devig([FL.toDec(-150), FL.toDec(130)], 'multiplicative');
  near(mu[0], 0.6 / (0.6 + 1 / 2.3), 1e-9);
  const wc = FL.devig([FL.toDec(-300), FL.toDec(240)], 'worst');
  const ad = FL.devig([FL.toDec(-300), FL.toDec(240)], 'additive');
  assert.ok(wc[1] <= pw[1] + 1e-12 && wc[1] <= ad[1] + 1e-12);
});

test('spread lines group by number', () => {
  const groups = FL.buildGroups(sampleEvents(Date.now()));
  const bengals = groups.filter(g => g.home === 'Cincinnati Bengals' && g.type === 'spreads');
  assert.deepStrictEqual(bengals.map(g => g.line).sort(), [1.5, 2.5]);
});

test('+EV: FanDuel Lakers +160 against Pinnacle', () => {
  const now = Date.now();
  const groups = FL.buildGroups(sampleEvents(now));
  const evs = FL.findEV(groups, baseCfg(now));
  const lak = evs.find(e => e.name === 'Los Angeles Lakers' && e.book === 'fanduel');
  assert.ok(lak, 'Lakers spot missing');
  const fair = FL.devig(FL.fullMarket(lak.g, 'pinnacle'), 'power');
  near(lak.ev, fair[0] * 2.6 - 1, 1e-9);
  near(lak.kellyF, lak.ev / 1.6, 1e-9);
  near(lak.stake, 1000 * 0.25 * lak.kellyF, 1e-9);
  // sorted best first
  for (let i = 1; i < evs.length; i++) assert.ok(evs[i - 1].ev >= evs[i].ev);
});

test('+EV: stale lines are filtered by age', () => {
  const now = Date.now();
  const groups = FL.buildGroups(sampleEvents(now));
  const isChiefs = e => e.name === 'Kansas City Chiefs' && e.book === 'betrivers';
  assert.ok(!FL.findEV(groups, baseCfg(now)).find(isChiefs));
  assert.ok(FL.findEV(groups, { ...baseCfg(now), staleMs: 60 * 60000 }).find(isChiefs));
});

test('+EV: consensus fallback when Pinnacle has no line', () => {
  const now = Date.now();
  const groups = FL.buildGroups(sampleEvents(now));
  const baylor = FL.findEV(groups, baseCfg(now)).find(e => e.label === 'Baylor Bears +3.5');
  assert.ok(baylor && baylor.ref.kind === 'consensus');
});

test('arbitrage: Lions total split across BetMGM and Caesars', () => {
  const now = Date.now();
  const groups = FL.buildGroups(sampleEvents(now));
  const arbs = FL.findArbs(groups, baseCfg(now));
  const lions = arbs.find(a => a.g.home === 'Detroit Lions' && a.g.type === 'totals');
  assert.ok(lions);
  near(lions.profit, 1 / (1 / 2.08 + 1 / 2.0) - 1, 1e-9);
  near(lions.legs.reduce((s, l) => s + l.frac, 0), 1, 1e-9);
  // equal return on every leg
  const r = lions.legs.map(l => l.frac * l.dec);
  near(r[0], r[1], 1e-9);
});
