"""
Session real-time collab — Apinator channel-auth service.

One job: when a Beta user joins a collab room, Session asks this service to
sign the Apinator presence-channel join. Signing needs the Apinator SECRET,
which lives ONLY here (in fly.dev env), never in the Session app.

This service does NOT touch The Vault's database, keys, contacts or messages.
It is deliberately standalone so the secret is isolated from everything else.

Endpoints:
  GET  /                      -> health check
  POST /v1/collab/auth        -> { auth, channel_data }  (Pusher-compatible signing)
  POST /v1/collab/blob        -> { id }     (store an encrypted audio blob, short-lived)
  GET  /v1/collab/blob/<id>   -> raw bytes  (fetch it back)

Beats (the in-app beat store — free downloads for now):
  GET    /v1/beats?q=&genre=&sort=new|popular&offset=&limit=   -> { beats, total }   (public)
  GET    /v1/beats/mine                                         -> { beats }          (signed in)
  GET    /v1/beats/<id>/audio                                   -> MP3 (supports seeking)
  GET    /v1/beats/<id>/cover                                   -> image
  POST   /v1/beats                (multipart: audio, cover?, title, genre, bpm, key, tags) (signed in)
  POST   /v1/beats/<id>/play | /download                        -> counters
  POST   /v1/beats/<id>/report                                  (signed in; 3 reports hide a beat)
  DELETE /v1/beats/<id>                                         (owner or admin)
Beats live on a persistent Fly volume mounted at /data (see DEPLOY.md).

The blob relay lets collaborators share audio (imports/recordings) that is far too
big for realtime events. The bytes are ENCRYPTED by the app with a room key that only
travels in the end-to-end-encrypted Vault invite — this server only ever sees and
stores ciphertext, and blobs are deleted after a couple of hours.

Request to /v1/collab/auth:
  headers: Authorization: Bearer <discord oauth token>
  body (JSON or form): socket_id, channel_name
  channel_name must look like  presence-sess-<roomId>
"""

import os
import re
import hmac
import json
import time
import hashlib
import secrets
import tempfile
from pathlib import Path

import sqlite3
import threading

import requests
from flask import Flask, request, jsonify, make_response, send_file

app = Flask(__name__)

# ---- encrypted audio blob relay ---------------------------------------------
BLOB_DIR = Path(tempfile.gettempdir()) / "collab_blobs"
BLOB_DIR.mkdir(exist_ok=True)
BLOB_TTL = 2 * 3600          # blobs live ~2 hours, then get swept
BLOB_MAX = 40 * 1024 * 1024  # 40 MB per blob
app.config["MAX_CONTENT_LENGTH"] = BLOB_MAX + (1 * 1024 * 1024)

def _sweep_blobs():
    cutoff = time.time() - BLOB_TTL
    try:
        for f in BLOB_DIR.glob("*.bin"):
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink()
            except OSError:
                pass
    except OSError:
        pass

# ---- config (from fly.dev env) ----------------------------------------------
APINATOR_KEY     = os.environ.get("APINATOR_KEY", "")
APINATOR_SECRET  = os.environ.get("APINATOR_SECRET", "").encode()
# Optional hard gate: only let members of this guild who have this role join.
# Needs the user's token to carry the guilds.members.read scope (Session asks
# for it already). Leave DISCORD_GUILD_ID blank to skip the role check for MVP.
DISCORD_GUILD_ID = os.environ.get("DISCORD_GUILD_ID", "")
DISCORD_ROLE_ID  = os.environ.get("DISCORD_BETA_ROLE_ID", "")

CHANNEL_RE = re.compile(r"^presence-sess-[A-Za-z0-9_-]{6,}$")
DISCORD_API = "https://discord.com/api"

# tiny in-process cache so we don't hit Discord on every re-auth
_cache = {}          # token -> (expires_ts, user_dict)
_CACHE_TTL = 120.0


def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Range"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    resp.headers["Access-Control-Expose-Headers"] = "Content-Range, Accept-Ranges, Content-Length"
    return resp


def verify_discord_user(auth_header):
    """Return {id, name, avatar} for a valid Discord bearer token, else None.
    When DISCORD_GUILD_ID + role are set, also require that role in the guild."""
    if not auth_header or not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None

    now = time.time()
    hit = _cache.get(token)
    if hit and hit[0] > now:
        return hit[1]

    try:
        r = requests.get(
            f"{DISCORD_API}/users/@me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=6,
        )
    except requests.RequestException:
        return None
    if r.status_code != 200:
        return None
    u = r.json()
    user = {
        "id": str(u.get("id", "")),
        "name": u.get("global_name") or u.get("username") or "Artist",
        "avatar": u.get("avatar"),
    }
    if not user["id"]:
        return None

    # optional Beta-role gate
    if DISCORD_GUILD_ID and DISCORD_ROLE_ID:
        try:
            m = requests.get(
                f"{DISCORD_API}/users/@me/guilds/{DISCORD_GUILD_ID}/member",
                headers={"Authorization": f"Bearer {token}"},
                timeout=6,
            )
        except requests.RequestException:
            return None
        if m.status_code != 200:
            return None
        roles = m.json().get("roles", []) or []
        if DISCORD_ROLE_ID not in roles:
            return None

    _cache[token] = (now + _CACHE_TTL, user)
    return user


@app.get("/")
def health():
    return jsonify(service="Session Collab Auth", ok=True,
                   ready=bool(APINATOR_KEY and APINATOR_SECRET))


@app.route("/v1/collab/auth", methods=["POST", "OPTIONS"])
def collab_auth():
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))

    if not (APINATOR_KEY and APINATOR_SECRET):
        return _cors(jsonify(error="server not configured")), 500

    user = verify_discord_user(request.headers.get("Authorization"))
    if not user:
        return _cors(make_response(jsonify(error="unauthorized"), 401))

    body = request.get_json(force=True, silent=True) or request.form or {}
    socket_id = (body.get("socket_id") or "").strip()
    channel   = (body.get("channel_name") or "").strip()

    if not socket_id:
        return _cors(make_response(jsonify(error="missing socket_id"), 400))
    if not CHANNEL_RE.match(channel):
        return _cors(make_response(jsonify(error="bad channel"), 403))

    # Presence channels require a UNIQUE user_id per connection — otherwise a second
    # client with the same id (e.g. the same person on two machines, common while
    # testing) is refused. We make the connection id unique and keep the real Discord
    # identity in user_info so the roster can show one entry per person.
    channel_data = json.dumps({
        "user_id": user["id"] + ":" + secrets.token_hex(3),
        "user_info": {"id": user["id"], "name": user["name"], "avatar": user["avatar"]},
    })
    to_sign = f"{socket_id}:{channel}:{channel_data}"
    sig = hmac.new(APINATOR_SECRET, to_sign.encode(), hashlib.sha256).hexdigest()
    return _cors(jsonify(auth=f"{APINATOR_KEY}:{sig}", channel_data=channel_data))


_BLOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")

@app.route("/v1/collab/blob", methods=["POST", "OPTIONS"])
def blob_put():
    """Store an encrypted audio blob. Body is the raw ciphertext (application/octet-stream)."""
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    if not verify_discord_user(request.headers.get("Authorization")):
        return _cors(make_response(jsonify(error="unauthorized"), 401))
    data = request.get_data(cache=False)
    if not data:
        return _cors(make_response(jsonify(error="empty"), 400))
    if len(data) > BLOB_MAX:
        return _cors(make_response(jsonify(error="too large"), 413))
    _sweep_blobs()
    bid = secrets.token_hex(16)
    try:
        (BLOB_DIR / (bid + ".bin")).write_bytes(data)
    except OSError as e:
        return _cors(make_response(jsonify(error="store failed: " + str(e)), 500))
    return _cors(jsonify(id=bid))

@app.route("/v1/collab/blob/<bid>", methods=["GET", "OPTIONS"])
def blob_get(bid):
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    if not verify_discord_user(request.headers.get("Authorization")):
        return _cors(make_response(jsonify(error="unauthorized"), 401))
    if not _BLOB_ID_RE.match(bid or ""):
        return _cors(make_response(jsonify(error="bad id"), 400))
    f = BLOB_DIR / (bid + ".bin")
    if not f.exists():
        return _cors(make_response(jsonify(error="not found"), 404))
    resp = make_response(f.read_bytes())
    resp.headers["Content-Type"] = "application/octet-stream"
    return _cors(resp)


# ---- beat store ---------------------------------------------------------------
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / ".w").write_text("ok")
except OSError:
    DATA_DIR = Path(tempfile.gettempdir()) / "session_data"   # no volume yet: works, but resets on redeploy
    DATA_DIR.mkdir(parents=True, exist_ok=True)
BEATS_DIR = DATA_DIR / "beats"
BEATS_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "beats.db"
BEAT_MAX = 20 * 1024 * 1024        # 20 MB per MP3 (a 3-minute beat at 320 kbps is ~7 MB)
COVER_MAX = 2 * 1024 * 1024
PER_USER_MAX = 60                  # beats per producer
PER_DAY_MAX = 15                   # uploads per producer per day
HIDE_AFTER_REPORTS = 3
ADMIN_IDS = {x.strip() for x in os.environ.get("ADMIN_DISCORD_IDS", "").split(",") if x.strip()}
GENRES = ["Trap", "Rage", "Drill", "R&B", "Pluggnb", "Boom Bap", "Lo-Fi", "Afrobeats", "Pop", "Jersey Club", "Phonk", "Other"]
KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_db_lock = threading.Lock()


def _db():
    con = sqlite3.connect(str(DB_PATH), timeout=10)
    con.row_factory = sqlite3.Row
    return con


with _db() as _c:
    _c.execute("""CREATE TABLE IF NOT EXISTS beats (
        id TEXT PRIMARY KEY, owner_id TEXT, owner_name TEXT, owner_avatar TEXT,
        title TEXT, genre TEXT, bpm INTEGER, musical_key TEXT, tags TEXT,
        created REAL, plays INTEGER DEFAULT 0, downloads INTEGER DEFAULT 0,
        size INTEGER, duration REAL, has_cover INTEGER DEFAULT 0, cover_type TEXT,
        hidden INTEGER DEFAULT 0)""")
    _c.execute("CREATE TABLE IF NOT EXISTS reports (beat_id TEXT, user_id TEXT, reason TEXT, created REAL, PRIMARY KEY (beat_id, user_id))")
    _c.execute("CREATE INDEX IF NOT EXISTS beats_created ON beats(created)")

_BEAT_ID_RE = re.compile(r"^[0-9a-f]{20}$")


def _err(msg, code):
    return _cors(make_response(jsonify(error=msg), code))


def _beat_json(r):
    return {
        "id": r["id"], "title": r["title"], "genre": r["genre"], "bpm": r["bpm"], "key": r["musical_key"],
        "tags": [t for t in (r["tags"] or "").split(",") if t], "created": r["created"],
        "plays": r["plays"], "downloads": r["downloads"], "duration": r["duration"],
        "cover": bool(r["has_cover"]),
        "producer": {"id": r["owner_id"], "name": r["owner_name"], "avatar": r["owner_avatar"]},
        "free": True,
    }


def _clean(text, n):
    text = re.sub(r"[\x00-\x1f<>]", "", str(text or "")).strip()
    return text[:n]


def _looks_like_mp3(head):
    return head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)


def _mp3_duration(path, size):
    """Rough duration from the first frame's bitrate (good enough for the store list)."""
    try:
        with open(path, "rb") as f:
            data = f.read(65536)
        i = 0
        if data[:3] == b"ID3" and len(data) > 10:
            i = 10 + ((data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F))
            if i >= len(data):
                return None
        while i < len(data) - 4:
            if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
                br_idx = (data[i + 2] >> 4) & 0x0F
                rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
                br = rates[br_idx] * 1000
                if br:
                    return round((size - i) * 8 / br, 1)
            i += 1
    except OSError:
        pass
    return None


@app.route("/v1/beats", methods=["GET", "POST", "OPTIONS"])
def beats_root():
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    if request.method == "GET":
        q = _clean(request.args.get("q"), 60).lower()
        genre = _clean(request.args.get("genre"), 30)
        sort = request.args.get("sort", "new")
        try:
            offset = max(0, int(request.args.get("offset", 0)))
            limit = min(60, max(1, int(request.args.get("limit", 30))))
        except ValueError:
            offset, limit = 0, 30
        where, args = ["hidden = 0"], []
        if genre and genre in GENRES:
            where.append("genre = ?"); args.append(genre)
        if q:
            where.append("(lower(title) LIKE ? OR lower(owner_name) LIKE ? OR lower(tags) LIKE ?)")
            args += ["%" + q + "%"] * 3
        order = "plays + downloads * 3 DESC, created DESC" if sort == "popular" else "created DESC"
        with _db() as c:
            total = c.execute("SELECT COUNT(*) FROM beats WHERE " + " AND ".join(where), args).fetchone()[0]
            rows = c.execute("SELECT * FROM beats WHERE " + " AND ".join(where) + " ORDER BY " + order + " LIMIT ? OFFSET ?", args + [limit, offset]).fetchall()
        return _cors(jsonify(beats=[_beat_json(r) for r in rows], total=total, genres=GENRES))

    # ---- publish ----
    user = verify_discord_user(request.headers.get("Authorization"))
    if not user:
        return _err("sign in with Discord to publish", 401)
    f = request.files.get("audio")
    if not f:
        return _err("no audio file", 400)
    title = _clean(request.form.get("title"), 60)
    if not title:
        return _err("give your beat a title", 400)
    genre = _clean(request.form.get("genre"), 30)
    if genre not in GENRES:
        genre = "Other"
    try:
        bpm = int(float(request.form.get("bpm") or 0))
    except ValueError:
        bpm = 0
    bpm = bpm if 40 <= bpm <= 300 else None
    key = _clean(request.form.get("key"), 12)
    if key and not re.match(r"^(%s)( (major|minor))?$" % "|".join(re.escape(k) for k in KEYS), key):
        key = ""
    tags = ",".join(t for t in (_clean(x, 20).lower() for x in (request.form.get("tags") or "").split(",")) if t)[:120]
    if request.form.get("agree") != "1":
        return _err("you must confirm you made this beat", 400)
    now = time.time()
    with _db() as c:
        mine = c.execute("SELECT COUNT(*) FROM beats WHERE owner_id = ?", (user["id"],)).fetchone()[0]
        today = c.execute("SELECT COUNT(*) FROM beats WHERE owner_id = ? AND created > ?", (user["id"], now - 86400)).fetchone()[0]
    if mine >= PER_USER_MAX:
        return _err("you've reached %d beats — delete an old one to publish more" % PER_USER_MAX, 403)
    if today >= PER_DAY_MAX:
        return _err("that's %d uploads today — try again tomorrow" % PER_DAY_MAX, 429)
    bid = secrets.token_hex(10)
    path = BEATS_DIR / (bid + ".mp3")
    f.save(str(path))
    size = path.stat().st_size
    with open(path, "rb") as fh:
        head = fh.read(4)
    if size == 0 or size > BEAT_MAX or not _looks_like_mp3(head):
        path.unlink(missing_ok=True)
        return _err("the beat must be an MP3 under 20 MB", 400)
    has_cover, ctype = 0, None
    cv = request.files.get("cover")
    if cv:
        data = cv.read(COVER_MAX + 1)
        if len(data) <= COVER_MAX and (data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n"):
            ctype = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg"
            (BEATS_DIR / (bid + ".cover")).write_bytes(data)
            has_cover = 1
    with _db_lock, _db() as c:
        c.execute("INSERT INTO beats (id, owner_id, owner_name, owner_avatar, title, genre, bpm, musical_key, tags, created, size, duration, has_cover, cover_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (bid, user["id"], _clean(user["name"], 40), user.get("avatar"), title, genre, bpm, key, tags, now, size, _mp3_duration(path, size), has_cover, ctype))
        row = c.execute("SELECT * FROM beats WHERE id = ?", (bid,)).fetchone()
    return _cors(jsonify(beat=_beat_json(row)))


@app.route("/v1/beats/mine", methods=["GET", "OPTIONS"])
def beats_mine():
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    user = verify_discord_user(request.headers.get("Authorization"))
    if not user:
        return _err("unauthorized", 401)
    with _db() as c:
        rows = c.execute("SELECT * FROM beats WHERE owner_id = ? ORDER BY created DESC", (user["id"],)).fetchall()
    return _cors(jsonify(beats=[dict(_beat_json(r), hidden=bool(r["hidden"])) for r in rows]))


def _get_beat(bid):
    if not _BEAT_ID_RE.match(bid or ""):
        return None
    with _db() as c:
        return c.execute("SELECT * FROM beats WHERE id = ?", (bid,)).fetchone()


@app.route("/v1/beats/<bid>/audio", methods=["GET", "OPTIONS"])
def beat_audio(bid):
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    r = _get_beat(bid)
    if not r or r["hidden"]:
        return _err("not found", 404)
    resp = send_file(str(BEATS_DIR / (bid + ".mp3")), mimetype="audio/mpeg", conditional=True, max_age=86400)
    return _cors(resp)


@app.route("/v1/beats/<bid>/cover", methods=["GET", "OPTIONS"])
def beat_cover(bid):
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    r = _get_beat(bid)
    if not r or not r["has_cover"] or r["hidden"]:
        return _err("not found", 404)
    return _cors(send_file(str(BEATS_DIR / (bid + ".cover")), mimetype=r["cover_type"] or "image/jpeg", max_age=86400))


_counted = {}   # (ip, beat, kind) -> ts, so refreshing doesn't inflate counts


@app.route("/v1/beats/<bid>/<kind>", methods=["POST", "OPTIONS"])
def beat_count(bid, kind):
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    if kind == "report":
        return beat_report(bid)
    if kind not in ("play", "download"):
        return _err("unknown", 404)
    if not _get_beat(bid):
        return _err("not found", 404)
    key = (request.headers.get("Fly-Client-IP") or request.remote_addr, bid, kind)
    now = time.time()
    if now - _counted.get(key, 0) > 600:
        _counted[key] = now
        if len(_counted) > 50000:
            _counted.clear()
        col = "plays" if kind == "play" else "downloads"
        with _db_lock, _db() as c:
            c.execute("UPDATE beats SET " + col + " = " + col + " + 1 WHERE id = ?", (bid,))
    return _cors(jsonify(ok=True))


def beat_report(bid):
    user = verify_discord_user(request.headers.get("Authorization"))
    if not user:
        return _err("sign in to report", 401)
    if not _get_beat(bid):
        return _err("not found", 404)
    body = request.get_json(force=True, silent=True) or {}
    with _db_lock, _db() as c:
        c.execute("INSERT OR REPLACE INTO reports VALUES (?,?,?,?)", (bid, user["id"], _clean(body.get("reason"), 200), time.time()))
        n = c.execute("SELECT COUNT(*) FROM reports WHERE beat_id = ?", (bid,)).fetchone()[0]
        if n >= HIDE_AFTER_REPORTS:
            c.execute("UPDATE beats SET hidden = 1 WHERE id = ?", (bid,))
    return _cors(jsonify(ok=True))


@app.route("/v1/beats/<bid>", methods=["DELETE", "OPTIONS"])
def beat_delete(bid):
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    user = verify_discord_user(request.headers.get("Authorization"))
    if not user:
        return _err("unauthorized", 401)
    r = _get_beat(bid)
    if not r:
        return _err("not found", 404)
    if r["owner_id"] != user["id"] and user["id"] not in ADMIN_IDS:
        return _err("that's not your beat", 403)
    with _db_lock, _db() as c:
        c.execute("DELETE FROM beats WHERE id = ?", (bid,))
        c.execute("DELETE FROM reports WHERE beat_id = ?", (bid,))
    for ext in (".mp3", ".cover"):
        (BEATS_DIR / (bid + ext)).unlink(missing_ok=True)
    return _cors(jsonify(ok=True))


# ---- BandLab preset import (AI reads a screenshot) ---------------------------------
# Session sends 1-4 screenshots of a BandLab effect chain plus the list of Session's own effects.
# Claude reads every BandLab effect and knob and maps them onto Session's effects. The Anthropic key
# lives only in this server's secrets (ANTHROPIC_API_KEY), never in the app.
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "")   # empty = pick the newest Sonnet automatically
_model_cache = {"id": None}


def _ai_headers():
    return {"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"}


def _pick_model(force=False):
    """Use ANTHROPIC_MODEL if set; otherwise ask Anthropic which models this key has and take the newest Sonnet
    (falls back to the newest model of any kind). Model names change over time, so nothing is hard-coded."""
    if ANTHROPIC_MODEL and not force:
        return ANTHROPIC_MODEL
    if _model_cache["id"] and not force:
        return _model_cache["id"]
    try:
        r = requests.get("https://api.anthropic.com/v1/models?limit=100", headers=_ai_headers(), timeout=15)
        ids = [m.get("id", "") for m in (r.json().get("data") or [])] if r.status_code == 200 else []
    except (requests.RequestException, ValueError):
        ids = []
    pick = next((i for i in ids if "sonnet" in i), None) or (ids[0] if ids else None)
    _model_cache["id"] = pick
    return pick
AI_PER_USER_DAY = int(os.environ.get("AI_PER_USER_DAY", "25"))
AI_GLOBAL_DAY = int(os.environ.get("AI_GLOBAL_DAY", "400"))     # cost guard for the whole server
IMG_MAX = 5 * 1024 * 1024

with _db() as _c:
    _c.execute("CREATE TABLE IF NOT EXISTS ai_usage (user_id TEXT, day TEXT, n INTEGER, PRIMARY KEY (user_id, day))")

BANDLAB_PROMPT = """You are helping a music app called Session copy a vocal/instrument effect preset from BandLab.

The images are screenshots from BandLab (Studio / Mix Editor) showing an effect chain or one or more effect panels.

STEP 1 - Read: list every BandLab effect you can see, in chain order (top to bottom / left to right), with every visible control label and its exact value as displayed (keep units). Note an effect that is switched off/bypassed. If a BandLab preset name is shown, record it. Never invent values you cannot see; if a knob shows no number, estimate its position as a percentage of its range and mark it "~".

STEP 2 - Rebuild: map that chain onto Session's effects (catalog below: pluginId, params with id/min/max/unit). Use the closest Session effect for each BandLab effect, convert units and ranges carefully (dB stay dB, ms stay ms, % of a 0-1 range etc.), and keep the same order. One BandLab effect may need two Session effects or a parameter can be approximated; explain those in notes. Pitch correction / Auto-Pitch -> Session's Auto-Tune if present (key/scale/speed). Every param value must be a number inside that param's min..max (or a valid option). Leave out params you have no information for (Session keeps its defaults).

CALIBRATION — Session must never sound stronger than the BandLab original:
- Values BandLab shows with units (dB, Hz, kHz, ms, s, ratio like 4:1, semitones) are copied exactly, converted only for units.
- BandLab's unitless 0-100 % knobs are gentle. For intensity controls (drive, saturation, amount, squeeze, depth, intensity, feedback, width, wet/mix of reverb, delay, chorus, distortion) use about 70 % of the straight proportional value in Session's range, and never more than the proportional value.
- EQ: copy each band's gain and frequency; if a gain has no number, estimate from the dot/slider position conservatively (round toward 0 dB).
- Compressors: if no threshold is shown, choose one that gives moderate gain reduction (about 3-6 dB) and keep make-up gain at or below what BandLab shows.
- Reverb / delay: BandLab "mix" or "wet" 100 % means fully wet only if the effect is clearly an insert meant to be fully wet; otherwise treat it as about 35 % in Session.
- Auto-Pitch / pitch correction: copy the key and scale exactly; BandLab "response" fast ≈ retune 5-20 ms, medium ≈ 40-70 ms, slow ≈ 100-200 ms.
- If you are unsure about a reading, pick the milder value and say so in notes.

Reply with ONE JSON object only, no markdown:
{"name": "short preset name", "bandlab": [{"effect": "...", "bypassed": false, "settings": {"Label": "value"}}], "chain": [{"pluginId": "...", "bypass": false, "params": {"paramId": 0}, "from": "BandLab effect it copies"}], "notes": ["..."], "confidence": "high|medium|low"}

If the images are not BandLab effect settings, reply {"error": "short reason"}.

SESSION EFFECTS CATALOG:
"""


def _ai_take_quota(uid):
    day = time.strftime("%Y-%m-%d", time.gmtime())
    with _db_lock, _db() as c:
        total = c.execute("SELECT COALESCE(SUM(n),0) FROM ai_usage WHERE day = ?", (day,)).fetchone()[0]
        row = c.execute("SELECT n FROM ai_usage WHERE user_id = ? AND day = ?", (uid, day)).fetchone()
        mine = row[0] if row else 0
        if total >= AI_GLOBAL_DAY:
            return "Preset import is busy today, try again tomorrow."
        if mine >= AI_PER_USER_DAY and uid not in ADMIN_IDS:
            return f"You've used today's {AI_PER_USER_DAY} preset imports. Try again tomorrow."
        c.execute("INSERT INTO ai_usage (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1", (uid, day))
    return None


def _img_type(b):
    if b[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    return None


@app.route("/v1/presets/bandlab", methods=["POST", "OPTIONS"])
def bandlab_import():
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    user = verify_discord_user(request.headers.get("Authorization"))
    if not user:
        return _err("sign in with Discord first", 401)
    if not ANTHROPIC_KEY:
        return _err("preset import isn't switched on on the server yet (ANTHROPIC_API_KEY missing)", 503)
    files = request.files.getlist("image")[:4]
    if not files:
        return _err("add a screenshot", 400)
    content = []
    for f in files:
        b = f.read(IMG_MAX + 1)
        if len(b) > IMG_MAX:
            return _err("each screenshot must be under 5 MB", 400)
        mt = _img_type(b)
        if not mt:
            return _err("screenshots must be PNG, JPG or WebP", 400)
        import base64
        content.append({"type": "image", "source": {"type": "base64", "media_type": mt, "data": base64.b64encode(b).decode()}})
    catalog = (request.form.get("catalog") or "")[:60000]
    try:
        json.loads(catalog)
    except ValueError:
        return _err("bad effect catalog", 400)
    hint = _clean(request.form.get("hint"), 300)
    text = BANDLAB_PROMPT + catalog + ("\n\nThe user adds: " + hint if hint else "")
    content.append({"type": "text", "text": text})
    q = _ai_take_quota(user["id"])
    if q:
        return _err(q, 429)
    def call(model):
        return requests.post("https://api.anthropic.com/v1/messages", timeout=90, headers=_ai_headers(),
                             json={"model": model, "max_tokens": 4000, "messages": [{"role": "user", "content": content}]})
    try:
        model = _pick_model()
        if not model:
            return _err("the AI key can't see any models — check the key in the Anthropic console", 502)
        r = call(model)
        if r.status_code == 404:          # that model name is retired / not on this key: find the current one
            newer = _pick_model(force=True)
            if newer and newer != model:
                r = call(newer)
    except requests.RequestException:
        return _err("couldn't reach the AI service, try again", 502)
    if r.status_code != 200:
        app.logger.warning("anthropic %s %s", r.status_code, r.text[:300])
        return _err("the AI service had a problem (%d%s), try again" % (r.status_code, ", check the API key" if r.status_code in (401, 403) else ""), 502)
    out = "".join(x.get("text", "") for x in r.json().get("content", []) if x.get("type") == "text").strip()
    m = re.search(r"\{[\s\S]*\}", out)
    try:
        res = json.loads(m.group(0)) if m else None
    except ValueError:
        res = None
    if not isinstance(res, dict):
        return _err("couldn't read that screenshot, try a clearer one", 422)
    if res.get("error"):
        return _err(str(res["error"])[:200], 422)
    return _cors(jsonify(result=res))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
