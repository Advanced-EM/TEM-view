#!/usr/bin/env node
// Copyright © 2026 by Northwestern University. All Rights Reserved.
// temview-mcp: an MCP server that lets an AI agent (an emskills agent, Claude, …) use the TEM-view digital twin.
//
//   Live:      the exhibit (browser) connects to ws://127.0.0.1:8790 after the visitor clicks "Connect agent".
//              The agent can then read the state, change settings, acquire images, speak through the exhibit,
//              and receive the visitor's spoken questions (voice commands the exhibit itself doesn't understand).
//   Headless:  `simulate` runs the same simulator in Node, no browser needed, and writes NumPy .npz data.
//
// Run it from an MCP client (stdio), e.g. in Claude Code: claude mcp add temview -- node /path/to/TEM-view/tools/temview-mcp/server.mjs
// Environment: TEMVIEW_PORT (8790), TEMVIEW_ORIGINS (comma-separated; default the exhibit's site and localhost),
//              TEMVIEW_OUT (folder for acquisitions and simulations; default ./temview-out).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { Sim } from '../../js/sim.js';
import { defaultState } from '../../js/state.js';
import * as P from '../../js/physics.js';
import { collectData, toNpz } from '../../js/export.js';
import { analyze, ANALYSES } from '../../js/analyze.js';
import { MAGSPECS } from '../../js/lorentz.js';

const PORT = +(process.env.TEMVIEW_PORT ?? 8790);
const ORIGINS = (process.env.TEMVIEW_ORIGINS ?? 'https://advanced-em.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = resolve(process.env.TEMVIEW_OUT ?? 'temview-out');
const log = (...a) => console.error('[temview-mcp]', ...a); // stdout belongs to the MCP protocol

// ------------------------------------------------------------------ bridge to the exhibit
let page = null, nextId = 1;
const pending = new Map(), utterances = [], waiters = [];
const allowed = (origin) => !origin || ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT, verifyClient: ({ origin }) => allowed(origin) });
wss.on('listening', () => log(`waiting for the exhibit on ws://127.0.0.1:${PORT}`));
wss.on('error', (e) => log('websocket error:', e.message));
wss.on('connection', (ws) => {
  if (page) page.close(4000, 'replaced by a newer exhibit tab');
  page = ws; log('exhibit connected');
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.t); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); }
    else if (m.event === 'utterance' && typeof m.text === 'string') {
      const u = { text: m.text.slice(0, 500), at: new Date().toISOString() };
      const w = waiters.shift(); if (w) w(u); else { utterances.push(u); if (utterances.length > 20) utterances.shift(); }
    }
  });
  ws.on('close', () => { if (page === ws) { page = null; log('exhibit disconnected'); } });
});

function call(method, params = {}, timeoutMs = 20000) {
  if (!page || page.readyState !== 1) return Promise.reject(new Error('No exhibit is connected. Open the exhibit and click "Connect agent" (Controls → Agent).'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`the exhibit did not answer ${method} in time`)); }, timeoutMs);
    pending.set(id, { resolve, reject, t });
    page.send(JSON.stringify({ id, method, params }));
  });
}

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e.message ?? String(e) }] });
const safe = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(e); } };

// ------------------------------------------------------------------ settings → exhibit operations (same ops as voice commands)
const MODES = ['tem', 'stem', '4d', 'diff', 'cbed', 'eds', 'eels', 'ronch', 'oah', 'ilh', 'ltem', 'lstem'];
const SPECS = ['au', 'si', 'sto', 'gr', 'mof', 'bio'];
const settings = {
  mode: z.enum(MODES).optional().describe('tem, stem, 4d (4D-STEM), diff (SAED), cbed, eds, eels, ronch (Ronchigram), oah (off-axis holography), ilh (in-line holography), ltem (Lorentz TEM: magnetic domains), lstem (Lorentz STEM: DPC induction maps)'),
  specimen: z.enum(SPECS).optional().describe('au gold on carbon, si silicon, sto SrTiO3 grain boundary, gr graphene, mof UiO-66, bio proteins in vitreous ice'),
  kV: z.union([z.literal(80), z.literal(200), z.literal(300)]).optional(),
  defocus_nm: z.number().min(-5000).max(5000).optional().describe('C1; negative is underfocus'),
  fov_nm: z.number().positive().max(200).optional().describe('field of view'),
  dose: z.number().positive().max(20000).optional().describe('electrons per Å²'),
  corrector: z.boolean().optional(),
  holder: z.enum(['room', 'ln2', 'lhe', 'heat']).optional(),
  temperature_K: z.number().min(4).max(1500).optional(),
  realistic: z.boolean().optional().describe('shot noise and real detectors instead of the clean educational view'),
  // Lorentz modes (ltem, lstem)
  magnetic_specimen: z.enum(['vortex', 'landau', 'fege']).optional().describe('Lorentz modes: vortex permalloy disc, landau permalloy rectangle, fege FeGe lamella (cool below 278 K; field along the beam makes skyrmions)'),
  lorentz_view: z.enum(['fresnel', 'foucault', 'tie', 'phase']).optional().describe('ltem display'),
  lorentz_defocus_um: z.number().min(-3000).max(3000).optional().describe('Lorentz-lens defocus, µm'),
  field_mT: z.number().min(0).max(600).optional().describe('objective-lens field along the beam, mT (Lorentz modes)'),
  probe_urad: z.number().min(20).max(3000).optional().describe('Lorentz-STEM probe semi-angle, µrad'),
};
function toOps(a) {
  const ops = [];
  if (a.specimen) ops.push({ op: 'spec', v: a.specimen });
  if (a.mode) ops.push({ op: 'mode', v: a.mode });
  if (a.kV) ops.push({ op: 'chip', k: 'kV', v: a.kV });
  if (a.corrector !== undefined) ops.push({ op: 'chip', k: 'corrector', v: a.corrector });
  if (a.holder) ops.push({ op: 'chip', k: 'holder', v: a.holder });
  if (a.temperature_K !== undefined) ops.push({ op: 'temp', v: a.temperature_K });
  if (a.defocus_nm !== undefined) ops.push({ op: 'set', k: 'df', v: a.defocus_nm });
  if (a.fov_nm !== undefined) ops.push({ op: 'set', k: 'fov', v: a.fov_nm });
  if (a.dose !== undefined) ops.push({ op: 'set', k: 'dose', v: a.dose });
  if (a.realistic !== undefined) ops.push({ op: 'set', k: 'clarity', v: a.realistic ? 'real' : 'edu' });
  if (a.magnetic_specimen) ops.push({ op: 'chip', k: 'magSpec', v: a.magnetic_specimen });
  if (a.lorentz_view) ops.push({ op: 'set', k: 'lorView', v: a.lorentz_view });
  if (a.lorentz_defocus_um !== undefined) ops.push({ op: 'set', k: 'lorDf', v: a.lorentz_defocus_um });
  if (a.field_mT !== undefined) ops.push({ op: 'set', k: 'lorField', v: a.field_mT });
  if (a.probe_urad !== undefined) ops.push({ op: 'set', k: 'lorAlpha', v: a.probe_urad });
  return ops;
}

// ------------------------------------------------------------------ headless simulation
function simulate(a) {
  const S = defaultState();
  if (a.specimen) { const sp = P.SPECIMENS[a.specimen]; S.spec = a.specimen; S.fov = sp.fov; [S.cx, S.cy] = sp.center; }
  if (a.mode) S.mode = a.mode;
  const fam = ['tem', 'diff', 'oah', 'ilh', 'ltem'].includes(S.mode) ? 'tem' : 'probe';
  if (a.kV) S.kV = a.kV;
  if (a.corrector !== undefined) S.corrector = a.corrector;
  S.df = a.defocus_nm ?? S.dfFam[fam];
  if (a.fov_nm) S.fov = a.fov_nm;
  if (a.dose) S.dose = a.dose;
  if (a.thickness_nm) S.thick = a.thickness_nm;
  if (a.holder) { S.holder = a.holder; S.tempSet = { room: 293, ln2: 90, lhe: 4.2, heat: 293 }[a.holder]; }
  if (a.temperature_K !== undefined) S.tempSet = a.temperature_K;
  if (a.realistic) S.clarity = 'real';
  if (a.magnetic_specimen) { S.magSpec = a.magnetic_specimen; S.lorFov = MAGSPECS[a.magnetic_specimen].fov; S.lorThick = MAGSPECS[a.magnetic_specimen].thick; }
  if (a.lorentz_view) S.lorView = a.lorentz_view;
  if (a.lorentz_defocus_um !== undefined) S.lorDf = a.lorentz_defocus_um;
  if (a.field_mT !== undefined) S.lorField = a.field_mT;
  if (a.probe_urad !== undefined) S.lorAlpha = a.probe_urad;
  const sim = new Sim(S);
  const steps = a.steps ?? (S.mode === '4d' ? 400 : S.mode === 'ilh' ? 600 : 10);
  for (let i = 0; i < steps; i++) { sim.update(0.05); if (S.mode === 'ilh' && sim.ilh.st?.it >= sim.ilh.st.maxIt) break; }
  const data = collectData(sim, S);
  mkdirSync(OUT, { recursive: true });
  const file = a.out ? resolve(a.out) : join(OUT, `sim-${S.mode}-${S.spec}-${Date.now()}.npz`);
  writeFileSync(file, toNpz(data));
  const arrays = Object.fromEntries(Object.entries(data.arrays).map(([k, v]) => [k, v.shape]));
  let analysis;
  if (a.analysis) { try { analysis = analyze(sim, S, a.analysis === 'auto' ? undefined : a.analysis); } catch (e) { analysis = { error: e.message }; } }
  return { file, mode: S.mode, specimen: sim.spec.name, kV: S.kV, defocus_nm: S.df, temperature_K: +sim.temp().toFixed(1), arrays, analysis,
    calibration: data.meta?.calibration ?? data.meta?.calibrations ?? undefined, wavelength_pm: +(sim.lam * 100).toFixed(4) };
}

// ------------------------------------------------------------------ MCP tools
const server = new McpServer({ name: 'temview', version: '0.1.0' }, {
  instructions: 'TEM-view is a physics-based transmission electron microscope simulator (a digital twin). Use simulate for headless data. The exhibit_* tools act on a live exhibit a visitor has open; a person may be watching and listening, so keep exhibit_say short and plain. Never change settings during a training task the visitor is doing (the exhibit refuses).',
});

server.registerTool('simulate', {
  title: 'Simulate a TEM-view acquisition (headless)',
  description: 'Run the TEM-view simulator without a browser and save what the detectors record as a NumPy .npz (images, diffraction, 4D datacube, spectra, holograms) with metadata.json (calibrations, optics, state). Returns the file path and array shapes; feed the file to analysis skills (e.g. emskills ctf-fitter, lattice-dspacing, eels-edge-id).',
  inputSchema: { ...settings, thickness_nm: z.number().positive().max(500).optional(), steps: z.number().int().min(1).max(2000).optional(), out: z.string().optional().describe('output .npz path'),
    analysis: z.enum(['auto', ...Object.keys(ANALYSES)]).optional().describe('also analyze the result: fit_ctf (emskills ctf-fitter), fit_lattice (lattice-dspacing), identify_edges (eels-edge-id), fit_eds, fit_zlp, fit_hologram; auto picks by mode') },
  annotations: { readOnlyHint: false, openWorldHint: false },
}, safe(async (a) => text(simulate(a))));

server.registerTool('exhibit_status', {
  title: 'Exhibit status',
  description: 'Is a live exhibit connected, and what is it showing: mode, specimen, voltage, defocus, field of view, dose, corrector, holder and temperature, and whether a training task is running.',
  inputSchema: {}, annotations: { readOnlyHint: true },
}, safe(async () => text(page ? { connected: true, ...(await call('state')) } : { connected: false, how: 'Open the exhibit (https://advanced-em.github.io/TEM-view/) and click "Connect agent" in Controls → Agent.' })));

server.registerTool('exhibit_set', {
  title: 'Change exhibit settings',
  description: 'Change the live microscope: mode, specimen, voltage, defocus, field of view, dose, corrector, holder, temperature, realistic view. Settings apply in a sensible order (specimen, mode, optics). Returns what changed.',
  inputSchema: settings,
}, safe(async (a) => { const ops = toOps(a); if (!ops.length) throw new Error('nothing to change'); return text(await call('run', { ops })); }));

server.registerTool('exhibit_action', {
  title: 'Exhibit action',
  description: 'Press a control on the live microscope: optimal_focus (Scherzer or probe focus), autotune (tune the corrector, Ronchigram), blank_beam, unblank_beam, wobbler, narrate (the exhibit explains the current mode aloud).',
  inputSchema: { action: z.enum(['optimal_focus', 'autotune', 'blank_beam', 'unblank_beam', 'wobbler', 'narrate']) },
}, safe(async ({ action }) => {
  const op = { optimal_focus: { op: 'action', v: 'optfocus' }, autotune: { op: 'action', v: 'autotune' }, blank_beam: { op: 'beam', v: false }, unblank_beam: { op: 'beam', v: true }, wobbler: { op: 'wobbler' }, narrate: { op: 'narrate' } }[action];
  return text(await call('run', { ops: [op] }));
}));

server.registerTool('exhibit_command', {
  title: 'Run a spoken-style command',
  description: 'Run a plain-language command with the exhibit\'s voice grammar, exactly as if the visitor had said it: "switch to STEM", "defocus minus fifty", "load graphene", "cool to 90 kelvin", "acquire". Returns what was done, or that the command was not understood.',
  inputSchema: { text: z.string().min(1).max(300) },
}, safe(async ({ text: t }) => text(await call('command', { text: t }))));

server.registerTool('exhibit_acquire', {
  title: 'Acquire from the exhibit',
  description: 'Record what the live detectors show, like the Acquire button. Returns the detector image(s) and the settings; with save=true also writes the data (.npz) and images (.png) to disk and returns their paths, ready for analysis skills.',
  inputSchema: { save: z.boolean().optional() },
}, safe(async ({ save }) => {
  const r = await call('acquire', { data: !!save }, 30000);
  const content = [{ type: 'text', text: JSON.stringify({ id: r.id, mode: r.mode, specimen: r.spec, settings: r.summary }, null, 2) }];
  for (const png of [r.png, r.png2].filter(Boolean)) content.push({ type: 'image', data: png.split(',')[1], mimeType: 'image/png' });
  if (save) {
    mkdirSync(OUT, { recursive: true });
    const base = join(OUT, `exhibit-${r.mode}-${r.id}-${Date.now()}`), files = {};
    if (r.npz) { writeFileSync(`${base}.npz`, Buffer.from(r.npz, 'base64')); files.npz = `${base}.npz`; }
    if (r.png) { writeFileSync(`${base}.png`, Buffer.from(r.png.split(',')[1], 'base64')); files.png = `${base}.png`; }
    content.push({ type: 'text', text: JSON.stringify({ saved: files }) });
  }
  return { content };
}));

server.registerTool('exhibit_analyze', {
  title: 'Analyze what the exhibit shows',
  description: 'Measure the live data and compare with the true settings: fit_ctf (defocus and astigmatism from Thon rings; emskills ctf-fitter), fit_lattice (indexed d-spacings from diffraction; emskills lattice-dspacing), identify_edges (EELS core-loss edges; emskills eels-edge-id), fit_eds (EDS peaks and resolution), fit_zlp (energy spread), fit_hologram (fringe spacing and contrast). Omit name to pick by mode.',
  inputSchema: { name: z.enum(Object.keys(ANALYSES)).optional() }, annotations: { readOnlyHint: true },
}, safe(async ({ name }) => text(await call('analyze', { name }))));

server.registerTool('exhibit_say', {
  title: 'Speak through the exhibit',
  description: 'Show a caption and say it aloud in the exhibit (the browser\'s speech voice). Use it to answer the visitor\'s spoken questions. Keep it to two or three short sentences.',
  inputSchema: { text: z.string().min(1).max(600) },
}, safe(async ({ text: t }) => text(await call('say', { text: t }))));

server.registerTool('exhibit_wait_for_voice', {
  title: 'Wait for the visitor to speak',
  description: 'Wait for the next thing the visitor says that is not a built-in command (usually a question), up to timeout_s seconds. Answer it with exhibit_say, and act with exhibit_set / exhibit_action if they asked for something.',
  inputSchema: { timeout_s: z.number().min(1).max(600).optional() }, annotations: { readOnlyHint: true },
}, safe(async ({ timeout_s = 60 }) => {
  if (utterances.length) return text(utterances.shift());
  if (!page) throw new Error('No exhibit is connected.');
  const u = await new Promise((res) => { const t = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); res(null); }, timeout_s * 1000); const w = (v) => { clearTimeout(t); res(v); }; waiters.push(w); });
  return text(u ?? { text: null, note: `nothing said in ${timeout_s} s` });
}));

await server.connect(new StdioServerTransport());
log('ready (stdio)');
