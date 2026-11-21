// 「X で共有」ボタン（「できあがり」と路線のページで使う）。
// 押せるときだけ X の投稿画面へのリンクにする（押したあとに通信を挟まない。スマホで開かなくなるため）。
// 押せないときは disabled のボタンにして、理由を 1 行添える。
import { PixelIcon } from "../ui/PixelIcon.tsx";

type Props = {
  /** X の投稿画面の URL。null なら押せない */
  href: string | null;
  /** 押せないときに添える理由 */
  reason?: string;
};

export function XShareButton({ href, reason }: Props) {
  if (href)
    return (
      <a className="btn btn--block" href={href} target="_blank" rel="noopener">
        <PixelIcon name="share" />X で共有
      </a>
    );
  return (
    <>
      <button type="button" className="btn btn--block" disabled>
        <PixelIcon name="share" />X で共有
      </button>
      {reason && <p className="text-weak">{reason}</p>}
    </>
  );
}
