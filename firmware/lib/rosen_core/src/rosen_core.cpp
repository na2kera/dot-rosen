#include "rosen_core.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

namespace rosen {

void buildRasterHeader(uint8_t out[kRasterHeaderSize], uint16_t widthBytes,
                       uint16_t rows, uint8_t mode) {
  if (mode > 3) mode = 3;
  out[0] = 0x1D;  // GS
  out[1] = 0x76;  // 'v'
  out[2] = 0x30;  // '0'
  out[3] = mode;
  out[4] = static_cast<uint8_t>(widthBytes & 0xFF);
  out[5] = static_cast<uint8_t>((widthBytes >> 8) & 0xFF);
  out[6] = static_cast<uint8_t>(rows & 0xFF);
  out[7] = static_cast<uint8_t>((rows >> 8) & 0xFF);
}

uint16_t nextBandRows(uint32_t remainingRows, uint16_t maxBandRows) {
  if (maxBandRows == 0) return 0;
  return remainingRows < maxBandRows ? static_cast<uint16_t>(remainingRows)
                                     : maxBandRows;
}

uint32_t bandCount(uint32_t totalRows, uint16_t maxBandRows) {
  if (maxBandRows == 0) return 0;
  return (totalRows + maxBandRows - 1) / maxBandRows;
}

void buildBaudCmd(uint8_t out[kBaudCmdSize], uint32_t baud) {
  static const uint8_t head[] = {0x1B, 0x23, 0x23, 0x53, 0x42, 0x44, 0x52};  // ESC ## SBDR
  memcpy(out, head, sizeof(head));
  out[7] = static_cast<uint8_t>(baud & 0xFF);
  out[8] = static_cast<uint8_t>((baud >> 8) & 0xFF);
  out[9] = static_cast<uint8_t>((baud >> 16) & 0xFF);
  out[10] = static_cast<uint8_t>((baud >> 24) & 0xFF);
}

void buildDensityCmd(uint8_t out[kDensityCmdSize], uint8_t n) {
  static const uint8_t head[] = {0x1B, 0x23, 0x23, 0x53, 0x54, 0x44, 0x50};  // ESC ## STDP
  memcpy(out, head, sizeof(head));
  out[7] = n;
}

PaperState interpretDleEot(uint8_t n, uint8_t v) {
  PaperState s{false, false, false, false};
  // 固定ビット: bit0=0, bit1=1, bit4=1, bit7=0（PDF 1.40 の表）
  if ((v & 0x93) != 0x12) return s;
  if (n == 2) {
    s.known = true;
    s.paperOut = (v & 0x20) != 0;
    s.error = (v & 0x40) != 0;
  } else if (n == 4) {
    s.known = true;
    s.nearEnd = (v & 0x0C) != 0;
    // PDF の n=4 の表は bit5 を「不可恢复错误 0x20」、bit6 を「纸尽 0x60」と書いており
    // ビットの割り当てが重なっている。ここでは bit6 を紙切れ、bit5 を異常として読む（未確認）。
    s.paperOut = (v & 0x40) != 0;
    s.error = (v & 0x20) != 0;
  } else if (n == 3) {
    s.known = false;  // 紙の情報は無い
    s.error = (v & 0x68) != 0;
  }
  return s;
}

PaperState interpretGsR1(uint8_t v) {
  PaperState s{false, false, false, false};
  if ((v & 0x90) != 0) return s;  // bit4, bit7 は 0 固定
  s.known = true;
  s.nearEnd = (v & 0x03) != 0;
  s.paperOut = (v & 0x0C) != 0;
  return s;
}

// ---------------------------------------------------------------------------
// テストパターン
// ---------------------------------------------------------------------------
static const uint8_t kBayer8[8][8] = {
    {0, 32, 8, 40, 2, 34, 10, 42},  {48, 16, 56, 24, 50, 18, 58, 26},
    {12, 44, 4, 36, 14, 46, 6, 38}, {60, 28, 52, 20, 62, 30, 54, 22},
    {3, 35, 11, 43, 1, 33, 9, 41},  {51, 19, 59, 27, 49, 17, 57, 25},
    {15, 47, 7, 39, 13, 45, 5, 37}, {63, 31, 55, 23, 61, 29, 53, 21},
};

bool ditherBlack(uint16_t x, uint16_t y, uint8_t percent) {
  if (percent >= 100) return true;
  if (percent == 0) return false;
  // 0..64 個のしきい値のうち percent に応じた数を黒にする
  const uint16_t level = static_cast<uint16_t>(percent) * 64 / 100;
  return kBayer8[y & 7][x & 7] < level;
}

uint16_t patternHeight(Pattern p) {
  switch (p) {
    case Pattern::Test1: return 400;
    case Pattern::Test2: return 192;
    case Pattern::Short: return 64;
  }
  return 0;
}

static inline void setDot(uint8_t row[kRowBytes], int x) {
  if (x < 0 || x >= kWidthDots) return;
  row[x >> 3] |= static_cast<uint8_t>(0x80 >> (x & 7));
}

static bool test1Dot(int x, int y) {
  // 左右端の線（各 2 ドット）
  if (x <= 1 || x >= kWidthDots - 2) return true;
  // 上下の枠（2 行）
  if (y <= 1 || y >= 398) return true;

  // 1) 縦線 y 8..79: 左 = 1 ドット線/1 ドット間隔、右 = 2 ドット線/2 ドット間隔
  if (y >= 8 && y < 80) {
    if (x >= 8 && x < 188) return (x & 1) == 0;
    if (x >= 196 && x < 376) return ((x >> 1) & 1) == 0;
    return false;
  }
  // 2) 横線 y 88..159: 左 = 1 行おき、右 = 2 行おき
  if (y >= 88 && y < 160) {
    if (x >= 8 && x < 188) return (y & 1) == 0;
    if (x >= 196 && x < 376) return ((y >> 1) & 1) == 0;
    return false;
  }
  // 3) 市松 y 168..231: 左 = 1 ドット、右 = 2 ドット
  if (y >= 168 && y < 232) {
    if (x >= 8 && x < 188) return ((x ^ y) & 1) == 0;
    if (x >= 196 && x < 376) return (((x >> 1) ^ (y >> 1)) & 1) == 0;
    return false;
  }
  // 4) 濃さの段階 y 240..303: 10% 〜 100%、各 36 ドット幅
  if (y >= 240 && y < 304) {
    const int x0 = 12;
    if (x >= x0 && x < x0 + 360) {
      const int step = (x - x0) / 36;  // 0..9
      return ditherBlack(x, y, static_cast<uint8_t>((step + 1) * 10));
    }
    return false;
  }
  // 5) 図形 y 312..391: 塗りつぶした円、三角、枠だけの四角、X
  if (y >= 312 && y < 392) {
    const int cy = 352;
    // 円 中心 (52, 352) 半径 36
    {
      const int dx = x - 52, dy = y - cy;
      if (dx * dx + dy * dy <= 36 * 36) return true;
    }
    // 三角 頂点 (148, 316)、底辺 y=388、x 112..184
    if (x >= 112 && x <= 184 && y >= 316 && y <= 388) {
      const int half = (y - 316) / 2;  // 72 行で半幅 36
      if (x >= 148 - half && x <= 148 + half) return true;
    }
    // 枠だけの四角 x 208..280、線の太さ 3
    if (x >= 208 && x <= 280 && y >= 316 && y <= 388) {
      if (x < 211 || x > 277 || y < 319 || y > 385) return true;
    }
    // X x 304..376
    if (x >= 304 && x <= 376 && y >= 316 && y <= 388) {
      const int u = x - 304, v = y - 316;
      if (abs(u - v) <= 1 || abs(u + v - 72) <= 1) return true;
    }
    return false;
  }
  return false;
}

void fillPatternRow(Pattern p, uint16_t y, uint8_t row[kRowBytes]) {
  memset(row, 0, kRowBytes);
  switch (p) {
    case Pattern::Test1:
      for (int x = 0; x < kWidthDots; ++x)
        if (test1Dot(x, y)) setDot(row, x);
      break;
    case Pattern::Test2: {
      // 黒 50% / 75% / 100% を各 64 行
      const uint8_t pct = y < 64 ? 50 : (y < 128 ? 75 : 100);
      for (int x = 0; x < kWidthDots; ++x)
        if (ditherBlack(x, y, pct)) setDot(row, x);
      break;
    }
    case Pattern::Short:
      for (int x = 0; x < kWidthDots; ++x) {
        bool b = false;
        if (x <= 1 || x >= kWidthDots - 2 || y <= 1 || y >= 62) b = true;
        else if (y >= 8 && y < 32) b = (x & 1) == 0;            // 1 ドット縦線
        else if (y >= 36 && y < 56) b = ((x ^ y) & 1) == 0;     // 1 ドット市松
        if (b) setDot(row, x);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// 行コマンド
// ---------------------------------------------------------------------------
static bool equalsIgnoreCase(const char* a, size_t alen, const char* b) {
  size_t blen = strlen(b);
  if (alen != blen) return false;
  for (size_t i = 0; i < alen; ++i)
    if (toupper(static_cast<unsigned char>(a[i])) != toupper(static_cast<unsigned char>(b[i])))
      return false;
  return true;
}

// 空白で区切った語を最大 3 つ取り出す
struct Tokens {
  const char* p[3];
  size_t n[3];
  int count;
};
static Tokens tokenize(const char* s) {
  Tokens t{{nullptr, nullptr, nullptr}, {0, 0, 0}, 0};
  while (*s) {
    while (*s && isspace(static_cast<unsigned char>(*s))) ++s;
    if (!*s) break;
    const char* start = s;
    while (*s && !isspace(static_cast<unsigned char>(*s))) ++s;
    if (t.count < 3) {
      t.p[t.count] = start;
      t.n[t.count] = static_cast<size_t>(s - start);
    }
    ++t.count;
  }
  return t;
}

static bool parseUint(const char* s, size_t n, uint32_t& out) {
  if (n == 0 || n > 9) return false;
  uint32_t v = 0;
  for (size_t i = 0; i < n; ++i) {
    if (s[i] < '0' || s[i] > '9') return false;
    v = v * 10 + static_cast<uint32_t>(s[i] - '0');
  }
  out = v;
  return true;
}

Command parseCommand(const char* line) {
  Command c{CmdType::Unknown, 0};
  Tokens t = tokenize(line ? line : "");
  if (t.count == 0) { c.type = CmdType::Empty; return c; }
  const char* w = t.p[0];
  size_t wn = t.n[0];
  uint32_t v = 0;
  if (t.count == 1) {
    if (equalsIgnoreCase(w, wn, "STATUS")) c.type = CmdType::Status;
    else if (equalsIgnoreCase(w, wn, "PAPER")) c.type = CmdType::Paper;
    else if (equalsIgnoreCase(w, wn, "HELP")) c.type = CmdType::Help;
    return c;
  }
  if (t.count == 2) {
    if (equalsIgnoreCase(w, wn, "TEST") && parseUint(t.p[1], t.n[1], v) && (v == 1 || v == 2)) {
      c.type = CmdType::Test; c.arg = v;
    } else if (equalsIgnoreCase(w, wn, "BAUD") && equalsIgnoreCase(t.p[1], t.n[1], "?")) {
      c.type = CmdType::BaudQuery;
    } else if (equalsIgnoreCase(w, wn, "BAUD") && parseUint(t.p[1], t.n[1], v) &&
               (v == 9600 || v == 115200)) {
      c.type = CmdType::Baud; c.arg = v;
    } else if (equalsIgnoreCase(w, wn, "PRINT") && parseUint(t.p[1], t.n[1], v) && v > 0) {
      c.type = CmdType::Print; c.arg = v;
    } else if (equalsIgnoreCase(w, wn, "CLAIM") && equalsIgnoreCase(t.p[1], t.n[1], "ON")) {
      c.type = CmdType::Claim; c.arg = 1;
    } else if (equalsIgnoreCase(w, wn, "CLAIM") && equalsIgnoreCase(t.p[1], t.n[1], "OFF")) {
      c.type = CmdType::Claim; c.arg = 0;
    }
    return c;
  }
  if (t.count == 3 && equalsIgnoreCase(w, wn, "BAUD") &&
      equalsIgnoreCase(t.p[1], t.n[1], "LOCAL") && parseUint(t.p[2], t.n[2], v) &&
      (v == 9600 || v == 115200)) {
    c.type = CmdType::BaudLocal; c.arg = v;
  }
  return c;
}

// ---------------------------------------------------------------------------
// サーバー応答の読み取り
// ---------------------------------------------------------------------------
// 小さな JSON の読み取り器（オブジェクト 1 つ。claim の応答用）
namespace {
struct JsonScan {
  const char* p;
  const char* end;
  bool atEnd() const { return p >= end; }
  void ws() {
    while (p < end && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')) ++p;
  }
  // "..." を読み、中身（エスケープはそのまま）の範囲を返す
  bool str(const char*& s, size_t& n) {
    if (atEnd() || *p != '"') return false;
    ++p;
    s = p;
    while (p < end && *p != '"') {
      if (static_cast<unsigned char>(*p) < 0x20) return false;
      if (*p == '\\') {
        ++p;
        if (p >= end) return false;
      }
      ++p;
    }
    if (p >= end) return false;
    n = static_cast<size_t>(p - s);
    ++p;  // 閉じ "
    return true;
  }
  static bool isTerm(char c) {
    return c == ',' || c == '}' || c == ']' || c == ' ' || c == '\t' || c == '\r' || c == '\n';
  }
  // JSON の数値を読み飛ばす。0 以上の整数（32 ビット）なら isUint と値も返す。
  bool number(bool& isUint, uint32_t& v) {
    const char* s = p;
    bool neg = false, frac = false;
    if (p < end && *p == '-') { neg = true; ++p; }
    if (p >= end || *p < '0' || *p > '9') return false;
    uint64_t acc = 0;
    bool overflow = false;
    while (p < end && *p >= '0' && *p <= '9') {
      acc = acc * 10 + static_cast<uint64_t>(*p - '0');
      if (acc > 0xFFFFFFFFull) overflow = true;
      ++p;
    }
    if (p < end && *p == '.') {
      frac = true; ++p;
      if (p >= end || *p < '0' || *p > '9') return false;
      while (p < end && *p >= '0' && *p <= '9') ++p;
    }
    if (p < end && (*p == 'e' || *p == 'E')) {
      frac = true; ++p;
      if (p < end && (*p == '+' || *p == '-')) ++p;
      if (p >= end || *p < '0' || *p > '9') return false;
      while (p < end && *p >= '0' && *p <= '9') ++p;
    }
    // 数値は終端まで読めていること（本文の途中で切れていない）
    if (p >= end || !isTerm(*p)) return false;
    (void)s;
    isUint = !neg && !frac && !overflow;
    v = static_cast<uint32_t>(acc);
    return true;
  }
  bool literal(const char* w) {
    const size_t n = strlen(w);
    if (static_cast<size_t>(end - p) < n || strncmp(p, w, n) != 0) return false;
    p += n;
    return p < end && isTerm(*p);
  }
  // 値を 1 つ読み飛ばす（入れ子は深さ 8 まで）
  bool skipValue(int depth) {
    if (atEnd() || depth > 8) return false;
    const char c = *p;
    if (c == '"') { const char* s; size_t n; return str(s, n); }
    if (c == '{' || c == '[') {
      const char close = c == '{' ? '}' : ']';
      ++p;
      ws();
      if (!atEnd() && *p == close) { ++p; return true; }
      while (true) {
        if (c == '{') {
          const char* s; size_t n;
          if (!str(s, n)) return false;
          ws();
          if (atEnd() || *p != ':') return false;
          ++p;
          ws();
        }
        if (!skipValue(depth + 1)) return false;
        ws();
        if (atEnd()) return false;
        if (*p == ',') { ++p; ws(); continue; }
        if (*p == close) { ++p; return true; }
        return false;
      }
    }
    if (c == 't') return literal("true");
    if (c == 'f') return literal("false");
    if (c == 'n') return literal("null");
    bool u; uint32_t v;
    return number(u, v);
  }
};

bool keyIs(const char* s, size_t n, const char* key) {
  return strlen(key) == n && strncmp(s, key, n) == 0;
}

bool parseClaimRange(const char* json, size_t len, ClaimInfo& out) {
  JsonScan j{json, json + len};
  j.ws();
  if (j.atEnd() || *j.p != '{') return false;
  ++j.p;
  bool hasJob = false, hasW = false, hasH = false;
  ClaimInfo c{0, 0, 0};
  j.ws();
  if (!j.atEnd() && *j.p == '}') return false;  // 空のオブジェクト
  while (true) {
    const char* k; size_t kn;
    if (!j.str(k, kn)) return false;
    j.ws();
    if (j.atEnd() || *j.p != ':') return false;
    ++j.p;
    j.ws();
    uint32_t* slot = nullptr;
    bool* seen = nullptr;
    if (keyIs(k, kn, "jobId")) { slot = &c.jobId; seen = &hasJob; }
    else if (keyIs(k, kn, "width")) { slot = &c.width; seen = &hasW; }
    else if (keyIs(k, kn, "height")) { slot = &c.height; seen = &hasH; }
    if (slot) {
      bool isUint = false; uint32_t v = 0;
      if (j.atEnd() || (*j.p != '-' && (*j.p < '0' || *j.p > '9'))) return false;
      if (!j.number(isUint, v) || !isUint || *seen) return false;
      *slot = v;
      *seen = true;
    } else if (!j.skipValue(0)) {
      return false;
    }
    j.ws();
    if (j.atEnd()) return false;  // 閉じ括弧が無い
    if (*j.p == ',') { ++j.p; j.ws(); continue; }
    if (*j.p == '}') { ++j.p; break; }
    return false;
  }
  j.ws();
  if (!j.atEnd()) return false;  // 閉じ括弧のあとに余計なもの
  if (!hasJob || !hasW || !hasH) return false;
  out = c;
  return true;
}

// 形が壊れていても "jobId" : <整数><終端> があれば読む（失敗の報告用）
bool looseJobId(const char* json, size_t len, uint32_t& out) {
  const char* end = json + len;
  static const char kKey[] = "\"jobId\"";
  const size_t kn = sizeof(kKey) - 1;
  for (const char* p = json; p + kn <= end; ++p) {
    if (strncmp(p, kKey, kn) != 0) continue;
    JsonScan j{p + kn, end};
    j.ws();
    if (j.atEnd() || *j.p != ':') continue;
    ++j.p;
    j.ws();
    bool isUint = false; uint32_t v = 0;
    if (j.atEnd() || *j.p < '0' || *j.p > '9') continue;
    if (j.number(isUint, v) && isUint) { out = v; return true; }
  }
  return false;
}
}  // namespace

bool parseClaimJson(const char* json, ClaimInfo& out) {
  if (!json) return false;
  return parseClaimRange(json, strlen(json), out);
}

ClaimCheck checkClaim(const char* body, size_t len, uint32_t maxHeight, ClaimInfo& out) {
  out = ClaimInfo{0, 0, 0};
  if (!body) return ClaimCheck::BadNoJob;
  ClaimInfo c{0, 0, 0};
  if (parseClaimRange(body, len, c)) {
    out = c;
    if (c.width == kWidthDots && c.height >= 1 && c.height <= maxHeight) return ClaimCheck::Ok;
    return ClaimCheck::BadWithJob;
  }
  uint32_t job = 0;
  if (looseJobId(body, len, job)) {
    out.jobId = job;
    return ClaimCheck::BadWithJob;
  }
  return ClaimCheck::BadNoJob;
}

// ---------------------------------------------------------------------------
// HTTP 本文の読み取り
// ---------------------------------------------------------------------------
void BodyReader::begin(Mode mode, int32_t contentLength, uint8_t* buf, size_t cap) {
  mode_ = mode;
  buf_ = buf;
  cap_ = cap;
  size_ = 0;
  error_ = "";
  ch_ = Ch::SizeHex;
  hexDigits_ = 0;
  remaining_ = 0;
  state_ = State::More;
  if (mode == Mode::Length) {
    if (contentLength < 0) { fail("no_length"); return; }
    if (buf_ && static_cast<size_t>(contentLength) > cap_) { fail("too_large"); return; }
    remaining_ = static_cast<uint32_t>(contentLength);
    if (remaining_ == 0) state_ = State::Done;
  }
}

BodyReader::State BodyReader::store(uint8_t c) {
  if (buf_) {
    if (size_ >= cap_) return fail("too_large");
    buf_[size_] = c;
  }
  ++size_;
  return state_;
}

static int hexValue(uint8_t c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

BodyReader::State BodyReader::feed(uint8_t c) {
  if (state_ != State::More) return state_ == State::Done ? fail("extra_data") : state_;
  if (mode_ == Mode::Length) {
    if (store(c) == State::Error) return state_;
    if (--remaining_ == 0) state_ = State::Done;
    return state_;
  }
  switch (ch_) {
    case Ch::SizeHex: {
      const int h = hexValue(c);
      if (h >= 0) {
        if (++hexDigits_ > 7) return fail("chunk_too_large");
        remaining_ = remaining_ * 16 + static_cast<uint32_t>(h);
        return state_;
      }
      if (hexDigits_ == 0) return fail("bad_chunk_size");
      if (c == '\r') { ch_ = Ch::SizeLF; return state_; }
      if (c == ';' || c == ' ' || c == '\t') { ch_ = Ch::SizeExt; return state_; }
      return fail("bad_chunk_size");
    }
    case Ch::SizeExt:
      if (c == '\r') ch_ = Ch::SizeLF;
      else if (c == '\n') return fail("bad_chunk_line");
      return state_;
    case Ch::SizeLF:
      if (c != '\n') return fail("bad_chunk_line");
      if (remaining_ == 0) { ch_ = Ch::TrailerStart; return state_; }
      ch_ = Ch::Data;
      return state_;
    case Ch::Data:
      if (store(c) == State::Error) return state_;
      if (--remaining_ == 0) ch_ = Ch::DataCR;
      return state_;
    case Ch::DataCR:
      if (c != '\r') return fail("bad_chunk_end");
      ch_ = Ch::DataLF;
      return state_;
    case Ch::DataLF:
      if (c != '\n') return fail("bad_chunk_end");
      ch_ = Ch::SizeHex;
      hexDigits_ = 0;
      remaining_ = 0;
      return state_;
    case Ch::TrailerStart:
      // 最後のチャンクのあと: 空行（CRLF）で終わり。ほかはトレーラーの行
      if (c == '\r') { ch_ = Ch::EndLF; return state_; }
      ch_ = Ch::TrailerLine;
      return state_;
    case Ch::TrailerLine:
      if (c == '\n') ch_ = Ch::TrailerStart;
      return state_;
    case Ch::EndLF:
      if (c != '\n') return fail("bad_chunk_end");
      state_ = State::Done;
      return state_;
  }
  return fail("bad_state");
}

DoneOutcome classifyDoneCode(int httpCode) {
  if (httpCode == 200) return DoneOutcome::Accepted;
  if (httpCode == 409) return DoneOutcome::Conflict;
  if (httpCode == 404) return DoneOutcome::Gone;
  return DoneOutcome::Retry;
}

ReadStop readStopCheck(uint32_t now, uint32_t lastRx, uint32_t idleMs, const Deadline& d) {
  if (d.expired(now)) return ReadStop::Total;
  if (now - lastRx > idleMs) return ReadStop::Idle;
  return ReadStop::Continue;
}

const char kErrUartStall[] = "uart_stall";

AfterPrint planAfterPrint(PrintFail f) {
  switch (f) {
    case PrintFail::None: return AfterPrint{false, true, false};
    case PrintFail::Clean: return AfterPrint{true, true, false};
    case PrintFail::MidBand: return AfterPrint{false, false, true};
  }
  return AfterPrint{false, false, true};
}

bool rowsRetryable(int httpCode) {
  return !(httpCode == 400 || httpCode == 401 || httpCode == 404 || httpCode == 409);
}

void PendingDone::set(uint32_t job, bool okResult, const char* err, uint32_t now) {
  active = true;
  jobId = job;
  ok = okResult;
  sanitizeErrorCode(okResult ? "" : (err && *err ? err : "unknown"), error, sizeof(error), 64);
  attempts = 0;
  lastAt = now;
  waitMs = 0;
}

bool PendingDone::due(uint32_t now) const {
  // 経過を符号なしの差で測る（予定時刻との符号つき比較は差が 2^31 ms を超えると逆転する）
  return active && (now - lastAt) >= waitMs;
}

void PendingDone::retryLater(uint32_t now, uint32_t interval) {
  ++attempts;
  lastAt = now;
  waitMs = interval;
}

uint32_t PollIdle::interval(uint32_t now, bool pendingDone, uint32_t fastMs, uint32_t slowMs,
                            uint32_t idleAfterMs) {
  // 差を符号なしで取るので millis() の桁あふれをまたいでも正しい。一度 idle になったら保持する
  if (!idle && (now - lastActivity) >= idleAfterMs) idle = true;
  if (pendingDone) return fastMs;
  return idle ? slowMs : fastMs;
}

void BusyStats::sample(bool busy, uint32_t now) {
  if (busy && !inBusy) {
    inBusy = true;
    since = now;
    ++count;
  } else if (!busy && inBusy) {
    inBusy = false;
    totalMs += now - since;
  }
}

size_t sanitizeErrorCode(const char* in, char* out, size_t outSize, size_t maxLen) {
  if (outSize == 0) return 0;
  size_t w = 0;
  for (const char* p = in ? in : ""; *p && w + 1 < outSize && w < maxLen; ++p) {
    unsigned char ch = static_cast<unsigned char>(*p);
    if (ch < 0x21 || ch > 0x7E || ch == '"' || ch == '\\') ch = '_';
    out[w++] = static_cast<char>(ch);
  }
  out[w] = '\0';
  return w;
}

size_t jsonEscape(const char* in, char* out, size_t outSize) {
  if (outSize == 0) return 0;
  size_t w = 0;
  for (const char* p = in ? in : ""; *p; ++p) {
    unsigned char ch = static_cast<unsigned char>(*p);
    char esc[7];
    size_t n;
    if (ch == '"' || ch == '\\') { esc[0] = '\\'; esc[1] = static_cast<char>(ch); n = 2; }
    else if (ch < 0x20) {
      static const char hex[] = "0123456789abcdef";
      esc[0] = '\\'; esc[1] = 'u'; esc[2] = '0'; esc[3] = '0';
      esc[4] = hex[ch >> 4]; esc[5] = hex[ch & 15]; n = 6;
    } else { esc[0] = static_cast<char>(ch); n = 1; }
    if (w + n + 1 > outSize) break;
    memcpy(out + w, esc, n);
    w += n;
  }
  out[w] = '\0';
  return w;
}

size_t trimmedUrlLength(const char* url) {
  if (!url) return 0;
  size_t n = strlen(url);
  while (n > 0 && url[n - 1] == '/') --n;
  return n;
}

}  // namespace rosen
