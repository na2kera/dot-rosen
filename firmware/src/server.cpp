#include "server.h"

#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#include "app_state.h"
#include "config.h"
#include "led.h"
#include "printer.h"
#include "root_ca.h"
#include "rosen_core.h"
#include "secrets_select.h"

using namespace rosen;

namespace server {

static WiFiClientSecure tls;
static HTTPClient http;
static Health currentHealth = Health::NotContacted;
static int httpCode = 0;
static bool timeOk = false;
static String baseUrl;

void begin() {
  baseUrl = String(SERVER_URL).substring(0, trimmedUrlLength(SERVER_URL));
#if TLS_VERIFY
  tls.setCACert(ROOT_CA_BUNDLE);
#else
  tls.setInsecure();
#endif
  http.setReuse(true);  // keep-alive で接続を使い回す
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
}

static bool ntpStarted = false;
static uint32_t ntpStartedAt = 0;

void reset() {
  http.end();
  tls.stop();
  ntpStarted = false;  // 時刻は一度合えば保たれるので timeOk は残す
}

// 証明書の検証の前に NTP で時刻を合わせる（取り決め: docs/api.md 5 と指示による）。
// 注: この Arduino-ESP32 2.0.17 の sdkconfig.h には CONFIG_MBEDTLS_HAVE_TIME はあるが
// CONFIG_MBEDTLS_HAVE_TIME_DATE が無く、証明書の有効期限の確認は組み込まれていないように見える
// （grep の結果。実機では未確認）。それでも時刻合わせは行い、合うまではサーバーに接続しない。
// 待つ間もボタンと USB が動くよう、ここでは待たずに毎回の問い合わせで確かめる。
bool ensureTime() {
  if (timeOk) return true;
  if (!ntpStarted) {
    configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);
    ntpStarted = true;
    ntpStartedAt = millis();
  }
  if (time(nullptr) > NTP_MIN_EPOCH) {
    timeOk = true;
    Serial.printf("[ntp] time ok %ld\n", static_cast<long>(time(nullptr)));
    return true;
  }
  if (millis() - ntpStartedAt > NTP_TIMEOUT_MS) {
    currentHealth = Health::NoTime;
    app::setLastError("ntp_timeout");
    ntpStarted = false;  // 次の問い合わせでやり直す
  }
  return false;
}

Health health() { return currentHealth; }
int lastHttpCode() { return httpCode; }

const char* healthName(Health h) {
  switch (h) {
    case Health::NotContacted: return "not_contacted";
    case Health::Ok: return "ok";
    case Health::Unauthorized: return "unauthorized";
    case Health::Unreachable: return "unreachable";
    case Health::NoTime: return "no_time";
  }
  return "?";
}

static bool beginRequest(const String& path) {
  if (!http.begin(tls, baseUrl + path)) return false;
  http.addHeader("Authorization", String("Bearer ") + PRINTER_TOKEN);
  return true;
}

// 接続を捨てる（読み残しがあって次の要求とずれるのを防ぐ）
static void dropConnection() {
  http.end();
  tls.stop();
}

static void noteCode(int code) {
  httpCode = code;
  if (code == 200 || code == 204) currentHealth = Health::Ok;
  else if (code == 401) currentHealth = Health::Unauthorized;
  else currentHealth = Health::Unreachable;
}

// ---- rows ----
struct JobCtx {
  uint32_t jobId;
};

static bool readExact(WiFiClient* s, uint8_t* buf, size_t len, String& err) {
  size_t got = 0;
  uint32_t last = millis();
  while (got < len) {
    int avail = s->available();
    if (avail > 0) {
      int n = s->read(buf + got, min(static_cast<size_t>(avail), len - got));
      if (n > 0) {
        got += static_cast<size_t>(n);
        last = millis();
        continue;
      }
    } else if (!s->connected()) {
      err = "rows_disconnected";
      return false;
    }
    if (millis() - last > HTTP_TIMEOUT_MS) {
      err = "rows_read_timeout";
      return false;
    }
    led::tick();
    delay(1);
  }
  return true;
}

// 1 回ぶんの取得。retryable はやり直す意味があるか。
static bool fetchRowsOnce(uint32_t jobId, uint32_t offset, uint16_t rows, uint8_t* buf,
                          String& err, bool& retryable) {
  retryable = true;
  char path[96];
  snprintf(path, sizeof(path), "/api/printer/jobs/%lu/rows?offset=%lu&count=%u",
           static_cast<unsigned long>(jobId), static_cast<unsigned long>(offset),
           static_cast<unsigned>(rows));
  if (!beginRequest(path)) { err = "rows_begin_failed"; return false; }
  const int code = http.GET();
  noteCode(code);
  if (code != 200) {
    err = code < 0 ? String("rows_conn_") + (-code) : String("rows_http_") + code;
    // 400（範囲外）/ 401 / 404 / 409（printing でない）はやり直しても変わらない
    if (code == 400 || code == 401 || code == 404 || code == 409) retryable = false;
    dropConnection();
    return false;
  }
  const size_t expected = static_cast<size_t>(rows) * kRowBytes;
  const int size = http.getSize();  // Content-Length（chunked なら -1）
  if (size < 0 || static_cast<size_t>(size) != expected) {
    err = String("rows_bad_length_") + size;
    dropConnection();
    return false;
  }
  WiFiClient* s = http.getStreamPtr();
  if (!s || !readExact(s, buf, expected, err)) {
    if (err.length() == 0) err = "rows_no_stream";
    dropConnection();
    return false;
  }
  http.end();  // 読み切ったので接続は残す（keep-alive）
  return true;
}

static bool rowsReader(void* ctx, uint32_t offset, uint16_t rows, uint8_t* buf, String& err) {
  const JobCtx* job = static_cast<const JobCtx*>(ctx);
  for (int attempt = 0; attempt <= FETCH_RETRIES; ++attempt) {
    if (attempt > 0) {
      Serial.printf("[rows] retry %d (%s)\n", attempt, err.c_str());
      const uint32_t wait = static_cast<uint32_t>(FETCH_RETRY_DELAY_MS) * attempt;
      const uint32_t start = millis();
      while (millis() - start < wait) { led::tick(); delay(10); }
    }
    bool retryable = true;
    err = "";
    if (WiFi.status() != WL_CONNECTED) { err = "wifi_lost"; continue; }
    if (fetchRowsOnce(job->jobId, offset, rows, buf, err, retryable)) return true;
    if (!retryable) return false;
  }
  return false;
}

// ---- done ----
static bool postDone(uint32_t jobId, bool ok, const String& error) {
  char path[64];
  snprintf(path, sizeof(path), "/api/printer/jobs/%lu/done", static_cast<unsigned long>(jobId));
  String body;
  if (ok) {
    body = "{\"ok\":true}";
  } else {
    char code[65];
    sanitizeErrorCode(error.c_str(), code, sizeof(code), 64);
    char esc[140];
    jsonEscape(code, esc, sizeof(esc));
    body = String("{\"ok\":false,\"error\":\"") + esc + "\"}";
  }
  uint32_t wait = DONE_RETRY_DELAY_MS;
  for (int attempt = 0; attempt <= DONE_RETRIES; ++attempt) {
    if (attempt > 0) {
      const uint32_t start = millis();
      while (millis() - start < wait) { led::tick(); delay(10); }
      wait *= 2;
    }
    if (WiFi.status() != WL_CONNECTED) continue;
    if (!beginRequest(path)) continue;
    http.addHeader("Content-Type", "application/json");
    const int code = http.POST(body);
    Serial.printf("[done] job=%lu ok=%d http=%d\n", static_cast<unsigned long>(jobId), ok, code);
    if (code == 200 || code == 409) {
      // 409 も「受理済み」（docs/api.md: すでに終わっている印刷）
      noteCode(200);
      http.end();
      return true;
    }
    noteCode(code);
    dropConnection();
  }
  app::setLastError(String("done_not_delivered_job_") + jobId);
  return false;
}

// ---- claim ----
bool pollOnce() {
  if (!ensureTime()) return false;
  if (!beginRequest("/api/printer/claim")) {
    currentHealth = Health::Unreachable;
    app::setLastError("claim_begin_failed");
    return false;
  }
  // 本文なしの POST。HTTPClient は長さ 0 のとき Content-Length を付けないので自分で付ける
  http.addHeader("Content-Length", "0");
  const int code = http.POST(static_cast<uint8_t*>(nullptr), 0);
  noteCode(code);
  if (code == 204) {
    http.end();
    return false;
  }
  if (code != 200) {
    if (code == 401) app::setLastError("unauthorized");
    else app::setLastError(code < 0 ? String("claim_conn_") + (-code) + "_" + HTTPClient::errorToString(code)
                                    : String("claim_http_") + code);
    dropConnection();
    return false;
  }
  String json = http.getString();
  http.end();

  ClaimInfo info{0, 0, 0};
  if (!parseClaimJson(json.c_str(), info)) {
    // jobId が読めないので done も送れない
    app::setLastError("claim_bad_json");
    led::showFailure();
    return true;
  }
  Serial.printf("[job] id=%lu width=%lu height=%lu\n", static_cast<unsigned long>(info.jobId),
                static_cast<unsigned long>(info.width), static_cast<unsigned long>(info.height));
  if (info.width != kWidthDots || info.height == 0 || info.height > MAX_JOB_HEIGHT) {
    app::setLastError("bad_job_size");
    postDone(info.jobId, false, "bad_job_size");
    led::showFailure();
    return true;
  }

  led::set(led::State::Printing);
  JobCtx ctx{info.jobId};
  String err;
  const bool ok = printer::printStream(info.height, FETCH_ROWS, rowsReader, &ctx, err);
  // 失敗しても、そこまで刷った分をちぎれるように紙を送る（先頭から刷り直さない）
  printer::feed();
  led::set(led::State::Idle);
  if (!ok) {
    app::setLastError(String("job_") + info.jobId + "_" + err);
    led::showFailure();
  }
  postDone(info.jobId, ok, ok ? String() : err);
  return true;
}

}  // namespace server
