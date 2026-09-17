import React, { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TransitionType } from "@openreel/core";
import type { ResolvedTransitionHandle } from "./transition-handles";
import { getTransitionDisplay } from "./transition-labels";
import { useProjectStore } from "../../../stores/project-store";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { toast } from "../../../stores/notification-store";

const BADGE_SIZE = 18;
const MENU_WIDTH = 200;

interface TransitionHandleProps {
  handle: ResolvedTransitionHandle;
  trackId: string;
  isSelected: boolean;
  onSelect: (transitionId: string, trackId: string) => void;
}

export const TransitionHandle: React.FC<TransitionHandleProps> = ({
  handle,
  trackId,
  isSelected,
  onSelect,
}) => {
  const { centerX, transition, clipA, clipB, edge } = handle;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    above: boolean;
  } | null>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);

  const { addClipTransition, updateClipTransition, removeClipTransition } =
    useProjectStore();
  const bridge = getTransitionBridge();
  const types = bridge.getAvailableTransitionTypes();

  const openMenu = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const rect = badgeRef.current?.getBoundingClientRect();
      if (!rect) return;
      const above = rect.top > 300;
      setAnchor({
        left: rect.left,
        top: above ? rect.top - 6 : rect.bottom + 6,
        above,
      });
      setOpen(true);
      if (transition) onSelect(transition.id, trackId);
    },
    [transition, onSelect, trackId],
  );

  const applyType = useCallback(
    async (type: TransitionType) => {
      setOpen(false);
      if (transition) {
        await updateClipTransition(transition.id, { type });
        toast.success("转场已更新", getTransitionDisplay(type).name);
        return;
      }
      if (!bridge.isInitialized()) {
        toast.error("转场功能尚未就绪", "请稍后重试。");
        return;
      }
      const params = bridge.getDefaultParams(type);
      const result = clipB
        ? bridge.createTransition(clipA, clipB, type, 1.0, params)
        : bridge.createClipEdgeTransition(clipA, edge ?? "out", type, 1.0, params);
      if (result.success && result.transitionId) {
        const created = bridge.getTransition(result.transitionId);
        if (created) {
          await addClipTransition(created);
          toast.success("已添加转场", `${getTransitionDisplay(type).name} · 1.0 秒`);
          return;
        }
      }
      toast.error(
        "转场失败",
        result.error || "无法创建转场。",
      );
    },
    [
      transition,
      clipA,
      clipB,
      edge,
      addClipTransition,
      updateClipTransition,
      bridge,
    ],
  );

  const handleRemove = useCallback(async () => {
    setOpen(false);
    if (!transition) return;
    await removeClipTransition(transition.id);
    toast.success("转场已删除", "已恢复硬切");
  }, [transition, removeClipTransition]);

  const label = transition
    ? `${getTransitionDisplay(transition.type).name} · ${transition.duration.toFixed(1)} 秒`
    : edge === "in"
      ? "添加片头转场"
      : edge === "out"
        ? "添加片尾转场"
        : "添加转场";
  const ariaLabel = edge
    ? `编辑${edge === "in" ? "片头" : "片尾"}转场：${label}`
    : `编辑片段之间的转场：${label}`;
  const isActive = Boolean(transition) || isSelected || open;

  const menu =
    open && anchor
      ? createPortal(
          <>
            <div
              className="fixed inset-0 z-[9998]"
              onMouseDown={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <div
              role="menu"
              className="fixed z-[9999] rounded-lg border border-border bg-bg-1 shadow-lg overflow-hidden"
              style={{
                left: anchor.left,
                width: MENU_WIDTH,
                ...(anchor.above
                  ? { bottom: window.innerHeight - anchor.top }
                  : { top: anchor.top }),
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="py-1 max-h-72 overflow-y-auto">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-fg-muted uppercase tracking-wide">
                  转场
                </div>
                {transition && (
                  <button
                    type="button"
                    onClick={handleRemove}
                    className="w-full flex items-center px-3 py-2 text-[12px] font-medium text-destructive hover:bg-hover transition-colors text-left"
                  >
                    删除转场
                  </button>
                )}
                {types.map((t) => {
                  const display = getTransitionDisplay(t.type);
                  return (
                    <button
                      key={t.type}
                      type="button"
                      onClick={() => applyType(t.type)}
                      className={`w-full flex flex-col px-3 py-1.5 hover:bg-hover transition-colors text-left ${
                        transition?.type === t.type ? "bg-selected" : ""
                      }`}
                    >
                      <span
                        className={`text-[12px] font-medium ${
                          transition?.type === t.type ? "text-accent" : "text-fg"
                        }`}
                      >
                        {display.name}
                      </span>
                      <span className="text-[11px] text-fg-muted leading-tight">
                        {display.description || t.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div
      className="absolute top-0 bottom-0 z-30 flex items-center pointer-events-none"
      style={{ left: centerX }}
    >
      <button
        ref={badgeRef}
        type="button"
        title={label}
        aria-label={ariaLabel}
        data-transition-id={transition?.id}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={openMenu}
        className={`pointer-events-auto flex items-center justify-center rounded-[5px] shadow-sm transition-all ${
          isActive ? "ring-2 ring-accent" : ""
        }`}
        style={{
          width: BADGE_SIZE,
          height: BADGE_SIZE,
          marginLeft: -(BADGE_SIZE / 2),
          background: "rgba(255,255,255,0.85)",
        }}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="#3a3a3c">
          <rect x="6" y="5" width="4" height="14" />
          <rect x="14" y="5" width="4" height="14" />
        </svg>
      </button>
      {menu}
    </div>
  );
};
