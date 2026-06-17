# 🔬 Portfolio Analytics Engine

A real-time, multi-portfolio stock analytics dashboard with Monte Carlo projections, technical indicators, and scientific visualizations.

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![Express](https://img.shields.io/badge/Express-4.x-blue) ![Chart.js](https://img.shields.io/badge/Chart.js-4.x-orange)

### 🌐 **[Live Site → portfolio-analytics-engine-production.up.railway.app](https://portfolio-analytics-engine-production.up.railway.app)**

## Features

- **Live Market Data** — Real-time stock prices via Yahoo Finance, auto-refreshing every 90 seconds
- **Multi-Portfolio Tabs** — Manage multiple portfolios with independent tracking and analytics
- **8-Week Forward Projections** — Closed-form Geometric Brownian Motion (GBM) model with momentum-adjusted drift
- **Technical Indicators** — RSI(14), SMA(20/50), MACD, Bollinger Bands, composite BUY/SELL signals
- **Portfolio Metrics** — Sharpe Ratio, Annualized Volatility, Max Drawdown
- **Interactive Charts** — 6-month historical + projection charts with confidence intervals (Chart.js)
- **30-Day Sparklines** — Inline trend visualization per holding
- **Scientific UI** — Terminal-inspired dark theme with monospace typography and dense data layout

## Current Portfolio: Horizon Alpha

| Ticker | Company | Sector | Allocation |
|--------|---------|--------|-----------|
| TTI | TETRA Technologies | Energy / Water Logistics | 25% |
| MSBI | Midland States Bancorp | Financials / Regional Banks | 20% |
| NEXA | Nexa Resources | Basic Materials / Mining | 20% |
| OMCL | Omnicell, Inc. | Healthcare / Pharmacy Tech | 20% |
| UFCS | United Fire Group | Financials / Property & Casualty | 15% |

## Quick Start

```bash
git clone https://github.com/mormontx/portfolio-analytics-engine.git
cd portfolio-analytics-engine
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Adding a New Portfolio

Edit `server.js` and add an entry to the `PORTFOLIOS` object:

```javascript
'my-portfolio': {
  id: 'my-portfolio',
  name: 'My Portfolio',
  subtitle: 'Custom Strategy',
  totalInvestment: 10000,
  holdings: [
    { ticker: 'AAPL', name: 'Apple Inc.', sector: 'Technology', pct: 50, allocation: 5000 },
    { ticker: 'MSFT', name: 'Microsoft', sector: 'Technology', pct: 50, allocation: 5000 },
  ],
},
```

The tab bar will automatically populate with all portfolios.

## Projection Methodology

Projections use the closed-form GBM formula:

**S(t) = S₀ · exp[(μ − ½σ²)t + σ√t · Φ⁻¹(p)]**

- **μ** = momentum-adjusted daily drift (50% long-term + 50% recent 20-day)
- **σ** = historical daily volatility from 6 months of data
- **Φ⁻¹(p)** = inverse normal CDF (Acklam's approximation)
- Bull/Bear bands = 90th/10th percentile projections

## Tech Stack

- **Backend:** Node.js + Express
- **Frontend:** Vanilla HTML/CSS/JS + Chart.js 4
- **Data:** Yahoo Finance v8 API (server-side, cached 5 min)
- **Design:** IBM Plex Mono, terminal-dark aesthetic

## Disclaimer

This is a hypothetical portfolio for educational purposes only. Not investment advice.
