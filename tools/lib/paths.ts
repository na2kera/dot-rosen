// リポジトリの場所。tools/run.mjs がまとめたスクリプトは tools/out/.run/ で動くので、
// import.meta.dirname ではなく run.mjs が渡す環境変数（無ければ今のディレクトリ）を使う。
import path from "node:path";

export const ROOT = path.resolve(process.env.DOT_ROSEN_ROOT ?? process.cwd());
