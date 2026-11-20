// ステップ4「できあがり」。上に路線カード（固定、枠の中でスクロール）、下に保存・画像・印刷。
import { useEffect, useState } from "react";
import { formatIssueNo } from "../../../shared/card/index.ts";
import { parseRouteData, type RouteData } from "../../../shared/route/index.ts";
import { errorMessage } from "../../api/client.ts";
import { useApp, useDraft } from "../../app/AppContext.tsx";
import { DeleteRouteButton } from "../../app/DeleteRouteButton.tsx";
import { getApi, getPublish } from "../../app/services.ts";
import { CardView } from "../../card/CardView.tsx";
import { ImageSaver } from "../../card/ImageSaver.tsx";
import { previewLook } from "../../card/card-input.ts";
import { routeUrl, useBitmapFont, useCard, useServerCardLook } from "../../card/useCard.ts";
import { getEventCode } from "../../store/device.ts";
import { isTerminal, PRINT_RECORD_REASON, type PublishState } from "../../store/publish-store.ts";
import { routeErrorStep, routeErrorText } from "../../store/route-errors.ts";
import { useStore } from "../../store/use-store.ts";
import { Button } from "../../ui/Button.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { toast } from "../../ui/Toast.tsx";
import { PRINT_VENUE_GUIDE, printPanelMode, type EventState } from "./print-panel-mode.ts";

export function FinishStep() {
  const { data, ui } = useApp();
  const draft = useDraft();
  const publish = getPublish();
  const pub = useStore(publish.store);
  const { font, error: fontError, retry } = useBitmapFont();
  // 開いた時点で印刷の申し込みがあれば、その状態をいちばん上に出す（押した直後に並びが変わって、押し間違えないよう途中では動かさない）
  const [printFirst] = useState(() => publish.store.get().print !== null);

  const parsed = parseRouteData(draft, data.index.lookup);
  const routeData = parsed.ok ? parsed.value : null;
  const saved = pub.saved?.id ? pub.saved : null;
  const status = publish.saveStatus(routeData);
  // QR コードは、今の内容が保存ずみの内容と同じときだけ付ける（違う内容に、前の路線の URL を付けない）
  const clean = status === "clean";
  // 印刷を申し込んだ内容と同じなら、発行番号と発行日を入れる（印刷が使った内容の印が分からない古い印刷は、同じとも違うとも決めない）
  const rec = pub.print;
  const printed = rec !== null && rec.jobId !== null && rec.status !== "canceled" && rec.status !== "failed";
  const relation = publish.printRelation(routeData);
  const printedSame = printed && relation === "same";
  // 申し込んだ内容は申し込んだときの見た目で、それ以外は今のサーバーの設定で描く
  const serverLook = useServerCardLook();
  const look = previewLook(printedSame ? rec!.card : null, serverLook);
  const card = useCard(routeData, data.index.lookup, font, {
    routeId: clean ? saved!.id : null,
    issueNo: printedSame ? rec!.issueNo : null,
    issuedOn: printedSame ? rec!.issuedOn : null,
    look,
  });

  return (
    <div className="finish">
      <div className="finish__card">
        {!parsed.ok ? (
          <div className="finish__invalid">
            <p className="text-alert">{routeErrorText(parsed.error) ?? "路線の内容に まちがいがあります"}</p>
            {routeErrorStep(parsed.error) && (
              <Button variant="primary" onClick={() => ui.setStep(routeErrorStep(parsed.error)!)}>
                直しにいく
              </Button>
            )}
          </div>
        ) : fontError ? (
          <div className="finish__invalid">
            <p>文字のデータを よみこめませんでした</p>
            <Button variant="primary" onClick={retry}>
              もういちど よみこむ
            </Button>
          </div>
        ) : (
          <>
            {printed && relation === "other" && <p className="finish__note finish__note--alert">印刷したときから内容が変わっています</p>}
            {status === "dirty" && <p className="finish__note">保存しなおすと QR コードが付きます</p>}
            <CardView card={card} />
          </>
        )}
      </div>
      <div className="finish__actions">
        {printFirst && <PrintPanel data={routeData} pub={pub} />}
        <SavePanel data={routeData} pub={pub} />
        <Panel title="画像">
          <ImageSaver card={card && !("error" in card) ? card.color : null} routeName={draft.name} />
        </Panel>
        {!printFirst && <PrintPanel data={routeData} pub={pub} />}
      </div>
    </div>
  );
}

// ---- 保存と URL ----

function SavePanel({ data, pub }: { data: RouteData | null; pub: PublishState }) {
  const publish = getPublish();
  const status = publish.saveStatus(data);
  const saved = pub.saved?.id ? pub.saved : null;
  const clean = status === "clean";
  const url = saved ? routeUrl(saved.id!) : null;
  const mode = (useApp().storage as { mode?: string }).mode ?? "ok";

  const onSave = async () => {
    if (!data) return;
    if (await publish.save(data)) toast("保存しました");
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("URL をコピーしました");
    } catch {
      toast("コピーできませんでした。URL を長押ししてコピーしてね", { tone: "alert" });
    }
  };

  const canShare = typeof navigator.share === "function";
  const share = async () => {
    if (!url) return;
    try {
      await navigator.share({ url, title: data?.name ?? "路線" });
    } catch {
      // 閉じただけ
    }
  };

  return (
    <Panel title="保存して URL をつくる">
      <div className="save">
        {saved && url && (
          <>
            <div className="save__url">
              <input className="field__input save__url-input" value={url} readOnly aria-label="路線の URL" onFocus={(e) => e.currentTarget.select()} />
            </div>
            <div className="save__share">
              <Button icon="copy" onClick={copy}>
                コピー
              </Button>
              {canShare && (
                <Button icon="share" onClick={share}>
                  共有
                </Button>
              )}
            </div>
          </>
        )}
        {clean ? (
          <p className="save__state">
            保存ずみです。
            <a href={url!} className="save__link">
              路線のページを見る
            </a>
          </p>
        ) : (
          <>
            {saved && <p className="save__dirty">変更があります。保存しなおすと、同じ URL の中身が新しくなります</p>}
            {!saved && <p className="save__note">この URL を知っている人は誰でも見られます</p>}
            {mode !== "ok" && <p className="text-alert">この端末には保存できないため、URL を作れません（プライベートモードや空き容量を確かめてね）</p>}
            <Button variant="primary" block icon="save" onClick={onSave} disabled={!data} aria-busy={pub.saving}>
              {pub.saving ? "保存しています…" : saved ? "保存しなおす" : "保存して URL をつくる"}
            </Button>
          </>
        )}
        {pub.saveError && !pub.saving && !(pub.saveError.code === "storage" && mode !== "ok") && <p className="text-alert">{errorMessage(pub.saveError)}</p>}
        {/* 保存ずみのときだけ、目立たないように小さく置く。消すと未保存に戻る（作りかけは残る） */}
        {saved && !pub.saving && <DeleteRouteButton id={saved.id!} className="save__delete" />}
      </div>
    </Panel>
  );
}

// ---- 印刷 ----

/** 会場コードの確認は、アプリを開いている間に1回だけ（違うコードは失敗回数に数えられるため） */
let eventCheck: { code: string; promise: Promise<EventState> } | null = null;

function checkEvent(code: string): Promise<EventState> {
  if (eventCheck?.code !== code) {
    const promise = getApi()
      .checkEvent(code)
      .then((r): EventState => {
        if (!r.ok) {
          eventCheck = null;
          return "error";
        }
        return !r.value.valid ? "invalid" : r.value.accepting ? "open" : "closed";
      });
    eventCheck = { code, promise };
  }
  return eventCheck.promise;
}

function useEventState(): [EventState, () => void] {
  const { storage } = useApp();
  const code = getEventCode(storage);
  const [state, setState] = useState<EventState>(code ? "checking" : "none");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!code) return;
    let alive = true;
    setState("checking");
    checkEvent(code).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [code, tick]);
  return [
    state,
    () => {
      eventCheck = null;
      setTick((t) => t + 1);
    },
  ];
}

function PrintPanel({ data, pub }: { data: RouteData | null; pub: PublishState }) {
  const { storage } = useApp();
  const publish = getPublish();
  const [event, recheck] = useEventState();
  const rec = pub.print;
  const code = getEventCode(storage);

  // 申し込みが無く、使える会場コードも無いとき（QR コードから開いていない、または古いコード）は、ボタンの代わりに会場の案内を出す
  const mode = printPanelMode(rec !== null, event);
  if (mode === "guide")
    return (
      <Panel title="印刷する" className="print">
        <p className="text-weak">{PRINT_VENUE_GUIDE}</p>
      </Panel>
    );

  const start = async () => {
    if (!data || !code) return;
    const ok = await publish.requestPrint(data, code);
    if (ok) toast("印刷を申し込みました");
    else if (publish.store.get().printError?.code === "not_accepting") recheck();
  };

  const active = rec !== null && rec.jobId !== null && !isTerminal(rec.status);
  // 申し込んだあとに内容を変えた
  const otherContent = rec !== null && rec.jobId !== null && publish.printRelation(data) === "other";
  const unknown = rec !== null && rec.jobId === null;
  // 印刷ずみでも押せる（係の人が回数を増やしたときのため。増えていなければ「もう印刷ずみ」と出る）
  const canRequest = event === "open" && !active;

  return (
    <Panel title="印刷する" className="print">
      {rec && rec.jobId !== null && <PrintStatusView rec={rec} pollFailing={pub.pollFailing} />}
      {otherContent && <p className="text-weak">これは 前の内容で申し込んだ印刷です（いまの内容とはちがいます）</p>}
      {unknown && !pub.requesting && <p>申し込みの結果が わかりませんでした。もういちど送ってね（二重には申し込まれません）</p>}

      {event === "checking" && !rec && <p className="text-weak">会場の受付を確かめています…</p>}
      {event === "closed" && !active && (
        <div className="print__row">
          <p>いまは印刷の受付をお休みしています。少し待ってね</p>
          <Button onClick={recheck}>受付が始まったか確かめる</Button>
        </div>
      )}
      {event === "error" && !active && (
        <div className="print__row">
          <p>会場の受付を確かめられませんでした</p>
          <Button onClick={recheck}>もういちど確かめる</Button>
        </div>
      )}

      {(canRequest || unknown) && code && (
        <>
          {!pub.requesting && data && !publish.isSaved(data) && !unknown && <p className="text-weak">押すと、先に路線を保存してから申し込みます</p>}
          <Button variant="primary" block icon="print" onClick={start} disabled={!data || pub.requesting}>
            {pub.requesting ? "申し込んでいます…" : unknown ? "もういちど送る" : rec && isTerminal(rec.status) ? "もういちど申し込む" : "印刷する"}
          </Button>
          <p className="text-weak print__note">印刷は 1台の端末につき 1回までです</p>
        </>
      )}
      {pub.printError && !pub.requesting && !(pub.printError.code === "not_accepting" && event === "closed") && (
        <p className="text-alert">
          {pub.printError.code === "storage" && pub.printError.reason === PRINT_RECORD_REASON
            ? "この端末に保存できないため、印刷を申し込めません（プライベートモードや空き容量を確かめてね）"
            : errorMessage(pub.printError)}
        </p>
      )}
    </Panel>
  );
}

function PrintStatusView({ rec, pollFailing }: { rec: NonNullable<PublishState["print"]>; pollFailing: boolean }) {
  const no = formatIssueNo(rec.issueNo);
  return (
    <div className="pstatus" data-status={rec.status ?? "unknown"} role="status" aria-live="polite">
      <p className="pstatus__no">
        発行番号 <strong className="text-l">{no}</strong>
      </p>
      {rec.status === "queued" && (
        <p className="pstatus__main text-l">{rec.ahead && rec.ahead > 0 ? `あと ${rec.ahead}人` : "つぎに印刷します"}</p>
      )}
      {rec.status === "queued" && <p>じゅんばんが来たら、プリンタから出てきます</p>}
      {rec.status === "printing" && <p className="pstatus__main text-l pstatus__blink">印刷中…</p>}
      {rec.status === "done" && (
        <>
          <p className="pstatus__main text-l">できあがり！</p>
          <p>プリンタの前で受け取ってね</p>
        </>
      )}
      {rec.status === "failed" && (
        <>
          <p className="pstatus__main text-l">うまく印刷できませんでした</p>
          <p>係の人に声をかけてね（発行番号を伝えてね）</p>
        </>
      )}
      {rec.status === "canceled" && <p className="pstatus__main">この申し込みは取り消されました</p>}
      {pollFailing && !isTerminal(rec.status) && <p className="text-alert">通信できません。つながったら自動で更新します</p>}
    </div>
  );
}
