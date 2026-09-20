import { useState, useEffect, useCallback } from 'react';

/**
 * A resizable pane docked to one edge. Dragging the divider changes its width
 * live (clamped), releasing persists it, and a double-click resets to default.
 *  - side 'right': the pane hugs the window's right edge (width from clientX to
 *    the right). Divider sits on the pane's left.
 *  - side 'left': the pane hugs `originRef`'s left edge (width from that edge to
 *    clientX). Divider sits on the pane's right.
 */
export function useResizablePane(opts: {
  storageKey: string;
  defaultWidth: number;
  min?: number;
  max?: number;
  side?: 'left' | 'right';
  originRef?: React.RefObject<HTMLElement | null>;
}) {
  const { storageKey, defaultWidth, min = 260, max = 900, side = 'right', originRef } = opts;

  const clamp = useCallback(
    (px: number) => {
      const winMax = typeof window !== 'undefined' ? Math.floor(window.innerWidth * 0.6) : max;
      return Math.max(min, Math.min(px, Math.min(max, Math.max(winMax, min))));
    },
    [min, max],
  );

  const [width, setWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(parsed) ? clamp(parsed) : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });
  const [isDragging, setIsDragging] = useState(false);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDividerDoubleClick = useCallback(() => {
    setWidth(defaultWidth);
    try {
      localStorage.setItem(storageKey, String(defaultWidth));
    } catch {}
  }, [defaultWidth, storageKey]);

  useEffect(() => {
    if (!isDragging) return;
    function move(e: MouseEvent) {
      const px =
        side === 'left'
          ? e.clientX - (originRef?.current?.getBoundingClientRect().left ?? 0)
          : window.innerWidth - e.clientX;
      setWidth(clamp(px));
    }
    function up() {
      setIsDragging(false);
      setWidth((w) => {
        try {
          localStorage.setItem(storageKey, String(w));
        } catch {}
        return w;
      });
    }
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [isDragging, clamp, storageKey, side, originRef]);

  return { width, isDragging, onDividerMouseDown, onDividerDoubleClick };
}
