// Test the MCP server as an agent would: list tools, simulate headless; with --live, also drive an open exhibit.
//   node test.mjs            headless only
//   node test.mjs --live     then open the exhibit and click "Connect agent" within 90 s
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'temview-'));
const client = new Client({ name: 'temview-test', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('./server.mjs', import.meta.url).pathname], env: { ...process.env, TEMVIEW_OUT: out }, stderr: 'inherit' }));
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
const body = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

const { tools } = await client.listTools();
ok(tools.length === 8, `8 tools: ${tools.map((t) => t.name).join(', ')}`);

let r = await client.callTool({ name: 'simulate', arguments: { mode: 'tem', specimen: 'au', kV: 300, defocus_nm: -60 } });
const sim = JSON.parse(body(r));
ok(!r.isError && existsSync(sim.file), `simulate wrote ${sim.file.split('/').pop()} (${Object.keys(sim.arrays).join(', ')})`);
ok(Math.abs(sim.wavelength_pm - 1.9687) < 0.001, `300 kV wavelength ${sim.wavelength_pm} pm`);
r = await client.callTool({ name: 'exhibit_set', arguments: { mode: 'stem' } });
ok(r.isError && /No exhibit is connected/.test(body(r)), 'exhibit_set without an exhibit explains how to connect');

if (process.argv.includes('--live')) {
  console.log('waiting up to 90 s for the exhibit to connect…');
  let st;
  for (let i = 0; i < 90; i++) { st = JSON.parse(body(await client.callTool({ name: 'exhibit_status', arguments: {} }))); if (st.connected) break; await new Promise((s) => setTimeout(s, 1000)); }
  ok(st.connected, `exhibit connected: ${st.mode} on ${st.specimen_name}`);
  r = await client.callTool({ name: 'exhibit_set', arguments: { specimen: 'gr', mode: 'stem', kV: 80 } });
  ok(!r.isError && /graphene/.test(body(r)), `exhibit_set: ${JSON.parse(body(r)).done.join(' · ')}`);
  r = await client.callTool({ name: 'exhibit_command', arguments: { text: 'zoom in and acquire' } });
  ok(!r.isError && JSON.parse(body(r)).understood, `exhibit_command: ${JSON.parse(body(r)).done?.join(' · ')}`);
  r = await client.callTool({ name: 'exhibit_acquire', arguments: { save: true } });
  const saved = JSON.parse(r.content.at(-1).text).saved;
  ok(!r.isError && r.content.some((c) => c.type === 'image') && existsSync(saved.npz), `exhibit_acquire: image + ${saved.npz.split('/').pop()}`);
  r = await client.callTool({ name: 'exhibit_say', arguments: { text: 'This is graphene at 80 kilovolts, below its knock-on threshold.' } });
  ok(!r.isError, 'exhibit_say');
  r = await client.callTool({ name: 'exhibit_wait_for_voice', arguments: { timeout_s: 20 } });
  console.log('     voice:', body(r));
}
await client.close();
