/**
 * The mascot's state for the window (task 12.2): what each conversation's turn is doing, as the runner says it
 * (`bonaparte-turn-activity`), and what the engine does; the state is the conversation shown's. A turn that ended
 * well makes it content for 1.5 s.
 */

import { useEffect, useRef, useState } from 'react';
import { TURN_ACTIVITY } from '../aparte/runner';
import { HAPPY_MS, mascotState, type EngineLike, type MascotState, type TurnActivity } from './mascot-state';

interface Kept {
  activity: TurnActivity;
  happyUntil: number;
}

export function useMascotState(engine: EngineLike, conversationId: string | null): MascotState {
  const kept = useRef(new Map<string, Kept>());
  const [, setVersion] = useState(0);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const heard = (event: Event): void => {
      const { conversationId: id, activity } = (event as CustomEvent<{ conversationId: string; activity: TurnActivity }>).detail;
      const happyUntil = activity === 'done' ? Date.now() + HAPPY_MS : 0;
      kept.current.set(id, { activity, happyUntil });
      setVersion((count) => count + 1);
      if (activity === 'done') {
        // Told again once the 1.5 s are over, so that it rests.
        const timer = setTimeout(() => {
          timers.delete(timer);
          setVersion((count) => count + 1);
        }, HAPPY_MS + 50);
        timers.add(timer);
      }
    };
    window.addEventListener(TURN_ACTIVITY, heard);
    return () => {
      window.removeEventListener(TURN_ACTIVITY, heard);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
  const shown = conversationId ? kept.current.get(conversationId) : undefined;
  return mascotState({ engine, activity: shown?.activity ?? null, happyUntil: shown?.happyUntil ?? 0, now: Date.now(), hovered: false });
}
