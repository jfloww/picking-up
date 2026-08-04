"use client";

import { useCallback, useRef, useState } from "react";

const DRAG_THRESHOLD_PX = 10;

export type DragResolution =
  | { kind: "reorder"; insertBeforeId: string | null }
  | { kind: "reorder-noop" }
  | { kind: "reschedule"; date: string }
  | { kind: "outside" };

export interface RescheduleOrReorderDragState {
  id: string;
  title: string;
  pointerX: number;
  pointerY: number;
  resolution: DragResolution;
}

interface DragGesture {
  id: string;
  title: string;
  sourceDate: string;
  timed: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export function useDragToRescheduleOrReorder(options: {
  columnRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  itemRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  orderedIdsByDate: Record<string, string[]>;
  onReorder: (id: string, insertBeforeId: string | null, sourceDate: string) => void;
  onReschedule: (id: string, date: string) => void;
}) {
  const { columnRefs, itemRefs, orderedIdsByDate, onReorder, onReschedule } = options;
  const [dragState, setDragState] = useState<RescheduleOrReorderDragState | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);

  const resolve = useCallback(
    (clientX: number, clientY: number, sourceDate: string, timed: boolean): DragResolution => {
      const columns = columnRefs.current;
      for (const date in columns) {
        const el = columns[date];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
          continue;
        }
        if (date !== sourceDate) return { kind: "reschedule", date };
        if (timed) return { kind: "reorder-noop" };
        const refs = itemRefs.current;
        for (const id of orderedIdsByDate[date] ?? []) {
          const itemEl = refs[id];
          if (!itemEl) continue;
          const itemRect = itemEl.getBoundingClientRect();
          if (clientY < (itemRect.top + itemRect.bottom) / 2) {
            return { kind: "reorder", insertBeforeId: id };
          }
        }
        return { kind: "reorder", insertBeforeId: null };
      }
      return { kind: "outside" };
    },
    [columnRefs, itemRefs, orderedIdsByDate],
  );

  const getDragHandlers = useCallback(
    (id: string, title: string, sourceDate: string, timed: boolean) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        // This hook attaches to a small handle nested inside a card; without
        // stopping propagation, pressing the handle would also bubble to
        // whatever other pointer handlers the card itself carries.
        e.stopPropagation();
        gestureRef.current = {
          id,
          title,
          sourceDate,
          timed,
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

        setDragState({
          id: gesture.id,
          title: gesture.title,
          pointerX: e.clientX,
          pointerY: e.clientY,
          resolution: resolve(e.clientX, e.clientY, gesture.sourceDate, gesture.timed),
        });
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
          // post-pointerup click reaches onClickCapture (e.g. a cross-day
          // drop that moves this card out of its old column and removes
          // this wrapper from the DOM), the flag would otherwise stay stuck
          // true and swallow the next unrelated click.
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
          const resolution = resolve(e.clientX, e.clientY, gesture.sourceDate, gesture.timed);
          if (resolution.kind === "reorder") {
            onReorder(gesture.id, resolution.insertBeforeId, gesture.sourceDate);
          } else if (resolution.kind === "reschedule") {
            onReschedule(gesture.id, resolution.date);
          }
          // "reorder-noop" and "outside" dispatch nothing.
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
    [resolve, onReorder, onReschedule],
  );

  return { dragState, getDragHandlers };
}
