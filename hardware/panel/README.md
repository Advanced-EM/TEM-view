# TEM-view Panel

A physical control panel for the exhibit, laid out like the hand panels of a transmission electron microscope: focus, magnification and intensity knobs, a pair of multifunction knobs (stigmator, image shift or tilt), a stage joystick and mode buttons. It plugs in over USB and works in any browser with the Gamepad API, with no drivers.

**Status:** reference design. The browser side is implemented and tested with emulated input and game controllers. The firmware's decoding logic is unit-tested on a computer. **No panel has been built yet**, and the firmware has not been compiled for the board.

**Prototype enclosure:** a parametric, 3D-printable case for this layout, with print files, parts list, wiring and assembly steps, is in [`enclosure/`](enclosure/README.md). There is also a [3D viewer](enclosure/viewer.html).

## How it talks to the exhibit

The panel is a USB HID joystick whose product name contains **`TEM-view Panel`**, which is how the exhibit recognizes it. Each report has 8 signed 16-bit axes and 16 buttons.

| Axis | Control | Encoding |
| --- | --- | --- |
| 0 | Stage joystick X | absolute, centered at 0 |
| 1 | Stage joystick Y | absolute, centered at 0 |
| 2 | Focus encoder | running counter, wraps in [−32767, 32767] |
| 3 | Magnification (camera length in diffraction) | running counter |
| 4 | Intensity (dose) | running counter |
| 5 | Multifunction X | running counter |
| 6 | Multifunction Y | running counter |
| 7 | Context knob | running counter |

Encoders are sent as counters rather than per-report changes, so a browser that polls slower than the panel reports (every 2 ms) never loses steps. The exhibit takes the change between polls, handles the wrap, and divides by the counts per detent (4 by default, adjustable in the panel dialog).

| Button | Function | Button | Function |
| --- | --- | --- | --- |
| 0 | Previous mode | 8 | Labels |
| 1 | Next mode | 9 | Narration |
| 2 | Multifunction: stigmator → image shift → tilt | 10 | Enlarge results |
| 3 | Focus wobbler | 11 | Calibration dialog |
| 4 | Focus fine / coarse (focus encoder push) | 12 | Acquire |
| 5 | Optimal focus | 13–15 | spare |
| 6 | Pause beam | | |
| 7 | Educational / realistic | | |

What the knobs do depends on the mode:
- **Focus:** one detent is 0.2 nm with a corrector, 1 nm without, or 10 nm for the cryo-EM specimen; coarse steps are 5× larger.
- **Magnification:** zooms the image. In diffraction and CBED it changes the camera length instead, as on a real console.
- **Context knob:**
  - convergence angle in STEM, 4D-STEM, EDS and EELS
  - selected area in SAED
  - CBED convergence, the Ronchigram aperture, biprism voltage, or the focal step
  - in TEM, the temperature setpoint when a cryo or heating holder is fitted; otherwise fine focus

Every assignment, inversion and sensitivity can be changed in the exhibit (the gamepad icon in the Controls header), and is saved in that browser. Ordinary game controllers work too: sticks for the stage and multifunction knobs, triggers for focus, bumpers for magnification, d-pad for intensity and mode.

## Electronics

| Part | Qty | Notes | Rough cost (USD, small batch) |
| --- | --- | --- | --- |
| Raspberry Pi Pico (RP2040) | 1 | USB, 26 GPIO, 3 ADC inputs | 4–6 |
| Rotary encoder with push switch, 20 detents | 6 | e.g. 24-step mechanical; optical for the focus knob is nicer | 1–3 each (optical 15–30) |
| Two-axis analog joystick or thumbstick | 1 | potentiometer type; a trackball is a possible upgrade | 3–15 |
| Tactile or arcade-style buttons | 10 | | 0.2–2 each |
| 1N4148 diodes | 16 | anti-ghosting in the button matrix | 0.02 each |
| Knobs (aluminum, 20–40 mm) | 6 | a large knob for focus | 1–4 each |
| PCB (2-layer, ~200 × 100 mm) | 1 | | 3–10 |
| Enclosure | 1 | 3D printed (prototype), CNC aluminum or molded (production) | 10–80 |
| USB-C connector, cable | 1 | | 2–5 |

Estimated parts cost per panel: about 60–120 USD in batches of a few hundred, depending mostly on the enclosure and knobs.

### Pin map (Pico)

| Signal | Pins |
| --- | --- |
| Encoders A / B (focus, magnification, intensity, MF-X, MF-Y, context) | GP0/GP1, GP2/GP3, GP4/GP5, GP6/GP7, GP8/GP9, GP10/GP11 |
| Button matrix rows (outputs) | GP12–GP15 |
| Button matrix columns (inputs, pull-up) | GP16–GP19 |
| Joystick X / Y | GP26 (ADC0) / GP27 (ADC1), potentiometers between 3V3 and AGND |

Each encoder's common pin goes to GND (its A and B inputs use the RP2040's internal pull-ups); the encoders' push switches are wired into the button matrix like the other buttons, with a diode each. If a knob turns the wrong way, swap its A and B wires or tick "invert" in the panel dialog.

## Firmware

`firmware/tem_view_panel/tem_view_panel.ino` is the reference firmware.

1. Install the Arduino IDE (or `arduino-cli`).
2. Add the Raspberry Pi Pico core by Earle Philhower.
3. Install the **Adafruit TinyUSB** library.
4. Select **Tools → USB Stack → Adafruit TinyUSB**, then build and upload.

It decodes the encoders with a quadrature table, which rejects contact bounce. It scans and debounces the button matrix, centers the joystick at power-up, and sends a report every 2 ms.

The USB vendor/product ID is the pid.codes test pair (0x1209 / 0x0001), which is only for development. Request a dedicated product ID from pid.codes (free for open hardware) before distributing panels.

## Without hardware

The exhibit's **on-screen panel** (key `V`, or the panel dialog) has the same knobs and buttons, driven by keyboard, mouse or touch, and can pop out into its own window. It is a quick way to try the layout before building one, and a fallback for visitors without a panel.

## Testing a panel

1. Open the exhibit, click the gamepad icon in the Controls header, and press any button on the panel: browsers only reveal a controller after it has been used.
2. In **Live input**, each knob should move one axis bar and each button should light one number.
3. Turn the focus knob in TEM mode: the defocus should change in steps of 0.2 nm (fine) or 1 nm (coarse) with the corrector on.
4. A heads-up display appears at the top of the 3D view while the panel is connected. It shows the multifunction mode and the last change.

## Licensing

The licenses for the hardware and the firmware are still to be decided; until then, see [LICENSE](../../LICENSE).
