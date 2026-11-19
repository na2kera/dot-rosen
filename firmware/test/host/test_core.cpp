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
  // 起動直後（lastActivity = 起動時刻）
  CHECK(pollInterval(0, 0, false, F, S, IDLE) == F);
  CHECK(pollInterval(119999, 0, false, F, S, IDLE) == F);
  CHECK(pollInterval(120000, 0, false, F, S, IDLE) == S);  // ちょうど 2 分で延ばす
  CHECK(pollInterval(500000, 0, false, F, S, IDLE) == S);
  // 印刷を受け取った・ボタンを押した → 短い方に戻る
  CHECK(pollInterval(500000, 499000, false, F, S, IDLE) == F);
  CHECK(pollInterval(500000 + IDLE, 500000, false, F, S, IDLE) == S);
  // 未送信の完了報告があれば常に短い方
  CHECK(pollInterval(500000, 0, true, F, S, IDLE) == F);
  // millis() の桁あふれをまたぐ
  CHECK(pollInterval(0x00000100u, 0xFFFFFF00u, false, F, S, IDLE) == F);
  CHECK(pollInterval(0x00020000u, 0xFFFFFF00u, false, F, S, IDLE) == S);  // 約 131 秒後
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
  testClaimCommand();
  testStrings();
  if (argc > 1) {
    writePbm(argv[1], Pattern::Test1, "test1.pbm");
    writePbm(argv[1], Pattern::Test2, "test2.pbm");
    writePbm(argv[1], Pattern::Short, "short.pbm");
  }
  printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
