# The Last Radio 📻

A collaborative web radio. Each station plays **one shared live stream**, and signed-in listeners
push tracks (YouTube, SoundCloud, Bandcamp, anything yt-dlp understands) onto its playlist,
within a per-station rate limit.

- Multiple stations, each with its own playlist, history, top tracks and top players
- Email/password auth, roles `admin` / `player` (the first account to register becomes admin)
- Admins create and configure stations, skip tracks, remove anything, promote users, and push without limits

## Architecture

```
browser ──► web (nginx :28700) ──/api──► api (Hono)  ──► postgres
                   │                                   ▲
                   └──/hls──► mediamtx ◄──RTSP── broadcaster (ffmpeg + yt-dlp)
```

| Service       | What it does                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `web`         | React + Vite + shadcn/ui (Base UI) SPA, served by nginx, which also proxies `/api` and `/hls`.           |
| `api`         | Hono + Drizzle. Auth, stations, queue, stats. Probes pushed URLs with `yt-dlp -J`. Runs DB migrations. |
| `broadcaster` | One channel per active station: downloads queued tracks ahead of time, decodes them to PCM, and feeds a single long-lived ffmpeg encoder at wall-clock rate. Gaps are filled with silence, so the stream never drops between tracks. |
| `mediamtx`    | Receives RTSP from the broadcaster and serves HLS (fMP4, 2 s segments). Its API backs the "on air" check. |
| `postgres`    | Everything else.                                                                                       |

The playlist *is* the play history: a `queue_items` row goes `queued → playing → played | skipped | failed`
(or `removed`), so "most played" and "top players" are plain aggregates over it.

**Rate limit:** a sliding window per user and station (`rate_limit_count` pushes per
`rate_limit_window_sec`). Every push counts until it ages out, even one that was later removed.
The limit is enforced under a Postgres advisory lock, so parallel requests can't slip past it.

## Running it

```bash
cp .env.example .env   # then set POSTGRES_PASSWORD
docker compose up -d --build
```

Open http://localhost:28700, register (the first user becomes admin), then go to **Admin → New station**.

Host ports (chosen to stay clear of other stacks): `WEB_PORT=28700`, and Postgres on
`127.0.0.1:28732` for debugging. Nothing else is published.

Promote or demote someone from the command line:

```bash
docker compose exec api node dist/cli.js promote someone@example.com
```

## Development

```bash
npm install
npm run typecheck
npm run db:generate -w @lastradio/server   # after editing apps/server/src/db/schema.ts
```

`npm run dev -w @lastradio/web` starts Vite and proxies `/api` and `/hls` to a running stack
(`LASTRADIO_URL`, default `http://localhost:28700`).

## Notes

- yt-dlp is pulled at image build time; YouTube breaks older versions regularly, so rebuild
  `api`/`broadcaster` (`docker compose build --no-cache api`) when fetches start failing.
- Listener counts come from a player heartbeat, not from mediamtx.
- Restreaming third-party content has licensing implications. Keep deployments private, or
  restrict stations to content you have the rights to.
