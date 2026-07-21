"use client";

import { useCallback, useRef, useState } from "react";

import { yToSnappedTime } from "../lib/times";

const DRAG_THRESHOLD_PX = 6;
const EDGE_ZONE_PX = 32;
const AUTO_SCROLL_STEP_PX = 12;

export interface DragState {
  id: string;
  title: string;
  pointerX: number;
  pointerY: number;
  previewTime: string | null;
}

interface DragGesture {
  id: string;
  title: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface Resolution {
  overAllDay: boolean;
  time: string | null;
}

export function useDragToSchedule(options: {
  railRef: React.RefObject<HTMLDivElement | null>;
  allDayZoneRef: React.RefObject<HTMLDivElement | null>;
  hourHeight: number;
  onSchedule: (id: string, time: string | undefined) => void;
}) {
  const { railRef, allDayZoneRef, hourHeight, onSchedule } = options;
  const [dragState, setDragState] = useState<DragState | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);

  const resolve = useCallback(
    (clientX: number, clientY: number): Resolution => {
      const allDayEl = allDayZoneRef.current;
      if (allDayEl) {
        const r = allDayEl.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return { overAllDay: true, time: null };
        }
      }
      const railEl = railRef.current;
      if (railEl) {
        const r = railEl.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          const y = clientY - r.top + railEl.scrollTop;
          return { overAllDay: false, time: yToSnappedTime(y, hourHeight) };
        }
      }
      return { overAllDay: false, time: null };
    },
    [allDayZoneRef, railRef, hourHeight],
  );

  const autoScroll = useCallback(
    (clientY: number) => {
      const railEl = railRef.current;
      if (!railEl) return;
      const r = railEl.getBoundingClientRect();
      const nearRail = clientY >= r.top - EDGE_ZONE_PX && clientY <= r.bottom + EDGE_ZONE_PX;
      if (!nearRail) return;
      if (clientY - r.top < EDGE_ZONE_PX) {
        railEl.scrollTop = Math.max(0, railEl.scrollTop - AUTO_SCROLL_STEP_PX);
      } else if (r.bottom - clientY < EDGE_ZONE_PX) {
        railEl.scrollTop += AUTO_SCROLL_STEP_PX;
      }
    },
    [railRef],
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
          // target away from nested interactive elements (a checkbox, the
          // title button), since browsers retarget the click to whichever
          // element holds pointer capture.
          const target = e.currentTarget as HTMLElement;
          if (typeof target.setPointerCapture === "function") {
            target.setPointerCapture(e.pointerId);
          }
        }

        autoScroll(e.clientY);
        const { time } = resolve(e.clientX, e.clientY);
        setDragState({
          id: gesture.id,
          title: gesture.title,
          pointerX: e.clientX,
          pointerY: e.clientY,
          previewTime: time,
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
          // post-pointerup click reaches onClickCapture (e.g. a cross-zone drop
          // that removes this wrapper from the DOM), the flag would otherwise
          // stay stuck true and swallow the next unrelated click.
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
          const { overAllDay, time } = resolve(e.clientX, e.clientY);
          if (overAllDay) {
            onSchedule(gesture.id, undefined);
          } else if (time !== null) {
            onSchedule(gesture.id, time);
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
    [resolve, autoScroll, onSchedule],
  );

  return { dragState, getDragHandlers };
}
