// サーバーとのやり取り（docs/api.md「5. プリンタ用 API」）
#pragma once

#include <Arduino.h>

namespace server {

enum class Health : uint8_t {
  NotContacted,  // まだ問い合わせていない
  Ok,            // 最後の問い合わせが届いた（200 / 204）
  Unauthorized,  // 401
  Unreachable,   // 接続できない・想定外の応答
  NoTime,        // NTP で時刻が合わず、まだ接続していない
};

void begin();
// Wi-Fi が切れたときに呼ぶ（TLS 接続を捨て、時刻合わせからやり直す）
void reset();
// 時刻を合わせる（済んでいれば何もしない）。合っていれば true
bool ensureTime();

// claim を 1 回呼び、印刷があれば印刷して done を報告する。
// 印刷を始めたら true（成功・失敗とも）。
bool pollOnce();

Health health();
int lastHttpCode();
const char* healthName(Health h);

}  // namespace server
