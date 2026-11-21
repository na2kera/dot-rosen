// Esc キーは、いちばん手前に出ているもの（確認ダイアログ、シート）だけが受け取る。
// 後から登録したものが手前。DOM の keydown を 1 つだけ聞く。

const stack: (() => void)[] = [];
let listening = false;

function onKey(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top();
}

/** Esc で呼ぶものを手前に積む。戻り値を呼ぶと外す */
export function pushEscape(fn: () => void): () => void {
  stack.push(fn);
  if (!listening) {
    window.addEventListener("keydown", onKey);
    listening = true;
  }
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}
