# TEM-view → Hugging Face

How training sessions from the exhibit become a Hugging Face dataset for machine learning.

```
exhibit (browser)                         Hugging Face
  training scenario, opt-in recording
  ├─ Download session file ──► you ──► hf/build_dataset.py --push ──┐
  └─ Send (second consent) ──► Space: hf/space (validates) ──► raw/ ─┤  dataset repo (private)
                                                                    └─ data/sessions.jsonl, data/steps.jsonl, README.md
```

The browser never holds a Hugging Face token. Every path goes through the same validator
([`space/schema.py`](space/schema.py)). It keeps only known fields, requires recorded consent, cuts free text to
140 characters, rounds the start time to the hour and the screen size to 100 px, and stores no IP addresses.

## 1. Pilot: files collected by hand (no server)

```bash
pip install huggingface_hub datasets
hf auth login                      # a token with write access
python3 hf/build_dataset.py pilot/*.json --out build/tem-view-alignment --push rmsreis/tem-view-alignment
```

This creates the dataset **private** (pass `--public` to change that later, or flip it on the Hub). To push
under the Northwestern organization, use `Northwestern/tem-view-alignment`. Run the same command again whenever
new files arrive. Duplicate sessions are kept once, and invalid files are listed and skipped.

## 2. Live collection: the Space (after ethics approval)

1. Create the dataset (step 1), or let the Space create it.
2. Create a Space with **SDK: Docker** (e.g. `rmsreis/tem-view-collector`) and upload this folder:
   ```bash
   hf upload rmsreis/tem-view-collector hf/space . --repo-type space
   ```
3. In the Space settings:
   - add the secret `HF_TOKEN`, a fine-grained token with write access to **that dataset only**
   - add the variable `DATASET_REPO=rmsreis/tem-view-alignment`
   - optionally set `ALLOWED_ORIGINS` (default `https://advanced-em.github.io`) and `RATE_PER_HOUR` (default 30)
4. Check `https://rmsreis-tem-view-collector.hf.space/`. It should report `"dry_run": false`.
5. In [`js/config.js`](../js/config.js), set
   `url: 'https://rmsreis-tem-view-collector.hf.space/submit', dataset: 'rmsreis/tem-view-alignment'`.
   Then run `node tools/stamp.mjs` and deploy.

From then on, the result screen of a recorded scenario offers **Share with the research dataset**:
- The visitor ticks a consent box and presses Send.
- The Space writes `raw/<scenario>/<id>.json` and commits new files to the dataset every 5 minutes.
- The visitor gets the session id, which they can quote to have the session removed.

The Space stores only raw files. Rebuild the tables from them now and then:

```bash
python3 hf/build_dataset.py --from-hub rmsreis/tem-view-alignment --out build/tem-view-alignment --push rmsreis/tem-view-alignment
```

## 3. Training

```python
from datasets import load_dataset
steps = load_dataset("rmsreis/tem-view-alignment", "steps", split="train")      # state, true metrics, actions
sessions = load_dataset("rmsreis/tem-view-alignment", "sessions", split="train")  # outcome, rating vs truth
```

- **Imitation:** learn `state → next actions` from successful sessions, by experience level.
- **Reward / judgment models:** predict the true `score` from what the user saw, and model when people stop (`rating` vs `final_score`).
- **Strategy mining:** the order of operations (stigmate → focus, C1/A1 → B2/A2 → C3/A3) and time to success.

The models can then be published as model repos linked to the dataset. Note that `state`, `metrics` and the action
values are stored as JSON text, so every column keeps one type across scenarios; decode them with `json.loads`.

## Local test

```bash
python3 -m venv .venv && .venv/bin/pip install -r hf/space/requirements.txt
DATA_DIR=/tmp/collector ALLOWED_ORIGINS=http://localhost:8765 .venv/bin/python -m uvicorn --app-dir hf/space app:app --port 7861
```

Then set `url: 'http://localhost:7861/submit'` in `js/config.js` while testing. Without `HF_TOKEN` the Space
runs as a dry run and only writes files locally.
