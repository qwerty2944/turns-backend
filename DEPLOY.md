# turns-backend · Deploy Notes

How the Colyseus side of `turns` ships to production. Read this first
before debugging "why isn't my code live."

## TL;DR

```bash
# from /backend (this directory)
git status                    # must be clean (this repo, not the monorepo!)
npx @colyseus/cloud deploy    # uploads .colyseus-cloud.json token, triggers Cloud build
```

After it returns "Deployment triggered." watch
https://cloud-prod.colyseus.io/application/1510-turns/deployment_logs

## Dual-repo setup (you will get bitten by this)

This `backend/` directory is committed to **two** repos:

| Where | Remote | Purpose |
|---|---|---|
| `<monorepo>/backend/` | `github.com/qwerty2944/turns` | source of truth, frontend lives next to it |
| `<this dir>/.git` | `github.com/qwerty2944/turns-backend` | the repo Colyseus Cloud pulls from |

A push to the monorepo does **not** reach Colyseus. You must commit and
push from inside `backend/` too. The Cloud deploy CLI runs `git status`
against the inner repo — if it reports uncommitted changes when your
root `git status` is clean, that is the cause.

## Required env vars on Colyseus Cloud

Dashboard → 1510-turns → Environment Variables:

- `DATABASE_URL` — Supabase Session pooler URL
  (`postgresql://postgres.<ref>:<PASSWORD>@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require`).
- `JWT_SECRET` — random hex string. Generated with `openssl rand -hex 32`.

Do **not** set `PORT` (Cloud injects it). `NODE_ENV=production` already
lives in `ecosystem.config.cjs` under `env_production`.

## The `ecosystem.<port>.config.cjs` quirk

Colyseus Cloud's build pipeline executes:

```
pm2 deploy ecosystem.<port>.config.cjs production update --force
```

`<port>` is the port Cloud assigned to this app. For `1510-turns` it is
**2037**. The pipeline does not generate that filename for us, so we
ship a duplicate:

- `ecosystem.config.cjs` — the canonical file (also what local pm2
  + `@colyseus/tools` `colyseus-post-deploy` look for)
- `ecosystem.2037.config.cjs` — byte-for-byte copy for the cloud's
  `pm2 deploy` command

If you change one, change the other. If Cloud ever migrates this app
to a new port, add another copy with that suffix; do not delete the
existing ones until you confirm the new port is stable.

## Adding a new game

The room map is built at module load in `src/app.config.ts` from
`GAME_REGISTRY`. After dropping a new slice under `src/games/<game>/`
and registering its manifest:

1. Push to *both* the monorepo and `turns-backend`.
2. Redeploy. Until Cloud restarts the process, clients calling
   `client.joinOrCreate("<game>", ...)` will get
   `provided room name "<game>" not defined`.

## Common deploy failures (in order of how often we've hit them)

1. **`provided room name "X" not defined`** — forgot to redeploy after
   adding a game. Just `npx @colyseus/cloud deploy`.
2. **CLI prompt: "you have uncommited changes"** — the inner repo
   (this one) is ahead/dirty. `cd backend && git status` to verify.
3. **`ENOENT: ecosystem.<port>.config.cjs`** — the port copy is
   missing or out of sync with `ecosystem.config.cjs`.
4. **Server starts but can't connect to DB** — `DATABASE_URL` in the
   Cloud dashboard is stale (password reset, region wrong, etc.). The
   correct pooler hostname for the current Supabase project is
   `aws-1-ap-northeast-2.pooler.supabase.com`, port 5432, session
   pooler mode (`prepare: false` in our drizzle setup already covers
   the pooler caveat).
