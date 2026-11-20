// サーバーとのやり取り（docs/api.md「5. プリンタ用 API」）
#pragma once

#include <Arduino.h>

namespace server {

enum class Health : uint8_t {
  NotContacted,  // まだ問い合わせていない
  Ok,            // 最後の問い合わせが届いた（200 / 204 / 409）
  Unauthorized,  // 401
  Unreachable,   // 接続できない・想定外の応答
  NoTime,        // NTP で時刻が合わず、まだ接続していない
};

void begin();
// Wi-Fi が切れたときに呼ぶ（TLS 接続を捨てる）
void reset();
// 時刻を合わせる。待たずに、合っていれば true
bool ensureTime();
bool timeSynced();

// 問い合わせの周期ごとに呼ぶ（Wi-Fi 接続中だけ）。
// 未送信の完了報告があれば、それを 1 回送り直すだけで claim はしない。
// 無ければ（自動 claim が有効なら）claim し、印刷があれば印刷して完了報告を送る。
// claim で印刷を受け取った（200）なら true。
bool tick();
// 未送信の完了報告があるか
bool hasPendingDone();

// CLAIM ON / OFF。ON にすると帯の途中で止まったときのエラー表示も解除する
void setAutoClaim(bool on);
bool autoClaim();
// 帯の途中で送信を打ち切った（printer::lastFailure() == MidBand）ときに呼ぶ。
// 自動の受け取りを止め（CLAIM OFF と同じ）、LED をエラー表示にして USB にログを出す。
// 再開は電源の入れ直しか CLAIM ON。where はログ用（"job_42" / "test" / "usb_print"）
void haltAfterStall(const String& where);

Health health();
int lastHttpCode();
const char* healthName(Health h);

// STATUS 用
uint32_t jobId();        // 今の（または最後の）印刷。無ければ 0
uint32_t jobHeight();
bool printing();
bool pendingDone(uint32_t& jobId, bool& ok, String& error, uint32_t& attempts);

}  // namespace server
