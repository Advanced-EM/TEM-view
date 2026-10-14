// TEM-view Panel: reference firmware
//
// Board:     Raspberry Pi Pico (RP2040), Arduino-Pico core (earlephilhower) with "USB Stack: Adafruit TinyUSB"
// Library:   Adafruit TinyUSB Library
// Device:    USB HID joystick "TEM-view Panel": 8 × 16-bit axes, 16 buttons (see ../../README.md)
//
//   axis 0, 1  stage joystick X, Y (absolute, centered at 0)
//   axis 2–7   rotary encoders: focus, magnification, intensity, multifunction X, multifunction Y, context.
//              Each is a running counter in [−32767, 32767] that wraps; the browser reads the change per poll.
//   buttons    a 4 × 4 matrix (encoder push switches included), mapping in the README
//
// Status: reference design, not yet built or tested on hardware.

#include <Adafruit_TinyUSB.h>

// ------------------------------------------------------------------ pins
// Encoders A/B: GP0–GP11 (6 encoders × 2), with the RP2040's internal pull-ups
const uint8_t ENC_A[6] = {0, 2, 4, 6, 8, 10};
const uint8_t ENC_B[6] = {1, 3, 5, 7, 9, 11};
// Button matrix: rows driven low one at a time, columns read with pull-ups (add a 1N4148 per switch for
// anti-ghosting if several buttons may be held at once)
const uint8_t ROWS[4] = {12, 13, 14, 15};
const uint8_t COLS[4] = {16, 17, 18, 19};
// Joystick (two potentiometers): ADC0 = GP26 (X), ADC1 = GP27 (Y)
const uint8_t JOY_X = 26, JOY_Y = 27;

// ------------------------------------------------------------------ USB HID
// Report descriptor: Generic Desktop Joystick, 8 axes (X Y Z Rx Ry Rz Slider Dial) as int16, then 16 buttons.
uint8_t const desc_hid_report[] = {
  0x05, 0x01,        // Usage Page (Generic Desktop)
  0x09, 0x04,        // Usage (Joystick)
  0xA1, 0x01,        // Collection (Application)
  0x05, 0x01,        //   Usage Page (Generic Desktop)
  0x09, 0x30, 0x09, 0x31, 0x09, 0x32, 0x09, 0x33,  // Usage X, Y, Z, Rx
  0x09, 0x34, 0x09, 0x35, 0x09, 0x36, 0x09, 0x37,  // Usage Ry, Rz, Slider, Dial
  0x16, 0x01, 0x80,  //   Logical Minimum (−32767)
  0x26, 0xFF, 0x7F,  //   Logical Maximum (32767)
  0x75, 0x10,        //   Report Size (16)
  0x95, 0x08,        //   Report Count (8)
  0x81, 0x02,        //   Input (Data, Variable, Absolute)
  0x05, 0x09,        //   Usage Page (Button)
  0x19, 0x01,        //   Usage Minimum (1)
  0x29, 0x10,        //   Usage Maximum (16)
  0x15, 0x00,        //   Logical Minimum (0)
  0x25, 0x01,        //   Logical Maximum (1)
  0x75, 0x01,        //   Report Size (1)
  0x95, 0x10,        //   Report Count (16)
  0x81, 0x02,        //   Input (Data, Variable, Absolute)
  0xC0               // End Collection
};

struct __attribute__((packed)) Report {
  int16_t axes[8];
  uint16_t buttons;
};

Adafruit_USBD_HID usb_hid;
Report report = {};

// ------------------------------------------------------------------ encoders
// Quadrature decoding by table lookup: index = (previous AB << 2) | current AB → −1, 0 or +1.
// Invalid transitions (both lines changed) count as 0, which rejects most contact bounce.
const int8_t QDEC[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
uint8_t encState[6];
int32_t encCount[6];

static inline uint8_t readAB(int i) { return (digitalRead(ENC_A[i]) << 1) | digitalRead(ENC_B[i]); }

void pollEncoders() {
  for (int i = 0; i < 6; i++) {
    uint8_t ab = readAB(i);
    encCount[i] += QDEC[(encState[i] << 2) | ab];
    encState[i] = ab;
  }
}

// Wrap a running count into the reported range [−32767, 32767] (period 65535).
static inline int16_t wrap16(int32_t c) {
  int32_t m = ((c % 65535) + 65535) % 65535;  // 0 … 65534
  return (int16_t)(m > 32767 ? m - 65535 : m);
}

// ------------------------------------------------------------------ joystick
int joyCenter[2];
int16_t readJoy(uint8_t pin, int center) {
  int v = analogRead(pin) - center;            // 12-bit ADC, about ±2048 around the center
  long s = (long)v * 32767 / 1900;             // full deflection ≈ full scale
  return (int16_t)constrain(s, -32767, 32767);  // the browser applies its own dead zone
}

// ------------------------------------------------------------------ buttons
uint16_t scanMatrix() {
  uint16_t b = 0;
  for (int r = 0; r < 4; r++) {
    digitalWrite(ROWS[r], LOW);
    delayMicroseconds(5);
    for (int c = 0; c < 4; c++) if (!digitalRead(COLS[c])) b |= 1u << (r * 4 + c);
    digitalWrite(ROWS[r], HIGH);
  }
  return b;
}
// simple debounce: a button state must hold for 3 consecutive scans (≈ 6 ms)
uint16_t stable = 0, last = 0;
uint8_t same = 0;

// ------------------------------------------------------------------ setup / loop
void setup() {
  TinyUSBDevice.setID(0x1209, 0x0001);  // pid.codes test PID: request a dedicated PID before shipping
  TinyUSBDevice.setManufacturerDescriptor("Advanced-EM");
  TinyUSBDevice.setProductDescriptor("TEM-view Panel");
  usb_hid.setReportDescriptor(desc_hid_report, sizeof(desc_hid_report));
  usb_hid.setPollInterval(2);  // ms
  usb_hid.begin();
  if (TinyUSBDevice.mounted()) { TinyUSBDevice.detach(); delay(10); TinyUSBDevice.attach(); }

  for (int i = 0; i < 6; i++) { pinMode(ENC_A[i], INPUT_PULLUP); pinMode(ENC_B[i], INPUT_PULLUP); }
  for (int r = 0; r < 4; r++) { pinMode(ROWS[r], OUTPUT); digitalWrite(ROWS[r], HIGH); }
  for (int c = 0; c < 4; c++) pinMode(COLS[c], INPUT_PULLUP);
  analogReadResolution(12);
  delay(20);
  for (int i = 0; i < 6; i++) encState[i] = readAB(i);
  joyCenter[0] = analogRead(JOY_X);  // the stick must be at rest at power-up
  joyCenter[1] = analogRead(JOY_Y);
}

uint32_t lastSend = 0;

void loop() {
  pollEncoders();  // as often as possible: fast knob turns produce ~1 kHz transitions

  uint32_t now = micros();
  if (now - lastSend < 2000) return;  // report every 2 ms
  lastSend = now;

  uint16_t b = scanMatrix();
  if (b == last) { if (same < 3) same++; } else { same = 0; last = b; }
  if (same >= 3) stable = b;

  report.axes[0] = readJoy(JOY_X, joyCenter[0]);
  report.axes[1] = readJoy(JOY_Y, joyCenter[1]);
  for (int i = 0; i < 6; i++) report.axes[2 + i] = wrap16(encCount[i]);
  report.buttons = stable;

  if (TinyUSBDevice.mounted() && usb_hid.ready()) usb_hid.sendReport(0, &report, sizeof(report));
}
