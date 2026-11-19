// 編成の組み方の決まり（どの車両にパンタグラフを載せるか）。

/**
 * 両数 n の編成で、各車両にパンタグラフを載せるか（先頭が 0）。
 * - 1両: その1両に載せる。
 * - 2両: 2両目に載せる。
 * - 3両以上: 先頭と最後尾には載せず、2両目から3両おき（2, 5, 8, … 両目）に載せる。
 * 屋根の機器が「なし」のときは、呼び出し側で全車なしにする。
 */
export function pantographCars(n: number): boolean[] {
  const out = new Array<boolean>(Math.max(0, n)).fill(false);
  if (n === 1) out[0] = true;
  else if (n === 2) out[1] = true;
  else for (let i = 1; i < n - 1; i += 3) out[i] = true;
  return out;
}
