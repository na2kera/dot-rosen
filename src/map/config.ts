// 地図の画面の決まり（ここを変えれば地図全体に反映される）。

/** 地図の1ドットを画面の何 px で表すか（整数。端末の画素に合わせて整数倍に丸める） */
export const MAP_DOT_PX = 2;

/** 駅の当たりの半径（px）。指の太さを考えて広め */
export const HIT_RADIUS_PX = 22;

/** これより近い駅が隣にあると「区別できない」とみなし、選ばずに拡大する（px） */
export const DENSE_SEP_PX = 20;

/** 隣の駅との距離の差がこれ未満のタップは、どちらを押したか区別できないとみなす（px） */
export const AMBIGUOUS_PX = 8;

/** 密集した場所を拡大するとき、隣の駅との間をこれだけ空ける（px） */
export const DENSE_TARGET_PX = 48;

/** 駅名を出し始める拡大度（1度あたりのドット数） */
export const LABEL_MIN_Z = 1400;

/** これより引いているときは、乗り入れ路線が2つ以上の駅だけ名前を出す */
export const LABEL_ALL_Z = 5000;

/** 自分の路線の線の太さ（ドット）と縁の太さ */
export const ROUTE_LINE_DOTS = 3;
export const ROUTE_EDGE_DOTS = 1;

/** 最初の表示: 山手線の内側がだいたい入る範囲（駅データの山手線の駅と東京駅から求めた範囲） */
export const INITIAL_VIEW = { minLon: 139.695, minLat: 35.615, maxLon: 139.775, maxLat: 35.742 } as const;

/** ダブルタップとみなす間隔（ミリ秒）と距離（px） */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 24;

/** タップとみなす指の動きの上限（px） */
export const TAP_SLOP_PX = 8;

/** 駅を加えたときの印の効果の長さ（ミリ秒） */
export const PULSE_MS = 360;
