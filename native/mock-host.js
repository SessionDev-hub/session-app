/* Stand-in for ps-host.exe used by the tests: same protocol, one fake "plugin" that halves the level. */
const net = require('net');
const a = process.argv;
const arg = (k) => a[a.indexOf(k) + 1];
const port = +arg('--port');
const token = arg('--token');
const sock = net.connect(port, '127.0.0.1');
sock.setNoDelay(true);
const frame = (type, p) => { const h = Buffer.alloc(5); h.writeUInt32LE(p.length + 1, 0); h[4] = type; return Buffer.concat([h, p]); };
const json = (o) => sock.write(frame(0, Buffer.from(JSON.stringify(o))));
const insts = new Map();
const PLUGINS = [
  { id: 'VST3-MockGain-1', name: 'Mock Gain', vendor: 'Test', path: 'C:\\mock\\MockGain.vst3', format: 'VST3', inputs: 2, outputs: 2 },
];
sock.on('connect', () => json({ evt: 'hello', token: process.env.MOCK_BAD_TOKEN ? 'wrong' : token }));
let buf = Buffer.alloc(0);
sock.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const type = buf[4];
    const p = buf.slice(5, 4 + len);
    buf = buf.slice(4 + len);
    if (type === 0) command(JSON.parse(p.toString()));
    else audio(Buffer.from(p));
  }
});
sock.on('close', () => process.exit(0));
function command(c) {
  if (c.cmd === 'list') json({ evt: 'plugins', plugins: PLUGINS, done: true });
  else if (c.cmd === 'scan') { json({ evt: 'scanProgress', name: 'MockGain.vst3', found: 1 }); json({ evt: 'plugins', plugins: PLUGINS, done: true, folders: c.folders || [] }); }
  else if (c.cmd === 'create') {
    if (c.id !== PLUGINS[0].id) return json({ evt: 'error', inst: c.inst, message: 'Plugin not found. Rescan your plugins.' });
    insts.set(c.inst, { state: '', bypass: false });
    json({ evt: 'created', inst: c.inst, latency: 64, hasEditor: true, name: 'Mock Gain' });
  } else if (c.cmd === 'destroy') insts.delete(c.inst);
  else if (c.cmd === 'setState') { const i = insts.get(c.inst); if (i) i.state = c.state; }
  else if (c.cmd === 'getState') { const i = insts.get(c.inst); json({ evt: 'state', inst: c.inst, req: c.req, state: i ? i.state : '' }); }
  else if (c.cmd === 'bypass') { const i = insts.get(c.inst); if (i) i.bypass = !!c.on; }
  else if (c.cmd === 'openEditor') json({ evt: 'editorClosed', inst: c.inst });
  else if (c.cmd === 'ping') json({ evt: 'pong' });
}
function audio(p) {
  const inst = p.readUInt32LE(0), ch = p.readUInt16LE(8), frames = p.readUInt16LE(10);
  const i = insts.get(inst);
  if (i && !i.bypass) for (let k = 0; k < ch * frames; k++) p.writeFloatLE(p.readFloatLE(12 + k * 4) * 0.5, 12 + k * 4);
  sock.write(frame(1, p));
}
