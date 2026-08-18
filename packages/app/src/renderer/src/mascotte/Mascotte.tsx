import { MASCOTTE_FACES, type MascotteState } from './mascotte-states.js';

export function Mascotte({ state }: { state: MascotteState }) {
  const face = MASCOTTE_FACES[state];
  return (
    <span className="mascotte" data-state={state} aria-hidden="true">
      <span className="mascotte-face">
        ({face.eyeLeft}
        {face.nose}
        {face.eyeRight})
      </span>
      {face.suffix === 'dots' && <span className="mascotte-dots">…</span>}
      {face.suffix === 'caret' && <span className="mascotte-caret">▌</span>}
    </span>
  );
}
