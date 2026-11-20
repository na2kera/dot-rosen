#include "led.h"

#include "config.h"

namespace led {

static State state = State::Booting;
static uint32_t failUntil = 0;
static bool fault = false;
static uint32_t lastColor = 0xFFFFFFFF;

static void write(uint8_t r, uint8_t g, uint8_t b) {
  const uint32_t c = (static_cast<uint32_t>(r) << 16) | (static_cast<uint32_t>(g) << 8) | b;
  if (c == lastColor) return;
  lastColor = c;
  // Arduino-ESP32 2.0.x の neopixelWrite（esp32-hal-rgb-led.h）。WS2812 互換の GRB 順で送る。
  // SK6812 も同じ並び（未確認だが一般的な仕様）。色がずれたら並びを確認する。
  neopixelWrite(LED_PIN, r, g, b);
}

static uint8_t lv(uint8_t on) { return on ? LED_BRIGHTNESS : 0; }

void begin() {
  lastColor = 0xFFFFFFFF;
  write(0, 0, 0);
}

void set(State s) {
  state = s;
  tick();
}

State get() { return state; }

void showFailure() {
  failUntil = millis() + LED_FAIL_MS;
  if (failUntil == 0) failUntil = 1;
  tick();
}

void setFault(bool on) {
  fault = on;
  tick();
}

void tick() {
  const uint32_t now = millis();
  if (fault) {
    write(LED_BRIGHTNESS, 0, 0);
    return;
  }
  if (failUntil != 0) {
    if (static_cast<int32_t>(failUntil - now) > 0) {
      write(LED_BRIGHTNESS, 0, 0);
      return;
    }
    failUntil = 0;
  }
  const bool blinkOn = ((now / LED_BLINK_MS) & 1) == 0;
  switch (state) {
    case State::Booting: write(0, 0, lv(blinkOn)); break;
    case State::Idle: write(0, LED_BRIGHTNESS, 0); break;
    case State::Printing: write(LED_BRIGHTNESS, LED_BRIGHTNESS, LED_BRIGHTNESS); break;
    case State::WifiDown: write(lv(blinkOn), 0, 0); break;
    case State::ServerError: write(LED_BRIGHTNESS, LED_BRIGHTNESS, 0); break;
  }
}

}  // namespace led
