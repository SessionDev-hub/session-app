/* Node-side link to the native plugin host (ps-host.exe). No Electron APIs here, so it can be tested with plain Node.
 *
 * Wire format on a loopback TCP socket, both directions:
 *   [u32 LE length][u8 type][payload]      length = 1 + payload bytes
 *   type 0 = UTF-8 JSON message
 *   type 1 = audio: [u32 inst][u32 seq][u16 channels][u16 frames][float32 planar samples]
 * The app listens, launches the host with --port/--token, and the host connects back and must open with
 * {"evt":"hello","token":...}. Anything else that connects is dropped.
 */
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const MAX_FRAME = 64 * 1024 * 1024;
const MAX_QUEUED_BYTES = 2 * 1024 * 1024;

class HostBridge extends EventEmitter {
  /** opts: { command, argsPrefix?, extraArgs?, startTimeoutMs? } */
  constructor(opts) {
    super();
    this.opts = opts;
    this.alive = false;
    this.socket = null;
    this.child = null;
    this.droppedAudio = 0;
    this._buf = Buffer.alloc(0);
  }

  start() {
    return new Promise((resolve, reject) => {
      const token = crypto.randomBytes(16).toString('hex');
      const server = net.createServer();
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { server.close(); } catch (e) {}
        try { this.child && this.child.kill(); } catch (e) {}
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('The plugin host did not start (timed out)')), this.opts.startTimeoutMs || 15000);
      server.on('error', fail);
      server.on('connection', (sock) => {
        if (this.socket) return sock.destroy(); // only one host
        sock.setNoDelay(true);
        let first = Buffer.alloc(0);
        const onData = (chunk) => {
          first = Buffer.concat([first, chunk]);
          if (first.length < 5) return;
          const len = first.readUInt32LE(0);
          if (len < 2 || len > 4096) return sock.destroy();
          if (first.length < 4 + len) return;
          let hello;
          try { hello = JSON.parse(first.slice(5, 4 + len).toString('utf8')); } catch (e) { return sock.destroy(); }
          if (first[4] !== 0 || !hello || hello.evt !== 'hello' || !tokenOk(hello.token, token)) return sock.destroy();
          sock.removeListener('data', onData);
          this.socket = sock;
          this.alive = true;
          try { server.close(); } catch (e) {}
          settled = true;
          clearTimeout(timer);
          this._buf = first.slice(4 + len);
          sock.on('data', (c) => this._onData(c));
          sock.on('close', () => this._closed());
          sock.on('error', () => {});
          if (this._buf.length) { const rest = this._buf; this._buf = Buffer.alloc(0); this._onData(rest); }
          resolve(hello);
        };
        sock.on('data', onData);
        sock.on('error', () => {});
      });
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const args = [...(this.opts.argsPrefix || []), '--port', String(port), '--token', token, ...(this.opts.extraArgs || [])];
        try {
          this.child = spawn(this.opts.command, args, { windowsHide: false, stdio: 'ignore' });
        } catch (e) {
          return fail(e);
        }
        this.child.on('error', (e) => fail(new Error('Could not start the plugin host: ' + e.message)));
        this.child.on('exit', (code) => {
          if (!settled) fail(new Error('The plugin host exited during start-up (code ' + code + ')'));
          this._closed();
        });
      });
    });
  }

  _onData(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    for (;;) {
      if (this._buf.length < 4) return;
      const len = this._buf.readUInt32LE(0);
      if (len < 1 || len > MAX_FRAME) return this.stop();
      if (this._buf.length < 4 + len) return;
      const type = this._buf[4];
      const payload = Buffer.from(this._buf.slice(5, 4 + len)); // copy: detaches from the receive buffer
      this._buf = this._buf.slice(4 + len);
      if (type === 0) {
        try { this.emit('json', JSON.parse(payload.toString('utf8'))); } catch (e) {}
      } else if (type === 1) {
        this.emit('audio', payload);
      }
    }
  }

  _frame(type, payload) {
    const head = Buffer.alloc(5);
    head.writeUInt32LE(payload.length + 1, 0);
    head[4] = type;
    return Buffer.concat([head, payload]);
  }

  sendJson(obj) {
    if (!this.alive) return false;
    return this.socket.write(this._frame(0, Buffer.from(JSON.stringify(obj), 'utf8')));
  }

  sendAudio(buf) {
    if (!this.alive) return false;
    if (this.socket.writableLength > MAX_QUEUED_BYTES) { this.droppedAudio++; return false; } // host is behind: drop rather than add latency
    return this.socket.write(this._frame(1, buf));
  }

  _closed() {
    if (!this.alive && !this.child) return;
    const was = this.alive;
    this.alive = false;
    this.socket = null;
    const child = this.child;
    this.child = null;
    try { child && child.kill(); } catch (e) {}
    if (was) this.emit('exit');
  }

  stop() {
    try { this.socket && this.socket.destroy(); } catch (e) {}
    this._closed();
  }
}

function tokenOk(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = { HostBridge };
