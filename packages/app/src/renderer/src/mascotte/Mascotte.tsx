import { cn } from '@aparte/bonaparte-plugin-sdk/ui';
import { MASCOTTE_FACES, type MascotteState } from './mascotte-states.js';

export function Mascotte({ state }: { state: MascotteState }) {
  const face = MASCOTTE_FACES[state];
  return (
    <span
      className="mascotte inline-flex items-baseline font-serif text-[15px] text-primary"
      data-state={state}
      aria-hidden="true"
    >
      <span className={cn('mascotte-face', state === 'sleeping' && 'opacity-55')}>
        ({face.eyeLeft}
        {face.nose}
        {face.eyeRight})
      </span>
      {face.suffix === 'dots' && <span className="mascotte-dots animate-mascotte-dots">…</span>}
      {face.suffix === 'caret' && <span className="mascotte-caret animate-mascotte-caret">▌</span>}
    </span>
  );
}
