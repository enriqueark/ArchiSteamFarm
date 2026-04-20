# Casino Crypto Frontend

Testing frontend for the casino crypto backend. Built with Next.js, TypeScript, and TailwindCSS.

## Prerequisites

- Node.js 18+
- npm
- Casino crypto backend running (default: `http://localhost:3000`)

## Setup

```bash
cd casino-crypto-frontend
npm install
```

## Configuration

Copy or edit `.env.local` to point at your backend:

```
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## Run

```bash
npm run dev
```

Opens on [http://localhost:3001](http://localhost:3001) (port 3001 to avoid conflict with the backend on 3000).

## Build

```bash
npm run build
npm start
```

## Pages

| Route | Description |
|------------|---------------------------------------|
| `/` | Dashboard — health check, WS status, events log |
| `/wallet` | View wallet balances (all currencies) |
| `/roulette`| Roulette — live rounds via WebSocket, place bets |
| `/mines` | Mines — start game, click 5x5 grid, cashout |

## Auth

On first load, a login/register form is shown. Tokens are stored in `localStorage`. The access token is sent as `Authorization: Bearer <token>` on all authenticated API calls.

## Project Structure

```
casino-crypto-frontend/
├── components/    # Button, Card, Input, Layout, AuthGate
├── lib/
│   ├── api.ts     # HTTP client for all backend endpoints
│   └── socket.ts  # WebSocket client for roulette events
├── pages/
│   ├── _app.tsx   # App wrapper with auth gate + layout
│   ├── index.tsx  # Dashboard
│   ├── wallet.tsx # Wallet balances
│   ├── roulette.tsx # Roulette testing
│   └── mines.tsx  # Mines testing
└── styles/
    └── globals.css # Tailwind imports
```
