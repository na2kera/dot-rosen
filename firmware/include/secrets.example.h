// secrets.h の見本。このファイルには本当の値を書かない。
// 使い方: このファイルを include/secrets.h にコピーして値を書き換える（secrets.h は .gitignore 済み）。
// secrets.h が無いときはこのファイルが使われ、Wi-Fi に接続しない（テスト印刷と USB だけ動く）。
#pragma once

#define WIFI_SSID ""            // 空なら Wi-Fi に接続しない
#define WIFI_PASS ""
#define SERVER_URL "https://example.workers.dev"  // 末尾の / は無くてよい
#define PRINTER_TOKEN "change-me"                   // Worker の PRINTER_TOKEN と同じ値
