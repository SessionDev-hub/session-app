# Session Collab Auth — deploy (5 minutes)

This is the tiny server that signs collab-room joins. It's standalone — it does
NOT need the lost Vault backend source. The Apinator **secret** lives only here.

Session is already pointed at `https://session-collab-auth.fly.dev/v1/collab/auth`.
If you deploy under a different fly app name, change the `authEndpoint` line in
Session's `updates.config.json` to match, then re-release.

## 1. Deploy

Open a terminal in this folder (the one with `app.py` and `fly.toml`) and run:

```bash
fly launch --no-deploy --copy-config --name session-collab-auth
```

If it asks to overwrite fly.toml, say **no** (keep the one here). If the name is
taken, pick another and update Session's `authEndpoint` to match.

## 2. Set the secrets (these never go in the code or in Session)

```bash
fly secrets set ^
  APINATOR_KEY=app_d10d9ee9c5ae545cd6d7f61694b211b6cf5aed1f ^
  APINATOR_SECRET=<the NEW secret from the Apinator dashboard> ^
  --app session-collab-auth
```

(On Mac/Linux use `\` instead of `^` for line continuation, or put it all on one line.)

**Rotate the secret first** in the Apinator dashboard (the old one was pasted in
chat), and set the fresh value here.

### Optional — hard-gate to Beta Testers
By default any valid Discord login can join a room (Session already gates launch
on the Beta role, so this is fine for the MVP). To also enforce it server-side:

```bash
fly secrets set ^
  DISCORD_GUILD_ID=1565508129486282864 ^
  DISCORD_BETA_ROLE_ID=1565525235388649623 ^
  --app session-collab-auth
```

This requires that Session's Discord login includes the `guilds.members.read`
scope (the Beta gate already uses it).

## 3. Ship it

```bash
fly deploy --app session-collab-auth
```

## 4. Verify

```bash
curl -s https://session-collab-auth.fly.dev/
# -> {"ok":true,"ready":true,"service":"Session Collab Auth"}
```

`ready:true` means both APINATOR_KEY and APINATOR_SECRET are set. If it says
`ready:false`, the secrets didn't take — re-run step 2 and redeploy.

That's it. Tell me when `ready:true` and I'll ship Session's collab client (M1).

---

### What this service does
- `POST /v1/collab/auth` with a Discord bearer token + `{socket_id, channel_name}`
- verifies the token with Discord (`/users/@me`, optional Beta-role check)
- returns `{auth, channel_data}` signed with the Apinator secret (HMAC-SHA256,
  Pusher scheme) so Apinator lets the user into `presence-sess-<roomId>`
- it is hit **once per person at join**, not per edit — edits go peer-to-peer
  through Apinator client events.

## Beats store (added in 0.26)

The same server now hosts the **Beats** tab (producers publish free beats).
Beats and covers are stored on a Fly volume mounted at `/data`, so create the
volume once, then redeploy:

```bash
fly volumes create session_data --size 3 --region iad --app session-collab-auth
fly deploy --app session-collab-auth
```

(If your app lives in a different region, use that region instead of `iad` —
`fly status --app session-collab-auth` shows it.)

Optional — let yourself delete any beat (moderation). Put your Discord user id(s),
comma separated:

```bash
fly secrets set ADMIN_DISCORD_IDS=123456789012345678 --app session-collab-auth
```

Limits built in: MP3 only (≤20 MB), 60 beats per producer, 15 uploads per day,
a beat is hidden automatically after 3 reports.

## BandLab preset import (added in 0.25.24)

Session's "Copy a BandLab preset" reads screenshots with Claude (AI) on this server.
It needs an Anthropic API key, which lives only here as a secret (never in the app):

1. Get a key at https://console.anthropic.com → API Keys (add a few dollars of credit under Billing).
2. Set it and redeploy:

```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-... --app session-collab-auth
```

(`fly secrets set` restarts the server by itself; no separate deploy needed after the first `fly deploy`.)

Cost guards (optional, these are the defaults): each user gets 25 reads a day, the whole server 400 a day.
Each read costs roughly 2–4 cents.

```bash
fly secrets set AI_PER_USER_DAY=25 AI_GLOBAL_DAY=400 --app session-collab-auth
```
