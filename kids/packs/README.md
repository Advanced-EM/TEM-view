# Sample packs

A sample pack adds a sample to Electron Explorer without code: a folder here with a `pack.json` and its images,
and an entry in `index.json`. Staff turn packs on or off in the staff menu. The example is `diatom/`.

```json
[ { "id": "diatom", "path": "diatom/pack.json", "default": true } ]
```

`default: true` turns the pack on until the staff menu says otherwise.

## pack.json

Lengths are in **nanometres**; the sample is centred on (0, 0). Every text is an object with one entry per
language, `{ "en": …, "es": …, "pt": …, "fr": …, "de": … }`; a missing language falls back to English. Texts may
use `<b>…</b>`.

| Field | Meaning |
| --- | --- |
| `id` | Short name, letters and dashes. |
| `icon` | One emoji for the sample button. |
| `name`, `blurb` | The button's name, and what Zip says when the sample is chosen. |
| `credit` | Where the images come from (and their license, for real micrographs). |
| `fovMax`, `fovMin` | Widest and narrowest view, in nm. |
| `start` | `{ "cx", "cy", "fov" }`: where a visitor starts. |
| `bound` | How far from the centre the view may move, in nm. |
| `soft` | `true` if a strong beam should "cook" it (biological samples). |
| `background` | `{ "color", "mono" }`: the colour around the sample, in cartoon and grey modes. |
| `layers` | Images, drawn in order: `{ "src", "x", "y", "width", "height", "minFov", "maxFov" }`. `x`, `y` are the image's centre and `width` its width, in nm (`height` defaults to `width`). A layer shows only between `minFov` and `maxFov`, and fades in over the last 40 % of its range, so finer layers appear as you zoom. |
| `what` | What Zip says you are looking at, by default. |
| `regions` | `{ "x", "y", "r", "maxFov", "what" }`: a more specific answer near (x, y), within r nm, when zoomed in at least to `maxFov`. The first match wins, so list the smallest first. |
| `mission` | Optional: `{ "icon", "title", "text", "win", "target": [x, y], "maxFov", "r" }`. The visitor must snap a picture centred within `r` (or 30 % of the view) of `target`, zoomed in to `maxFov` or closer. |

## Images

- **SVG** stays sharp at any zoom; `diatom/make_svgs.py` draws the example's three layers from one geometry, so they
  line up.
- **Real micrographs** (PNG or JPEG) work well as three layers: the whole object, a detail, and the finest detail,
  each placed at its true size and position. A grey image is shown in grey in every colour mode; you may draw a
  coloured version for the cartoon mode as its own layer.
- Keep each image under about 2 MB and 4000 pixels across, so kiosks and phones load it quickly.

## Voices and translations

Zip reads pack texts aloud like the built-in ones. `node tools/narrate-kids.mjs` records them for every language
and voice; until then, the computer's own voice reads them.
