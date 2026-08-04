"use client";

import { useCallback, useRef, useState } from "react";

const DRAG_THRESHOLD_PX = 10;

export interface ReorderDragState {
  id: string;
  title: string;
  pointerX: number;
  pointerY: number;
  // Id of the card the drop would land above; null means "at the end."
  insertBeforeId: string | null;
}

interface DragGesture {
  id: string;
  title: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export function useDragToReorder(options: {
  itemRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  orderedIds: string[];
  onReorder: (id: string, insertBeforeId: string | null) => void;
}) {
  const { itemRefs, orderedIds, onReorder } = options;
  const [dragState, setDragState] = useState<ReorderDragState | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);

  const resolve = useCallback(
    (clientY: number): string | null => {
      const refs = itemRefs.current;
      for (const id of orderedIds) {
        const el = refs[id];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientY < (r.top + r.bottom) / 2) return id;
      }
      return null;
    },
    [itemRefs, orderedIds],
  );

  const getDragHandlers = useCallback(
    (id: string, title: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        // This hook is designed specifically for a small handle nested
        // inside a card that already carries a *different*, unrelated
        // drag gesture (drag-to-schedule) on its own pointerdown — without
        // stopping propagation here, pressing the handle would also start
        // that other gesture.
        e.stopPropagation();
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
          insertBeforeId: resolve(e.clientY),
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
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
          onReorder(gesture.id, resolve(e.clientY));
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
    [resolve, onReorder],
  );

  return { dragState, getDragHandlers };
}
