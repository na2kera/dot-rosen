// プリンタ（UART）との通信
#pragma once

#include <Arduino.h>

#include "rosen_core.h"

// 帯のデータを取ってくる関数。offset 行目から rows 行ぶん（rows*48 バイト）を buf に入れる。
// 失敗したら false を返し、err に短い理由（英数字）を入れる。
typedef bool (*RowReader)(void* ctx, uint32_t offset, uint16_t rows, uint8_t* buf,
                          String& err);

namespace printer {

void begin();
// ESC @（初期化）。ATOM_PRINTER_CMD.h 2 行目 INIT_PRINTER_CMD = {0x1B, 0x40}
void init();
uint32_t baud();
// G19（CTS 相当）の今の電圧（STATUS で極性を確かめる用）
int ctsLevel();

// ESC ## SBDR を今の速度で送り、こちらの速度も変える。
void changeBaud(uint32_t newBaud);
// こちら側の速度だけ変える（プリンタへは何も送らない。速度が食い違ったときの復旧用）
void setLocalBaud(uint32_t newBaud);
// GS g 7（PDF 5.8「返回串口波特率」）を送り、返ってきた文字列を返す。無ければ空
String queryBaud();

// 状態問い合わせ。応答のバイト（無ければ -1）を返す。
int queryDleEot(uint8_t n);  // 10 04 n
int queryGsR1();             // 1D 72 01

// 縦の倍率（%、100〜200）。範囲外は無視して false。
// printStream の最初に読むので、印刷の途中で変えても次の印刷から効く。
bool setVScale(uint16_t percent);
uint16_t vscale();

// 高さ height 行の画像を、帯（最大 bandRows 行）ごとに reader から読んで印刷する。
// 縦の倍率が 100 でなければ、プリンタへ送る行だけを水増しする（rosen::VScale）。
// reader に渡す offset / rows と rowsSent() は元の行数のまま。
// 失敗したら false。err に理由。
// ヘッダを送る前の失敗（取得の失敗など）ならプリンタを初期化し直す。
// 帯の途中（ヘッダ送信後、データを送り切る前）で打ち切ったときは err = "uart_stall" とし、
// プリンタには何も送らない（lastFailure() == MidBand）。
bool printStream(uint32_t height, uint16_t bandRows, RowReader reader, void* ctx,
                 String& err);
// 最後の printStream の失敗のしかた
rosen::PrintFail lastFailure();
// 最後の printStream のあとに紙送りしてよければ紙を送って true（帯の途中で止まったときは送らず false）
bool feedIfSafe();
// 今の（または最後の）印刷で送り終えた行数
uint32_t rowsSent();
// 最後の印刷中に G19 が busy（PRINTER_CTS_BUSY_LEVEL）になった回数と累積時間（ms）。
// PRINTER_USE_CTS に関係なく、送る区切りごとにピンを見て記録している。
uint32_t ctsBusyCount();
uint32_t ctsBusyMs();
// 紙送り（LF を PRINTER_FEED_LINES 回）
void feed();
// 内蔵のテストパターンを印刷する
bool printPattern(rosen::Pattern p, String& err);

}  // namespace printer
