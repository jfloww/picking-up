"use client";

import { useCallback, useRef, useState } from "react";

const DRAG_THRESHOLD_PX = 10;

export interface RescheduleDragState {
  id: string;
  title: string;
  targetDate: string | null;
}

interface DragGesture {
  id: string;
  title: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export function useDragToRescheduleDay(options: {
  columnRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  onReschedule: (id: string, date: string) => void;
}) {
  const { columnRefs, onReschedule } = options;
  const [dragState, setDragState] = useState<RescheduleDragState | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);

  const resolve = useCallback(
    (clientX: number, clientY: number): string | null => {
      const columns = columnRefs.current;
      for (const date in columns) {
        const el = columns[date];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return date;
        }
      }
      return null;
    },
    [columnRefs],
  );

  const getDragHandlers = useCallback(
    (id: string, title: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest("input, textarea")) return;
        gestureRef.current = {
          id,
          title,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;

        if (!gesture.moved) {
          const dx = e.clientX - gesture.startX;
          const dy = e.clientY - gesture.startY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          gesture.moved = true;
          // Capture only once a real drag starts, not on every pointerdown:
          // capturing unconditionally would redirect a plain click's event
          // target away from nested interactive elements, since browsers
          // retarget the click to whichever element holds pointer capture.
          const target = e.currentTarget as HTMLElement;
          if (typeof target.setPointerCapture === "function") {
            target.setPointerCapture(e.pointerId);
          }
        }

        const targetDate = resolve(e.clientX, e.clientY);
        setDragState({ id: gesture.id, title: gesture.title, targetDate });
      },
      onPointerUp: (e: React.PointerEvent) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        gestureRef.current = null;

        const target = e.currentTarget as HTMLElement;
        if (typeof target.releasePointerCapture === "function") {
          target.releasePointerCapture(e.pointerId);
        }

        if (gesture.moved) {
          suppressClickRef.current = true;
          // Safety net: if the source element unmounts before the browser's
          // post-pointerup click reaches onClickCapture (e.g. a cross-column
          // drop that removes this wrapper from the DOM), the flag would
          // otherwise stay stuck true and swallow the next unrelated click.
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
          const targetDate = resolve(e.clientX, e.clientY);
          if (targetDate !== null) {
            onReschedule(gesture.id, targetDate);
          }
        }
        setDragState(null);
      },
      onPointerCancel: (e: React.PointerEvent) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        gestureRef.current = null;
        setDragState(null);
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      },
    }),
    [resolve, onReschedule],
  );

  return { dragState, getDragHandlers };
}
