# FAIRPAY

FAIRPAY is a self-hosted Hebrew RTL group expense app. It runs as one Node.js service with a static frontend, an API backend, and a SQLite database stored in a Docker volume.

## Local run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

For reverse proxies, set `APP_URL` to the public HTTPS URL and `TRUST_PROXY=true`.

## Home Server Deploy

On the server:

```bash
git clone <your-repo-url> fairpay
cd fairpay
cp .env.example .env
```

Edit `.env`:

```env
APP_URL=https://fairpay.your-domain.com
SESSION_SECRET=replace-with-a-long-random-secret
TRUST_PROXY=true
DB_PATH=/data/fairpay.sqlite
PORT=3000
```

Start or update:

```bash
docker compose up -d --build
```

Check logs:

```bash
docker compose logs -f fairpay
```

The app listens on port `3000` inside Docker Compose. Put Caddy, Nginx, Traefik, or Cloudflare Tunnel in front of it and forward traffic to `http://127.0.0.1:3000`.

### Cloudflare

Use one of these options:

- Reverse proxy on your router/server: create a DNS record such as `fairpay.your-domain.com` pointing to the home IP, enable proxy, and forward HTTPS traffic to the reverse proxy.
- Cloudflare Tunnel: create a tunnel and map `fairpay.your-domain.com` to `http://fairpay:3000` if the tunnel runs in the same Docker network, or to `http://127.0.0.1:3000` if it runs on the host.

When using Cloudflare HTTPS, keep `APP_URL` as the final public `https://...` address and keep `TRUST_PROXY=true`.

## PWA

FAIRPAY includes a web app manifest, install icons, and a service worker. On desktop Chrome/Edge, open the app and use the install button in the address bar or the browser menu. On phones, install from the browser share/menu. For mobile installation outside localhost, serve the app through HTTPS.

## Data

SQLite is stored at `DB_PATH`. In Docker Compose it lives in the `fairpay-data` volume at `/data/fairpay.sqlite`.

## Invite Links

An invite link belongs to an event, not to the user who created it. The creator copies a link like `/invite/{token}`. Another person opens that link, signs in or creates an account, and is then added to the event members list. If the creator opens the same link in the same browser, it will use the creator's existing session.
