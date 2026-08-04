"use client";

import { useCallback, useRef, useState } from "react";

const DRAG_THRESHOLD_PX = 10;

export interface ReorderDragState {
  id: string;
  title: string;
  pointerX: number;
  pointerY: number;
  // Id of the card the drop would land above; null means "at the end,
  // inside the list." Only meaningful when insideList is true — while
  // insideList is false, ignore this field (the drag is over territory
  // outside the "All Day To-Do" container and would cancel on release).
  insertBeforeId: string | null;
  // Whether the pointer is currently within the "All Day To-Do" list's
  // own container, mirroring useDragToSchedule's allDayZoneRef
  // containment check. False means releasing now cancels the drag: the
  // task keeps its original order, nothing is dispatched or saved.
  insideList: boolean;
}

interface DragGesture {
  id: string;
  title: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface ReorderResolution {
  insideList: boolean;
  insertBeforeId: string | null;
}

export function useDragToReorder(options: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  itemRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  orderedIds: string[];
  onReorder: (id: string, insertBeforeId: string | null) => void;
}) {
  const { containerRef, itemRefs, orderedIds, onReorder } = options;
  const [dragState, setDragState] = useState<ReorderDragState | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);

  const resolve = useCallback(
    (clientX: number, clientY: number): ReorderResolution => {
      const containerEl = containerRef.current;
      if (containerEl) {
        const r = containerEl.getBoundingClientRect();
        if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
          return { insideList: false, insertBeforeId: null };
        }
      }
      const refs = itemRefs.current;
      for (const id of orderedIds) {
        const el = refs[id];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientY < (r.top + r.bottom) / 2) return { insideList: true, insertBeforeId: id };
      }
      return { insideList: true, insertBeforeId: null };
    },
    [containerRef, itemRefs, orderedIds],
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

        const resolution = resolve(e.clientX, e.clientY);
        setDragState({
          id: gesture.id,
          title: gesture.title,
          pointerX: e.clientX,
          pointerY: e.clientY,
          insertBeforeId: resolution.insertBeforeId,
          insideList: resolution.insideList,
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
          const resolution = resolve(e.clientX, e.clientY);
          // Releasing outside the "All Day To-Do" container cancels the
          // drag entirely — the task keeps its original order, nothing is
          // dispatched or saved. insertBeforeId: null (inside, past the
          // last card) is a different, valid drop target and must still
          // call onReorder.
          if (resolution.insideList) {
            onReorder(gesture.id, resolution.insertBeforeId);
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
    [resolve, onReorder],
  );

  return { dragState, getDragHandlers };
}
