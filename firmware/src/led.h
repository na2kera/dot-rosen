// 本体 LED（SK6812、G27）。点滅は led::tick() を呼んだときに進む。
#pragma once

#include <Arduino.h>

namespace led {

enum class State : uint8_t {
  Booting,      // 起動中・Wi-Fi 接続中: 青の点滅
  Idle,         // 待機中（サーバーに届いている）: 緑
  Printing,     // 印刷中: 白
  WifiDown,     // Wi-Fi 切断: 赤の点滅
  ServerError,  // サーバーに届かない・認証エラー: 黄
};

void begin();
void set(State s);
State get();
// 印刷の失敗: LED_FAIL_MS の間、赤（点灯）にする
void showFailure();
// 帯の途中で止まって自動の受け取りを止めている間: 赤（点灯）のままにする。ほかの表示より優先
void setFault(bool on);
void tick();

}  // namespace led
