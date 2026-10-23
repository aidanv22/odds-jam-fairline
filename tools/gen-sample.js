// Generates the built-in sample slate (invented prices) in The Odds API v4 shape.
// Times are stored as offsets: t = minutes until start, u = minutes since the market last updated.
const fs = require('fs');

let seed = 20261023;
function rnd() { // mulberry32
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gauss(sd) { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const hex = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');

const BOOKS = [
  ['pinnacle', 'Pinnacle'], ['draftkings', 'DraftKings'], ['fanduel', 'FanDuel'], ['betmgm', 'BetMGM'],
  ['williamhill_us', 'Caesars'], ['espnbet', 'theScore Bet'], ['fanatics', 'Fanatics'],
  ['betrivers', 'BetRivers'], ['hardrockbet', 'Hard Rock Bet']
];

function amFromProb(p, round5) {
  const d = 1 / p;
  let a = d >= 2 ? (d - 1) * 100 : -100 / (d - 1);
  a = round5 ? Math.round(a / 5) * 5 : Math.round(a);
  if (a > -100 && a < 100) a = a >= 0 ? 100 : -100;
  return a;
}
function decFromAm(a) { return a > 0 ? 1 + a / 100 : 1 + 100 / -a; }
const r3 = x => Math.round(x * 1000) / 1000;

// price a market: probs = true probabilities, margin = book hold, sharp = Pinnacle-style precision
function price(probs, margin, sd, sharp) {
  let q = probs.map(p => Math.max(0.02, p + gauss(sd)));
  const s = q.reduce((a, b) => a + b, 0);
  q = q.map(p => p / s * (1 + margin));
  return q.map(p => r3(decFromAm(amFromProb(p, !sharp))));
}

// sport, away, home, minutes to start, ML probs [away, home, (draw)], home spread line, P(home covers), total, P(over)
const EVENTS = [
  ['basketball_nba', 'NBA', 'Boston Celtics', 'New York Knicks', 376, [0.46, 0.54], -2.5, 0.50, 222.5, 0.50],
  ['basketball_nba', 'NBA', 'Denver Nuggets', 'Oklahoma City Thunder', 406, [0.36, 0.64], -5.5, 0.50, 228.5, 0.49],
  ['basketball_nba', 'NBA', 'Los Angeles Lakers', 'Golden State Warriors', 526, [0.41, 0.59], -3.5, 0.51, 231.5, 0.50],
  ['icehockey_nhl', 'NHL', 'Florida Panthers', 'Toronto Maple Leafs', 376, [0.47, 0.53], -1.5, 0.33, 6.5, 0.46],
  ['icehockey_nhl', 'NHL', 'Edmonton Oilers', 'Dallas Stars', 436, [0.49, 0.51], -1.5, 0.31, 6.5, 0.52],
  ['americanfootball_ncaaf', 'NCAAF', 'Kansas State Wildcats', 'Baylor Bears', 1362, [0.55, 0.45], 3.5, 0.50, 55.5, 0.50],
  ['americanfootball_ncaaf', 'NCAAF', 'Texas Longhorns', 'Georgia Bulldogs', 1592, [0.40, 0.60], -4.5, 0.50, 51.5, 0.50],
  ['americanfootball_ncaaf', 'NCAAF', 'Oregon Ducks', 'USC Trojans', 1802, [0.62, 0.38], 6.5, 0.49, 58.5, 0.51],
  ['soccer_epl', 'EPL', 'Chelsea', 'Arsenal', 1237, [0.25, 0.50, 0.25], null, null, 2.5, 0.55],
  ['americanfootball_nfl', 'NFL', 'Dallas Cowboys', 'Philadelphia Eagles', 2857, [0.36, 0.64], -4.5, 0.50, 46.5, 0.50],
  ['americanfootball_nfl', 'NFL', 'Baltimore Ravens', 'Cincinnati Bengals', 2857, [0.55, 0.45], 1.5, 0.50, 51.5, 0.50],
  ['americanfootball_nfl', 'NFL', 'Green Bay Packers', 'Detroit Lions', 3062, [0.42, 0.58], -2.5, 0.50, 49.5, 0.50],
  ['americanfootball_nfl', 'NFL', 'San Francisco 49ers', 'Seattle Seahawks', 3062, [0.52, 0.48], 1.5, 0.50, 44.5, 0.50],
  ['americanfootball_nfl', 'NFL', 'Kansas City Chiefs', 'Buffalo Bills', 3297, [0.47, 0.53], -1.5, 0.50, 47.5, 0.50]
];

const events = EVENTS.map(([sk, st, away, home, t, ml, hLine, pHome, total, pOver]) => {
  const noPinnacle = home === 'Baylor Bears';
  const books = BOOKS.filter(([k]) => !(noPinnacle && (k === 'pinnacle' || k === 'fanatics')));
  const bookmakers = books.map(([key, title]) => {
    const sharp = key === 'pinnacle';
    const markets = [];
    const u = () => Math.round((0.4 + rnd() * 3.5) * 10) / 10;
    // moneyline
    const mlMargin = sharp ? 0.025 : (ml.length === 3 ? 0.065 : 0.045);
    const mlP = price(ml, mlMargin, sharp ? 0.004 : 0.011, sharp);
    const mlNames = ml.length === 3 ? [away, home, 'Draw'] : [away, home];
    markets.push({ key: 'h2h', u: u(), outcomes: mlNames.map((n, i) => ({ name: n, price: mlP[i] })) });
    // spread
    if (hLine !== null) {
      let line = hLine, p = pHome;
      // a couple of books hang a different number
      if (home === 'Cincinnati Bengals' && (key === 'betmgm' || key === 'fanatics')) { line = 2.5; p = pHome + 0.035; }
      const sp = price([1 - p, p], sharp ? 0.02 : 0.045, sharp ? 0.003 : 0.009, sharp);
      markets.push({ key: 'spreads', u: u(), outcomes: [
        { name: away, price: sp[0], point: -line },
        { name: home, price: sp[1], point: line }
      ] });
    }
    // total
    const tp = price([pOver, 1 - pOver], sharp ? 0.02 : 0.045, sharp ? 0.003 : 0.009, sharp);
    markets.push({ key: 'totals', u: u(), outcomes: [
      { name: 'Over', price: tp[0], point: total },
      { name: 'Under', price: tp[1], point: total }
    ] });
    return { key, title, markets };
  });
  return { id: hex(), sport_key: sk, sport_title: st, t, home_team: home, away_team: away, bookmakers };
});

// ---- hand-placed spots so the sample shows each feature ----
function set(home, book, mkt, name, am, extra) {
  const ev = events.find(e => e.home_team === home);
  const bk = ev.bookmakers.find(b => b.key === book);
  const m = bk.markets.find(x => x.key === mkt);
  const o = m.outcomes.find(x => x.name === name);
  o.price = r3(decFromAm(am));
  if (extra && extra.u != null) m.u = extra.u;
}
set('Golden State Warriors', 'fanduel', 'h2h', 'Los Angeles Lakers', 160);      // soft price on the dog
set('Golden State Warriors', 'fanduel', 'h2h', 'Golden State Warriors', -195);
set('Philadelphia Eagles', 'draftkings', 'spreads', 'Philadelphia Eagles', 106);
set('Philadelphia Eagles', 'draftkings', 'spreads', 'Dallas Cowboys', -118); // juice-free favourite spread
set('Detroit Lions', 'betmgm', 'totals', 'Over', 108);                          // Over/Under split across books = arb
set('Detroit Lions', 'williamhill_us', 'totals', 'Under', 100);
set('Buffalo Bills', 'betrivers', 'h2h', 'Kansas City Chiefs', 150, { u: 48 });  // stale line, hidden by the freshness filter
set('Oklahoma City Thunder', 'fanatics', 'h2h', 'Denver Nuggets', 230);        // too good to be true: flagged Verify
set('Baylor Bears', 'hardrockbet', 'spreads', 'Baylor Bears', 115);             // no Pinnacle here: priced off consensus
set('Arsenal', 'betmgm', 'h2h', 'Draw', 340);                                   // three-way market
set('Seattle Seahawks', 'espnbet', 'totals', 'Under', 102);

const out = '// Sample slate with invented prices, in The Odds API v4 shape. Regenerate with: node tools/gen-sample.js\n' +
  '// t = minutes until start, u = minutes since the market last updated (rebased to page load).\n' +
  'var SAMPLE = ' + JSON.stringify(events) + ';\nif (typeof module !== \'undefined\') module.exports = SAMPLE;\n';
fs.writeFileSync(__dirname + '/../assets/sample-data.js', out);
console.log('wrote assets/sample-data.js:', events.length, 'events');
