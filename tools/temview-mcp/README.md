# temview-mcp

An MCP server that lets an AI agent use the TEM-view digital twin, for example an
[emskills](https://emskills.org) agent, Claude, or any MCP client.

- **Headless:** `simulate` runs the simulator in Node, with no browser, and writes the detector data as NumPy
  `.npz` with `metadata.json` (calibrations, optics, state). The output is ready for analysis skills such as
  ctf-fitter, lattice-dspacing or eels-edge-id.
- **Live:** an open exhibit connects to the server after the visitor clicks **Connect agent** (Controls → Voice
  and agent). The agent can then:
  - read the microscope
  - change settings
  - acquire images and data
  - speak through the exhibit
  - hear the visitor's spoken questions

## Install

```bash
cd tools/temview-mcp && npm install
claude mcp add temview -- node "$PWD/server.mjs"
```

That example uses Claude Code; other MCP clients use the same command over stdio. Then open the exhibit
(<https://advanced-em.github.io/TEM-view/> or a local copy) and click **Connect agent**.

| Variable | Default | |
| --- | --- | --- |
| `TEMVIEW_PORT` | 8790 | local WebSocket port for the exhibit (bound to 127.0.0.1 only). The exhibit tries 8790, then 8791 |
| `TEMVIEW_ORIGINS` | `https://advanced-em.github.io` | sites allowed to connect, besides localhost |
| `TEMVIEW_OUT` | `./temview-out` | where simulations and saved acquisitions go |

Each AI client starts its own copy of the server, and only one copy can hold a port. With two clients running, the
exhibit joins whichever server holds 8790; start a second client with `TEMVIEW_PORT=8791`, or run one at a time.
The full setup, with Claude, OpenAI Codex, Ollama and emskills, is in
[SOP-03](../../docs/guides/pdf/sop-03-ai-agents.pdf).

## Tools

| Tool | What it does |
| --- | --- |
| `simulate` | Headless acquisition. Arguments: mode, specimen, kV, defocus, field of view, dose, thickness, corrector, holder, temperature, realistic, and optionally `analysis`. Writes `.npz` |
| `exhibit_status` | Whether an exhibit is connected, and what it shows (mode, specimen, optics, temperature, Scherzer defocus, training task) |
| `exhibit_set` | Change settings: mode, specimen, kV, defocus, field, dose, corrector, holder, temperature, view |
| `exhibit_action` | `optimal_focus`, `autotune`, `blank_beam`, `unblank_beam`, `wobbler`, `narrate` |
| `exhibit_command` | Run a plain-language command with the exhibit's voice grammar ("load graphene and acquire") |
| `exhibit_acquire` | Acquire. Returns the detector images; with `save` also writes `.npz` and `.png` |
| `exhibit_analyze` | Measure the live data and compare with the truth: `fit_ctf` (emskills ctf-fitter), `fit_lattice` (lattice-dspacing), `identify_edges` (eels-edge-id), `fit_eds`, `fit_zlp`, `fit_hologram` |
| `exhibit_say` | Show a caption and say it aloud in the exhibit |
| `exhibit_wait_for_voice` | Wait for the visitor's next spoken question (anything the voice grammar does not handle) |

A simple voice-assistant loop:
1. Call `exhibit_wait_for_voice`.
2. Answer with `exhibit_say`.
3. Act with `exhibit_set` or `exhibit_action` when the visitor asks for something.
4. Repeat.

## Safety

- The WebSocket listens on 127.0.0.1 only and accepts only the exhibit's site and localhost.
- The exhibit connects only when the visitor clicks, and shows that an agent is connected.
- The exhibit refuses changes while a training task is running, so recorded behavior stays the visitor's own.
- Nothing here controls a real microscope.

## Test

```bash
node test.mjs
```

`node test.mjs` checks the headless part. `node test.mjs --live` also drives an open exhibit: click **Connect
agent** within 90 s.
