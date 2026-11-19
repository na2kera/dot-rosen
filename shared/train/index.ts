// 電車のデザインとドット絵（正面の顔、側面、編成、白黒変換、既製ロゴ）。
// DOM にも Node にも依存しない。乱数は引数で受け取る。
export * from "./colors.ts";
export * from "./design.ts";
export * from "./logos.ts";
export * from "./geometry.ts";
export * from "./consist-rules.ts";
export * from "./face.ts";
export * from "./car.ts";
export * from "./mono.ts";
export { drawTrack } from "./draw.ts";
