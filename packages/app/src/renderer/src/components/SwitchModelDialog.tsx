import type { SwitchEstimateDto } from '@aparte/bonaparte-shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from '@aparte/bonaparte-plugin-sdk/ui';
import { Cpu, HardDrive, RotateCcw } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { formatBytes, verdictTone } from '../models/format.js';

interface SwitchModelDialogProps {
  estimate: SwitchEstimateDto;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * What switching a conversation to another model costs, said before it is
 * paid (D-03): the model read from disk, the conversation computed again,
 * the memory it needs — with durations only where this machine measured
 * them. Cancel holds the focus: the expensive answer is never the default.
 */
export function SwitchModelDialog({ estimate, onConfirm, onCancel }: SwitchModelDialogProps) {
  const { t, locale } = useTranslate();
  const s = t.switchModel;
  const size = (bytes: number): string => formatBytes(bytes, t.units);

  const line = (icon: ReactElement, text: string, detail?: string, tone?: string): ReactElement => (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="flex flex-col gap-0.5">
        <span className={cn('text-[13.5px]', tone)}>{text}</span>
        {detail && <span className="text-[12px] text-muted-foreground">{detail}</span>}
      </span>
    </li>
  );

  const verdictText =
    estimate.memory.verdict === 'too-big'
      ? s.tooBig.replace('{machine}', size(estimate.machineBytes))
      : estimate.memory.verdict === 'tight'
        ? s.tight.replace('{machine}', size(estimate.machineBytes))
        : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="switch-model sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[19px] font-medium">
            {s.title.replace('{model}', () => estimate.modelName)}
          </DialogTitle>
          <DialogDescription>{s.intro}</DialogDescription>
        </DialogHeader>
        <ul className="switch-model-costs flex flex-col gap-3">
          {line(
            <HardDrive />,
            s.load.replace('{size}', size(estimate.readBytes)),
            estimate.loadSeconds !== undefined ? s.loadMeasured.replace('{seconds}', String(estimate.loadSeconds)) : undefined,
          )}
          {estimate.reprefillTokens > 0 &&
            line(
              <RotateCcw />,
              s.reprefill.replace('{tokens}', estimate.reprefillTokens.toLocaleString(locale)),
              estimate.reprefillSeconds !== undefined
                ? s.reprefillMeasured.replace('{seconds}', String(estimate.reprefillSeconds))
                : s.reprefillUnmeasured,
            )}
          {line(
            <Cpu />,
            s.memory
              .replace('{total}', size(estimate.memory.totalBytes))
              .replace('{ctx}', estimate.memory.nCtx.toLocaleString(locale)),
            verdictText ??
              s.memoryDetail
                .replace('{weights}', size(estimate.memory.weightsBytes))
                .replace('{kv}', size(estimate.memory.kvBytes)),
            verdictText ? verdictTone(estimate.memory.verdict) : undefined,
          )}
        </ul>
        {estimate.reprefillTokens > 0 && (
          <p className="text-[12px] leading-snug text-muted-foreground">{s.stateNote}</p>
        )}
        <DialogFooter className="mt-1">
          <Button type="button" variant="ghost" autoFocus onClick={onCancel}>
            {s.cancel}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {s.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
