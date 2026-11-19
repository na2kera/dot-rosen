// 各部で共有する「最後のエラー」
#pragma once

#include <Arduino.h>

namespace app {

inline String& lastErrorRef() {
  static String s = "none";
  return s;
}
inline void setLastError(const String& e) {
  lastErrorRef() = e;
  Serial.print("[error] ");
  Serial.println(e);
}
inline const String& lastError() { return lastErrorRef(); }

}  // namespace app
