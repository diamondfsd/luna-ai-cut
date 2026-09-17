import type { JSX } from "react";
import { useEffect, useState } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import type { OpenReelUpdaterStatus } from "../types/global";

// Notify → (consented) download → install. Subscribes to main-process update
// status and drives download/install through window.openreel.updater. The
// install path quits through the normal guarded flow, so unsaved changes are
// still protected.
export function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<OpenReelUpdaterStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const updater = window.openreel?.updater;
    if (!updater) return;
    return updater.onStatus((next) => {
      setStatus(next);
      if (next.state === "available" || next.state === "downloaded") {
        setDismissed(false);
      }
    });
  }, []);

  if (!status || dismissed) return null;

  const visible =
    status.state === "available" ||
    status.state === "downloading" ||
    status.state === "downloaded";
  if (!visible) return null;

  const card =
    "fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-bg-elev p-4 text-fg shadow-2xl";
  return (
    <div className={card} role="status" aria-live="polite">
      {status.state === "available" && (
        <>
          <Text type="body" weight="bold" display="block" className="text-sm">
            有可用更新：{status.version}
          </Text>
          <Text type="supporting" color="secondary" display="block" className="mt-1 text-xs">
            OpenReel 新版本已可下载。
          </Text>
          <div className="mt-3 flex gap-2">
            <Button
              label="下载"
              variant="primary"
              size="sm"
              onClick={() => void window.openreel?.updater.download()}
            />
            <Button
              label="稍后"
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(true)}
            />
          </div>
        </>
      )}

      {status.state === "downloading" && (
        <>
          <Text type="body" weight="bold" display="block" className="text-sm">
            正在下载更新…
          </Text>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${status.percent}%` }}
            />
          </div>
          <Text type="supporting" color="secondary" display="block" className="mt-1 text-xs">
            {status.percent}%
          </Text>
        </>
      )}

      {status.state === "downloaded" && (
        <>
          <Text type="body" weight="bold" display="block" className="text-sm">
            更新 {status.version} 已就绪
          </Text>
          <Text type="supporting" color="secondary" display="block" className="mt-1 text-xs">
            重启后安装。未保存的更改会先提示你保存。
          </Text>
          <div className="mt-3 flex gap-2">
            <Button
              label="重启并安装"
              variant="primary"
              size="sm"
              onClick={() => void window.openreel?.updater.install()}
            />
            <Button
              label="稍后"
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(true)}
            />
          </div>
        </>
      )}
    </div>
  );
}
