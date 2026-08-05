"use client";

import { useCallback, useRef, useState } from "react";

import type { NestBlockReason } from "../lib/nesting";
import { yToSnappedTime } from "../lib/times";

const DRAG_THRESHOLD_PX = 10;
const EDGE_ZONE_PX = 32;
const AUTO_SCROLL_STEP_PX = 12;

export interface DragState {
  id: string;
  title: string;
  pointerX: number;
  pointerY: number;
  previewTime: string | null;
  nestTargetId: string | null;
  nestBlockReason: NestBlockReason | undefined;
}

interface DragGesture {
  id: string;
  title: string;
  nestBlockReason: NestBlockReason | undefined;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

type Resolution =
  | { kind: "nest"; targetId: string }
  | { kind: "nest-blocked"; targetId: string; reason: NestBlockReason }
  | { kind: "clear-time" }
  | { kind: "schedule"; time: string }
  | { kind: "outside" };

export function useDragToSchedule(options: {
  railRef: React.RefObject<HTMLDivElement | null>;
  allDayZoneRef: React.RefObject<HTMLDivElement | null>;
  cardRefs: React.RefObject<Record<string, HTMLElement | null>>;
  hourHeight: number;
  onSchedule: (id: string, time: string | undefined) => void;
  onNest: (sourceId: string, targetId: string) => void;
  onNestBlocked: (reason: NestBlockReason) => void;
}) {
  const { railRef, allDayZoneRef, cardRefs, hourHeight, onSchedule, onNest, onNestBlocked } = options;
  const [dragState, setDragState] = useState<DragState | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);

  const resolve = useCallback(
    (
      clientX: number,
      clientY: number,
      sourceId: string,
      nestBlockReason: NestBlockReason | undefined,
    ): Resolution => {
      // Cards are only live drop targets while the pointer is within the
      // agenda's own scroll container — the agenda list scrolls, so a card
      // scrolled above/below the visible area still has a real (if
      // off-screen) bounding rect and would otherwise stay a live nest
      // target even while the pointer is over the header or footer.
      // Mirrors useDragToReorder's containment check.
      const allDayEl = allDayZoneRef.current;
      const allDayRect = allDayEl?.getBoundingClientRect();
      const insideAllDayZone = !!allDayRect &&
        clientX >= allDayRect.left &&
        clientX <= allDayRect.right &&
        clientY >= allDayRect.top &&
        clientY <= allDayRect.bottom;

      // Most specific target first: a card is more specific than the
      // broader zone (all-day zone / rail) it visually sits inside.
      if (insideAllDayZone) {
        for (const [id, el] of Object.entries(cardRefs.current)) {
          if (id === sourceId || !el) continue;
          const r = el.getBoundingClientRect();
          if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
            return nestBlockReason
              ? { kind: "nest-blocked", targetId: id, reason: nestBlockReason }
              : { kind: "nest", targetId: id };
          }
        }
        return { kind: "clear-time" };
      }
      const railEl = railRef.current;
      if (railEl) {
        const r = railEl.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          const y = clientY - r.top + railEl.scrollTop;
          return { kind: "schedule", time: yToSnappedTime(y, hourHeight) };
        }
      }
      return { kind: "outside" };
    },
    [allDayZoneRef, railRef, cardRefs, hourHeight],
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
    (id: string, title: string, nestBlockReason: NestBlockReason | undefined) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest("input, textarea")) return;
        gestureRef.current = {
          id,
          title,
          nestBlockReason,
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
        const resolution = resolve(e.clientX, e.clientY, gesture.id, gesture.nestBlockReason);
        setDragState({
          id: gesture.id,
          title: gesture.title,
          pointerX: e.clientX,
          pointerY: e.clientY,
          previewTime: resolution.kind === "schedule" ? resolution.time : null,
          nestTargetId:
            resolution.kind === "nest" || resolution.kind === "nest-blocked" ? resolution.targetId : null,
          nestBlockReason: resolution.kind === "nest-blocked" ? resolution.reason : undefined,
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
          const resolution = resolve(e.clientX, e.clientY, gesture.id, gesture.nestBlockReason);
          switch (resolution.kind) {
            case "nest":
              onNest(gesture.id, resolution.targetId);
              break;
            case "nest-blocked":
              onNestBlocked(resolution.reason);
              break;
            case "clear-time":
              onSchedule(gesture.id, undefined);
              break;
            case "schedule":
              onSchedule(gesture.id, resolution.time);
              break;
            case "outside":
              break;
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
    [resolve, autoScroll, onSchedule, onNest, onNestBlocked],
  );

  return { dragState, getDragHandlers };
}
