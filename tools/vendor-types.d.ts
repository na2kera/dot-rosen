// 型定義の無い依存のための最小限の宣言（tools で使う部分だけ）。

declare module "opentype.js" {
  export type PathCommand =
    | { type: "M" | "L"; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Z" };
  export interface Glyph {
    index: number;
    name: string | null;
    unicode: number | undefined;
    advanceWidth: number;
    /** フォントの単位、上向きが正の座標 */
    path: { commands: PathCommand[] };
  }
  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    numGlyphs: number;
    glyphs: { get(index: number): Glyph };
    charToGlyph(ch: string): Glyph;
    charToGlyphIndex(ch: string): number;
    names: Record<string, unknown>;
  }
  export function parse(buffer: ArrayBuffer): Font;
  // Node からは CommonJS として読み込まれるので default 経由で使う
  const opentype: { parse: typeof parse };
  export default opentype;
}

declare module "wawoff2" {
  export function compress(input: Uint8Array): Promise<Uint8Array>;
  export function decompress(input: Uint8Array): Promise<Uint8Array>;
}
