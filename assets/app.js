// Fair Line Scanner UI: settings, scanning, rendering and the bet log.
(function () {
  'use strict';
  var API = 'https://api.the-odds-api.com';
  var STORE_KEY = 'fairline.settings.v1';
  var BETS_KEY = 'fairline.bets.v1';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var SPORTS = [
    ['americanfootball_nfl', 'NFL'], ['americanfootball_ncaaf', 'NCAAF'], ['basketball_nba', 'NBA'], ['basketball_ncaab', 'NCAAB'],
    ['icehockey_nhl', 'NHL'], ['baseball_mlb', 'MLB'], ['soccer_epl', 'EPL'], ['soccer_usa_mls', 'MLS'],
    ['soccer_uefa_champs_league', 'Champions League'], ['mma_mixed_martial_arts', 'MMA']
  ];
  var BET_BOOKS = [
    ['draftkings', 'DraftKings'], ['fanduel', 'FanDuel'], ['betmgm', 'BetMGM'], ['williamhill_us', 'Caesars', 1],
    ['espnbet', 'theScore Bet'], ['fanatics', 'Fanatics', 1], ['betrivers', 'BetRivers'], ['hardrockbet', 'Hard Rock Bet'],
    ['ballybet', 'Bally Bet'], ['betparx', 'betPARX'], ['fliff', 'Fliff'], ['courtside', 'Courtside', 1], ['betonlineag', 'BetOnline'], ['bovada', 'Bovada'],
    ['mybookieag', 'MyBookie'], ['betus', 'BetUS'], ['lowvig', 'LowVig'], ['novig', 'Novig'], ['prophetx', 'ProphetX'],
    ['kalshi', 'Kalshi'], ['polymarket_us', 'Polymarket US']
  ];
  var SHARP_BOOKS = [
    ['pinnacle', 'Pinnacle'], ['betonlineag', 'BetOnline'], ['lowvig', 'LowVig'], ['novig', 'Novig'],
    ['prophetx', 'ProphetX'], ['betfair_ex_eu', 'Betfair Exchange'], ['', 'None: consensus only']
  ];
  var MARKETS = [['h2h', 'Moneyline'], ['spreads', 'Spread'], ['totals', 'Total']];
  var DEFAULTS = {
    apiKey: '', sports: ['americanfootball_nfl', 'americanfootball_ncaaf', 'basketball_nba', 'icehockey_nhl'],
    markets: ['h2h', 'spreads', 'totals'], sharp: 'pinnacle', fallback: true, method: 'power',
    myBooks: ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'espnbet', 'fanatics', 'betrivers', 'hardrockbet', 'ballybet'],
    minEV: 1.5, maxOdds: 500, staleMin: '10', window: '48', includeLive: false, format: 'american',
    bankroll: 1000, kelly: '0.25', arbStake: 500, auto: '0', usState: ''
  };

  var s = loadSettings();
  var st = {
    events: [], groups: [], ev: [], arbs: [], source: 'sample', asOf: Date.now(), quota: null,
    tab: 'ev', fSport: 'all', fBook: 'all', query: '', screenType: 'h2h', scanning: false, inSeason: null, timer: null, paidWarned: '',
    bets: [], viewEV: [], viewArbs: [], logBusy: false, armClose: 0, armDel: null, chart: null
  };

  function loadSettings() {
    var out = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { var saved = JSON.parse(raw); Object.keys(out).forEach(function (k) { if (k in saved) out[k] = saved[k]; }); }
    } catch (e) { /* storage unavailable: run on defaults */ }
    return out;
  }
  function saveSettings() { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

  // ---------- helpers ----------
  function sportLabel(key) {
    for (var i = 0; i < SPORTS.length; i++) if (SPORTS[i][0] === key) return SPORTS[i][1];
    if (st.inSeason) for (var j = 0; j < st.inSeason.length; j++) if (st.inSeason[j].key === key) return st.inSeason[j].title;
    return FL.sportName(key);
  }
  function bookTitle(key) {
    var all = BET_BOOKS.concat(SHARP_BOOKS);
    for (var i = 0; i < all.length; i++) if (all[i][0] === key) return all[i][1];
    for (var g = 0; g < st.groups.length; g++) if (st.groups[g].books[key]) return st.groups[g].books[key].title;
    return key;
  }
  // books The Odds API only returns on paid plans (third field in BET_BOOKS)
  function isPaid(key) { return BET_BOOKS.some(function (b) { return b[0] === key && b[2]; }); }
  function paidTitles(keys) {
    var t = keys.map(bookTitle);
    return t.length < 3 ? t.join(' and ') : t.slice(0, -1).join(', ') + ' and ' + t[t.length - 1];
  }
  function price(d) { return s.format === 'decimal' ? (d > 1 ? d.toFixed(2) : '—') : FL.fmtAm(d); }
  function pct(x, dp) { return (x * 100).toFixed(dp == null ? 1 : dp) + '%'; }
  function money(v) {
    if (!isFinite(v)) return '—';
    return '$' + v.toLocaleString(undefined, { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 });
  }
  function isSoccer(g) { return /^soccer_/.test(g.sportKey); }
  function gameName(g) { return isSoccer(g) ? g.home + ' vs ' + g.away : g.away + ' @ ' + g.home; }
  function marketName(g) {
    if (g.type === 'h2h') return isSoccer(g) || g.names.indexOf('Draw') >= 0 ? 'Match result' : 'Moneyline';
    if (g.type === 'spreads') return /icehockey/.test(g.sportKey) ? 'Puck line' : /baseball/.test(g.sportKey) ? 'Run line' : 'Spread';
    return 'Total';
  }
  function displayNow() { return st.source === 'live' ? Date.now() : st.asOf; }
  function fmtStart(ms, now) {
    if (ms <= now) return 'Live';
    var d = new Date(ms), n = new Date(now);
    var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === n.toDateString()) return (d.getHours() >= 17 ? 'Tonight ' : 'Today ') + time;
    var t = new Date(n); t.setDate(n.getDate() + 1);
    if (d.toDateString() === t.toDateString()) return 'Tomorrow ' + time;
    if (ms - now < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
  }
  function fmtAge(ms, now) {
    if (!ms) return '';
    var m = Math.max(0, Math.round((now - ms) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    return Math.round(m / 60) + 'h ago';
  }
  function kellyName() { return { '1': 'Full Kelly', '0.5': '½ Kelly', '0.25': '¼ Kelly', '0.125': '⅛ Kelly' }[String(s.kelly)] || 'Kelly'; }
  function betLink(url) {
    if (!url) return null;
    if (url.indexOf('{state}') >= 0) {
      if (!s.usState) return null;
      url = url.split('{state}').join(s.usState.toLowerCase());
    }
    return /^https?:\/\//.test(url) ? url : null;
  }
  function scanBooks() {
    var list = s.myBooks.slice();
    if (s.sharp && list.indexOf(s.sharp) < 0) list.unshift(s.sharp);
    return list;
  }
  function costPerScan() {
    var books = scanBooks().length;
    return { cost: s.sports.length * s.markets.length * Math.max(1, Math.ceil(books / 10)), mult: Math.max(1, Math.ceil(books / 10)), books: books };
  }
  function cfg() {
    var maxOdds = Number(s.maxOdds);
    return {
      now: st.asOf, refBook: s.sharp || null,
      refMode: !s.sharp ? 'consensus' : (s.fallback ? 'book+consensus' : 'book'),
      method: s.method, myBooks: new Set(s.myBooks), arbBooks: new Set(s.myBooks),
      minEV: (Number(s.minEV) || 0) / 100, maxDec: maxOdds >= 100 ? FL.toDec(maxOdds) : 0,
      staleMs: Number(s.staleMin) * 60000, includeLive: !!s.includeLive,
      bankroll: Number(s.bankroll) || 0, kelly: Number(s.kelly) || 0,
      verifyEV: 0.12, verifyArb: 0.05, minConsensus: 3
    };
  }

  // ---------- data ----------
  function loadSample() {
    var now = Date.now();
    st.events = SAMPLE.map(function (e) {
      return {
        id: e.id, sport_key: e.sport_key, sport_title: e.sport_title, home_team: e.home_team, away_team: e.away_team,
        commence_time: new Date(now + e.t * 60000).toISOString(),
        bookmakers: e.bookmakers.map(function (b) {
          return { key: b.key, title: b.title, markets: b.markets.map(function (m) {
            return { key: m.key, last_update: new Date(now - m.u * 60000).toISOString(), outcomes: m.outcomes };
          }) };
        })
      };
    });
    st.source = 'sample'; st.asOf = now; st.fSport = 'all'; st.fBook = 'all';
    rebuild();
  }
  function rebuild() { st.groups = FL.buildGroups(st.events); compute(); }
  function compute() {
    var c = cfg();
    st.ev = FL.findEV(st.groups, c);
    st.arbs = FL.findArbs(st.groups, c);
    render();
  }

  function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function readQuota(res) {
    var rem = res.headers.get('x-requests-remaining'), used = res.headers.get('x-requests-used');
    if (rem !== null) st.quota = { rem: Number(rem), used: Number(used) };
  }
  var BLOCKED = 'Your browser couldn\u2019t reach The Odds API. Check your connection and any ad or tracker blocker. If you opened this page as a file on disk, serve it over http instead (see How it works).';

  function needKey() {
    if (s.apiKey.trim()) return false;
    showBanner('warn', 'Add your Odds API key under Odds data first. A free key covers about 40 scans a month at the default settings.');
    openSettings(); $('#apiKey').focus();
    return true;
  }

  async function scanLive() {
    if (st.scanning || needKey()) return;
    if (!s.sports.length || !s.markets.length) { showBanner('warn', 'Pick at least one sport and one market to scan.'); return; }
    st.scanning = true; renderScanBtn();
    var params = new URLSearchParams({
      apiKey: s.apiKey.trim(), markets: s.markets.join(','), oddsFormat: 'decimal', dateFormat: 'iso',
      bookmakers: scanBooks().join(','), includeLinks: 'true'
    });
    if (s.window !== 'all') params.set('commenceTimeTo', iso(Date.now() + Number(s.window) * 3600000));
    var all = [], errs = [], blocked = false, badKey = false, outOfCredits = false;
    for (var i = 0; i < s.sports.length; i++) {
      var sport = s.sports[i];
      var url = API + '/v4/sports/' + encodeURIComponent(sport) + '/odds/?' + params.toString();
      try {
        var r = await fetch(url);
        if (r.status === 429) { await sleep(2000); r = await fetch(url); }
        readQuota(r);
        if (r.status === 401) {
          var body = ''; try { body = (await r.json()).message || ''; } catch (e) { /* ignore */ }
          if (/quota|usage/i.test(body)) outOfCredits = true; else badKey = true;
          break;
        }
        if (!r.ok) {
          var msg = ''; try { msg = (await r.json()).message || ''; } catch (e) { /* ignore */ }
          errs.push(sportLabel(sport) + ' (' + (msg || 'error ' + r.status) + ')');
          continue;
        }
        var data = await r.json();
        if (Array.isArray(data)) all = all.concat(data);
      } catch (e) { blocked = true; break; }
    }
    st.scanning = false; renderScanBtn();
    if (blocked) { showBanner('error', BLOCKED); return; }
    if (badKey) { showBanner('error', 'The Odds API rejected that key. Copy it again from your account page at the-odds-api.com.'); return; }
    if (outOfCredits) { showBanner('error', 'Your Odds API credits are used up for this period. They reset monthly, or you can upgrade the plan.'); return; }
    st.events = all; st.source = 'live'; st.asOf = Date.now();
    rebuild();
    captureCloses();
    if (st.tab === 'log') renderLog();
    // paid-only books come back empty on a free key without any error, so say so once instead of leaving them blank
    var seen = {};
    all.forEach(function (ev) { (ev.bookmakers || []).forEach(function (b) { seen[b.key] = 1; }); });
    var emptyPaid = all.length ? s.myBooks.filter(function (k) { return isPaid(k) && !seen[k]; }) : [];
    var paidKey = emptyPaid.join(','), paidMsg = '';
    if (emptyPaid.length && paidKey !== st.paidWarned) {
      paidMsg = ' No odds came back from ' + paidTitles(emptyPaid) + '. The Odds API includes ' + (emptyPaid.length === 1 ? 'it' : 'them') +
        ' only on paid plans, and ' + (emptyPaid.length === 1 ? 'it doesn’t' : 'they don’t') + ' price every sport.';
    }
    st.paidWarned = paidKey;
    if (errs.length) showBanner('warn', 'Some sports didn’t load: ' + errs.join('; ') + '.' + paidMsg);
    else if (!all.length) showBanner('info', 'No games with odds in that window. Try a longer look-ahead or other sports.');
    else if (paidMsg) showBanner('info', paidMsg.trim());
    else hideBanner();
  }

  async function loadInSeason() {
    if (needKey()) return;
    var btn = $('#inSeasonBtn'); btn.disabled = true; btn.textContent = 'Loading…';
    try {
      var r = await fetch(API + '/v4/sports/?apiKey=' + encodeURIComponent(s.apiKey.trim()));
      if (r.status === 401) showBanner('error', 'The Odds API rejected that key. Copy it again from your account page at the-odds-api.com.');
      else if (!r.ok) showBanner('error', 'Couldn’t load the sports list (error ' + r.status + ').');
      else {
        var list = await r.json();
        st.inSeason = list.filter(function (x) { return x.active && !x.has_outrights; })
          .map(function (x) { return { key: x.key, title: x.title }; });
        renderSportChips();
        showBanner('info', st.inSeason.length + ' sports are in season. Pick the ones to scan; the sports list doesn’t use credits.');
      }
    } catch (e) { showBanner('error', BLOCKED); }
    btn.disabled = false; btn.textContent = 'Load in-season';
  }

  function importJSON(texts) {
    var byId = {}, order = [];
    texts.forEach(function (t) {
      var v = JSON.parse(t);
      var list = Array.isArray(v) ? v : (v && Array.isArray(v.data) ? v.data : (v && v.bookmakers ? [v] : []));
      list.forEach(function (ev) {
        if (!ev || !ev.id || !ev.home_team) return;
        if (!byId[ev.id]) { byId[ev.id] = JSON.parse(JSON.stringify(ev)); order.push(ev.id); }
        else {
          var have = byId[ev.id];
          (ev.bookmakers || []).forEach(function (b) {
            var hb = have.bookmakers.filter(function (x) { return x.key === b.key; })[0];
            if (!hb) have.bookmakers.push(b);
            else b.markets.forEach(function (m) { hb.markets = hb.markets.filter(function (x) { return x.key !== m.key; }).concat([m]); });
          });
        }
      });
    });
    var events = order.map(function (id) { return byId[id]; });
    if (!events.length) throw new Error('none');
    st.events = events; st.source = 'import'; st.asOf = Date.now(); st.fSport = 'all';
    rebuild();
    showBanner('info', 'Loaded ' + events.length + ' games. Line ages count from when the feed captured them, so set the age filter to Never for older files.');
  }

  // ---------- rendering ----------
  function showBanner(kind, text) {
    var b = $('#banner'); b.className = 'banner ' + kind; $('#bannerText').textContent = text; b.hidden = false;
  }
  function hideBanner() { $('#banner').hidden = true; }
  function openSettings() { $('#settings').open = true; }

  function renderScanBtn() {
    var b = $('#scanBtn');
    b.disabled = st.scanning;
    b.innerHTML = st.scanning ? '<span class="spin" aria-hidden="true"></span>Scanning…' : 'Scan books';
  }

  function renderStatus() {
    var h = '';
    if (st.source === 'sample') h += '<span class="pill sample">Sample slate</span><span>Invented prices to show how it works</span>';
    else if (st.source === 'import') h += '<span class="pill import">Loaded file</span><span>' + st.events.length + ' games</span>';
    else h += '<span class="pill live">Live</span><span>Scanned ' + new Date(st.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</span>';
    if (st.quota) h += '<span class="num" title="Odds API credits left this period">' + st.quota.rem.toLocaleString() + ' credits left</span>';
    $('#status').innerHTML = h;
  }

  function passSport(g) { return st.fSport === 'all' || g.sportKey === st.fSport; }
  function passQuery(g) {
    if (!st.query) return true;
    var q = st.query.toLowerCase();
    return (g.home + ' ' + g.away + ' ' + g.sportTitle).toLowerCase().indexOf(q) >= 0;
  }
  function viewEV() {
    return st.ev.filter(function (e) { return passSport(e.g) && passQuery(e.g) && (st.fBook === 'all' || e.book === st.fBook); });
  }
  function viewArbs() {
    return st.arbs.filter(function (a) {
      return passSport(a.g) && passQuery(a.g) && (st.fBook === 'all' || a.legs.some(function (l) { return l.book === st.fBook; }));
    });
  }

  function renderStrip() {
    var ev = viewEV(), arbs = viewArbs();
    var events = {}, books = {};
    st.groups.forEach(function (g) { events[g.eventId] = 1; Object.keys(g.books).forEach(function (b) { books[b] = 1; }); });
    var best = ev.length ? ev[0].ev : 0;
    var totalStake = ev.reduce(function (a, e) { return a + e.stake; }, 0);
    var h = '';
    h += '<div class="stat good"><b>' + ev.length + '</b><span>+EV bets</span></div>';
    h += '<div class="stat good"><b>' + (best ? '+' + pct(best) : '—') + '</b><span>best edge</span></div>';
    h += '<div class="stat"><b>' + arbs.length + '</b><span>arbitrages</span></div>';
    h += '<div class="stat"><b>' + Object.keys(events).length + '</b><span>games · ' + Object.keys(books).length + ' books</span></div>';
    if (totalStake > 0) h += '<div class="stat"><b class="num" style="font-family:var(--f-display)">' + money(totalStake) + '</b><span>in suggested stakes</span></div>';
    $('#strip').innerHTML = h;
    $('#n-ev').textContent = ev.length;
    $('#n-arb').textContent = arbs.length;
  }

  function renderToolbar() {
    var sports = {};
    st.groups.forEach(function (g) { sports[g.sportKey] = g.sportTitle || sportLabel(g.sportKey); });
    var keys = Object.keys(sports);
    if (st.fSport !== 'all' && !sports[st.fSport]) st.fSport = 'all';
    var h = '<button class="chip" type="button" data-sport="all" aria-pressed="' + (st.fSport === 'all') + '">All sports</button>';
    keys.forEach(function (k) { h += '<button class="chip" type="button" data-sport="' + esc(k) + '" aria-pressed="' + (st.fSport === k) + '">' + esc(sports[k]) + '</button>'; });
    $('#sportFilter').innerHTML = keys.length > 1 ? h : '';
    var present = {};
    st.groups.forEach(function (g) { Object.keys(g.books).forEach(function (b) { if (s.myBooks.indexOf(b) >= 0) present[b] = 1; }); });
    var opts = '<option value="all">All my books</option>';
    s.myBooks.filter(function (b) { return present[b]; }).forEach(function (b) {
      opts += '<option value="' + esc(b) + '"' + (st.fBook === b ? ' selected' : '') + '>' + esc(bookTitle(b)) + '</option>';
    });
    $('#bookFilter').innerHTML = opts;
    if (st.fBook !== 'all' && !present[st.fBook]) { st.fBook = 'all'; $('#bookFilter').value = 'all'; }
    $('#toolbar').hidden = st.tab === 'how' || st.tab === 'log';
  }

  function refCell(e) {
    var r = e.ref;
    if (r.kind === 'book') {
      return '<span class="sub">' + esc(r.title) + ' ' + r.decs.map(price).join(' / ') + ' · hold ' + pct(r.hold) + '</span>';
    }
    return '<span class="sub">Consensus of ' + r.n + ' books</span>';
  }

  function emptyState(title, text) { return '<div class="sheet"><div class="empty"><strong>' + esc(title) + '</strong>' + esc(text) + '</div></div>'; }

  function renderEV() {
    var list = viewEV(), now = displayNow();
    st.viewEV = list;
    if (!list.length) {
      $('#panel-ev').innerHTML = emptyState('No +EV bets at these settings',
        st.groups.length ? 'Lower the minimum edge, add books, or loosen the line-age filter.' : 'Press Scan books to pull odds.');
      return;
    }
    var h = '<div class="sheet ev-list" role="table" aria-label="Positive EV bets"><div class="ev-head" role="row">' +
      '<span>Edge</span><span>Bet</span><span>Game</span><span>Book</span><span>Fair line</span><span class="h-stake">Stake</span></div>';
    list.forEach(function (e, i) {
      var g = e.g, link = betLink(e.link);
      var started = g.commence <= now;
      var priceHtml = '<span class="price">' + price(e.dec) + '</span>';
      var pb = link ? '<a class="pricebox" href="' + esc(link) + '" target="_blank" rel="noopener" title="Open at ' + esc(e.bookTitle) + '">' + priceHtml + ' ↗</a>'
                    : '<span class="pricebox">' + priceHtml + '</span>';
      h += '<div class="ev-row" role="row">' +
        '<div class="c-edge"><span class="edge">+' + pct(e.ev) + '</span><span class="bar"><i style="width:' + Math.min(100, e.ev / 0.1 * 100).toFixed(0) + '%"></i></span>' +
          (e.verify ? '<span class="verify" title="Edges this large usually mean a stale or mislabeled line. Confirm the price at the book first.">Check line</span>' : '') + '</div>' +
        '<div class="c-bet"><strong>' + esc(e.label) + '</strong><span class="sub">' + esc(marketName(g)) + '</span></div>' +
        '<div class="c-game"><span class="g">' + esc(gameName(g)) + '</span><span class="sub"><span class="tag' + (started ? ' live' : '') + '">' + esc(g.sportTitle) + '</span>' + esc(fmtStart(g.commence, now)) + '</span></div>' +
        '<div class="c-book">' + pb + '<span class="sub">' + esc(e.bookTitle) + ' · ' + esc(fmtAge(e.updated, now)) + '</span></div>' +
        '<div class="c-fair"><span class="price">' + price(e.fairDec) + '</span><span class="sub">' + pct(e.fairP) + ' fair win</span>' + refCell(e) + '</div>' +
        '<div class="c-stake"><span class="money">' + money(e.stake) + '</span><span class="sub">' + kellyName() + '</span>' +
          (isLogged(g, e.name, e.book) ? '<span class="logged">Logged</span>' : '<button class="logbtn" type="button" data-log="' + i + '">Log bet</button>') + '</div>' +
        '</div>';
    });
    h += '</div>';
    $('#panel-ev').innerHTML = h;
  }

  function renderArbs() {
    var list = viewArbs(), now = displayNow(), total = Number(s.arbStake) || 0;
    st.viewArbs = list;
    if (!list.length) {
      $('#panel-arb').innerHTML = emptyState('No arbitrage right now', 'True arbitrage is rare and closes in minutes. Adding more books gives the scanner more prices to pair.');
      return;
    }
    var h = '<div class="arbs">';
    list.forEach(function (a, ai) {
      var g = a.g, back = total / a.sum;
      h += '<article class="arb"><header><span class="edge">+' + pct(a.profit, 2) + '</span><div><strong>' + esc(marketName(g)) +
        (g.type === 'totals' ? ' ' + g.line : '') + '</strong><span class="sub"><span class="tag">' + esc(g.sportTitle) + '</span>' +
        esc(gameName(g)) + ' · ' + esc(fmtStart(g.commence, now)) + '</span>' +
        (a.verify ? '<span class="verify" title="Margins this large usually mean one price is stale. Confirm both before betting.">Check lines</span>' : '') +
        '</div></header><div class="legs-wrap"><table class="legs"><thead><tr><th>Bet</th><th>Book</th><th class="r">Odds</th><th class="r">Stake</th><th class="r">Returns</th></tr></thead><tbody>';
      a.legs.forEach(function (l) {
        var link = betLink(l.link), stake = total * l.frac;
        h += '<tr><td>' + esc(l.label) + '</td><td>' + (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">' + esc(l.bookTitle) + '</a>' : esc(l.bookTitle)) +
          '<span class="sub">' + esc(fmtAge(l.updated, now)) + '</span></td><td class="r price">' + price(l.dec) + '</td><td class="r money">' + money(stake) +
          '</td><td class="r money">' + money(stake * l.dec) + '</td></tr>';
      });
      h += '</tbody></table></div><footer>' + money(total) + ' staked returns ' + money(back) + ' on any result: <b>+' + money(back - total) + '</b>' + logArbBtn(a, ai) + '</footer></article>';
    });
    h += '</div>';
    $('#panel-arb').innerHTML = h;
  }

  function renderScreen() {
    var c = cfg(), now = displayNow();
    var rows = FL.screenRows(st.groups, c, st.screenType).filter(function (r) { return passSport(r.g) && passQuery(r.g); });
    var present = {};
    st.groups.forEach(function (g) { Object.keys(g.books).forEach(function (b) { present[b] = 1; }); });
    var cols = [];
    if (s.sharp && present[s.sharp]) cols.push(s.sharp);
    s.myBooks.forEach(function (b) { if (present[b] && cols.indexOf(b) < 0) cols.push(b); });
    var seg = '<div class="toolbar"><div class="seg" role="group" aria-label="Market">' + MARKETS.map(function (m) {
      return '<button type="button" data-screen="' + m[0] + '" aria-pressed="' + (st.screenType === m[0]) + '">' + m[1] + '</button>';
    }).join('') + '</div><div class="legend"><span><mark>+150</mark> best price among your books</span><span><span class="plus">+150</span> beats the fair line</span></div></div>';
    if (!rows.length) { $('#panel-screen').innerHTML = seg + emptyState('Nothing to show', 'No games have this market in the current data.'); return; }
    var h = seg + '<div class="sheet screen-wrap" style="margin-top:12px"><table class="screen"><thead><tr><th>Game</th><th>Fair</th>';
    cols.forEach(function (b) { h += '<th>' + esc(bookTitle(b)) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var g = r.g;
      var refNote = r.ref ? (r.ref.kind === 'book' ? '' : ' · consensus') : ' · no fair line';
      h += '<tr class="evt"><td colspan="' + (cols.length + 2) + '"><span class="tag' + (g.commence <= now ? ' live' : '') + '">' + esc(g.sportTitle) + '</span>' +
        esc(gameName(g)) + ' <span class="sub" style="display:inline;font-weight:400">· ' + esc(fmtStart(g.commence, now)) + esc(refNote) + '</span></td></tr>';
      g.names.forEach(function (name, i) {
        var best = 0;
        s.myBooks.forEach(function (b) {
          var bk = g.books[b];
          if (bk && bk.prices[name] && FL.isFresh(g, b, c) && bk.prices[name] > best) best = bk.prices[name];
        });
        var fp = r.fair ? r.fair[i] : null;
        h += '<tr><td>' + esc(g.labels[name]) + '</td><td class="fair">' + (fp ? price(1 / fp) + '<span class="e">' + pct(fp) + '</span>' : '—') + '</td>';
        cols.forEach(function (b) {
          var bk = g.books[b], d = bk && bk.prices[name];
          if (!d) { h += '<td class="p" style="color:var(--muted)">·</td>'; return; }
          var fresh = FL.isFresh(g, b, c), isRef = b === s.sharp;
          var edge = fp ? fp * d - 1 : null;
          var cls = 'p' + (isRef ? ' ref' : '') + (fresh ? '' : ' stale');
          var plus = !isRef && fresh && edge !== null && edge >= c.minEV;
          if (plus) cls += ' plus';
          var txt = price(d);
          if (!isRef && fresh && d === best) txt = '<mark>' + txt + '</mark>';
          var title = bookTitle(b) + ': updated ' + fmtAge(bk.updated, now) + (fresh ? '' : ' (stale)');
          h += '<td class="' + cls + '" title="' + esc(title) + '">' + txt + (plus ? '<span class="e">+' + pct(edge) + '</span>' : '') + '</td>';
        });
        h += '</tr>';
      });
    });
    h += '</tbody></table></div>';
    $('#panel-screen').innerHTML = h;
  }

  function renderTabs() {
    ['ev', 'arb', 'screen', 'log', 'how'].forEach(function (t) {
      $('#tab-' + t).setAttribute('aria-selected', String(st.tab === t));
      $('#panel-' + t).hidden = st.tab !== t;
    });
  }

  function render() {
    renderStatus(); renderStrip(); renderToolbar(); renderTabs();
    if (st.tab === 'ev') renderEV();
    if (st.tab === 'arb') renderArbs();
    if (st.tab === 'screen') renderScreen();
    if (st.tab === 'log') renderLog();
    $('#n-log').textContent = countBets();
  }

  // ---------- bet log ----------
  function loadBets() {
    try { var raw = localStorage.getItem(BETS_KEY); var v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function saveBets() { try { localStorage.setItem(BETS_KEY, JSON.stringify(st.bets)); } catch (e) { /* storage unavailable */ } }
  function realBets() { return st.bets.filter(function (b) { return !b.sample; }); }
  function sampleBets() { return st.bets.filter(function (b) { return b.sample; }); }
  function countBets() { return realBets().length || st.bets.length; }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function betKey(b) { return [b.eventId, b.type, b.line, b.name, b.book].join('|'); }
  function isLogged(g, name, book) {
    var k = [g.eventId, g.type, g.line, name, book].join('|');
    return st.bets.some(function (b) { return betKey(b) === k; });
  }
  function betGame(b) { return /^soccer_/.test(b.sportKey || '') ? b.home + ' vs ' + b.away : b.away + ' @ ' + b.home; }
  function fmtDate(ms) { return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function signedPct(x) { return (x >= 0 ? '+' : '−') + pct(Math.abs(x)); }
  function signedMoney(v) { return (v >= 0 ? '+' : '−') + money(Math.abs(v)); }
  function axisMoney(v) {
    var a = Math.abs(v), t = a >= 1000 ? '$' + (a / 1000).toFixed(a % 1000 === 0 ? 0 : 1) + 'k' : '$' + Math.round(a);
    return (v < 0 ? '−' : '') + t;
  }
  function niceStep(raw) {
    var pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  }

  function makeBet(g, name, book, title, dec, stake, fairP, refText) {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: Date.now(), sample: st.source === 'sample',
      eventId: g.eventId, sportKey: g.sportKey, sportTitle: g.sportTitle, home: g.home, away: g.away, commence: g.commence,
      type: g.type, line: g.line, name: name, label: g.labels[name], market: marketName(g), threeWay: g.names.indexOf('Draw') >= 0,
      book: book, bookTitle: title, dec: dec, stake: Math.max(1, Math.round(stake || 0)),
      fairAtBet: fairP || null, refAtBet: refText || '', close: null, result: 'open', score: null
    };
  }

  var toastTimer = null;
  function toast(text) {
    var t = $('#toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3800);
  }

  function logEV(e) {
    if (!e || isLogged(e.g, e.name, e.book)) return;
    var refText = e.ref.kind === 'book' ? e.ref.title : 'Consensus of ' + e.ref.n + ' books';
    st.bets.unshift(makeBet(e.g, e.name, e.book, e.bookTitle, e.dec, e.stake, e.fairP, refText));
    saveBets(); render();
    toast('Logged ' + e.label + ' at ' + e.bookTitle + (st.source === 'sample' ? ' as a practice bet' : '') + '. Change the stake or odds in Bet log if yours differ.');
  }
  function logArb(a) {
    if (!a) return;
    var c = cfg(), total = Number(s.arbStake) || 0, n = 0;
    a.legs.forEach(function (l) {
      if (isLogged(a.g, l.name, l.book)) return;
      var f = FL.fairAtLine(st.groups, { eventId: a.g.eventId, sportKey: a.g.sportKey, type: a.g.type, name: l.name, line: a.g.line, home: a.g.home }, c, l.book);
      var refText = f ? (f.kind === 'book' ? bookTitle(s.sharp) : 'Consensus') : '';
      st.bets.unshift(makeBet(a.g, l.name, l.book, l.bookTitle, l.dec, total * l.frac, f ? f.p : null, refText));
      n++;
    });
    saveBets(); render();
    toast(n ? 'Logged ' + n + ' bets from this arbitrage.' : 'Those bets are already in your log.');
  }
  function logArbBtn(a, i) {
    if (a.legs.every(function (l) { return isLogged(a.g, l.name, l.book); })) return '<span class="logged">Logged</span>';
    return '<button class="logbtn" type="button" data-logarb="' + i + '">' + (a.legs.length === 2 ? 'Log both bets' : 'Log all ' + a.legs.length + ' bets') + '</button>';
  }

  // the last scan before a game starts stands in for the closing line until a snapshot replaces it
  function captureCloses() {
    if (st.source !== 'live') return;
    var c = cfg(), changed = false;
    st.bets.forEach(function (b) {
      if (b.sample || st.asOf >= b.commence || (b.close && b.close.src === 'snapshot')) return;
      var f = FL.fairAtLine(st.groups, b, c, b.book);
      if (!f) return;
      b.close = { p: f.p, at: st.asOf, src: 'scan', est: f.est, line: f.line, kind: f.kind };
      changed = true;
    });
    if (changed) saveBets();
  }

  function setLogBusy(v) { st.logBusy = v; if (st.tab === 'log') renderLog(); }

  async function fetchResults() {
    if (needKey()) return;
    var now = Date.now();
    var due = realBets().filter(function (b) { return b.result === 'open' && b.commence < now; });
    if (!due.length) { toast('None of your open bets have started yet.'); return; }
    var bySport = {};
    due.forEach(function (b) { (bySport[b.sportKey] = bySport[b.sportKey] || []).push(b); });
    var graded = 0, tooOld = 0, blocked = false, errs = [];
    setLogBusy(true);
    var sports = Object.keys(bySport);
    for (var i = 0; i < sports.length; i++) {
      var sport = sports[i];
      var list = bySport[sport].filter(function (b) { return now - b.commence < 3 * 864e5; });
      tooOld += bySport[sport].length - list.length;
      if (!list.length) continue;
      var params = new URLSearchParams({ apiKey: s.apiKey.trim(), daysFrom: '3', dateFormat: 'iso', eventIds: uniq(list.map(function (b) { return b.eventId; })).join(',') });
      try {
        var r = await fetch(API + '/v4/sports/' + encodeURIComponent(sport) + '/scores/?' + params.toString());
        readQuota(r);
        if (!r.ok) { errs.push(sportLabel(sport) + ' (error ' + r.status + ')'); continue; }
        var data = await r.json(), byId = {};
        (data || []).forEach(function (ev) { byId[ev.id] = ev; });
        list.forEach(function (b) {
          var gr = FL.gradeBet(b, byId[b.eventId]);
          if (gr) { b.result = gr.result; b.score = gr.score; graded++; }
        });
      } catch (e) { blocked = true; break; }
    }
    saveBets(); setLogBusy(false); render();
    if (blocked) { showBanner('error', BLOCKED); return; }
    var msg = graded + ' bet' + (graded === 1 ? '' : 's') + ' graded from final scores.';
    if (due.length - graded - tooOld > 0) msg += ' ' + (due.length - graded - tooOld) + ' still in progress or not final.';
    if (tooOld) msg += ' ' + tooOld + ' started more than 3 days ago; set those results by hand.';
    if (errs.length) msg += ' Couldn’t load ' + errs.join('; ') + '.';
    showBanner('info', msg);
  }

  function closeBuckets() {
    var now = Date.now(), buckets = {};
    realBets().forEach(function (b) {
      if (b.commence >= now || (b.close && b.close.src === 'snapshot')) return;
      var k = b.sportKey + '|' + b.commence;
      (buckets[k] = buckets[k] || []).push(b);
    });
    return buckets;
  }
  function closeCost() {
    var buckets = closeBuckets(), cost = 0, mult = Math.max(1, Math.ceil(scanBooks().length / 10));
    Object.keys(buckets).forEach(function (k) { cost += 10 * uniq(buckets[k].map(function (b) { return b.type; })).length * mult; });
    return cost;
  }
  async function fetchClosing() {
    if (needKey()) return;
    var buckets = closeBuckets(), keys = Object.keys(buckets);
    if (!keys.length) { toast('Every bet that has started already has a closing snapshot.'); return; }
    var got = 0, missing = 0, blocked = false, failMsg = '';
    setLogBusy(true);
    for (var i = 0; i < keys.length; i++) {
      var list = buckets[keys[i]], b0 = list[0];
      var params = new URLSearchParams({
        apiKey: s.apiKey.trim(), date: iso(b0.commence - 60000),
        markets: uniq(list.map(function (b) { return b.type; })).join(','), bookmakers: scanBooks().join(','),
        oddsFormat: 'decimal', dateFormat: 'iso', eventIds: uniq(list.map(function (b) { return b.eventId; })).join(',')
      });
      try {
        var r = await fetch(API + '/v4/historical/sports/' + encodeURIComponent(b0.sportKey) + '/odds/?' + params.toString());
        readQuota(r);
        if (!r.ok) {
          var m = ''; try { m = (await r.json()).message || ''; } catch (e) { /* ignore */ }
          failMsg = m || 'error ' + r.status; break;
        }
        var snap = await r.json();
        var groups = FL.buildGroups(snap.data || []);
        var c = cfg(); c.now = Date.parse(snap.timestamp) || b0.commence - 60000;
        list.forEach(function (b) {
          var f = FL.fairAtLine(groups, b, c, b.book);
          if (f) { b.close = { p: f.p, at: c.now, src: 'snapshot', est: f.est, line: f.line, kind: f.kind }; got++; }
          else missing++;
        });
      } catch (e) { blocked = true; break; }
    }
    saveBets(); setLogBusy(false); render();
    if (blocked) { showBanner('error', BLOCKED); return; }
    var msg = 'Closing lines saved for ' + got + ' bet' + (got === 1 ? '' : 's') + '.';
    if (missing) msg += ' ' + missing + ' had no fair line in the snapshot.';
    if (failMsg) msg += ' The Odds API stopped the request (' + failMsg + '). Closing snapshots need a paid plan.';
    showBanner(failMsg ? 'warn' : 'info', msg);
  }

  // invented history so the sample slate shows what a working log looks like
  var demoCache = null;
  function demoBets() {
    if (demoCache) return demoCache;
    var seed = 11;
    var rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    var gauss = function () { var u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    var c = cfg(), out = [], now = Date.now();
    var groups = st.groups.filter(function (g) { return g.names.length === 2; });
    var books = s.myBooks.length ? s.myBooks : ['draftkings', 'fanduel'];
    for (var i = 0; i < 72 && groups.length; i++) {
      var g = groups[(i * 7) % groups.length], name = g.names[i % 2];
      var f = FL.fairAtLine(st.groups, { eventId: g.eventId, sportKey: g.sportKey, type: g.type, name: name, line: g.line, home: g.home }, c);
      if (!f) continue;
      var am = FL.toAm((1.01 + rnd() * 0.05) / f.p);
      var dec = FL.toDec(Math.round(am / 5) * 5);
      var closeP = Math.min(0.97, Math.max(0.03, f.p * (1 - 0.015 + 0.035 * gauss())));
      var commence = now - (72 - i) * 6 * 3600e3;
      var bk = books[i % books.length];
      out.push({
        id: 'demo' + i, at: commence - 3 * 3600e3, sample: true, demo: true,
        eventId: g.eventId, sportKey: g.sportKey, sportTitle: g.sportTitle, home: g.home, away: g.away, commence: commence,
        type: g.type, line: g.line, name: name, label: g.labels[name], market: marketName(g), threeWay: false,
        book: bk, bookTitle: bookTitle(bk), dec: dec, stake: Math.round(20 + rnd() * 45), fairAtBet: f.p, refAtBet: 'Pinnacle',
        close: { p: closeP, at: commence - 4 * 60000, src: 'snapshot', est: false }, result: rnd() < closeP ? 'win' : 'loss', score: null
      });
    }
    demoCache = out.reverse();
    return demoCache;
  }

  function stat(big, label, tone) { return '<div class="stat' + (tone ? ' ' + tone : '') + '"><b>' + big + '</b><span>' + label + '</span></div>'; }

  function verdictHTML(S) {
    if (!S.n) return '';
    var tone = '', title, body;
    if (!S.clvN) {
      title = 'No closing lines yet';
      body = 'Closing line value needs the fair price right before each game starts. Run a scan shortly before start times (auto-scan does this for you), or press Get closing snapshots once the games begin.';
    } else if (S.clvN < 50) {
      title = 'Too early to call';
      body = 'Average closing line value is ' + signedPct(S.avgCLV) + ' across ' + S.clvN + ' bets, and you beat the close ' + pct(S.beatRate, 0) + ' of the time. This settles down after 50 to 100 bets; profit takes far longer.';
    } else if (S.avgCLV > 0.005 && S.beatRate > 0.5) {
      tone = 'good'; title = 'You’re beating the closing line';
      body = 'You beat the fair closing price by ' + signedPct(S.avgCLV) + ' on average across ' + S.clvN + ' bets, ' + pct(S.beatRate, 0) + ' of the time. That is the strongest early sign the fair line is working and the edge is real.';
    } else {
      tone = 'warn'; title = 'You’re not beating the closing line';
      body = 'Average closing line value is ' + signedPct(S.avgCLV) + ' across ' + S.clvN + ' bets. The edges are likely gone before you bet, or the scanner saw stale prices. Scan closer to bet time, shorten the line-age limit, or drop books whose prices update slowly.';
    }
    if (S.decided >= 20 && S.z !== null) {
      var luck = Math.abs(S.z) < 1 ? 'within normal swings' : S.z > 0 ? 'running ahead of expectation' : 'running behind expectation';
      body += ' You won ' + S.wins + ' of ' + S.decided + ' decided bets against ' + S.expWins.toFixed(1) + ' expected. Profit of ' + signedMoney(S.pl) + ' against ' +
        signedMoney(S.expPL) + ' expected is ' + luck + ' (' + (S.z >= 0 ? '+' : '−') + Math.abs(S.z).toFixed(1) + ' standard deviations).';
    }
    return '<div class="verdict ' + tone + '"><strong>' + esc(title) + '</strong><p>' + esc(body) + '</p></div>';
  }

  function chartHTML(bets) {
    var head = '<div class="chart-head"><h3>Profit over settled bets</h3><div class="legend-s"><span><i></i>Actual</span><span><i class="exp"></i>Expected from the fair line</span></div></div>';
    var done = bets.filter(function (b) { return FL.betPL(b) !== null; }).sort(function (a, b) { return a.commence - b.commence; });
    st.chart = null;
    if (done.length < 2) return '<div class="sheet chart-card">' + head + '<p class="note" style="padding:24px 0">The chart starts once two bets are settled.</p></div>';
    var act = [0], exp = [0], a = 0, e = 0;
    done.forEach(function (b) {
      a += FL.betPL(b);
      var p = b.close && b.close.p > 0 ? b.close.p : (b.fairAtBet || 1 / b.dec);
      if (b.result === 'win' || b.result === 'loss') e += b.stake * (p * b.dec - 1);
      act.push(a); exp.push(e);
    });
    // size the drawing to the panel so axis text stays readable on phones
    var avail = ($('#panel-log').clientWidth || 700) - 34;
    var W = Math.round(Math.max(340, Math.min(760, avail))), H = W < 520 ? 210 : 240, L = 52, R = W < 520 ? 92 : 112, T = 12, B = 26, n = act.length - 1;
    var lo = Math.min(0, Math.min.apply(null, act), Math.min.apply(null, exp));
    var hi = Math.max(0, Math.max.apply(null, act), Math.max.apply(null, exp));
    if (hi - lo < 4) { hi += 2; lo -= 2; }
    var step = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var x = function (i) { return L + (W - L - R) * i / n; };
    var y = function (v) { return T + (H - T - B) * (hi - v) / (hi - lo); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cumulative profit over ' + n + ' settled bets: actual ' + esc(signedMoney(a)) + ', expected ' + esc(signedMoney(e)) + '">';
    for (var v = lo; v <= hi + step / 1000; v += step) {
      var zero = Math.abs(v) < step / 1000;
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="var(--line)" stroke-width="' + (zero ? 1.5 : 1) + '"' + (zero ? '' : ' stroke-dasharray="2 4"') + '/>';
      svg += '<text x="' + (L - 8) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="var(--muted)" style="font-family:var(--f-data)">' + esc(axisMoney(zero ? 0 : v)) + '</text>';
    }
    uniq([1, Math.round(n / 2), n]).forEach(function (i, k, arr) {
      var anchor = arr.length > 1 && k === 0 ? 'start' : (k === arr.length - 1 && arr.length > 1 ? 'end' : 'middle');
      svg += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '" font-size="11" fill="var(--muted)">Bet ' + i + '</text>';
    });
    var path = function (arr) { return arr.map(function (val, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val).toFixed(1); }).join(' '); };
    svg += '<path d="' + path(exp) + '" fill="none" stroke="var(--s-expected)" stroke-width="2" stroke-dasharray="6 4" stroke-linejoin="round"/>';
    svg += '<path d="' + path(act) + '" fill="none" stroke="var(--s-actual)" stroke-width="2" stroke-linejoin="round"/>';
    svg += '<circle cx="' + x(n).toFixed(1) + '" cy="' + y(e).toFixed(1) + '" r="4" fill="var(--s-expected)" stroke="var(--surface)" stroke-width="2"/>';
    svg += '<circle cx="' + x(n).toFixed(1) + '" cy="' + y(a).toFixed(1) + '" r="4" fill="var(--s-actual)" stroke="var(--surface)" stroke-width="2"/>';
    // direct labels at the line ends, nudged apart when they would collide
    var ya = y(a), ye = y(e);
    if (Math.abs(ya - ye) < 26) { var mid = (ya + ye) / 2, up = ya <= ye ? -13 : 13; ya = mid + up; ye = mid - up; }
    svg += '<text x="' + (x(n) + 10).toFixed(1) + '" y="' + (ya - 1).toFixed(1) + '" font-size="11" fill="var(--ink)" font-weight="600">Actual</text>' +
      '<text x="' + (x(n) + 10).toFixed(1) + '" y="' + (ya + 12).toFixed(1) + '" font-size="11" fill="var(--muted)" style="font-family:var(--f-data)">' + esc(signedMoney(a)) + '</text>';
    svg += '<text x="' + (x(n) + 10).toFixed(1) + '" y="' + (ye - 1).toFixed(1) + '" font-size="11" fill="var(--ink)" font-weight="600">Expected</text>' +
      '<text x="' + (x(n) + 10).toFixed(1) + '" y="' + (ye + 12).toFixed(1) + '" font-size="11" fill="var(--muted)" style="font-family:var(--f-data)">' + esc(signedMoney(e)) + '</text>';
    svg += '<g class="hover" visibility="hidden"><line class="hl" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--muted)" stroke-width="1"/>' +
      '<circle class="he" r="4" fill="var(--s-expected)" stroke="var(--surface)" stroke-width="2"/><circle class="ha" r="4" fill="var(--s-actual)" stroke="var(--surface)" stroke-width="2"/></g>';
    svg += '<rect class="hit" x="' + (L - 6) + '" y="0" width="' + (W - L - R + 12) + '" height="' + H + '" fill="transparent"/></svg>';
    st.chart = { act: act, exp: exp, done: done, W: W, H: H, L: L, R: R, n: n, x: x, y: y };
    return '<div class="sheet chart-card">' + head + '<div class="chart" id="chart">' + svg + '<div class="tip" id="chartTip" hidden></div></div></div>';
  }

  function bindChart() {
    var el = $('#chart');
    if (!el || !st.chart) return;
    var svg = el.querySelector('svg'), hit = el.querySelector('.hit'), hov = el.querySelector('.hover'), tip = $('#chartTip');
    var show = function (ev) {
      var C = st.chart, r = svg.getBoundingClientRect();
      var sx = (ev.clientX - r.left) * C.W / r.width;
      var i = Math.max(1, Math.min(C.n, Math.round((sx - C.L) / (C.W - C.L - C.R) * C.n)));
      var b = C.done[i - 1];
      var xi = C.x(i).toFixed(1);
      hov.setAttribute('visibility', 'visible');
      hov.querySelector('.hl').setAttribute('x1', xi); hov.querySelector('.hl').setAttribute('x2', xi);
      hov.querySelector('.ha').setAttribute('cx', xi); hov.querySelector('.ha').setAttribute('cy', C.y(C.act[i]).toFixed(1));
      hov.querySelector('.he').setAttribute('cx', xi); hov.querySelector('.he').setAttribute('cy', C.y(C.exp[i]).toFixed(1));
      tip.innerHTML = '<b>Bet ' + i + '</b> · ' + esc(b.label) + ' (' + esc(b.result) + ')<br>Actual ' + esc(signedMoney(C.act[i])) + ' · Expected ' + esc(signedMoney(C.exp[i]));
      tip.hidden = false;
      var px = C.x(i) * r.width / C.W, py = Math.min(C.y(C.act[i]), C.y(C.exp[i])) * r.height / C.H;
      var half = tip.offsetWidth / 2 + 4;
      tip.style.left = Math.max(half, Math.min(r.width - half, px)) + 'px';
      tip.style.top = Math.max(tip.offsetHeight + 4, py - 8) + 'px';
    };
    var hide = function () { hov.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
  }

  function closeText(b, now) {
    if (!b.close) return '<span class="sub">' + (b.commence > now ? 'before start' : 'not captured') + '</span>';
    var src;
    if (b.close.src === 'snapshot') src = 'snapshot';
    else {
      var m = Math.round((b.commence - b.close.at) / 60000);
      src = 'last scan, ' + (m < 120 ? m + 'm' : Math.round(m / 60) + 'h') + ' before start';
    }
    if (b.close.est) src += ' · line moved, estimated';
    return '<span class="price" style="font-weight:500">' + price(1 / b.close.p) + '</span><span class="sub">' + esc(src) + '</span>';
  }

  function tableHTML(bets, editable) {
    var now = Date.now();
    var h = '<div class="sheet screen-wrap"><table class="logtable"><thead><tr><th>Placed</th><th>Bet</th><th>Book</th><th class="r">Odds</th><th class="r">Stake</th>' +
      '<th class="r">Edge at bet</th><th class="r">Fair at close</th><th class="r">CLV</th><th>Result</th><th class="r">Profit</th><th><span hidden>Remove</span></th></tr></thead><tbody>';
    bets.forEach(function (b) {
      var clv = FL.betCLV(b), pl = FL.betPL(b), edge = b.fairAtBet ? b.fairAtBet * b.dec - 1 : null;
      var cls = function (v) { return v === null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : ''; };
      var odds = editable ? '<input class="cell-in" data-f="price" value="' + esc(price(b.dec)) + '" aria-label="Odds taken" inputmode="decimal">' : '<span class="price">' + price(b.dec) + '</span>';
      var stake = editable ? '<input class="cell-in" data-f="stake" type="number" min="0" step="1" value="' + esc(b.stake) + '" aria-label="Stake">' : '<span class="money">' + money(b.stake) + '</span>';
      var res = editable ? '<select class="cell-in" data-f="result" aria-label="Result">' + ['open', 'win', 'loss', 'push', 'void'].map(function (r) {
        return '<option value="' + r + '"' + (b.result === r ? ' selected' : '') + '>' + r.charAt(0).toUpperCase() + r.slice(1) + '</option>';
      }).join('') + '</select>' : esc(b.result.charAt(0).toUpperCase() + b.result.slice(1));
      h += '<tr data-id="' + esc(b.id) + '">' +
        '<td><span class="num" style="white-space:nowrap">' + esc(fmtDate(b.at)) + '</span></td>' +
        '<td class="bet"><strong>' + esc(b.label) + '</strong>' + (b.sample && !b.demo ? '<span class="chip-s">Practice</span>' : '') +
          '<span class="sub">' + esc(b.market) + ' · ' + esc(betGame(b)) + ' · ' + esc(fmtDate(b.commence)) + '</span>' +
          (b.score ? '<span class="sub">Final: ' + esc(b.score) + '</span>' : '') + '</td>' +
        '<td>' + esc(b.bookTitle) + '</td>' +
        '<td class="r">' + odds + '</td>' +
        '<td class="r">' + stake + '</td>' +
        '<td class="r"><span class="num ' + cls(edge) + '">' + (edge === null ? '—' : signedPct(edge)) + '</span></td>' +
        '<td class="r">' + closeText(b, now) + '</td>' +
        '<td class="r"><span class="num ' + cls(clv) + '">' + (clv === null ? '—' : signedPct(clv)) + '</span></td>' +
        '<td>' + res + '</td>' +
        '<td class="r"><span class="money ' + cls(pl) + '">' + (pl === null ? '—' : signedMoney(pl)) + '</span></td>' +
        '<td>' + (editable ? '<button class="xbtn' + (st.armDel === b.id ? ' armed' : '') + '" type="button" data-act="del" aria-label="Remove bet">' + (st.armDel === b.id ? 'Remove?' : '×') + '</button>' : '') + '</td>' +
        '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function renderLog() {
    var real = realBets(), samp = sampleBets();
    var mode = real.length ? 'real' : samp.length ? 'sample' : (st.source === 'sample' ? 'demo' : 'empty');
    var bets = mode === 'real' ? real : mode === 'sample' ? samp : mode === 'demo' ? demoBets() : [];
    var h = '<div class="log">';
    if (mode === 'demo') h += '<div class="banner info"><p>Example log with invented bets, so you can see what tracking looks like. Press <strong>Log bet</strong> on any +EV row and your own bets replace it.</p></div>';
    if (mode === 'sample') h += '<div class="banner warn"><p>Practice bets from the sample slate. They’re set aside as soon as you log a bet from a live scan.</p></div>';
    if (mode === 'real' && samp.length) h += '<div class="banner info"><p>' + samp.length + ' practice bet' + (samp.length === 1 ? ' is' : 's are') + ' hidden. Clear them below if you don’t need them.</p></div>';
    if (mode === 'empty') {
      h += emptyState('No bets logged yet', 'Press Log bet on any row in Positive EV or Arbitrage after you place it. The log then tracks closing line value and results.');
    } else {
      var S = FL.logStats(bets);
      h += '<div class="strip">' +
        stat(S.n, 'bets' + (S.open ? ' · ' + S.open + ' open' : '')) +
        stat(S.avgCLV === null ? '—' : signedPct(S.avgCLV), 'avg closing line value', S.avgCLV > 0 ? 'good' : S.avgCLV < 0 ? 'bad' : '') +
        stat(S.beatRate === null ? '—' : pct(S.beatRate, 0), 'beat the close') +
        stat(signedMoney(S.pl), 'profit' + (S.roi !== null ? ' · ' + signedPct(S.roi) + ' ROI' : ''), S.pl > 0 ? 'good' : S.pl < 0 ? 'bad' : '') +
        stat(signedMoney(S.expPL), 'expected') +
        '</div>';
      h += verdictHTML(S);
      h += chartHTML(bets);
    }
    var busy = st.logBusy ? ' disabled' : '';
    h += '<div class="log-actions">';
    if (mode === 'real') {
      var armed = st.armClose > Date.now();
      h += '<button class="btn small" type="button" data-act="results"' + busy + '>' + (st.logBusy ? 'Working…' : 'Update results') + '</button>' +
        '<button class="btn small" type="button" data-act="close"' + busy + '>' + (armed ? 'Confirm: about ' + closeCost() + ' credits' : 'Get closing snapshots') + '</button>';
    }
    if (mode === 'real' || mode === 'sample') {
      h += '<button class="btn small" type="button" data-act="csv">Copy CSV</button>' +
        (window.claude ? '' : '<button class="btn small" type="button" data-act="dl">Download CSV</button>') +
        '<button class="btn small" type="button" data-act="backup">Copy backup</button>';
    }
    if (samp.length) h += '<button class="btn small" type="button" data-act="clearsample">Clear practice bets</button>';
    if (mode === 'real') {
      h += '<p class="note">Update results grades bets from final scores (2 credits per sport, games from the last 3 days). Closing snapshots read the fair line from the last snapshot before each start time and need a paid Odds API plan (10 credits per market per start time). Without them, closing lines come from your last scan before each game.</p>';
    }
    h += '<details class="manual"><summary>Restore from backup</summary><textarea id="restoreBox" spellcheck="false" placeholder="Paste a backup copied from this log"></textarea>' +
      '<div class="btns"><button class="btn small" type="button" data-act="restore">Restore bets</button></div></details>';
    h += '</div>';
    if (bets.length) h += tableHTML(bets, mode !== 'demo');
    h += '</div>';
    $('#panel-log').innerHTML = h;
    bindChart();
  }

  function exportBets() { var r = realBets(); return r.length ? r : sampleBets(); }
  function toCSV(bets) {
    var cols = ['placed', 'sport', 'game', 'market', 'bet', 'book', 'odds', 'decimal_odds', 'stake', 'fair_win_at_bet', 'edge_at_bet',
      'fair_win_at_close', 'close_source', 'clv', 'result', 'profit', 'final_score'];
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var rows = bets.map(function (b) {
      var clv = FL.betCLV(b), pl = FL.betPL(b);
      return [new Date(b.at).toISOString(), b.sportTitle, betGame(b), b.market, b.label, b.bookTitle, FL.fmtAm(b.dec).replace('−', '-'),
        b.dec.toFixed(3), b.stake, b.fairAtBet ? b.fairAtBet.toFixed(4) : '', b.fairAtBet ? (b.fairAtBet * b.dec - 1).toFixed(4) : '',
        b.close ? b.close.p.toFixed(4) : '', b.close ? b.close.src + (b.close.est ? ' (estimated)' : '') : '',
        clv === null ? '' : clv.toFixed(4), b.result, pl === null ? '' : pl.toFixed(2), b.score || ''].map(q).join(',');
    });
    return cols.join(',') + '\n' + rows.join('\n') + '\n';
  }
  function copyText(text, okMsg) {
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      toast(ok ? okMsg : 'Your browser blocked copying. Use Download CSV instead.');
    };
    try { navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback); } catch (e) { fallback(); }
  }
  function downloadCSV() {
    var blob = new Blob([toCSV(exportBets())], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'fair-line-bets.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function restoreBets(text) {
    var list;
    try { list = JSON.parse(text); } catch (e) { list = null; }
    if (!Array.isArray(list)) { showBanner('error', 'That isn’t a backup from this log. Use Copy backup to make one.'); return; }
    var have = {}, added = 0;
    st.bets.forEach(function (b) { have[b.id] = 1; });
    list.forEach(function (b) {
      if (b && b.id && b.eventId && b.dec > 1 && !have[b.id]) { st.bets.push(b); have[b.id] = 1; added++; }
    });
    st.bets.sort(function (a, b) { return b.at - a.at; });
    saveBets(); render();
    toast(added ? 'Restored ' + added + ' bets.' : 'No new bets in that backup.');
  }
  function editBet(id, field, value) {
    var b = st.bets.filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    if (field === 'price') { var d = FL.toDec(String(value).replace('−', '-').trim()); if (d > 1) b.dec = d; }
    if (field === 'stake') { var v = Number(value); if (v >= 0) b.stake = v; }
    if (field === 'result') b.result = value;
    saveBets(); renderLog(); $('#n-log').textContent = countBets();
  }
  function logAction(act, row) {
    if (act === 'results') fetchResults();
    else if (act === 'close') {
      if (st.armClose > Date.now()) { st.armClose = 0; fetchClosing(); }
      else { st.armClose = Date.now() + 6000; renderLog(); setTimeout(function () { if (st.tab === 'log' && !st.logBusy) renderLog(); }, 6100); }
    }
    else if (act === 'csv') copyText(toCSV(exportBets()), 'CSV copied. Paste it into a spreadsheet.');
    else if (act === 'dl') downloadCSV();
    else if (act === 'backup') copyText(JSON.stringify(exportBets()), 'Backup copied. Keep it somewhere safe; this log lives only in this browser.');
    else if (act === 'restore') restoreBets($('#restoreBox').value);
    else if (act === 'clearsample') { st.bets = realBets(); saveBets(); render(); toast('Practice bets cleared.'); }
    else if (act === 'del' && row) {
      var id = row.getAttribute('data-id');
      if (st.armDel === id) { st.bets = st.bets.filter(function (b) { return b.id !== id; }); st.armDel = null; saveBets(); render(); }
      else { st.armDel = id; renderLog(); setTimeout(function () { if (st.armDel === id) { st.armDel = null; if (st.tab === 'log') renderLog(); } }, 4000); }
    }
  }

  // ---------- settings UI ----------
  function chipHTML(attr, key, label, on, extra) {
    return '<button class="chip" type="button" ' + attr + '="' + esc(key) + '" aria-pressed="' + on + '">' + esc(label) + (extra || '') + '</button>';
  }
  function renderSportChips() {
    var list = SPORTS.map(function (x) { return { key: x[0], title: x[1] }; });
    if (st.inSeason) {
      var known = {}; list.forEach(function (x) { known[x.key] = 1; });
      list = list.filter(function (x) { return st.inSeason.some(function (y) { return y.key === x.key; }); })
        .concat(st.inSeason.filter(function (y) { return !known[y.key]; }));
    }
    s.sports.forEach(function (k) { if (!list.some(function (x) { return x.key === k; })) list.push({ key: k, title: sportLabel(k) }); });
    $('#sportChips').innerHTML = list.map(function (x) { return chipHTML('data-sp', x.key, x.title, s.sports.indexOf(x.key) >= 0); }).join('');
  }
  function renderMarketChips() {
    $('#marketChips').innerHTML = MARKETS.map(function (m) { return chipHTML('data-mk', m[0], m[1], s.markets.indexOf(m[0]) >= 0); }).join('');
  }
  function renderBookChips() {
    $('#bookChips').innerHTML = BET_BOOKS.map(function (b) {
      return chipHTML('data-bk', b[0], b[1], s.myBooks.indexOf(b[0]) >= 0, b[2] ? '<small>paid</small>' : '');
    }).join('');
    $('#bookCount').textContent = s.myBooks.length + ' picked';
    var paid = BET_BOOKS.filter(function (b) { return b[2]; }).map(function (b) { return b[0]; });
    $('#paidNote').textContent = paidTitles(paid) + ' need a paid Odds API plan.' +
      (s.myBooks.indexOf('courtside') >= 0 ? ' Courtside is a sweepstakes app: picks use Courtside Cash, counted here as $1 each.' : '');
  }
  function renderCost() {
    var c = costPerScan();
    var per = c.cost;
    var h = '<b>' + per + '</b> credits per scan: ' + s.sports.length + ' sports × ' + s.markets.length + ' markets' +
      (c.mult > 1 ? ' × ' + c.mult + ' (' + c.books + ' books is over 10)' : '') + '. Free plan: 500 a month.';
    $('#cost').innerHTML = h;
    var m = Number(s.auto);
    $('#autoNote').innerHTML = m ? 'Uses about <b class="num">' + Math.round(per * 60 / m) + '</b> credits an hour while this tab is open and visible.' : 'Scans only when you press Scan books.';
  }
  function fillForm() {
    $('#sharp').innerHTML = SHARP_BOOKS.map(function (b) { return '<option value="' + b[0] + '">' + esc(b[1]) + '</option>'; }).join('');
    ['apiKey', 'sharp', 'method', 'minEV', 'maxOdds', 'staleMin', 'window', 'format', 'bankroll', 'kelly', 'arbStake', 'auto', 'usState']
      .forEach(function (id) { $('#' + id).value = s[id]; });
    $('#fallback').checked = !!s.fallback;
    $('#includeLive').checked = !!s.includeLive;
    $('#fallback').disabled = !s.sharp;
    renderSportChips(); renderMarketChips(); renderBookChips(); renderCost();
  }

  function toggle(arr, key) { var i = arr.indexOf(key); if (i >= 0) arr.splice(i, 1); else arr.push(key); }

  function setupAuto() {
    clearInterval(st.timer);
    var m = Number(s.auto);
    if (m > 0) st.timer = setInterval(function () {
      if (!document.hidden && s.apiKey && st.source === 'live' && !st.scanning) scanLive();
    }, m * 60000);
  }

  function bind() {
    $('#scanBtn').addEventListener('click', scanLive);
    $('#inSeasonBtn').addEventListener('click', loadInSeason);
    $('#bannerX').addEventListener('click', hideBanner);
    $('#keyShow').addEventListener('click', function () {
      var i = $('#apiKey'); var show = i.type === 'password'; i.type = show ? 'text' : 'password';
      this.textContent = show ? 'Hide' : 'Show'; this.setAttribute('aria-label', show ? 'Hide key' : 'Show key');
    });

    // fields that only change pricing recompute from the data already loaded
    var pricing = ['sharp', 'method', 'minEV', 'maxOdds', 'staleMin', 'bankroll', 'kelly', 'arbStake', 'format', 'usState'];
    pricing.forEach(function (id) {
      $('#' + id).addEventListener('input', function () {
        s[id] = this.value; if (id === 'usState') s[id] = this.value.trim().toUpperCase();
        if (id === 'sharp') { $('#fallback').disabled = !s.sharp; renderCost(); }
        saveSettings(); compute();
      });
    });
    $('#apiKey').addEventListener('input', function () { s.apiKey = this.value.trim(); saveSettings(); });
    $('#window').addEventListener('change', function () { s.window = this.value; saveSettings(); });
    $('#auto').addEventListener('change', function () { s.auto = this.value; saveSettings(); renderCost(); setupAuto(); });
    $('#fallback').addEventListener('change', function () { s.fallback = this.checked; saveSettings(); compute(); });
    $('#includeLive').addEventListener('change', function () { s.includeLive = this.checked; saveSettings(); compute(); });

    $('#sportChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sp]'); if (!b) return;
      toggle(s.sports, b.getAttribute('data-sp')); saveSettings(); renderSportChips(); renderCost();
    });
    $('#marketChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-mk]'); if (!b) return;
      toggle(s.markets, b.getAttribute('data-mk')); saveSettings(); renderMarketChips(); renderCost();
    });
    $('#bookChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bk]'); if (!b) return;
      toggle(s.myBooks, b.getAttribute('data-bk')); saveSettings(); renderBookChips(); renderCost(); compute();
    });

    document.querySelector('.tabs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-tab]'); if (!t) return;
      st.tab = t.getAttribute('data-tab'); render();
    });
    $('#sportFilter').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sport]'); if (!b) return;
      st.fSport = b.getAttribute('data-sport'); render();
    });
    $('#bookFilter').addEventListener('change', function () { st.fBook = this.value; render(); });
    $('#search').addEventListener('input', function () { st.query = this.value.trim(); render(); });
    $('#panel-screen').addEventListener('click', function (e) {
      var b = e.target.closest('[data-screen]'); if (!b) return;
      st.screenType = b.getAttribute('data-screen'); renderScreen();
    });

    $('#pasteBtn').addEventListener('click', function () {
      var t = $('#pasteBox').value.trim();
      if (!t) { showBanner('warn', 'Paste a JSON response from The Odds API first.'); return; }
      try { importJSON([t]); } catch (e) { showBanner('error', 'That isn’t an Odds API odds response. It should be a JSON list of games with a bookmakers field.'); }
    });
    $('#fileIn').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files || []);
      if (!files.length) return;
      Promise.all(files.map(function (f) { return f.text(); })).then(function (texts) {
        try { importJSON(texts); } catch (e) { showBanner('error', 'Those files aren’t Odds API odds responses.'); }
      });
      this.value = '';
    });
    $('#sampleBtn').addEventListener('click', function () { loadSample(); hideBanner(); });

    $('#copyCmd').addEventListener('click', function () {
      var btn = this, text = $('#cmdText').textContent;
      var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };
      var fallback = function () {
        var r = document.createRange(); r.selectNodeContents($('#cmdText'));
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        btn.textContent = 'Press Ctrl+C';
      };
      try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
    });

    // bet log
    $('#panel-ev').addEventListener('click', function (e) {
      var b = e.target.closest('[data-log]'); if (!b) return;
      logEV(st.viewEV[Number(b.getAttribute('data-log'))]);
    });
    $('#panel-arb').addEventListener('click', function (e) {
      var b = e.target.closest('[data-logarb]'); if (!b) return;
      logArb(st.viewArbs[Number(b.getAttribute('data-logarb'))]);
    });
    $('#panel-log').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      logAction(b.getAttribute('data-act'), b.closest('tr'));
    });
    $('#panel-log').addEventListener('change', function (e) {
      var f = e.target.getAttribute && e.target.getAttribute('data-f'); if (!f) return;
      var row = e.target.closest('tr'); if (!row) return;
      editBet(row.getAttribute('data-id'), f, e.target.value);
    });

    // the rail is a sidebar on wide screens and a collapsible panel on phones
    var mq = window.matchMedia('(min-width: 981px)');
    var sync = function () { if (mq.matches) $('#settings').open = true; };
    sync();
    if (mq.addEventListener) mq.addEventListener('change', sync);
    if (!mq.matches) $('#settings').open = false;

    // keep "x min ago" honest on live data
    setInterval(function () { if (st.source === 'live') render(); }, 30000);
  }

  st.bets = loadBets();
  fillForm();
  bind();
  loadSample();
  renderScanBtn();
  setupAuto();
  if (s.apiKey) showBanner('info', 'Showing the sample slate. Press Scan books to pull live odds with your saved key.');
  else showBanner('info', 'You\u2019re looking at a sample slate with invented prices. Add a free key from The Odds API under Odds data to scan live odds.');
})();
