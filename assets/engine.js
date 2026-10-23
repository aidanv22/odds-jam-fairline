// Fair Line engine: pure functions for odds math, devig, +EV and arbitrage detection.
// Works in the browser (global FL) and in Node (module.exports) so it can be tested directly.
var FL = (function () {
  var MARKET_KEYS = ['h2h', 'spreads', 'totals'];

  // ---- odds conversions ----
  function toDec(price) {
    // accepts decimal or American; American is never strictly between -100 and +100
    var p = Number(price);
    if (!isFinite(p)) return NaN;
    if (p <= -100) return 1 + 100 / -p;
    if (p >= 100) return 1 + p / 100;
    return p; // already decimal
  }
  function toAm(d) {
    if (!(d > 1)) return NaN;
    return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
  }
  function fmtAm(d) {
    var a = toAm(d);
    if (!isFinite(a)) return '—';
    if (a === -100) a = 100;
    return a > 0 ? '+' + a : '−' + Math.abs(a);
  }
  function fmtPt(p) {
    if (p === 0) return 'PK';
    return (p > 0 ? '+' : '−') + Math.abs(p);
  }

  // ---- devig ----
  function powerDevig(p) {
    var lo = 0.01, hi = 20, k = 1;
    for (var i = 0; i < 80; i++) {
      k = (lo + hi) / 2;
      var s = 0;
      for (var j = 0; j < p.length; j++) s += Math.pow(p[j], k);
      if (s > 1) lo = k; else hi = k;
    }
    return p.map(function (x) { return Math.pow(x, k); });
  }
  // decs: decimal prices for every outcome of one market, same order every time
  function devig(decs, method) {
    var p = decs.map(function (d) { return 1 / d; });
    var S = p.reduce(function (a, b) { return a + b; }, 0);
    var n = p.length;
    var mult = p.map(function (x) { return x / S; });
    if (method === 'multiplicative') return mult;
    var add = p.map(function (x) { return Math.max(1e-6, x - (S - 1) / n); });
    if (method === 'additive') return add;
    var pow = powerDevig(p);
    if (method === 'power') return pow;
    // worst case: the least favourable fair probability for each side
    return p.map(function (_, i) { return Math.min(mult[i], add[i], pow[i]); });
  }
  function hold(decs) {
    return decs.reduce(function (a, d) { return a + 1 / d; }, 0) - 1;
  }

  // ---- normalise API events into market groups (one group = one event + market + line) ----
  function buildGroups(events) {
    var groups = new Map();
    (events || []).forEach(function (ev) {
      var home = ev.home_team, away = ev.away_team;
      var commence = Date.parse(ev.commence_time);
      (ev.bookmakers || []).forEach(function (bk) {
        (bk.markets || []).forEach(function (m) {
          if (MARKET_KEYS.indexOf(m.key) < 0 || !m.outcomes || !m.outcomes.length) return;
          var updated = Date.parse(m.last_update || bk.last_update || '') || 0;
          var line = null;
          if (m.key === 'spreads') {
            var o = m.outcomes.filter(function (x) { return x.name === home; })[0] || m.outcomes[0];
            if (o.point == null) return;
            line = o.name === home ? Number(o.point) : -Number(o.point);
          } else if (m.key === 'totals') {
            if (m.outcomes[0].point == null) return;
            line = Number(m.outcomes[0].point);
          }
          var gid = ev.id + '|' + m.key + '|' + (line === null ? '' : line);
          var g = groups.get(gid);
          if (!g) {
            g = {
              id: gid, eventId: ev.id, sportKey: ev.sport_key || '',
              sportTitle: ev.sport_title || sportName(ev.sport_key),
              home: home, away: away, commence: commence,
              type: m.key, line: line, names: [], books: {}
            };
            groups.set(gid, g);
          }
          var entry = { title: bk.title || bk.key, prices: {}, links: {}, updated: updated };
          m.outcomes.forEach(function (oc) {
            if (m.key === 'spreads') {
              var hp = oc.name === home ? Number(oc.point) : -Number(oc.point);
              if (hp !== line) return;
            }
            if (m.key === 'totals' && Number(oc.point) !== line) return;
            var d = toDec(oc.price);
            if (!(d > 1)) return;
            entry.prices[oc.name] = d;
            var link = oc.link || m.link || bk.link;
            if (link) entry.links[oc.name] = link;
            if (g.names.indexOf(oc.name) < 0) g.names.push(oc.name);
          });
          g.books[bk.key] = entry;
        });
      });
    });
    var out = [];
    groups.forEach(function (g) {
      var rank = function (n) {
        if (g.type === 'totals') return n === 'Over' ? 0 : 1;
        if (n === g.away) return 0;
        if (n === g.home) return 1;
        if (n === 'Draw') return 2;
        return 3;
      };
      g.names.sort(function (a, b) { return rank(a) - rank(b); });
      g.labels = {};
      g.names.forEach(function (n) { g.labels[n] = outcomeLabel(g, n); });
      out.push(g);
    });
    return out;
  }

  function outcomeLabel(g, n) {
    if (g.type === 'spreads') return n + ' ' + fmtPt(n === g.home ? g.line : -g.line);
    if (g.type === 'totals') return n + ' ' + g.line;
    return n === 'Draw' ? 'Draw' : n;
  }

  function sportName(key) {
    var map = {
      americanfootball_nfl: 'NFL', americanfootball_ncaaf: 'NCAAF', basketball_nba: 'NBA',
      basketball_ncaab: 'NCAAB', basketball_wnba: 'WNBA', icehockey_nhl: 'NHL', baseball_mlb: 'MLB',
      soccer_epl: 'EPL', soccer_usa_mls: 'MLS', soccer_uefa_champs_league: 'UCL', mma_mixed_martial_arts: 'MMA'
    };
    return map[key] || (key || '').replace(/_/g, ' ');
  }

  // prices for every outcome, or null when the book is missing a side
  function fullMarket(g, bookKey) {
    var b = g.books[bookKey];
    if (!b) return null;
    var decs = [];
    for (var i = 0; i < g.names.length; i++) {
      var d = b.prices[g.names[i]];
      if (!(d > 1)) return null;
      decs.push(d);
    }
    return decs;
  }

  function isFresh(g, bookKey, cfg) {
    var b = g.books[bookKey];
    if (!b) return false;
    if (!cfg.staleMs || !b.updated) return true;
    return cfg.now - b.updated <= cfg.staleMs;
  }

  function inWindow(g, cfg) {
    if (!cfg.includeLive && g.commence <= cfg.now) return false;
    return true;
  }

  // ---- fair probabilities for one group ----
  // returns function(bookKeyBeingPriced) -> {fair:[...], kind, text, n} or null
  function fairFor(g, cfg) {
    var refDecs = null;
    var refBook = cfg.refBook;
    if (cfg.refMode !== 'consensus' && refBook && isFresh(g, refBook, cfg)) {
      refDecs = fullMarket(g, refBook);
    }
    if (refDecs) {
      var fair = devig(refDecs, cfg.method);
      var info = {
        fair: fair, kind: 'book', book: refBook, title: g.books[refBook].title,
        decs: refDecs, hold: hold(refDecs), n: 1
      };
      return function () { return info; };
    }
    if (cfg.refMode === 'book') return null;

    // consensus: average devigged probabilities of every complete, fresh book
    var contrib = {};
    var sums = g.names.map(function () { return 0; });
    var count = 0;
    Object.keys(g.books).forEach(function (bk) {
      if (!isFresh(g, bk, cfg)) return;
      var decs = fullMarket(g, bk);
      if (!decs) return;
      var f = devig(decs, cfg.method);
      contrib[bk] = f;
      f.forEach(function (x, i) { sums[i] += x; });
      count++;
    });
    var minBooks = cfg.minConsensus || 3;
    return function (pricingBook) {
      var s = sums.slice(), n = count;
      if (contrib[pricingBook]) { // leave the book being priced out of its own fair line
        contrib[pricingBook].forEach(function (x, i) { s[i] -= x; });
        n--;
      }
      if (n < minBooks) return null;
      var fair = s.map(function (x) { return x / n; });
      var tot = fair.reduce(function (a, b) { return a + b; }, 0);
      fair = fair.map(function (x) { return x / tot; });
      return { fair: fair, kind: 'consensus', n: n };
    };
  }

  // ---- positive expected value ----
  function findEV(groups, cfg) {
    var out = [];
    groups.forEach(function (g) {
      if (!inWindow(g, cfg)) return;
      var getFair = fairFor(g, cfg);
      if (!getFair) return;
      Object.keys(g.books).forEach(function (bk) {
        if (cfg.refMode !== 'consensus' && bk === cfg.refBook) return;
        if (cfg.myBooks && cfg.myBooks.size && !cfg.myBooks.has(bk)) return;
        if (!isFresh(g, bk, cfg)) return;
        var ref = getFair(bk);
        if (!ref) return;
        var b = g.books[bk];
        g.names.forEach(function (name, i) {
          var d = b.prices[name];
          if (!(d > 1)) return;
          if (cfg.maxDec && d > cfg.maxDec) return;
          var p = ref.fair[i];
          var ev = p * d - 1;
          if (ev < cfg.minEV) return;
          var kellyF = Math.max(0, ev / (d - 1));
          out.push({
            g: g, book: bk, bookTitle: b.title, name: name, label: g.labels[name],
            dec: d, fairP: p, fairDec: 1 / p, ev: ev, kellyF: kellyF,
            stake: (cfg.bankroll || 0) * (cfg.kelly || 0) * kellyF,
            ref: ref, updated: b.updated, link: b.links[name] || null,
            verify: ev >= (cfg.verifyEV || 0.12)
          });
        });
      });
    });
    out.sort(function (a, b) { return b.ev - a.ev; });
    return out;
  }

  // ---- arbitrage: best price on every side across books sums to < 100% implied ----
  function findArbs(groups, cfg) {
    var out = [];
    groups.forEach(function (g) {
      if (!inWindow(g, cfg)) return;
      var legs = [];
      for (var i = 0; i < g.names.length; i++) {
        var name = g.names[i], best = null;
        Object.keys(g.books).forEach(function (bk) {
          if (cfg.arbBooks && cfg.arbBooks.size && !cfg.arbBooks.has(bk)) return;
          if (!isFresh(g, bk, cfg)) return;
          var d = g.books[bk].prices[name];
          if (d > 1 && (!best || d > best.dec)) {
            best = { name: name, label: g.labels[name], book: bk, bookTitle: g.books[bk].title, dec: d, link: g.books[bk].links[name] || null, updated: g.books[bk].updated };
          }
        });
        if (!best) return;
        legs.push(best);
      }
      if (legs.length < 2) return;
      var books = {};
      legs.forEach(function (l) { books[l.book] = 1; });
      if (Object.keys(books).length < 2) return;
      var sum = legs.reduce(function (a, l) { return a + 1 / l.dec; }, 0);
      if (sum >= 1) return;
      var profit = 1 / sum - 1;
      if (profit < (cfg.minArb || 0)) return;
      legs.forEach(function (l) { l.frac = (1 / l.dec) / sum; });
      out.push({ g: g, legs: legs, sum: sum, profit: profit, verify: profit >= (cfg.verifyArb || 0.06) });
    });
    out.sort(function (a, b) { return b.profit - a.profit; });
    return out;
  }

  // ---- odds screen: one line per event and market type ----
  function screenRows(groups, cfg, type) {
    var byEvent = new Map();
    groups.forEach(function (g) {
      if (g.type !== type || !inWindow(g, cfg)) return;
      var cur = byEvent.get(g.eventId);
      var score = function (x) {
        return (x.books[cfg.refBook] ? 1000 : 0) + Object.keys(x.books).length;
      };
      if (!cur || score(g) > score(cur)) byEvent.set(g.eventId, g);
    });
    var rows = [];
    byEvent.forEach(function (g) {
      var getFair = fairFor(g, cfg);
      var ref = getFair ? getFair(null) : null;
      rows.push({ g: g, fair: ref ? ref.fair : null, ref: ref });
    });
    rows.sort(function (a, b) { return a.g.commence - b.g.commence || a.g.away.localeCompare(b.g.away); });
    return rows;
  }

  // ---- normal distribution, used to move a fair line to a nearby number ----
  function ncdf(x) {
    var z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
    var erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-z * z);
    return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
  }
  function ninv(p) { // Acklam's rational approximation
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    var q, r;
    if (p < 0.02425) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - 0.02425) return -ninv(1 - p);
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  // rough spread of final margin and total around the market number, by sport
  var SIGMA = {
    americanfootball_nfl: [13.5, 13.5], americanfootball_ncaaf: [16, 16], basketball_nba: [12.5, 18],
    basketball_ncaab: [10.5, 15], basketball_wnba: [11, 15], icehockey_nhl: [2.3, 2.2], baseball_mlb: [4.2, 4.3]
  };
  function sigmaFor(sportKey, type) {
    var s = SIGMA[sportKey] || (/^soccer_/.test(sportKey || '') ? [1.6, 1.6] : [12, 15]);
    return type === 'totals' ? s[1] : s[0];
  }

  // fair win probability for one side at a given number.
  // bet: {eventId, sportKey, type, name, line, home}; line is the group's line (home handicap or total)
  function fairAtLine(groups, bet, cfg, excludeBook) {
    var same = groups.filter(function (g) { return g.eventId === bet.eventId && g.type === bet.type; });
    if (!same.length) return null;
    var priced = [];
    same.forEach(function (g) {
      var get = fairFor(g, cfg);
      var ref = get ? get(excludeBook || null) : null;
      if (ref) priced.push({ g: g, ref: ref });
    });
    if (!priced.length) return null;
    if (bet.type === 'h2h') {
      var i0 = priced[0].g.names.indexOf(bet.name);
      return i0 < 0 ? null : { p: priced[0].ref.fair[i0], est: false, line: null, kind: priced[0].ref.kind };
    }
    var exact = priced.filter(function (x) { return x.g.line === bet.line; })[0];
    if (exact) {
      var ie = exact.g.names.indexOf(bet.name);
      if (ie >= 0) return { p: exact.ref.fair[ie], est: false, line: exact.g.line, kind: exact.ref.kind };
    }
    // nearest number the fair line exists at, then shift along a normal curve
    priced.sort(function (a, b) {
      return Math.abs(a.g.line - bet.line) - Math.abs(b.g.line - bet.line) || Object.keys(b.g.books).length - Object.keys(a.g.books).length;
    });
    var n = priced[0], sigma = sigmaFor(bet.sportKey, bet.type), p;
    if (bet.type === 'spreads') {
      var ih = n.g.names.indexOf(n.g.home);
      if (ih < 0) return null;
      var pHome = ncdf(ninv(n.ref.fair[ih]) + (bet.line - n.g.line) / sigma);
      p = bet.name === n.g.home ? pHome : 1 - pHome;
    } else {
      var io = n.g.names.indexOf('Over');
      if (io < 0) return null;
      var pOver = ncdf(ninv(n.ref.fair[io]) - (bet.line - n.g.line) / sigma);
      p = bet.name === 'Over' ? pOver : 1 - pOver;
    }
    return { p: p, est: true, line: n.g.line, kind: n.ref.kind };
  }

  // ---- grading from a final score (The Odds API /scores shape) ----
  function gradeBet(bet, ev) {
    if (!ev || !ev.completed || !ev.scores) return null;
    var sc = {};
    ev.scores.forEach(function (s) { sc[s.name] = Number(s.score); });
    var hs = sc[bet.home], as = sc[bet.away];
    if (!isFinite(hs) || !isFinite(as)) return null;
    var res;
    if (bet.type === 'h2h') {
      if (bet.name === 'Draw') res = hs === as ? 'win' : 'loss';
      else if (hs === as) res = bet.threeWay ? 'loss' : 'push';
      else res = (hs > as) === (bet.name === bet.home) ? 'win' : 'loss';
    } else if (bet.type === 'spreads') {
      var homeMargin = hs - as;
      var v = bet.name === bet.home ? homeMargin + bet.line : -homeMargin - bet.line;
      res = v > 0 ? 'win' : v < 0 ? 'loss' : 'push';
    } else {
      var w = bet.name === 'Over' ? hs + as - bet.line : bet.line - (hs + as);
      res = w > 0 ? 'win' : w < 0 ? 'loss' : 'push';
    }
    return { result: res, score: bet.away + ' ' + as + ', ' + bet.home + ' ' + hs };
  }
  function betPL(bet) {
    if (bet.result === 'win') return bet.stake * (bet.dec - 1);
    if (bet.result === 'loss') return -bet.stake;
    if (bet.result === 'push' || bet.result === 'void') return 0;
    return null;
  }
  function betCLV(bet) { return bet.close && bet.close.p > 0 ? bet.close.p * bet.dec - 1 : null; }

  // ---- how a log of bets is doing against the fair line ----
  function logStats(bets) {
    var s = { n: 0, open: 0, settled: 0, staked: 0, pl: 0, expPL: 0, expVar: 0, clvN: 0, clvStake: 0, clvSum: 0, beat: 0, wins: 0, decided: 0, expWins: 0 };
    bets.forEach(function (b) {
      s.n++;
      var clv = betCLV(b);
      if (clv !== null) { s.clvN++; s.clvStake += b.stake; s.clvSum += clv * b.stake; if (clv > 0) s.beat++; }
      var pl = betPL(b);
      if (pl === null) { s.open++; return; }
      s.settled++; s.staked += b.stake; s.pl += pl;
      if (b.result === 'win' || b.result === 'loss') {
        var p = b.close && b.close.p > 0 ? b.close.p : b.fairAtBet; // best estimate of the true chance
        if (!(p > 0 && p < 1)) p = 1 / b.dec; // no fair line at all: assume the price was fair
        s.decided++; if (b.result === 'win') s.wins++; s.expWins += p;
        s.expPL += b.stake * (p * b.dec - 1);
        s.expVar += b.stake * b.stake * b.dec * b.dec * p * (1 - p);
      }
    });
    s.avgCLV = s.clvStake ? s.clvSum / s.clvStake : null;
    s.beatRate = s.clvN ? s.beat / s.clvN : null;
    s.roi = s.staked ? s.pl / s.staked : null;
    s.sd = Math.sqrt(s.expVar);
    s.z = s.expVar > 0 ? (s.pl - s.expPL) / s.sd : null;
    return s;
  }

  return {
    MARKET_KEYS: MARKET_KEYS, toDec: toDec, toAm: toAm, fmtAm: fmtAm, fmtPt: fmtPt,
    devig: devig, hold: hold, buildGroups: buildGroups, fullMarket: fullMarket,
    findEV: findEV, findArbs: findArbs, screenRows: screenRows, sportName: sportName, isFresh: isFresh,
    ncdf: ncdf, ninv: ninv, sigmaFor: sigmaFor, fairAtLine: fairAtLine, gradeBet: gradeBet,
    betPL: betPL, betCLV: betCLV, logStats: logStats
  };
})();
if (typeof module !== 'undefined') module.exports = FL;
