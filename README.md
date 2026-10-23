# Fair Line Scanner

A free, static website that finds positive-EV bets and arbitrage across US sportsbooks. It takes Pinnacle's line, removes the vig to estimate each side's true win probability, and flags books paying more than that. A built-in bet log tracks closing line value so you can check whether the edges hold up.

Everything runs in the browser. Each visitor brings their own free key from [The Odds API](https://the-odds-api.com), which stays in their browser and is only sent to The Odds API. There is no server and no account system.

> Not affiliated with OddsJam or The Odds API. For information only, not betting or financial advice.

## Features

- **Positive EV**: every bet priced above the fair line, with edge, fair odds, fair win %, and a Kelly stake from your bankroll.
- **Arbitrage**: prices across books whose implied chances sum to under 100%, with the stake split that returns the same amount on any result.
- **Odds screen**: every book side by side for moneylines, spreads and totals, with the best price highlighted and +EV prices marked.
- **Bet log**: log bets from the EV and arbitrage tabs, capture the fair price before each game starts, grade results from final scores, and compare actual profit with what the fair line expected.
- Four devig methods (power, multiplicative, additive, worst case), consensus fallback when Pinnacle has no line, line-age filter, auto-scan, CSV export.

The page opens on a sample slate with invented prices, so it shows how everything works before anyone adds a key.

## Publish it with GitHub Pages

1. In this repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. After a minute the site is live at `https://aidanv22.github.io/odds-jam-fairline/`.

Any static host works the same way (Netlify, Cloudflare Pages, Vercel): there is no build step, just upload the folder.

## Run it locally

Browsers block API calls from pages opened as files, so serve the folder over http:

```bash
npm run serve          # http://localhost:8000, no dependencies
# or
python3 -m http.server 8000
```

## How it works

1. **Fair line.** For each market, the sharp book's two (or three) prices are devigged so the implied probabilities sum to 100%. Pinnacle at +139 / −154 implies 41.8% + 60.6% = 102.4%; the power method scales both sides down to 40.5% / 59.5%. If the sharp book has no line, the scanner averages the devigged prices of every other book with a full market (at least three), leaving out the book being priced.
2. **Edge.** `edge = fair win probability × decimal odds − 1`. FanDuel's Lakers +160 pays 2.60, so 0.405 × 2.60 − 1 = +5.3%.
3. **Stake.** Kelly fraction `edge ÷ (decimal odds − 1)`, scaled by your chosen fraction (quarter Kelly by default).
4. **Arbitrage.** Best price for every side across your books; if `Σ 1/odds < 1`, staking each side in proportion to `1/odds` returns the same amount whichever side wins.
5. **Closing line value.** `CLV = fair win probability at close × decimal odds taken − 1`. The closing price comes from the last scan before start, or from The Odds API's historical snapshots on paid plans. When the line has moved off your number, the fair price at your number is estimated with a normal approximation of the final margin or total; that estimate is rough, especially around football's key numbers.

Bettors who consistently beat the closing line tend to win over time, and that shows after 50 to 100 bets, long before profit and loss means much. The bet log's verdict panel reports this, along with actual profit against expected profit in standard deviations.

## Odds API credits

| Call | Cost |
| --- | --- |
| Scan (per sport) | 1 credit per market, up to 10 books; 11–20 books doubles it |
| In-season sports list | free |
| Update results (per sport) | 2 credits, games from the last 3 days |
| Closing snapshots (paid plans) | 10 credits per market per start time |

The free plan has 500 credits a month. Four sports with all three markets is 12 credits per scan, about 40 scans a month. Caesars and Fanatics odds need a paid plan.

## Project layout

```
index.html              page markup
assets/styles.css       styles (light and dark themes)
assets/engine.js        pure odds math: devig, +EV, arbitrage, grading, CLV, stats
assets/app.js           UI: settings, scanning, rendering, bet log
assets/sample-data.js   sample slate with invented prices
tools/gen-sample.js     regenerates the sample slate
tools/serve.js          local static server
tests/                  engine and bet-log tests (npm test, Node 18+)
```

## Limits worth knowing

- Edges at soft books close in minutes, and The Odds API is not instant. Pinnacle's prices in the feed come from its public site and can lag. Confirm every price at the book.
- Positive-EV bets still lose often; a 5% edge on a +160 underdog loses about 60% of the time.
- US sportsbooks limit accounts that consistently beat the closing line, and arbitrage gets limited fastest.
- An arbitrage is only locked in if every leg is placed at the shown price. Line moves, stake limits, voided bets, and settlement rule differences can break it.
- The bet log lives in each visitor's browser. Use **Copy backup** or the CSV export to keep a copy.

Bet only where it's legal for you and you're of legal age. Gambling problem? Call 1-800-GAMBLER.
