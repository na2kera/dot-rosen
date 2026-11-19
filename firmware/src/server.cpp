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

static_assert(MAX_JOB_HEIGHT >= 1, "MAX_JOB_HEIGHT");

namespace server {

static WiFiClientSecure tls;
static HTTPClient http;
static Health currentHealth = Health::NotContacted;
static int httpCode = 0;
static bool timeOk = false;
static bool ntpStarted = false;
static uint32_t ntpStartedAt = 0;
static String baseUrl;
static bool autoClaimOn = AUTO_CLAIM != 0;

static uint32_t curJobId = 0;
static uint32_t curJobHeight = 0;
static bool printingNow = false;
static PendingDone pending;

static const char* kHeaderKeys[] = {"Transfer-Encoding"};

void begin() {
  baseUrl = String(SERVER_URL).substring(0, trimmedUrlLength(SERVER_URL));
#if TLS_VERIFY
  tls.setCACert(ROOT_CA_BUNDLE);
#else
  tls.setInsecure();
#endif
  tls.setHandshakeTimeout(TLS_HANDSHAKE_TIMEOUT_S);  // 秒で指定（WiFiClientSecure.cpp で x1000）
  http.setReuse(true);  // keep-alive で接続を使い回す（本文を読み切ったときだけ）
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
}

void reset() {
  http.end();
  tls.stop();
  ntpStarted = false;  // 時刻は一度合えば保たれるので timeOk は残す
}

// 証明書の検証の前に NTP で時刻を合わせる（取り決め: docs/api.md 5 と指示による）。
// 注: この Arduino-ESP32 2.0.17 の sdkconfig.h には CONFIG_MBEDTLS_HAVE_TIME はあるが
// CONFIG_MBEDTLS_HAVE_TIME_DATE が無く、証明書の有効期間（日付）は検証されていない可能性がある
// （grep の結果。実機では未検証）。それでも時刻合わせは行い、合うまではサーバーに接続しない。
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

bool timeSynced() { return timeOk; }

void setAutoClaim(bool on) { autoClaimOn = on; }
bool autoClaim() { return autoClaimOn; }

Health health() { return currentHealth; }
int lastHttpCode() { return httpCode; }
uint32_t jobId() { return curJobId; }
uint32_t jobHeight() { return curJobHeight; }
bool printing() { return printingNow; }

bool pendingDone(uint32_t& job, bool& ok, String& error, uint32_t& attempts) {
  if (!pending.active) return false;
  job = pending.jobId;
  ok = pending.ok;
  error = pending.error;
  attempts = pending.attempts;
  return true;
}

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
  http.collectHeaders(kHeaderKeys, 1);
  return true;
}

// 接続を捨てる（読み残しがあって次の要求とずれるのを防ぐ）
static void dropConnection() {
  http.end();
  tls.stop();
}

static void noteCode(int code) {
  httpCode = code;
  if (code == 200 || code == 204 || code == 409) currentHealth = Health::Ok;
  else if (code == 401) currentHealth = Health::Unauthorized;
  else currentHealth = Health::Unreachable;
}

// 応答の本文を最後まで読む（Content-Length か chunked の終端まで）。
// 読み切れたら true（接続を使い回してよい）。outLen には読めたところまでの長さが入る。
static bool readBody(uint8_t* buf, size_t cap, size_t& outLen, String& err) {
  outLen = 0;
  BodyReader r;
  const bool chunked = http.header("Transfer-Encoding").indexOf("chunked") >= 0;
  const int size = http.getSize();
  if (chunked) r.begin(BodyReader::Mode::Chunked, -1, buf, cap);
  else if (size >= 0) r.begin(BodyReader::Mode::Length, size, buf, cap);
  else { err = "no_length"; return false; }
  WiFiClient* s = http.getStreamPtr();
  if (!s) { err = "no_stream"; return false; }
  uint32_t last = millis();
  while (r.state() == BodyReader::State::More) {
    const int c = s->available() > 0 ? s->read() : -1;
    if (c >= 0) {
      r.feed(static_cast<uint8_t>(c));
      last = millis();
      continue;
    }
    if (!s->connected() && s->available() <= 0) { err = "disconnected"; break; }
    if (millis() - last > HTTP_TIMEOUT_MS) { err = "read_timeout"; break; }
    led::tick();
    delay(1);
  }
  outLen = r.size();
  if (r.state() == BodyReader::State::Error) err = r.error();
  return r.state() == BodyReader::State::Done;
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
static bool fetchRowsOnce(uint32_t job, uint32_t offset, uint16_t rows, uint8_t* buf,
                          String& err, bool& retryable) {
  retryable = true;
  char path[96];
  snprintf(path, sizeof(path), "/api/printer/jobs/%lu/rows?offset=%lu&count=%u",
           static_cast<unsigned long>(job), static_cast<unsigned long>(offset),
           static_cast<unsigned>(rows));
  if (!beginRequest(path)) { err = "rows_begin_failed"; return false; }
  const int code = http.GET();
  noteCode(code);
  if (code != 200) {
    err = code < 0 ? String("rows_conn_") + (-code) : String("rows_http_") + code;
    retryable = rowsRetryable(code);
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
  http.end();  // Content-Length ちょうど読み切ったので接続は残す（keep-alive）
  return true;
}

static bool rowsReader(void* ctx, uint32_t offset, uint16_t rows, uint8_t* buf, String& err) {
  const JobCtx* job = static_cast<const JobCtx*>(ctx);
  const uint32_t started = millis();
  for (int attempt = 0; attempt <= FETCH_RETRIES; ++attempt) {
    if (attempt > 0) {
      const uint32_t wait = static_cast<uint32_t>(FETCH_RETRY_DELAY_MS) * attempt;
      // やり直し全体の時間の上限
      if (millis() - started + wait > FETCH_TOTAL_TIMEOUT_MS) {
        err += "_gave_up";
        return false;
      }
      Serial.printf("[rows] retry %d (%s)\n", attempt, err.c_str());
      const uint32_t start = millis();
      while (millis() - start < wait) { led::tick(); delay(10); }
    }
    bool retryable = true;
    err = "";
    if (WiFi.status() != WL_CONNECTED) { err = "wifi_lost"; continue; }
    if (fetchRowsOnce(job->jobId, offset, rows, buf, err, retryable)) return true;
    if (!retryable) return false;
    if (millis() - started > FETCH_TOTAL_TIMEOUT_MS) {
      err += "_gave_up";
      return false;
    }
  }
  return false;
}

// ---- done ----
static uint8_t doneBodyBuf[DONE_BODY_MAX];

// 完了報告を 1 回送る。結果に応じて pending を消すか、次の送り直しを予約する。
static void tryPostDone() {
  if (!pending.active) return;
  char path[64];
  snprintf(path, sizeof(path), "/api/printer/jobs/%lu/done",
           static_cast<unsigned long>(pending.jobId));
  String body;
  if (pending.ok) {
    body = "{\"ok\":true}";
  } else {
    char esc[140];
    jsonEscape(pending.error, esc, sizeof(esc));
    body = String("{\"ok\":false,\"error\":\"") + esc + "\"}";
  }
  int code = -1;
  if (beginRequest(path)) {
    http.addHeader("Content-Type", "application/json");
    code = http.POST(body);
    noteCode(code);
    String err;
    size_t len = 0;
    if (code > 0 && readBody(doneBodyBuf, sizeof(doneBodyBuf), len, err)) http.end();
    else dropConnection();
  }
  Serial.printf("[done] job=%lu ok=%d http=%d attempt=%lu\n",
                static_cast<unsigned long>(pending.jobId), pending.ok, code,
                static_cast<unsigned long>(pending.attempts + 1));
  switch (classifyDoneCode(code)) {
    case DoneOutcome::Accepted:
      pending.clear();
      break;
    case DoneOutcome::Conflict:
      // サーバー側ではすでに別の結果で終わっている。送り直しはやめるが、記録は残す
      app::setLastError(String("done_conflict_job_") + pending.jobId);
      pending.clear();
      break;
    case DoneOutcome::Retry:
      pending.retryLater(millis(), POLL_INTERVAL_MS);
      app::setLastError(String("done_pending_job_") + pending.jobId + "_http_" + code);
      break;
  }
}

// ---- claim ----
static char claimBuf[CLAIM_BODY_MAX + 1];

static void claimAndPrint() {
  if (!beginRequest("/api/printer/claim")) {
    currentHealth = Health::Unreachable;
    app::setLastError("claim_begin_failed");
    return;
  }
  // 本文なしの POST。HTTPClient は長さ 0 のとき Content-Length を付けないので自分で付ける
  http.addHeader("Content-Length", "0");
  const int code = http.POST(static_cast<uint8_t*>(nullptr), 0);
  noteCode(code);
  if (code == 204) {
    http.end();  // 204 は本文が無いので、そのまま使い回せる
    return;
  }
  if (code != 200) {
    if (code == 401) app::setLastError("unauthorized");
    else app::setLastError(code < 0 ? String("claim_conn_") + (-code) + "_" + HTTPClient::errorToString(code)
                                    : String("claim_http_") + code);
    dropConnection();  // 本文は読まないので接続は閉じる
    return;
  }
  size_t len = 0;
  String readErr;
  const bool complete =
      readBody(reinterpret_cast<uint8_t*>(claimBuf), CLAIM_BODY_MAX, len, readErr);
  claimBuf[len] = '\0';
  if (complete) http.end();
  else dropConnection();

  ClaimInfo info{0, 0, 0};
  ClaimCheck check = checkClaim(claimBuf, len, MAX_JOB_HEIGHT, info);
  if (!complete && check == ClaimCheck::Ok) check = ClaimCheck::BadWithJob;  // 最後まで受け取れていない
  if (check == ClaimCheck::BadNoJob) {
    app::setLastError(String("claim_bad_no_job_") + (complete ? "json" : readErr));
    led::showFailure();
    return;
  }
  curJobId = info.jobId;
  curJobHeight = info.height;
  if (check == ClaimCheck::BadWithJob) {
    app::setLastError(String("bad_claim_job_") + info.jobId);
    led::showFailure();
    pending.set(info.jobId, false, "bad_claim", millis());
    tryPostDone();
    return;
  }
  Serial.printf("[job] id=%lu width=%lu height=%lu\n", static_cast<unsigned long>(info.jobId),
                static_cast<unsigned long>(info.width), static_cast<unsigned long>(info.height));

  led::set(led::State::Printing);
  printingNow = true;
  JobCtx ctx{info.jobId};
  String err;
  const bool ok = printer::printStream(info.height, FETCH_ROWS, rowsReader, &ctx, err);
  printingNow = false;
  // 失敗しても、そこまで刷った分をちぎれるように紙を送る（先頭から刷り直さない）
  printer::feed();
  led::set(led::State::Idle);
  if (!ok) {
    app::setLastError(String("job_") + info.jobId + "_" + err);
    led::showFailure();
  }
  pending.set(info.jobId, ok, ok ? "" : err.c_str(), millis());
  tryPostDone();
}

void tick() {
  if (!ensureTime()) return;
  if (pending.active) {
    // 未送信の完了報告がある間は claim しない
    if (pending.due(millis())) tryPostDone();
    return;
  }
  if (autoClaimOn) claimAndPrint();
}

}  // namespace server
