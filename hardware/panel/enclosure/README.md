# TEM-view Console: prototype enclosure

A 3D-printable enclosure for the first working Console. It uses the same layout as the
[concept model](../README.md), built from off-the-shelf parts. It is the prototype that the campaign video needs.

- **Look at it:** [`viewer.html`](viewer.html) shows the assembly in 3D, with an exploded view. It is online at
  `https://advanced-em.github.io/TEM-view/hardware/panel/enclosure/viewer.html`, or locally with `python3 -m http.server`.
- **Print it:** the files in [`stl/`](stl).
- **Change it:** [`console.py`](console.py) is the parametric model. Every dimension is a named parameter at the top.
  Run it again to rebuild the STLs and `assembly.glb`. It also checks that no two parts overlap:
  ```bash
  pip install manifold3d trimesh numpy scipy
  python3 hardware/panel/enclosure/console.py
  ```

**Status:** generated and checked in software: all parts are watertight and the assembled parts don't overlap.
Nothing has been printed yet. Before the first print, check the parameters marked **MEASURE** in `console.py`
against your parts.

## Parts to print

| File | Qty | Material | Orientation | Notes |
| --- | --- | --- | --- | --- |
| `top_plate.stl` | 1 | black PETG or PLA, or smoked translucent PETG | face down, as exported | 210 × 120 mm; the bosses and posts grow upward. A textured sheet gives the top a matte finish |
| `base.stl` | 1 | black PETG or PLA | upright | the wall slots bridge without support |
| `focus_dial.stl` | 1 | black PETG or PLA | open side down | drop steel washers (M8–M10) into the ring cavity for weight, glue in place |
| `knob.stl` | 5 | black PETG or PLA | open side down | |
| `diffuser_ring.stl` | 1 | clear or natural PETG | flange down | sits in the slot around the dial, over the LED ring |
| `light_bar.stl` | 1 | clear or natural PETG | flat, ribs up | its ribs push into the front slots from inside |

Suggested settings: 0.2 mm layers (0.12 mm for the knobs), 3 walls, 20% infill, no supports. Everything fits a
220 × 220 mm bed. Printing the top plate and base takes roughly 6–9 hours together.

## Electronics for the prototype

| Part | Qty | Notes | Approx. USD |
| --- | --- | --- | --- |
| Pico-format RP2350 board with USB-C (e.g. Pimoroni Pico Plus 2) | 1 | mounts on the base standoffs, USB-C at the back | 10–15 |
| EC11 rotary encoder with push switch, 20 detents, 15 mm D-shaft | 6 | focus dial and five knobs; file off the locating tab, trim the shaft if a knob sits high | 1–2 each |
| MX-compatible switches (e.g. Gateron) and blank 1u keycaps (DSA or XDA, black) | 8 | clip into the plate; legends can be added with UV printing or vinyl | 10 |
| MCP23017 I/O expander breakout | 1 | reads the 8 keys and 6 encoder push switches over I²C, no matrix or diodes | 3 |
| Thumbstick module (KY-023 style, later a Hall-effect stick) | 1 | on the four posts; **MEASURE** its hole spacing first | 2 |
| Adafruit NeoPixel Ring, 24 LEDs | 1 | under the diffuser ring | 15 |
| WS2812B strip, about 10 LEDs | 1 | behind the front light bar, chained after the ring | 3 |
| 0.91" 128 × 32 I²C OLED (SSD1306) | 1 | glass in the pocket under the window; hold with a dab of hot glue | 3 |
| INMP441 I²S microphone (round board) | 2 | pressed against the grilles, foam gasket around the port | 3 each |
| SS12D00 slide switch | 1 | back wall; in series with the microphones' 3.3 V, so muting cuts their power | 0.5 |
| 3 mm red/blue LED and resistors | 1 | microphone status light | 0.5 |
| M3 heat-set inserts and M3 × 8 countersunk screws | 6 | from below into the plate bosses | 3 |
| M2.5 inserts or screws for the joystick, M2 self-tapping screws for the board | 4 + 4 | | 1 |
| Rubber feet, 10 mm | 4 | in the recesses under the base | 1 |
| Steel washers for the dial | 4–6 | weight and a smoother feel | 1 |

Electronics come to about **$80–100** for one prototype, plus about $10 of filament.

## Wiring and pins

The RP2350 has enough pins once the keys go through the MCP23017:

| Function | Pins |
| --- | --- |
| 6 encoders (A/B) | 12 GPIO |
| Joystick X/Y | 2 ADC |
| I²C: MCP23017 (0x20) and OLED (0x3C) | 2 |
| NeoPixel ring, then the front strip | 1 |
| I²S microphones (BCLK, LRCLK, DATA; one mic set to left, one to right) | 3 |
| Mic status LED (red/blue) | 2 |
| **Total** | **22 of 26** |

The reference firmware in [`../firmware`](../firmware) still scans a 4 × 4 button matrix. It needs these
updates for this wiring:
- read the keys from the MCP23017
- drive the LEDs and the display
- add the USB microphone

## Assembly

1. Press the heat-set inserts into the six plate bosses and the four joystick posts. Use a soldering iron at about 220 °C.
2. Fit the diffuser ring from below, flange under the plate. Glue the NeoPixel ring under it with its LEDs centered in the slot.
3. Clip the MX switches into the plate. Mount the encoders with their nuts from above.
4. Place the OLED glass in its pocket and the microphones against the grilles. Screw the joystick module to its posts.
5. Wire everything to the board (pins above). Mount the board on the base standoffs, USB-C through the back wall.
6. Push the light bar into the front slots from inside, with the LED strip behind it. Fit the mute switch in the back wall.
7. Lower the plate onto the base (the lip locates it). Fix it with six M3 screws from below. Stick on the feet.
8. Push on the knobs and the focus dial, then the keycaps.

## Differences from the concept

- **Focus dial:** 52 mm here instead of 58 mm, so that the off-the-shelf 24-LED ring shows around it. A custom ring PCB
  in production allows the larger dial.
- **Keys:** use MX switches with standard keycaps, so the key spacing is 21 mm.
- **Joystick:** a potentiometer thumbstick for now. The Hall-effect stick in the target specs fits the same posts
  once its mounting holes are measured.
