const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// ═══════════════════════════════════════════════════════════════
//  Portfolio Configurations (multi-portfolio support)
// ═══════════════════════════════════════════════════════════════
const PORTFOLIOS = {
  'horizon-alpha': {
    id: 'horizon-alpha',
    name: 'Horizon Alpha',
    subtitle: 'Small-Cap Discovery · Momentum Strategy',
    totalInvestment: 10000,
    holdings: [
      { ticker: 'TTI',  name: 'TETRA Technologies',    sector: 'Energy / Water Logistics',          pct: 25, allocation: 2500 },
      { ticker: 'MSBI', name: 'Midland States Bancorp', sector: 'Financials / Regional Banks',       pct: 20, allocation: 2000 },
      { ticker: 'NEXA', name: 'Nexa Resources',         sector: 'Basic Materials / Mining',           pct: 20, allocation: 2000 },
      { ticker: 'OMCL', name: 'Omnicell, Inc.',          sector: 'Healthcare / Pharmacy Tech',        pct: 20, allocation: 2000 },
      { ticker: 'UFCS', name: 'United Fire Group',       sector: 'Financials / Property & Casualty',  pct: 15, allocation: 1500 },
    ],
  },
  // Add more portfolios here:
  // 'dividend-yield': { id: 'dividend-yield', name: 'Steady Yield', subtitle: 'Dividend Income Strategy', ... },
};

const DATA_DIR = process.env.VERCEL ? '/tmp' : __dirname;
function purchaseFile(portfolioId) {
  return path.join(DATA_DIR, `purchase_prices_${portfolioId}.json`);
}
const cache = {};
const CACHE_TTL = 5 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════
//  Math & Statistics Helpers
// ═══════════════════════════════════════════════════════════════
const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
const stddev = (arr) => {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
};

// Peter Acklam's inverse normal CDF — high-precision rational approximation
function normalQuantile(p) {
  if (p <= 0) return -8; if (p >= 1) return 8; if (p === 0.5) return 0;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

// ═══════════════════════════════════════════════════════════════
//  Technical Indicators
// ═══════════════════════════════════════════════════════════════
function calcSMA(prices, period) {
  if (prices.length < period) return null;
  return mean(prices.slice(-period));
}

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = mean(prices.slice(0, period));
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function calcMACD(prices) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  if (ema12 === null || ema26 === null) return { macd: null, signal: null, histogram: null };
  const macd = ema12 - ema26;
  // Approximate signal line from recent MACD values
  const recentMACDs = [];
  for (let i = Math.max(0, prices.length - 35); i <= prices.length; i++) {
    const slice = prices.slice(0, i);
    if (slice.length >= 26) {
      recentMACDs.push(calcEMA(slice, 12) - calcEMA(slice, 26));
    }
  }
  const signal = recentMACDs.length >= 9 ? calcEMA(recentMACDs, 9) : macd;
  return { macd, signal, histogram: macd - signal };
}

function calcBollinger(prices, period = 20) {
  if (prices.length < period) return { upper: null, lower: null, middle: null };
  const slice = prices.slice(-period);
  const middle = mean(slice);
  const sd = stddev(slice);
  return { upper: middle + 2 * sd, lower: middle - 2 * sd, middle };
}

function deriveSignal(rsi, price, sma20, sma50, macdHist) {
  let score = 0;
  // RSI component (-2 to +2)
  if (rsi !== null) {
    if (rsi < 25) score += 2;
    else if (rsi < 40) score += 1;
    else if (rsi > 75) score -= 2;
    else if (rsi > 60) score -= 1;
  }
  // Trend component (-2 to +2)
  if (sma20 !== null && sma50 !== null) {
    if (price > sma20 && sma20 > sma50) score += 2;
    else if (price > sma20) score += 1;
    else if (price < sma20 && sma20 < sma50) score -= 2;
    else if (price < sma20) score -= 1;
  }
  // MACD component (-1 to +1)
  if (macdHist !== null) {
    if (macdHist > 0) score += 1;
    else score -= 1;
  }
  // Map score to signal
  if (score >= 4) return { label: 'STRONG BUY', strength: 1.0 };
  if (score >= 2) return { label: 'BUY', strength: 0.7 };
  if (score >= -1) return { label: 'HOLD', strength: 0.4 };
  if (score >= -3) return { label: 'SELL', strength: 0.7 };
  return { label: 'STRONG SELL', strength: 1.0 };
}

// ═══════════════════════════════════════════════════════════════
//  GBM Projection Engine (Closed-Form)
// ═══════════════════════════════════════════════════════════════
function projectPrices(prices, weeks = 8) {
  if (prices.length < 30) return [];
  const logReturns = [];
  for (let i = 1; i < prices.length; i++) {
    logReturns.push(Math.log(prices[i] / prices[i - 1]));
  }

  const dailyMu = mean(logReturns);
  const dailyVol = stddev(logReturns);

  // Momentum adjustment: blend long-term drift with recent 20-day momentum
  const recent = logReturns.slice(-20);
  const recentMu = mean(recent);
  const adjustedMu = dailyMu * 0.5 + recentMu * 0.5;

  const lastPrice = prices[prices.length - 1];
  const projections = [];
  const percentiles = [0.10, 0.25, 0.50, 0.75, 0.90];

  for (let w = 1; w <= weeks; w++) {
    const t = w * 5; // trading days
    const drift = (adjustedMu - 0.5 * dailyVol * dailyVol) * t;
    const diffusion = dailyVol * Math.sqrt(t);

    const projected = {};
    const labels = ['p10', 'p25', 'p50', 'p75', 'p90'];
    percentiles.forEach((p, i) => {
      projected[labels[i]] = parseFloat((lastPrice * Math.exp(drift + diffusion * normalQuantile(p))).toFixed(2));
    });

    const today = new Date();
    today.setDate(today.getDate() + w * 7);
    projected.week = w;
    projected.date = today.toISOString().split('T')[0];
    projections.push(projected);
  }

  return projections;
}

// ═══════════════════════════════════════════════════════════════
//  Yahoo Finance Data Fetching (with cache)
// ═══════════════════════════════════════════════════════════════
function getCached(key) {
  const e = cache[key];
  return (e && Date.now() - e.ts < CACHE_TTL) ? e.data : null;
}
function setCache(key, data) { cache[key] = { data, ts: Date.now() }; }

async function fetchHistorical(ticker) {
  const cached = getCached(`hist_${ticker}`);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=6mo&interval=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${ticker}`);

  const timestamps = result.timestamp || [];
  const quotes = result.indicators?.quote?.[0] || {};
  const meta = result.meta;
  const closes = quotes.close || [];

  // Build clean arrays (remove nulls)
  const dates = [];
  const prices = [];
  timestamps.forEach((ts, i) => {
    if (closes[i] != null) {
      dates.push(new Date(ts * 1000).toISOString().split('T')[0]);
      prices.push(parseFloat(closes[i].toFixed(2)));
    }
  });

  const output = {
    ticker,
    dates,
    prices,
    currentPrice: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose || meta.previousClose,
    dayChange: parseFloat((meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose)).toFixed(2)),
    dayChangePct: parseFloat((((meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose)) / (meta.chartPreviousClose || meta.previousClose)) * 100).toFixed(2)),
  };

  setCache(`hist_${ticker}`, output);
  return output;
}

// ═══════════════════════════════════════════════════════════════
//  Market State
// ═══════════════════════════════════════════════════════════════
function deriveMarketState() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
  if (day >= 1 && day <= 5 && mins >= 570 && mins < 960) return 'REGULAR';
  if (day >= 1 && day <= 5 && mins >= 540 && mins < 570) return 'PRE';
  return 'CLOSED';
}

// ═══════════════════════════════════════════════════════════════
//  Portfolio List API
// ═══════════════════════════════════════════════════════════════
app.get('/api/portfolios', (req, res) => {
  const list = Object.values(PORTFOLIOS).map(p => ({
    id: p.id,
    name: p.name,
    subtitle: p.subtitle,
    holdingCount: p.holdings.length,
    totalInvestment: p.totalInvestment,
  }));
  res.json(list);
});

// ═══════════════════════════════════════════════════════════════
//  Main Analytics API (per-portfolio)
// ═══════════════════════════════════════════════════════════════
app.get('/api/analytics', async (req, res) => {
  try {
    const portfolioId = req.query.id || Object.keys(PORTFOLIOS)[0];
    const portfolioCfg = PORTFOLIOS[portfolioId];
    if (!portfolioCfg) return res.status(404).json({ error: `Portfolio '${portfolioId}' not found` });

    const PORTFOLIO = portfolioCfg.holdings;
    const PURCHASE_FILE = purchaseFile(portfolioId);

    const results = await Promise.all(
      PORTFOLIO.map(p => fetchHistorical(p.ticker).catch(err => ({ ticker: p.ticker, error: err.message })))
    );

    // Load or initialize purchase prices
    let purchasePrices = {};
    if (fs.existsSync(PURCHASE_FILE)) {
      purchasePrices = JSON.parse(fs.readFileSync(PURCHASE_FILE, 'utf-8'));
    }

    let needsSave = false;
    PORTFOLIO.forEach(p => {
      const r = results.find(r => r.ticker === p.ticker);
      if (r && r.currentPrice && !purchasePrices[p.ticker]) {
        purchasePrices[p.ticker] = {
          price: r.currentPrice,
          date: new Date().toISOString(),
          shares: parseFloat((p.allocation / r.currentPrice).toFixed(4))
        };
        needsSave = true;
      }
    });
    if (needsSave) fs.writeFileSync(PURCHASE_FILE, JSON.stringify(purchasePrices, null, 2));

    // Build holdings with analytics
    let totalCurrentValue = 0;
    const holdings = PORTFOLIO.map(p => {
      const r = results.find(r => r.ticker === p.ticker);
      const purchase = purchasePrices[p.ticker];
      if (!r || r.error || !purchase) {
        return { ...p, error: r?.error || 'No data' };
      }

      const shares = purchase.shares;
      const currentValue = parseFloat((shares * r.currentPrice).toFixed(2));
      const costBasis = parseFloat((shares * purchase.price).toFixed(2));
      const gainLoss = parseFloat((currentValue - costBasis).toFixed(2));
      const gainLossPct = parseFloat(((gainLoss / costBasis) * 100).toFixed(2));
      totalCurrentValue += currentValue;

      // Technical indicators
      const pr = r.prices;
      const rsi = calcRSI(pr);
      const sma20 = calcSMA(pr, 20);
      const sma50 = calcSMA(pr, 50);
      const macdData = calcMACD(pr);
      const bollinger = calcBollinger(pr);
      const signal = deriveSignal(rsi, r.currentPrice, sma20, sma50, macdData.histogram);

      // Sparkline (last 30 data points)
      const sparkline = pr.slice(-30);

      // Projections
      const projections = projectPrices(pr, 8);

      // Annualized volatility
      const logRet = [];
      for (let i = 1; i < pr.length; i++) logRet.push(Math.log(pr[i] / pr[i-1]));
      const annVol = logRet.length > 1 ? parseFloat((stddev(logRet) * Math.sqrt(252) * 100).toFixed(1)) : null;

      return {
        ...p,
        currentPrice: r.currentPrice,
        purchasePrice: purchase.price,
        shares,
        currentValue,
        costBasis,
        gainLoss,
        gainLossPct,
        dayChange: r.dayChange,
        dayChangePct: r.dayChangePct,
        technicals: {
          rsi: rsi !== null ? parseFloat(rsi.toFixed(1)) : null,
          sma20: sma20 !== null ? parseFloat(sma20.toFixed(2)) : null,
          sma50: sma50 !== null ? parseFloat(sma50.toFixed(2)) : null,
          macd: macdData.macd !== null ? parseFloat(macdData.macd.toFixed(3)) : null,
          macdSignal: macdData.signal !== null ? parseFloat(macdData.signal.toFixed(3)) : null,
          macdHist: macdData.histogram !== null ? parseFloat(macdData.histogram.toFixed(3)) : null,
          bollingerUpper: bollinger.upper !== null ? parseFloat(bollinger.upper.toFixed(2)) : null,
          bollingerLower: bollinger.lower !== null ? parseFloat(bollinger.lower.toFixed(2)) : null,
          annualizedVol: annVol,
          signal: signal.label,
          signalStrength: signal.strength,
        },
        sparkline,
        historical: { dates: r.dates, prices: r.prices },
        projections,
      };
    });

    // Portfolio-level stats
    const totalInvestment = portfolioCfg.totalInvestment;
    const totalGainLoss = parseFloat((totalCurrentValue - totalInvestment).toFixed(2));
    const totalGainLossPct = parseFloat(((totalGainLoss / totalInvestment) * 100).toFixed(2));

    // Portfolio historical value series
    const validHoldings = holdings.filter(h => h.historical);
    let portfolioDates = [];
    let portfolioValues = [];
    if (validHoldings.length > 0) {
      const refDates = validHoldings[0].historical.dates;
      portfolioDates = refDates;
      portfolioValues = refDates.map((_, di) => {
        let val = 0;
        validHoldings.forEach(h => {
          const price = h.historical.prices[di];
          if (price != null) val += h.shares * price;
          else val += h.currentValue / validHoldings.length; // fallback
        });
        return parseFloat(val.toFixed(2));
      });
    }

    // Portfolio-level projections (sum of individual stock projections)
    const portfolioProjections = [];
    if (validHoldings.length > 0 && validHoldings[0].projections.length > 0) {
      const weeks = validHoldings[0].projections.length;
      for (let w = 0; w < weeks; w++) {
        const proj = { week: w + 1, date: validHoldings[0].projections[w].date, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
        validHoldings.forEach(h => {
          if (h.projections[w]) {
            proj.p10 += h.shares * h.projections[w].p10;
            proj.p25 += h.shares * h.projections[w].p25;
            proj.p50 += h.shares * h.projections[w].p50;
            proj.p75 += h.shares * h.projections[w].p75;
            proj.p90 += h.shares * h.projections[w].p90;
          }
        });
        ['p10','p25','p50','p75','p90'].forEach(k => proj[k] = parseFloat(proj[k].toFixed(2)));
        portfolioProjections.push(proj);
      }
    }

    // Portfolio annualized volatility & Sharpe
    let portfolioAnnVol = null, sharpe = null, maxDrawdown = null;
    if (portfolioValues.length > 20) {
      const lr = [];
      for (let i = 1; i < portfolioValues.length; i++) lr.push(Math.log(portfolioValues[i] / portfolioValues[i-1]));
      const dailyMu = mean(lr);
      const dailyStd = stddev(lr);
      portfolioAnnVol = parseFloat((dailyStd * Math.sqrt(252) * 100).toFixed(1));
      sharpe = parseFloat(((dailyMu / dailyStd) * Math.sqrt(252)).toFixed(2));

      // Max drawdown
      let peak = portfolioValues[0];
      let mdd = 0;
      portfolioValues.forEach(v => { peak = Math.max(peak, v); mdd = Math.min(mdd, (v - peak) / peak); });
      maxDrawdown = parseFloat((mdd * 100).toFixed(1));
    }

    res.json({
      portfolio: {
        id: portfolioCfg.id,
        name: portfolioCfg.name,
        subtitle: portfolioCfg.subtitle,
        totalInvestment,
        totalCurrentValue: parseFloat(totalCurrentValue.toFixed(2)),
        totalGainLoss,
        totalGainLossPct,
        annualizedVol: portfolioAnnVol,
        sharpeRatio: sharpe,
        maxDrawdown,
        marketState: deriveMarketState(),
        lastUpdated: new Date().toISOString(),
      },
      holdings: holdings.map(h => {
        const { historical, ...rest } = h;
        return rest;
      }),
      historical: { dates: portfolioDates, values: portfolioValues },
      stockHistorical: Object.fromEntries(validHoldings.map(h => [h.ticker, { dates: h.historical.dates, prices: h.historical.prices }])),
      portfolioProjections,
    });
  } catch (err) {
    console.error('Analytics API error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset', (req, res) => {
  const portfolioId = req.query.id || Object.keys(PORTFOLIOS)[0];
  const pf = purchaseFile(portfolioId);
  if (fs.existsSync(pf)) fs.unlinkSync(pf);
  Object.keys(cache).forEach(k => delete cache[k]);
  res.json({ message: `Portfolio '${portfolioId}' reset.` });
});

// Only listen when running locally (not on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`\n  🔬 Portfolio Analytics Engine running at http://localhost:${PORT}\n`));
}

// Export for Vercel serverless
module.exports = app;
