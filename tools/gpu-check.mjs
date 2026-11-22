// GPU kernels against the JS reference, in headless Chromium (M8). Serves the repository on localhost (WebGPU
// needs a secure context) and runs tools/gpu-check.html.
//
//   node tools/gpu-check.mjs              the adapter Chromium picks (the real GPU where headless Chromium has one)
//   GPU_ADAPTER=swiftshader node tools/gpu-check.mjs     the software adapter (CI runners have no GPU)
//   node tools/gpu-check.mjs --big        also times 256³ tomography
// Needs Playwright (npm i playwright; npx playwright install chromium) or PLAYWRIGHT=/path/to/playwright/index.mjs.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const srv = http.createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try { const b = await readFile(join(root, p)); res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const port = srv.address().port;

const args = ['--enable-unsafe-webgpu'];
if (process.env.GPU_ADAPTER) args.push(`--use-webgpu-adapter=${process.env.GPU_ADAPTER}`);
if (process.platform === 'linux') args.push('--enable-features=Vulkan');
// the new headless mode reaches the real GPU on macOS; the headless shell has the software adapter
const browser = await chromium.launch({ channel: process.env.GPU_ADAPTER ? undefined : 'chromium', args });
let code = 1;
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (/favicon|404/.test(m.text())) return; if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  await page.goto(`http://localhost:${port}/tools/gpu-check.html${process.argv.includes('--big') ? '?big=1' : ''}`);
  await page.waitForFunction(() => window.__result, null, { timeout: 600000 });
  const r = await page.evaluate(() => window.__result);
  console.log(`adapter: ${r.gpu ?? 'none'}`);
  for (const c of r.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}  ${typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)}`);
  if (r.error) console.log(r.error);
  if (!r.gpu) console.log('no WebGPU adapter in this browser: nothing was checked');
  code = r.ok && r.gpu ? 0 : 1;
  console.log(code ? 'GPU check FAILED' : `all ${r.checks.length} GPU checks passed`);
} finally { await browser.close(); srv.close(); }
process.exit(code);
