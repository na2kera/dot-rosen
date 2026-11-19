// ドット路線メーカー: 感熱プリンタ（M5Stack ATOM Printer K118 / ATOM Lite）のファーム
#include <Arduino.h>
#include <WiFi.h>

#include "app_state.h"
#include "config.h"
#include "led.h"
#include "printer.h"
#include "rosen_core.h"
#include "secrets_select.h"
#include "server.h"

using namespace rosen;

static const bool kWifiConfigured = sizeof(WIFI_SSID) > 1;

static bool wifiEverConnected = false;
static bool wifiWasConnected = false;
static uint32_t lastWifiAttempt = 0;
static uint32_t lastPoll = 0;

// ---------------------------------------------------------------------------
// テスト印刷
// ---------------------------------------------------------------------------
static void runPattern(Pattern p) {
  const led::State prev = led::get();
  led::set(led::State::Printing);
  String err;
  const bool ok = printer::printPattern(p, err);
  led::set(prev);
  if (!ok) {
    app::setLastError(String("test_") + static_cast<int>(p) + "_" + err);
    led::showFailure();
  }
  Serial.println(ok ? "DONE" : (String("ERR ") + err).c_str());
}

// ---------------------------------------------------------------------------
// USB シリアル
// ---------------------------------------------------------------------------
static bool usbReader(void* ctx, uint32_t offset, uint16_t rows, uint8_t* buf, String& err) {
  (void)ctx;
  (void)offset;
  const size_t len = static_cast<size_t>(rows) * kRowBytes;
  Serial.printf("READY %u\n", static_cast<unsigned>(len));
  size_t got = 0;
  uint32_t last = millis();
  while (got < len) {
    const int avail = Serial.available();
    if (avail > 0) {
      got += Serial.readBytes(buf + got, min(static_cast<size_t>(avail), len - got));
      last = millis();
      continue;
    }
    if (millis() - last > USB_READ_TIMEOUT_MS) {
      err = "usb_timeout";
      return false;
    }
    led::tick();
    delay(1);
  }
  return true;
}

static void cmdStatus() {
  if (!kWifiConfigured) {
    Serial.println("WIFI not_configured");
  } else if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("WIFI connected ssid=%s ip=%s rssi=%d\n", WiFi.SSID().c_str(),
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.printf("WIFI disconnected status=%d\n", static_cast<int>(WiFi.status()));
  }
  Serial.printf("SERVER %s http=%d url=%s tls=%s\n", server::healthName(server::health()),
                server::lastHttpCode(), SERVER_URL, TLS_VERIFY ? "verify" : "insecure");
  Serial.printf("PRINTER baud=%lu cts_g19=%d use_cts=%d\n",
                static_cast<unsigned long>(printer::baud()), printer::ctsLevel(),
                PRINTER_USE_CTS);
  Serial.printf("LAST_ERROR %s\n", app::lastError().c_str());
}

static String hexOrNone(int v) {
  if (v < 0) return "none";
  char b[12];
  snprintf(b, sizeof(b), "0x%02X", v);
  return b;
}

static void cmdPaper() {
  // 命令一覧 PDF の DLE EOT 2 / DLE EOT 4（1.40）と GS r 1（1.25）を送る。
  // 公式リポジトリの ATOM_PRINTER_CMD.h には状態問い合わせの命令は無い。
  const int e2 = printer::queryDleEot(2);
  const int e4 = printer::queryDleEot(4);
  const int r1 = printer::queryGsR1();
  Serial.printf("PAPER raw dle_eot2=%s dle_eot4=%s gs_r1=%s\n", hexOrNone(e2).c_str(),
                hexOrNone(e4).c_str(), hexOrNone(r1).c_str());
  if (e2 < 0 && e4 < 0 && r1 < 0) {
    Serial.println("PAPER 未対応 (no_response)");
    return;
  }
  bool known = false, out = false, near = false, error = false;
  auto merge = [&](const PaperState& s) {
    if (!s.known) return;
    known = true;
    out |= s.paperOut;
    near |= s.nearEnd;
    error |= s.error;
  };
  if (e2 >= 0) merge(interpretDleEot(2, static_cast<uint8_t>(e2)));
  if (e4 >= 0) merge(interpretDleEot(4, static_cast<uint8_t>(e4)));
  if (r1 >= 0) merge(interpretGsR1(static_cast<uint8_t>(r1)));
  if (!known) Serial.println("PAPER unknown");
  else Serial.printf("PAPER %s%s%s\n", out ? "out" : "ok", near ? " near_end" : "",
                     error ? " error" : "");
}

static void handleLine(const char* line) {
  const Command c = parseCommand(line);
  switch (c.type) {
    case CmdType::Empty: return;
    case CmdType::Status: cmdStatus(); return;
    case CmdType::Help:
      Serial.println("COMMANDS STATUS | TEST 1 | TEST 2 | BAUD 9600 | BAUD 115200 | "
                     "BAUD LOCAL <rate> | BAUD ? | PAPER | PRINT <height>");
      return;
    case CmdType::Test: runPattern(c.arg == 1 ? Pattern::Test1 : Pattern::Test2); return;
    case CmdType::Baud:
      printer::changeBaud(c.arg);
      Serial.printf("BAUD %lu\n", static_cast<unsigned long>(printer::baud()));
      runPattern(Pattern::Short);
      return;
    case CmdType::BaudLocal:
      printer::setLocalBaud(c.arg);
      Serial.printf("BAUD LOCAL %lu\n", static_cast<unsigned long>(printer::baud()));
      return;
    case CmdType::BaudQuery: {
      String r = printer::queryBaud();
      Serial.printf("BAUD local=%lu printer=%s\n", static_cast<unsigned long>(printer::baud()),
                    r.length() ? r.c_str() : "no_response");
      return;
    }
    case CmdType::Paper: cmdPaper(); return;
    case CmdType::Print: {
      if (c.arg > MAX_JOB_HEIGHT) {
        Serial.println("ERR too_tall");
        return;
      }
      const led::State prev = led::get();
      led::set(led::State::Printing);
      String err;
      const bool ok = printer::printStream(c.arg, FETCH_ROWS, usbReader, nullptr, err);
      printer::feed();
      led::set(prev);
      if (ok) {
        Serial.println("DONE");
      } else {
        app::setLastError(String("usb_print_") + err);
        led::showFailure();
        // 送られてくる途中だった残りのデータを捨てる
        const uint32_t start = millis();
        while (millis() - start < 300) {
          while (Serial.available()) Serial.read();
          delay(10);
        }
        Serial.printf("ERR %s\n", err.c_str());
      }
      return;
    }
    case CmdType::Unknown:
    default:
      Serial.println("ERR unknown_command");
      return;
  }
}

static void pollSerial() {
  static char line[USB_LINE_MAX + 1];
  static size_t len = 0;
  static bool overflow = false;
  while (Serial.available()) {
    const int ch = Serial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      line[len] = '\0';
      if (overflow) Serial.println("ERR line_too_long");
      else handleLine(line);
      len = 0;
      overflow = false;
      // PRINT は handleLine の中で本文を読むので、ここで続けてよい
      continue;
    }
    if (len < USB_LINE_MAX) line[len++] = static_cast<char>(ch);
    else overflow = true;
  }
}

// ---------------------------------------------------------------------------
// ボタン（G39。押すと LOW）
// ---------------------------------------------------------------------------
static void pollButton() {
  static bool stablePressed = false;
  static bool lastRaw = false;
  static uint32_t rawChangedAt = 0;
  static uint32_t pressedAt = 0;
  static bool longFired = false;

  const uint32_t now = millis();
  const bool raw = digitalRead(BUTTON_PIN) == LOW;
  if (raw != lastRaw) {
    lastRaw = raw;
    rawChangedAt = now;
  }
  // 一定時間同じ値が続いたときだけ受け付ける（Wi-Fi 動作中の G39 の雑音対策）
  if (raw != stablePressed && now - rawChangedAt >= BUTTON_DEBOUNCE_MS) {
    stablePressed = raw;
    if (stablePressed) {
      pressedAt = now;
      longFired = false;
    } else if (!longFired) {
      Serial.println("[button] short -> TEST 1");
      runPattern(Pattern::Test1);
    }
  }
  if (stablePressed && !longFired && now - pressedAt >= BUTTON_LONG_MS) {
    longFired = true;
    Serial.println("[button] long -> TEST 2");
    runPattern(Pattern::Test2);
  }
}

// ---------------------------------------------------------------------------
// Wi-Fi とサーバー
// ---------------------------------------------------------------------------
static void startWifi() {
  lastWifiAttempt = millis();
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

static void pollNetwork() {
  if (!kWifiConfigured) {
    led::set(led::State::WifiDown);
    return;
  }
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (connected != wifiWasConnected) {
    wifiWasConnected = connected;
    if (connected) {
      wifiEverConnected = true;
      Serial.printf("[wifi] connected ip=%s\n", WiFi.localIP().toString().c_str());
    } else {
      Serial.println("[wifi] disconnected");
      app::setLastError("wifi_disconnected");
      server::reset();
    }
  }
  if (!connected) {
    led::set(wifiEverConnected ? led::State::WifiDown : led::State::Booting);
    if (millis() - lastWifiAttempt > WIFI_RETRY_INTERVAL_MS) startWifi();
    return;
  }
  if (millis() - lastPoll < POLL_INTERVAL_MS) {
    return;
  }
  lastPoll = millis();
  server::pollOnce();
  // 印刷の後も、問い合わせの間隔は印刷が終わってから数える
  lastPoll = millis();
  switch (server::health()) {
    case server::Health::Ok: led::set(led::State::Idle); break;
    case server::Health::NotContacted: break;
    default: led::set(led::State::ServerError); break;
  }
}

void setup() {
  // PRINT で 1 帯ぶんのデータを受け取れるよう、受信バッファを begin の前に広げる
  Serial.setRxBufferSize(FETCH_ROWS * kRowBytes + 256);
  Serial.begin(USB_BAUD);
  pinMode(BUTTON_PIN, INPUT);  // ATOM Lite の G39 は入力専用
  led::begin();
  led::set(led::State::Booting);
  Serial.println();
  Serial.println("[boot] dot-rosen printer firmware");
  if (SECRETS_FROM_EXAMPLE) Serial.println("[boot] secrets.h が無いので secrets.example.h を使用（Wi-Fi なし）");

  printer::begin();
  Serial.printf("[boot] printer baud=%lu\n", static_cast<unsigned long>(printer::baud()));

  server::begin();
  if (kWifiConfigured) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    startWifi();
  }
}

void loop() {
  pollSerial();
  pollButton();
  pollNetwork();
  led::tick();
  delay(5);
}
