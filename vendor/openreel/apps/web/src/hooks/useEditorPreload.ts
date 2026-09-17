import { useEffect, useRef } from "react";

let preloadStarted = false;

export function useEditorPreload(shouldPreload: boolean): void {
  const hasPreloaded = useRef(false);

  useEffect(() => {
    if (!shouldPreload || hasPreloaded.current || preloadStarted) {
      return;
    }

    preloadStarted = true;
    hasPreloaded.current = true;

    const preload = () => {
      import("../components/editor/EditorInterface");
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(preload, { timeout: 2000 });
    } else {
      setTimeout(preload, 100);
    }
  }, [shouldPreload]);
}
