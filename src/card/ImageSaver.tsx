// 「画像を保存」ボタン。iPhone などでダウンロードできないときは、画像を表示して長押しで保存してもらう
import { useEffect, useState } from "react";
import type { IndexedImage, Palette } from "../../shared/pix/index.ts";
import { Button } from "../ui/Button.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { toast } from "../ui/Toast.tsx";
import { cardPngBlob, imageFileName, saveImage } from "./save-image.ts";

type Props = { card: { image: IndexedImage; palette: Palette } | null; routeName: string };

export function ImageSaver({ card, routeName }: Props) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  // 共有はタップの直後に呼ぶ必要があるので、画像は先に作っておく
  useEffect(() => {
    setBlob(null);
    if (!card) return;
    let alive = true;
    const t = setTimeout(() => {
      cardPngBlob(card).then(
        (b) => alive && setBlob(b),
        () => alive && toast("画像を作れませんでした", { tone: "alert" }),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [card]);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  const onSave = async () => {
    if (!blob) return;
    const r = await saveImage(blob, imageFileName(routeName));
    if (r === "preview") setPreview(true);
    else if (r === "downloaded") toast("画像を保存しました");
  };

  return (
    <div className="image-saver">
      <Button icon="save" block onClick={onSave} disabled={!blob}>
        {blob ? "画像を保存" : "画像を準備中…"}
      </Button>
      <button type="button" className="linkish" onClick={() => setPreview(true)} disabled={!url}>
        うまく保存できないときは、画像を表示して長押し
      </button>
      <Sheet open={preview && !!url} title="画像を保存" onClose={() => setPreview(false)}>
        <p className="image-saver__hint">画像を長押しして「写真に保存」や「画像を保存」をえらんでね</p>
        {url && <img className="image-saver__img pix" src={url} alt={`${routeName}の路線カード`} />}
      </Sheet>
    </div>
  );
}
