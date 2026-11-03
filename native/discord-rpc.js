/* Discord Rich Presence over the local Discord IPC pipe — no bot token, no npm dependency.
 *
 * Speaks Discord's IPC framing directly to the Discord desktop app running on this computer
 * (named pipe on Windows, unix socket on macOS/Linux). If Discord isn't running, every call is a
 * quiet no-op and we retry in the background, so the studio never blocks or errors on it.
 *
 * Protocol: each frame is  <int32 op LE><int32 len LE><utf8 JSON>.  op 0 = handshake, 1 = frame,
 * 2 = close, 3 = ping, 4 = pong. After a handshake { v:1, client_id } Discord dispatches READY;
 * then we send { cmd:'SET_ACTIVITY', nonce, args:{ pid, activity } }.
 */
const net = require('net');
const path = require('path');
const os = require('os');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function ipcPath(id) {
  if (process.platform === 'win32') return '\\\\?\\pipe\\discord-ipc-' + id;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  // Discord may also live under a flatpak/snap subdir; check the common ones.
  const prefixes = ['', 'app/com.discordapp.Discord/', 'snap.discord/'];
  for (const p of prefixes) {
    const full = path.join(base, p, 'discord-ipc-' + id);
    return full; // net.connect just fails if it's wrong; caller walks ids
  }
}

class DiscordRPC {
  constructor(clientId) {
    this.clientId = String(clientId || '');
    this.sock = null;
    this.connected = false; // handshook + READY
    this.connecting = false;
    this.activity = null;    // last activity we were asked to show (null = clear)
    this.want = false;       // whether we should be showing anything
    this.buf = Buffer.alloc(0);
    this.retry = null;
    this.closedByUs = false;
  }

  // ---- public ----
  setActivity(activity) {
    this.activity = activity || null;
    this.want = true;
    if (this.connected) this._send(OP.FRAME, { cmd: 'SET_ACTIVITY', nonce: nonce(), args: { pid: process.pid, activity: this.activity || undefined } });
    else this._ensure();
  }
  clear() {
    this.activity = null;
    this.want = false;
    if (this.connected) this._send(OP.FRAME, { cmd: 'SET_ACTIVITY', nonce: nonce(), args: { pid: process.pid, activity: undefined } });
  }
  destroy() {
    this.closedByUs = true;
    this.want = false;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    try { if (this.sock) { this._send(OP.CLOSE, {}); this.sock.destroy(); } } catch (e) {}
    this.sock = null; this.connected = false; this.connecting = false;
  }

  // ---- connection ----
  _ensure() {
    if (!this.clientId) return;
    if (this.connected || this.connecting || this.closedByUs) return;
    this.connecting = true;
    this._tryId(0);
  }
  _tryId(id) {
    if (id > 9) { this.connecting = false; this._scheduleRetry(); return; } // Discord not reachable
    const sock = net.connect(ipcPath(id));
    let settled = false;
    const fail = () => { if (settled) return; settled = true; try { sock.destroy(); } catch (e) {} this._tryId(id + 1); };
    sock.once('error', fail);
    sock.once('connect', () => {
      if (settled) return; settled = true;
      sock.removeListener('error', fail);
      this.sock = sock;
      this.buf = Buffer.alloc(0);
      sock.on('data', (d) => this._onData(d));
      sock.on('close', () => this._onClose());
      sock.on('error', () => this._onClose());
      this._send(OP.HANDSHAKE, { v: 1, client_id: this.clientId });
    });
  }
  _onClose() {
    const wasConnected = this.connected || this.connecting;
    this.connected = false; this.connecting = false; this.sock = null;
    if (!this.closedByUs && this.want && wasConnected) this._scheduleRetry();
  }
  _scheduleRetry() {
    if (this.closedByUs || this.retry || !this.want) return;
    this.retry = setTimeout(() => { this.retry = null; this._ensure(); }, 15000); // Discord may be launched later
  }

  // ---- framing ----
  _send(op, payload) {
    if (!this.sock) return;
    try {
      const json = Buffer.from(JSON.stringify(payload), 'utf8');
      const head = Buffer.alloc(8);
      head.writeInt32LE(op, 0);
      head.writeInt32LE(json.length, 4);
      this.sock.write(Buffer.concat([head, json]));
    } catch (e) { /* pipe went away; _onClose handles it */ }
  }
  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) break;
      const body = this.buf.slice(8, 8 + len);
      this.buf = this.buf.slice(8 + len);
      let msg = null; try { msg = JSON.parse(body.toString('utf8')); } catch (e) {}
      this._onMessage(op, msg);
    }
  }
  _onMessage(op, msg) {
    if (op === OP.PING) { this._send(OP.PONG, msg); return; }
    if (op === OP.CLOSE) { this._onClose(); return; }
    if (op === OP.FRAME && msg && msg.evt === 'READY') {
      this.connected = true;
      this.connecting = false;
      // push whatever we currently want to show
      if (this.want) this._send(OP.FRAME, { cmd: 'SET_ACTIVITY', nonce: nonce(), args: { pid: process.pid, activity: this.activity || undefined } });
    }
  }
}

let _n = 0;
function nonce() { return Date.now() + '-' + (_n++); }

module.exports = { DiscordRPC };
