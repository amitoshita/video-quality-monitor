# Deploying (free tier, no credit card)

Three free services: **Neon** (Postgres), **Render** (FastAPI), **Cloudflare Pages** (static frontend). Do them in this order: each step needs a URL from the previous one.

## 1. Neon: database

1. Sign up at <https://neon.tech> (GitHub login works, no card).
2. Create a project: Postgres 17, region **AWS Europe Central 1 (Frankfurt)**, the same region as the Render service in `render.yaml`.
3. Dashboard → **Connect** → turn **Connection pooling** on, then copy the connection string. It looks like
   `postgresql://USER:PASSWORD@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
   (note `-pooler` in the host and `sslmode=require`). Keep it secret; it goes into Render only.

Neon's free compute suspends after a few idle minutes and wakes on the next query (well under a second). The backend's connection pool pings connections before use, so a suspended database doesn't cause a 500.

## 2. Render: backend

1. Sign up at <https://render.com> with GitHub (no card for the free plan).
2. **New + → Blueprint**, pick this repository. Render reads `render.yaml` and proposes the `vqm-api` web service on the **Free** plan.
3. It asks for the two secret values:
   - `DATABASE_URL`: the Neon pooled string from step 1.
   - `CORS_ORIGINS`: the frontend origin. You don't have it yet: enter `https://placeholder.invalid` for now and fix it in step 4.
4. **Apply**. The build runs `pip install -r requirements.txt`; the start command runs the Alembic migration, then uvicorn.
5. When the deploy is live, copy the service URL, e.g. `https://vqm-api.onrender.com`, and check `https://vqm-api.onrender.com/healthz` returns `{"status":"ok"}`.

The free instance sleeps after 15 minutes without traffic; the next request wakes it in up to about a minute. The frontend shows "Waking up the server…" meanwhile.

## 3. Cloudflare Pages: frontend

1. Sign up at <https://dash.cloudflare.com> (no card).
2. **Workers & Pages → Create → Pages → Connect to Git**, pick this repository.
3. Build settings:
   - Framework preset: **None**
   - Root directory: `frontend`
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Environment variables (Production):
   - `VITE_API_BASE_URL` = the Render URL from step 2 (no trailing slash)
   - `NODE_VERSION` = `22`
5. **Save and Deploy**. Note the URL, e.g. `https://video-quality-monitor.pages.dev`.

`VITE_API_BASE_URL` is baked in at build time; the build fails if it is missing or not `https://`. Changing it later requires a redeploy (Deployments → Retry deployment).

## 4. Connect them

1. Render → `vqm-api` → **Environment** → set `CORS_ORIGINS` to the exact Pages origin, e.g. `https://video-quality-monitor.pages.dev` (scheme + host, no path, no trailing slash). Save; Render restarts the service.
2. Run the smoke test from your machine:

   ```bash
   scripts/smoke.sh https://vqm-api.onrender.com https://video-quality-monitor.pages.dev
   ```

   It wakes the backend, creates one short test session (visible in History), and checks idempotency, validation, Stop twice, samples after Stop, CORS for your origin vs. another origin, and that the face model and wasm are served from Pages.

## 5. Browser checklist (Chrome on a laptop, public URL)

- [ ] The page shows "Waking up the server…" at most about a minute, then the Start button.
- [ ] Start → camera permission prompt → preview appears; "Camera: 640×480" (or the closest your camera offers), "Face detection: GPU" or CPU.
- [ ] Verdict and tiles update every second; the charts scroll over a 30-second window.
- [ ] Cover the camera → brightness drops, "Poor: no face".
- [ ] Bright light at the camera → brightness above 200 ("too bright" once a face is visible).
- [ ] Move your head → motion above 2, "Poor: hold still".
- [ ] DevTools → Network → Offline for ~10 s → "Connection problem … retrying"; back online → "All samples delivered" within a few seconds.
- [ ] Stop → the camera light turns off.
- [ ] Block the camera in site settings and press Start → a clear message on how to allow it.
- [ ] Keep Chrome in front during a session: a hidden, minimised, or (on macOS) fully covered window records 0 FPS by design.

## Before the demo

Open the frontend a couple of minutes before the call so the Render instance is awake.
