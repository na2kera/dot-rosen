// secrets.h があればそれを、無ければ secrets.example.h（ダミー値）を使う。
#pragma once

#if __has_include("secrets.h")
#include "secrets.h"
#define SECRETS_FROM_EXAMPLE 0
#else
#include "secrets.example.h"
#define SECRETS_FROM_EXAMPLE 1
#endif

#if !defined(WIFI_SSID) || !defined(WIFI_PASS) || !defined(SERVER_URL) || !defined(PRINTER_TOKEN)
#error "secrets.h に WIFI_SSID / WIFI_PASS / SERVER_URL / PRINTER_TOKEN を定義してください"
#endif
