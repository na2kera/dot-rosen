// PC 上で動かすテスト（機器に依存しない部分）。
//   c++ -std=c++17 -Wall -Wextra -I lib/rosen_core/src lib/rosen_core/src/rosen_core.cpp \
//       test/host/test_core.cpp -o .pio/test_core && .pio/test_core
// オプション: 第 1 引数にディレクトリを渡すと、テストパターンを PBM 画像で書き出す（目で確かめる用）。
#include <stdio.h>
#include <string.h>

#include <string>
#include <vector>

#include "rosen_core.h"

using namespace rosen;

static int failures = 0;
static int checks = 0;
#define CHECK(cond)                                                     \
  do {                                                                  \
    ++checks;                                                           \
    if (!(cond)) {                                                      \
      ++failures;                                                       \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);   \
    }                                                                   \
  } while (0)

static bool dot(const uint8_t* row, int x) { return (row[x >> 3] >> (7 - (x & 7))) & 1; }

static void testRasterHeader() {
  uint8_t h[kRasterHeaderSize];
  buildRasterHeader(h, 48, 96);
  const uint8_t e1[] = {0x1D, 0x76, 0x30, 0x00, 48, 0x00, 96, 0x00};
  CHECK(memcmp(h, e1, 8) == 0);
  buildRasterHeader(h, 48, 300, 0);  // 255 を超える高さ（公式 printBMP で問題になった範囲）
  const uint8_t e2[] = {0x1D, 0x76, 0x30, 0x00, 48, 0x00, 0x2C, 0x01};
  CHECK(memcmp(h, e2, 8) == 0);
  buildRasterHeader(h, 0x0130, 2200, 7);  // mode は 3 で頭打ち
  CHECK(h[3] == 3 && h[4] == 0x30 && h[5] == 0x01 && h[6] == 0x98 && h[7] == 0x08);
}

static void testBands() {
  CHECK(bandCount(2200, 96) == 23);
  CHECK(bandCount(96, 96) == 1);
  CHECK(bandCount(97, 96) == 2);
  CHECK(bandCount(0, 96) == 0);
  CHECK(bandCount(10, 0) == 0);
  // 2200 行を 96 行ずつ: 22 帯 x 96 + 最後 88
  uint32_t remaining = 2200, sum = 0, n = 0, last = 0;
  while (remaining) {
    uint16_t r = nextBandRows(remaining, 96);
    CHECK(r >= 1 && r <= 96);
    sum += r; remaining -= r; ++n; last = r;
  }
  CHECK(sum == 2200 && n == 23 && last == 88);
  CHECK(nextBandRows(5, 96) == 5);
  CHECK(nextBandRows(1000, 240) == 240);
}

static void testBaudCmd() {
  uint8_t c[kBaudCmdSize];
  buildBaudCmd(c, 115200);
  // 公式ドキュメントと PDF 2.8 の例: 1B 23 23 53 42 44 52 00 C2 01 00
  const uint8_t e115[] = {0x1B, 0x23, 0x23, 0x53, 0x42, 0x44, 0x52, 0x00, 0xC2, 0x01, 0x00};
  CHECK(memcmp(c, e115, sizeof(e115)) == 0);
  buildBaudCmd(c, 9600);
  // 公式ドキュメント: (9600:X=0x80,0x25,0x00,0x00)
  const uint8_t e96[] = {0x1B, 0x23, 0x23, 0x53, 0x42, 0x44, 0x52, 0x80, 0x25, 0x00, 0x00};
  CHECK(memcmp(c, e96, sizeof(e96)) == 0);

  uint8_t d[kDensityCmdSize];
  buildDensityCmd(d, 3);  // PDF 2.10 の例: 1B 23 23 53 54 44 50 03
  const uint8_t ed[] = {0x1B, 0x23, 0x23, 0x53, 0x54, 0x44, 0x50, 0x03};
  CHECK(memcmp(d, ed, sizeof(ed)) == 0);
}

static void testStatus() {
  PaperState s = interpretDleEot(2, 0x12);
  CHECK(s.known && !s.paperOut && !s.error);
  s = interpretDleEot(2, 0x32);
  CHECK(s.known && s.paperOut);
  s = interpretDleEot(2, 0x00);  // 固定ビットが合わない
  CHECK(!s.known);
  s = interpretDleEot(4, 0x12 | 0x0C);
  CHECK(s.known && s.nearEnd && !s.paperOut);
  s = interpretDleEot(4, 0x12 | 0x40);
  CHECK(s.known && s.paperOut);
  s = interpretGsR1(0x00);
  CHECK(s.known && !s.paperOut && !s.nearEnd);
  s = interpretGsR1(0x0C);
  CHECK(s.known && s.paperOut);
  s = interpretGsR1(0x03);
  CHECK(s.known && s.nearEnd && !s.paperOut);
  s = interpretGsR1(0x90);
  CHECK(!s.known);
}

static double blackRatio(Pattern p, int y0, int y1, int x0, int x1) {
  uint8_t row[kRowBytes];
  long black = 0, total = 0;
  for (int y = y0; y < y1; ++y) {
    fillPatternRow(p, static_cast<uint16_t>(y), row);
    for (int x = x0; x < x1; ++x) { black += dot(row, x); ++total; }
  }
  return static_cast<double>(black) / total;
}

static void testPatterns() {
  CHECK(patternHeight(Pattern::Test1) == 400);
  CHECK(patternHeight(Pattern::Test2) == 192);
  CHECK(patternHeight(Pattern::Short) == 64);

  uint8_t row[kRowBytes];
  // 左右端の線
  for (int y : {0, 50, 200, 399}) {
    fillPatternRow(Pattern::Test1, y, row);
    CHECK(dot(row, 0) && dot(row, 1) && dot(row, 382) && dot(row, 383));
  }
  // 1 ドット縦線（y=40, x=8.. は 1 ドットおき）
  fillPatternRow(Pattern::Test1, 40, row);
  CHECK(dot(row, 8) && !dot(row, 9) && dot(row, 10));
  CHECK(dot(row, 196) && dot(row, 197) && !dot(row, 198) && !dot(row, 199));
  // 市松
  fillPatternRow(Pattern::Test1, 168, row);
  CHECK(dot(row, 8) && !dot(row, 9));
  // 濃さの段階: 各段の黒の割合が 10%..100% に近い
  for (int step = 0; step < 10; ++step) {
    const int x0 = 12 + step * 36;
    double r = blackRatio(Pattern::Test1, 240, 304, x0, x0 + 32);  // 32 = 8 の倍数で測る
    const double want = (step + 1) / 10.0;
    CHECK(r > want - 0.03 && r < want + 0.03);
  }
  // テスト 2: 50 / 75 / 100%
  CHECK(blackRatio(Pattern::Test2, 0, 64, 0, 384) == 0.5);
  CHECK(blackRatio(Pattern::Test2, 64, 128, 0, 384) == 0.75);
  CHECK(blackRatio(Pattern::Test2, 128, 192, 0, 384) == 1.0);
  CHECK(ditherBlack(0, 0, 100) && !ditherBlack(0, 0, 0));
}

static void testParse() {
  CHECK(parseCommand("STATUS").type == CmdType::Status);
  CHECK(parseCommand("  status \r\n").type == CmdType::Status);
  CHECK(parseCommand("").type == CmdType::Empty);
  Command c = parseCommand("TEST 1");
  CHECK(c.type == CmdType::Test && c.arg == 1);
  c = parseCommand("test 2");
  CHECK(c.type == CmdType::Test && c.arg == 2);
  CHECK(parseCommand("TEST 3").type == CmdType::Unknown);
  c = parseCommand("BAUD 115200");
  CHECK(c.type == CmdType::Baud && c.arg == 115200);
  CHECK(parseCommand("BAUD 57600").type == CmdType::Unknown);
  c = parseCommand("BAUD LOCAL 9600");
  CHECK(c.type == CmdType::BaudLocal && c.arg == 9600);
  CHECK(parseCommand("BAUD ?").type == CmdType::BaudQuery);
  CHECK(parseCommand("PAPER").type == CmdType::Paper);
  c = parseCommand("PRINT 2200");
  CHECK(c.type == CmdType::Print && c.arg == 2200);
  CHECK(parseCommand("PRINT 0").type == CmdType::Unknown);
  CHECK(parseCommand("PRINT -1").type == CmdType::Unknown);
  CHECK(parseCommand("PRINT abc").type == CmdType::Unknown);
  CHECK(parseCommand("PRINT 1234567890").type == CmdType::Unknown);
  CHECK(parseCommand("HELLO").type == CmdType::Unknown);
}

static void testClaim() {
  ClaimInfo c{};
  CHECK(parseClaimJson("{\"jobId\":42,\"width\":384,\"height\":1800}", c));
  CHECK(c.jobId == 42 && c.width == 384 && c.height == 1800);
  CHECK(parseClaimJson("{ \"height\" : 10 , \"width\": 384, \"jobId\" :7 }", c));
  CHECK(c.jobId == 7 && c.height == 10);
  CHECK(!parseClaimJson("{\"jobId\":\"7\",\"width\":384,\"height\":10}", c));  // 文字列は不可
  CHECK(!parseClaimJson("{\"jobId\":7,\"width\":384}", c));
  CHECK(!parseClaimJson("{\"jobId\":7.5,\"width\":384,\"height\":10}", c));
  CHECK(!parseClaimJson("{\"jobId\":-1,\"width\":384,\"height\":10}", c));
  CHECK(!parseClaimJson("{\"jobId\":99999999999,\"width\":384,\"height\":10}", c));
  // 似た名前のキーに引っかからない
  CHECK(parseClaimJson("{\"xjobId\":1,\"jobIdx\":2,\"jobId\":3,\"width\":384,\"height\":4}", c));
  CHECK(c.jobId == 3);
  CHECK(!parseClaimJson(nullptr, c));
}

static ClaimCheck cc(const char* s, ClaimInfo& c) { return checkClaim(s, strlen(s), 3200, c); }

static void testClaimStrict() {
  ClaimInfo c{};
  CHECK(cc("{\"jobId\":42,\"width\":384,\"height\":1800}", c) == ClaimCheck::Ok);
  CHECK(c.jobId == 42 && c.height == 1800);
  CHECK(cc(" \r\n{\"jobId\":1,\"width\":384,\"height\":3200}\n", c) == ClaimCheck::Ok);
  // 知らないキー（入れ子・文字列・真偽値・null）は読み飛ばす
  CHECK(cc("{\"x\":{\"a\":[1,2,{\"b\":\"}\"}]},\"jobId\":5,\"s\":\"a\\\"b\",\"t\":true,"
           "\"n\":null,\"f\":-1.5e3,\"width\":384,\"height\":10}", c) == ClaimCheck::Ok);
  CHECK(c.jobId == 5);
  // 高さ・幅の範囲
  CHECK(cc("{\"jobId\":7,\"width\":384,\"height\":0}", c) == ClaimCheck::BadWithJob && c.jobId == 7);
  CHECK(cc("{\"jobId\":7,\"width\":384,\"height\":3201}", c) == ClaimCheck::BadWithJob);
  CHECK(cc("{\"jobId\":7,\"width\":383,\"height\":10}", c) == ClaimCheck::BadWithJob);
  // 欠け・壊れ
  CHECK(cc("{\"jobId\":7,\"width\":384}", c) == ClaimCheck::BadWithJob && c.jobId == 7);
  CHECK(cc("{\"jobId\":7,\"width\":384,\"height\":10", c) == ClaimCheck::BadWithJob);  // 閉じ括弧なし
  CHECK(cc("{\"jobId\":7,\"width\":384,\"height\":1", c) == ClaimCheck::BadWithJob);   // 数値の途中で切れた
  CHECK(cc("{\"jobId\":7,\"width\":384,\"height\":10}x", c) == ClaimCheck::BadWithJob);  // 後ろに余計なもの
  CHECK(cc("{\"jobId\":7,\"width\":384,\"height\":10.0}", c) == ClaimCheck::BadWithJob);  // 小数
  CHECK(cc("{\"jobId\":7,\"jobId\":8,\"width\":384,\"height\":10}", c) == ClaimCheck::BadWithJob);  // 重複
  CHECK(cc("{\"jobId\":7,,\"width\":384,\"height\":10}", c) == ClaimCheck::BadWithJob);
  // jobId が読めない
  CHECK(cc("{\"jobId\":\"7\",\"width\":384,\"height\":10}", c) == ClaimCheck::BadNoJob);
  CHECK(cc("{\"jobId\":-7,\"width\":384,\"height\":10}", c) == ClaimCheck::BadNoJob);
  CHECK(cc("{\"jobId\":12", c) == ClaimCheck::BadNoJob);  // 途中で切れている（123 の可能性）
  CHECK(cc("", c) == ClaimCheck::BadNoJob);
  CHECK(cc("<html>error</html>", c) == ClaimCheck::BadNoJob);
  CHECK(checkClaim(nullptr, 0, 3200, c) == ClaimCheck::BadNoJob);
  // NUL 終端が無くても len で止まる
  const char raw[] = "{\"jobId\":3,\"width\":384,\"height\":9}GARBAGE";
  CHECK(checkClaim(raw, strlen("{\"jobId\":3,\"width\":384,\"height\":9}"), 3200, c) == ClaimCheck::Ok);
}

static BodyReader::State feedAll(BodyReader& r, const char* s) {
  BodyReader::State st = r.state();
  for (const char* p = s; *p; ++p) st = r.feed(static_cast<uint8_t>(*p));
  return st;
}

static void testBodyReader() {
  uint8_t buf[32];
  BodyReader r;
  // Content-Length
  r.begin(BodyReader::Mode::Length, 5, buf, sizeof(buf));
  CHECK(feedAll(r, "hell") == BodyReader::State::More);
  CHECK(feedAll(r, "o") == BodyReader::State::Done && r.size() == 5 && memcmp(buf, "hello", 5) == 0);
  CHECK(r.feed('x') == BodyReader::State::Error);  // 余計なデータ
  r.begin(BodyReader::Mode::Length, 0, buf, sizeof(buf));
  CHECK(r.state() == BodyReader::State::Done);
  r.begin(BodyReader::Mode::Length, 33, buf, sizeof(buf));
  CHECK(r.state() == BodyReader::State::Error);  // 上限超え
  r.begin(BodyReader::Mode::Length, -1, buf, sizeof(buf));
  CHECK(r.state() == BodyReader::State::Error);
  // 捨てる（buf なし）なら上限なし
  r.begin(BodyReader::Mode::Length, 100, nullptr, 0);
  for (int i = 0; i < 99; ++i) r.feed('a');
  CHECK(r.state() == BodyReader::State::More);
  CHECK(r.feed('a') == BodyReader::State::Done);

  // chunked
  r.begin(BodyReader::Mode::Chunked, -1, buf, sizeof(buf));
  CHECK(feedAll(r, "4\r\nWiki\r\n5;ext=1\r\npedia\r\n") == BodyReader::State::More);
  CHECK(feedAll(r, "0\r\n") == BodyReader::State::More);  // まだ最後の空行が無い
  CHECK(feedAll(r, "\r\n") == BodyReader::State::Done);
  CHECK(r.size() == 9 && memcmp(buf, "Wikipedia", 9) == 0);
  // 16 進の大文字・トレーラーつき
  r.begin(BodyReader::Mode::Chunked, -1, buf, sizeof(buf));
  CHECK(feedAll(r, "A\r\n0123456789\r\n0\r\nX-T: 1\r\n\r\n") == BodyReader::State::Done);
  CHECK(r.size() == 10);
  // 壊れた chunked
  r.begin(BodyReader::Mode::Chunked, -1, buf, sizeof(buf));
  CHECK(feedAll(r, "4\r\nWikiXX") == BodyReader::State::Error);
  r.begin(BodyReader::Mode::Chunked, -1, buf, sizeof(buf));
  CHECK(feedAll(r, "zz\r\n") == BodyReader::State::Error);
  r.begin(BodyReader::Mode::Chunked, -1, buf, sizeof(buf));
  CHECK(feedAll(r, "\r\n") == BodyReader::State::Error);
  r.begin(BodyReader::Mode::Chunked, -1, buf, 4);
  CHECK(feedAll(r, "5\r\nabcde") == BodyReader::State::Error);  // 上限超え
  r.begin(BodyReader::Mode::Chunked, -1, buf, sizeof(buf));
  CHECK(feedAll(r, "FFFFFFFF\r\n") == BodyReader::State::Error);  // 大きすぎるチャンク
}

static void testDoneAndRetry() {
  CHECK(classifyDoneCode(200) == DoneOutcome::Accepted);
  CHECK(classifyDoneCode(409) == DoneOutcome::Conflict);
  CHECK(classifyDoneCode(500) == DoneOutcome::Retry);
  CHECK(classifyDoneCode(401) == DoneOutcome::Retry);
  CHECK(classifyDoneCode(-1) == DoneOutcome::Retry);
  CHECK(classifyDoneCode(204) == DoneOutcome::Retry);

  CHECK(!rowsRetryable(400) && !rowsRetryable(401) && !rowsRetryable(404) && !rowsRetryable(409));
  CHECK(rowsRetryable(500) && rowsRetryable(503) && rowsRetryable(-1) && rowsRetryable(-11));

  PendingDone p;
  CHECK(!p.active && !p.due(0));
  p.set(42, false, "rows http 500", 1000);
  CHECK(p.active && p.jobId == 42 && !p.ok && strcmp(p.error, "rows_http_500") == 0);
  CHECK(p.due(1000));
  p.retryLater(1000, 3000);
  CHECK(p.attempts == 1 && !p.due(3999) && p.due(4000));
  // millis() の桁あふれをまたいでも動く
  p.retryLater(0xFFFFF000u, 0x2000);
  CHECK(!p.due(0xFFFFFFF0u) && p.due(0x00001000u));
  p.clear();
  CHECK(!p.active && !p.due(0x00001000u));
  p.set(7, true, "ignored", 5);
  CHECK(p.ok && p.error[0] == '\0' && p.attempts == 0);
  p.set(8, false, "", 5);
  CHECK(strcmp(p.error, "unknown") == 0);
  std::string longErr(100, 'e');
  p.set(9, false, longErr.c_str(), 5);
  CHECK(strlen(p.error) == 64);
}

static void testPollInterval() {
  const uint32_t F = 3000, S = 10000, IDLE = 120000;
  PollIdle p;
  // 起動直後（起動時刻を活動とする）
  p.activity(0);
  CHECK(p.interval(0, false, F, S, IDLE) == F);
  CHECK(p.interval(119999, false, F, S, IDLE) == F);
  CHECK(p.interval(120000, false, F, S, IDLE) == S);  // ちょうど 2 分で延ばす
  CHECK(p.interval(500000, false, F, S, IDLE) == S);
  // 未送信の完了報告があれば常に短い方
  CHECK(p.interval(500000, true, F, S, IDLE) == F);
  // 印刷を受け取った・ボタンを押した → 短い方に戻る
  p.activity(499000);
  CHECK(p.interval(500000, false, F, S, IDLE) == F);
  CHECK(p.interval(499000 + IDLE, false, F, S, IDLE) == S);
}

// ---- 再レビューの指摘 F1 / F4（直す前の実装では落ちた）----
static void testLongOutage() {
  // F1: done の 404 は送り直さない
  CHECK(classifyDoneCode(404) != DoneOutcome::Retry);
  // F4: 約 25 日以上たっても送り直しが止まらない
  PendingDone q;
  q.set(1, true, "", 1000);
  q.retryLater(1000, 3000);
  CHECK(q.due(1000 + 0x80000000u + 5000));
  CHECK(q.due(1000 + 0xC0000000u));
}

// F1: done の 404 は「報告先が無い」終端結果。401 などは従来どおり送り直す
static void testDoneGone() {
  CHECK(classifyDoneCode(404) == DoneOutcome::Gone);
  CHECK(classifyDoneCode(401) == DoneOutcome::Retry);
  CHECK(classifyDoneCode(400) == DoneOutcome::Retry);
  CHECK(classifyDoneCode(410) == DoneOutcome::Retry);
}

// F2: 帯の取得の締切（無通信の待ちとは別に、総経過時間で打ち切る）
static void testDeadline() {
  Deadline d{1000, 90000};
  CHECK(!d.expired(1000) && !d.expired(90999) && d.expired(91000));
  CHECK(d.remaining(1000) == 90000 && d.remaining(61000) == 30000 && d.remaining(91000) == 0);
  CHECK(d.remaining(500000) == 0);
  // millis() の桁あふれをまたぐ
  Deadline w{0xFFFFF000u, 90000};
  CHECK(!w.expired(0xFFFFFFFFu) && !w.expired(0x00001000u));
  CHECK(w.expired(0xFFFFF000u + 90000u) && w.remaining(0xFFFFF000u + 89000u) == 1000);

  const uint32_t IDLE = 15000;
  // 1 秒に 1 バイトずつ届く: 無通信の待ちには掛からないが、90 秒で打ち切る
  uint32_t lastRx = 1000;
  ReadStop stop = ReadStop::Continue;
  uint32_t stoppedAt = 0;
  for (uint32_t now = 1000; now < 1000 + 5000000; now += 100) {
    if ((now - 1000) % 1000 == 0) lastRx = now;  // 受信
    stop = readStopCheck(now, lastRx, IDLE, d);
    if (stop != ReadStop::Continue) { stoppedAt = now; break; }
  }
  CHECK(stop == ReadStop::Total && stoppedAt == 91000);
  // 無通信なら 15 秒で打ち切る（締切より先）
  CHECK(readStopCheck(16000, 1000, IDLE, d) == ReadStop::Continue);
  CHECK(readStopCheck(16001, 1000, IDLE, d) == ReadStop::Idle);
  // 締切と無通信が同時なら締切を優先
  CHECK(readStopCheck(91000, 1000, IDLE, d) == ReadStop::Total);
}

// F3: 帯の途中で送信を打ち切ったあとの扱い
static void testAfterPrint() {
  AfterPrint a = planAfterPrint(PrintFail::None);
  CHECK(!a.resetPrinter && a.feedPaper && !a.stopAutoClaim);
  a = planAfterPrint(PrintFail::Clean);  // ヘッダを送る前の失敗（取得の失敗など）
  CHECK(a.resetPrinter && a.feedPaper && !a.stopAutoClaim);
  a = planAfterPrint(PrintFail::MidBand);  // ヘッダ送信後、データを送り切る前
  CHECK(!a.resetPrinter && !a.feedPaper && a.stopAutoClaim);
  CHECK(strcmp(kErrUartStall, "uart_stall") == 0);
}

// F5: 2 分たったら idle を保持し、印刷の受信・ボタン操作でだけ解除する
static void testPollIdle() {
  const uint32_t F = 3000, S = 10000, IDLE = 120000;
  PollIdle p;
  p.activity(0);
  CHECK(p.interval(119999, false, F, S, IDLE) == F);
  CHECK(p.interval(120000, false, F, S, IDLE) == S);
  // 約 49.7 日たって now が 1 周しても 10 秒のまま（途中も毎周期見ている）
  bool allSlow = true;
  for (uint64_t t = 120000; t <= 0x100000000ull + 200000; t += 3600000)
    allSlow &= p.interval(static_cast<uint32_t>(t), false, F, S, IDLE) == S;
  CHECK(allSlow);
  CHECK(p.interval(1000, false, F, S, IDLE) == S);  // 1 周して 1000 に戻った
  // 未送信の完了報告があれば常に短い方（idle は保持したまま）
  CHECK(p.interval(2000, true, F, S, IDLE) == F);
  CHECK(p.interval(2001, false, F, S, IDLE) == S);
  // 印刷の受信・ボタン操作で解除
  p.activity(5000);
  CHECK(p.interval(5001, false, F, S, IDLE) == F);
  CHECK(p.interval(5000 + IDLE - 1, false, F, S, IDLE) == F);
  CHECK(p.interval(5000 + IDLE, false, F, S, IDLE) == S);
  // 桁あふれの直前に活動があった場合
  p.activity(0xFFFFFF00u);
  CHECK(p.interval(0x00000100u, false, F, S, IDLE) == F);
  CHECK(p.interval(0x00020000u, false, F, S, IDLE) == S);  // 約 131 秒後
}

static void testBusyStats() {
  BusyStats s;
  s.sample(false, 0);
  s.sample(true, 10);
  s.sample(true, 20);
  s.sample(false, 35);  // 25ms
  s.sample(true, 100);
  s.finish(110);        // 10ms
  CHECK(s.count == 2 && s.totalMs == 35 && !s.inBusy);
  s.reset();
  CHECK(s.count == 0 && s.totalMs == 0);
}

// 高さ height を bandRows 行ずつに切って VScale を回し、元の行ごとの回数を返す
static std::vector<uint8_t> vscaleRun(uint32_t height, uint16_t pct, uint16_t bandRows) {
  std::vector<uint8_t> out;
  VScale v;
  v.begin(pct);
  uint32_t offset = 0;
  while (offset < height) {
    const uint16_t rows = nextBandRows(height - offset, bandRows);
    for (uint16_t i = 0; i < rows; ++i) out.push_back(v.repeat());
    offset += rows;
  }
  return out;
}

static uint32_t sumOf(const std::vector<uint8_t>& v) {
  uint32_t s = 0;
  for (uint8_t x : v) s += x;
  return s;
}

static void testVScale() {
  // 範囲
  CHECK(!vscaleValid(0));
  CHECK(!vscaleValid(99));
  CHECK(vscaleValid(100));
  CHECK(vscaleValid(113));
  CHECK(vscaleValid(200));
  CHECK(!vscaleValid(201));
  CHECK(!vscaleValid(100000));

  // 合計の行数（四捨五入）
  CHECK(vscaleOutputRows(400, 100) == 400);
  CHECK(vscaleOutputRows(400, 113) == 452);
  CHECK(vscaleOutputRows(400, 125) == 500);
  CHECK(vscaleOutputRows(400, 200) == 800);
  CHECK(vscaleOutputRows(3, 150) == 5);    // 4.5 → 5
  CHECK(vscaleOutputRows(1, 149) == 1);    // 1.49 → 1
  CHECK(vscaleOutputRows(1, 150) == 2);    // 1.5 → 2
  CHECK(vscaleOutputRows(0, 150) == 0);
  CHECK(vscaleOutputRows(3200, 200) == 6400);
  CHECK(vscaleOutputRows(3200, 199) == 6368);

  // 100% は常に 1 回
  {
    std::vector<uint8_t> r = vscaleRun(3200, 100, 96);
    bool allOne = true;
    for (uint8_t x : r) allOne &= (x == 1);
    CHECK(allOne && r.size() == 3200);
  }
  // 200% はすべて 2 回
  {
    std::vector<uint8_t> r = vscaleRun(3200, 200, 96);
    bool allTwo = true;
    for (uint8_t x : r) allTwo &= (x == 2);
    CHECK(allTwo);
  }
  // 133%: ほぼ 3 行ごとに 1 行足す（2 回の行の間隔は 3 か 4。133 は 4/3 より少し小さい）
  {
    std::vector<uint8_t> r = vscaleRun(300, 133, 96);
    CHECK(r[0] == 1 && r[1] == 2 && r[2] == 1 && r[3] == 1 && r[4] == 2);
    bool even = true;
    int last = -1, twos = 0;
    for (size_t i = 0; i < r.size(); ++i) {
      if (r[i] != 2) continue;
      if (last >= 0) even &= (i - last == 3 || i - last == 4);
      last = static_cast<int>(i);
      ++twos;
    }
    CHECK(even);
    CHECK(twos == 99 && sumOf(r) == 399);
  }
  // 125%: 4 行ごとに 1 行足す（間隔はちょうど 4）
  {
    std::vector<uint8_t> r = vscaleRun(400, 125, 96);
    bool even = true;
    for (size_t i = 0; i < r.size(); ++i) even &= (r[i] == ((i % 4 == 1) ? 2 : 1));
    CHECK(even);
  }
  // 範囲外を渡したら 100 として扱う
  {
    std::vector<uint8_t> r = vscaleRun(50, 250, 96);
    CHECK(sumOf(r) == 50);
    r = vscaleRun(50, 0, 96);
    CHECK(sumOf(r) == 50);
  }

  // 合計・各行の回数（1 か 2）・途中の累計・帯の切り方によらないこと
  const uint32_t heights[] = {1, 2, 3, 95, 96, 97, 400, 2200, 3200};
  const uint16_t pcts[] = {100, 101, 110, 113, 120, 125, 133, 150, 167, 199, 200};
  const uint16_t bands[] = {1, 7, 96, 240};
  for (uint32_t h : heights) {
    for (uint16_t p : pcts) {
      const std::vector<uint8_t> ref = vscaleRun(h, p, 96);
      CHECK(ref.size() == h);
      CHECK(sumOf(ref) == vscaleOutputRows(h, p));
      bool ok = true;
      uint32_t acc = 0;
      for (size_t i = 0; i < ref.size(); ++i) {
        ok &= (ref[i] == 1 || ref[i] == 2);
        acc += ref[i];
        ok &= (acc == vscaleOutputRows(static_cast<uint32_t>(i + 1), p));  // 均等に散らす
      }
      CHECK(ok);
      for (uint16_t b : bands) CHECK(vscaleRun(h, p, b) == ref);
    }
  }
  // 1 つの帯（最大 240 行）を水増ししても 2 倍の 480 行まで（ヘッダの上限 255 で分ける前提）
  CHECK(vscaleOutputRows(240, 200) == 480);
}

static void testVScaleCommand() {
  Command c = parseCommand("VSCALE 113");
  CHECK(c.type == CmdType::VScale && c.arg == 113);
  c = parseCommand("vscale 100");
  CHECK(c.type == CmdType::VScale && c.arg == 100);
  c = parseCommand("VSCALE 200");
  CHECK(c.type == CmdType::VScale && c.arg == 200);
  CHECK(parseCommand("VSCALE").type == CmdType::VScaleQuery);
  CHECK(parseCommand(" vscale ? ").type == CmdType::VScaleQuery);
  CHECK(parseCommand("VSCALE 99").type == CmdType::VScaleBad);
  CHECK(parseCommand("VSCALE 201").type == CmdType::VScaleBad);
  CHECK(parseCommand("VSCALE 0").type == CmdType::VScaleBad);
  CHECK(parseCommand("VSCALE abc").type == CmdType::VScaleBad);
  CHECK(parseCommand("VSCALE -110").type == CmdType::VScaleBad);
  CHECK(parseCommand("VSCALE 11.3").type == CmdType::VScaleBad);
  CHECK(parseCommand("VSCALE 1234567890").type == CmdType::VScaleBad);
  CHECK(parseCommand("VSCALE 110 120").type == CmdType::VScaleBad);
  CHECK(parseCommand("VSCALE 110 120 130").type == CmdType::VScaleBad);
}

static void testClaimCommand() {
  Command c = parseCommand("CLAIM ON");
  CHECK(c.type == CmdType::Claim && c.arg == 1);
  c = parseCommand("claim off");
  CHECK(c.type == CmdType::Claim && c.arg == 0);
  CHECK(parseCommand("CLAIM").type == CmdType::Unknown);
  CHECK(parseCommand("CLAIM MAYBE").type == CmdType::Unknown);
}

static void testStrings() {
  char out[80];
  sanitizeErrorCode("rows http 500 \"x\"\\", out, sizeof(out));
  CHECK(strcmp(out, "rows_http_500__x__") == 0);
  std::string longIn(100, 'a');
  CHECK(sanitizeErrorCode(longIn.c_str(), out, sizeof(out), 64) == 64);
  CHECK(strlen(out) == 64);
  jsonEscape("a\"b\\c\n", out, sizeof(out));
  CHECK(strcmp(out, "a\\\"b\\\\c\\u000a") == 0);
  char small[4];
  jsonEscape("abcdef", small, sizeof(small));
  CHECK(strcmp(small, "abc") == 0);
  CHECK(trimmedUrlLength("https://x.workers.dev/") == strlen("https://x.workers.dev"));
  CHECK(trimmedUrlLength("https://x.workers.dev") == strlen("https://x.workers.dev"));
}

static void writePbm(const char* dir, Pattern p, const char* name) {
  std::string path = std::string(dir) + "/" + name;
  FILE* f = fopen(path.c_str(), "wb");
  if (!f) { fprintf(stderr, "cannot write %s\n", path.c_str()); return; }
  fprintf(f, "P4\n%d %d\n", kWidthDots, patternHeight(p));
  uint8_t row[kRowBytes];
  for (int y = 0; y < patternHeight(p); ++y) {
    fillPatternRow(p, static_cast<uint16_t>(y), row);
    fwrite(row, 1, kRowBytes, f);  // PBM も 1 が黒・左が最上位ビット
  }
  fclose(f);
  printf("wrote %s\n", path.c_str());
}

int main(int argc, char** argv) {
  testRasterHeader();
  testBands();
  testBaudCmd();
  testStatus();
  testPatterns();
  testParse();
  testClaim();
  testClaimStrict();
  testBodyReader();
  testDoneAndRetry();
  testBusyStats();
  testPollInterval();
  testLongOutage();
  testDoneGone();
  testDeadline();
  testAfterPrint();
  testPollIdle();
  testClaimCommand();
  testVScale();
  testVScaleCommand();
  testStrings();
  if (argc > 1) {
    writePbm(argv[1], Pattern::Test1, "test1.pbm");
    writePbm(argv[1], Pattern::Test2, "test2.pbm");
    writePbm(argv[1], Pattern::Short, "short.pbm");
  }
  printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
