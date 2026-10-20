---
title: TEM-view session collector
emoji: 🔬
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: other
short_description: Receives opt-in TEM-view training sessions for a dataset
---

# TEM-view session collector

Receives training sessions that visitors of [Seeing with Electrons](https://advanced-em.github.io/TEM-view/)
chose to share, validates them, and commits them to a dataset repo (`raw/<scenario>/<id>.json`) every 5 minutes.

- `POST /submit`: one session (`tem-view-telemetry/1` JSON). Returns its id.
- `GET /`: status and counts.

Settings: secret `HF_TOKEN` (write access to the dataset), variables `DATASET_REPO` and `ALLOWED_ORIGINS`.
Without them it runs as a dry run and keeps nothing on the Hub. No IP addresses are stored.
Source: `hf/space/` in the [TEM-view repository](https://github.com/Advanced-EM/TEM-view).
