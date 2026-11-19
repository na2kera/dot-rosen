#include "printer.h"

#include "config.h"

using namespace rosen;

static_assert(FETCH_ROWS >= 1 && FETCH_ROWS <= 240, "FETCH_ROWS は 1〜240（docs/api.md の count の範囲）");
static_assert(FETCH_ROWS <= 255, "GS v 0 の yH を 0 に保つため 255 行以下");

namespace printer {

static HardwareSerial& uart = Serial2;
static uint32_t currentBaud = PRINTER_BAUD_DEFAULT;
// 1 帯ぶんの作業用バッファ（PSRAM が無いので画像全体は持たない）
static uint8_t bandBuf[FETCH_ROWS * kRowBytes];

void begin() {
  // ATOM_PRINTER.cpp 8 行目と同じ: begin(baud, SERIAL_8N1, RX=33, TX=23)
  uart.begin(currentBaud, SERIAL_8N1, PRINTER_PIN_RX, PRINTER_PIN_TX);
  pinMode(PRINTER_PIN_CTS, INPUT);
  delay(50);
  init();
#if PRINTER_DENSITY >= 0
  uint8_t cmd[kDensityCmdSize];
  buildDensityCmd(cmd, static_cast<uint8_t>(PRINTER_DENSITY));
  uart.write(cmd, sizeof(cmd));
  uart.flush();
#endif
#if PRINTER_BOOT_USE_115200
  changeBaud(PRINTER_FAST_BAUD);
#endif
}

void init() {
  static const uint8_t kInit[] = {0x1B, 0x40};  // ESC @（ATOM_PRINTER_CMD.h 2 行目）
  uart.write(kInit, sizeof(kInit));
  uart.flush();
  delay(20);
}

uint32_t baud() { return currentBaud; }

int ctsLevel() { return digitalRead(PRINTER_PIN_CTS); }

void setLocalBaud(uint32_t newBaud) {
  uart.flush();
  uart.updateBaudRate(newBaud);
  currentBaud = newBaud;
  delay(20);
  while (uart.available()) uart.read();
}

void changeBaud(uint32_t newBaud) {
  uint8_t cmd[kBaudCmdSize];
  buildBaudCmd(cmd, newBaud);
  uart.write(cmd, sizeof(cmd));
  uart.flush();
  delay(PRINTER_BAUD_SWITCH_WAIT_MS);
  setLocalBaud(newBaud);
  init();
}

static void drainRx() {
  while (uart.available()) uart.read();
}

static int readByte(uint32_t timeoutMs) {
  const uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    if (uart.available()) return uart.read();
    delay(1);
  }
  return -1;
}

String queryBaud() {
  drainRx();
  static const uint8_t cmd[] = {0x1D, 0x67, 0x37};  // GS g 7（PDF 5.8）
  uart.write(cmd, sizeof(cmd));
  uart.flush();
  String s;
  const uint32_t start = millis();
  uint32_t last = start;
  while (millis() - start < PRINTER_STATUS_TIMEOUT_MS * 2) {
    while (uart.available()) {
      int c = uart.read();
      if (c >= 0x20 && c < 0x7F) s += static_cast<char>(c);
      last = millis();
    }
    if (s.length() > 0 && millis() - last > 50) break;
    delay(1);
  }
  return s;
}

int queryDleEot(uint8_t n) {
  drainRx();
  const uint8_t cmd[] = {0x10, 0x04, n};  // DLE EOT n（PDF 1.40）
  uart.write(cmd, sizeof(cmd));
  uart.flush();
  return readByte(PRINTER_STATUS_TIMEOUT_MS);
}

int queryGsR1() {
  drainRx();
  static const uint8_t cmd[] = {0x1D, 0x72, 0x01};  // GS r 1（PDF 1.25）
  uart.write(cmd, sizeof(cmd));
  uart.flush();
  return readByte(PRINTER_STATUS_TIMEOUT_MS);
}

// CTS（G19）の記録。設定に関係なく、送る区切りごとにピンを見て数える。
static BusyStats ctsStats;
static uint32_t rowsSentCount = 0;

static bool ctsBusyNow() { return digitalRead(PRINTER_PIN_CTS) == PRINTER_CTS_BUSY_LEVEL; }

// 受信できるまで待つ（PRINTER_USE_CTS のとき）。待たない設定でも記録は取る。
static bool waitClear(String& err) {
  bool busy = ctsBusyNow();
  ctsStats.sample(busy, millis());
#if PRINTER_USE_CTS
  const uint32_t start = millis();
  while (busy) {
    if (millis() - start > PRINTER_CTS_TIMEOUT_MS) {
      err = "printer_busy";
      return false;
    }
    delay(1);
    busy = ctsBusyNow();
    ctsStats.sample(busy, millis());
  }
#else
  (void)err;
#endif
  return true;
}

static bool sendBand(const uint8_t* data, uint16_t rows, String& err) {
  uint8_t header[kRasterHeaderSize];
  buildRasterHeader(header, kRowBytes, rows, 0);
  if (!waitClear(err)) return false;
  uart.write(header, sizeof(header));
  const size_t total = static_cast<size_t>(rows) * kRowBytes;
  for (size_t off = 0; off < total; off += PRINTER_CHUNK_BYTES) {
    if (!waitClear(err)) {
      // 受信できないまま残りを無理に送ることはしない。帯の途中で打ち切り、
      // 呼び出し元でプリンタを初期化し直す。プリンタは GS v 0 の残りのデータを待っている
      // 可能性があり、初期化命令がデータとして読まれるかもしれない（実機で未確認）。
      return false;
    }
    const size_t n = min(static_cast<size_t>(PRINTER_CHUNK_BYTES), total - off);
    uart.write(data + off, n);
#if PRINTER_CHUNK_DELAY_US > 0
    uart.flush();
    if (PRINTER_CHUNK_DELAY_US >= 1000) delay(PRINTER_CHUNK_DELAY_US / 1000);
    delayMicroseconds(PRINTER_CHUNK_DELAY_US % 1000);
#endif
  }
  uart.flush();  // 送り終わるまで待つ
  const uint32_t waitUs =
      static_cast<uint32_t>(rows) * PRINTER_ROW_DELAY_US + PRINTER_BAND_DELAY_MS * 1000UL;
  if (waitUs >= 1000) delay(waitUs / 1000);
  if (waitUs % 1000) delayMicroseconds(waitUs % 1000);
  ctsStats.sample(ctsBusyNow(), millis());
#if PRINTER_SYNC_AFTER_BAND
  // GS r 1 は受信済みのデータを処理し終えてから応答する（PDF 1.25 の説明）
  drainRx();
  static const uint8_t q[] = {0x1D, 0x72, 0x01};
  uart.write(q, sizeof(q));
  uart.flush();
  int v = readByte(PRINTER_SYNC_TIMEOUT_MS);
  if (v < 0) { err = "printer_no_response"; return false; }
  PaperState ps = interpretGsR1(static_cast<uint8_t>(v));
  if (ps.known && ps.paperOut) { err = "paper_out"; return false; }
#endif
  return true;
}

bool printStream(uint32_t height, uint16_t bandRows, RowReader reader, void* ctx,
                 String& err) {
  if (bandRows == 0 || bandRows > FETCH_ROWS) bandRows = FETCH_ROWS;
  ctsStats.reset();
  rowsSentCount = 0;
  init();
  uint32_t offset = 0;
  bool ok = true;
  while (offset < height) {
    const uint16_t rows = nextBandRows(height - offset, bandRows);
    // 帯を全部受け取ってからヘッダを送る。受け取りに失敗しても、
    // プリンタが GS v 0 のデータ待ちのまま残ることはない。
    if (!reader(ctx, offset, rows, bandBuf, err)) {
      if (err.length() == 0) err = "read_failed";
      ok = false;
      break;
    }
    if (!sendBand(bandBuf, rows, err)) {
      ok = false;
      break;
    }
    offset += rows;
    rowsSentCount = offset;
  }
  ctsStats.finish(millis());
  if (!ok) init();
  return ok;
}

uint32_t rowsSent() { return rowsSentCount; }
uint32_t ctsBusyCount() { return ctsStats.count; }
uint32_t ctsBusyMs() { return ctsStats.totalMs; }

void feed() {
  for (int i = 0; i < PRINTER_FEED_LINES; ++i) uart.write(static_cast<uint8_t>(0x0A));
  uart.flush();
}

static bool patternReader(void* ctx, uint32_t offset, uint16_t rows, uint8_t* buf,
                          String& err) {
  (void)err;
  const Pattern p = *static_cast<Pattern*>(ctx);
  for (uint16_t i = 0; i < rows; ++i)
    fillPatternRow(p, static_cast<uint16_t>(offset + i), buf + static_cast<size_t>(i) * kRowBytes);
  return true;
}

bool printPattern(Pattern p, String& err) {
  Pattern pp = p;
  bool ok = printStream(patternHeight(p), FETCH_ROWS, patternReader, &pp, err);
  if (ok) feed();
  return ok;
}

}  // namespace printer
