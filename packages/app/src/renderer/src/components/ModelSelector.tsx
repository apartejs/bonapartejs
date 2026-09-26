import type { ModelInfoDto } from '@aparte/bonaparte-shared';
import { Button, Input, Popover, PopoverContent, PopoverTrigger, cn } from '@aparte/bonaparte-plugin-sdk/ui';
import { Cpu, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { filterModels } from '../models/filter.js';
import { formatBytes, modelFootprint, verdictTone } from '../models/format.js';
import { MENU_LABEL } from './menu-styles.js';

interface ModelSelectorProps {
  /** Model pinned by the open conversation. */
  modelName: string | null;
  busy: boolean;
  onPick: (modelPath: string) => void;
  /** Controlled open, so another surface (the missing-model alert) can raise the menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const HINT = 'model-hint mx-1 mt-1.5 mb-0.5 text-[11.5px] leading-normal text-muted-foreground';

/**
 * Conversation's model, in the composer's row.
 *
 * The model's name used to be displayed there, but as a plain label: to
 * change it, you had to create a new conversation. Yet the model belongs to
 * the conversation — on the same footing as the temperature and the play
 * mode, which are already here.
 *
 * Changing model is NOT trivial, and the menu says so: the saved KV state
 * depends on the model (it enters the manifest), so the context gets
 * rebuilt on the first message. This is the kind of information that must
 * be readable before the click, not guessed after.
 */
export function ModelSelector({
  modelName,
  busy,
  onPick,
  open: openProp,
  onOpenChange,
}: ModelSelectorProps) {
  const { t, locale } = useTranslate();
  const [openState, setOpenState] = useState(false);
  // Controlled when the parent drives it (the alert), self-managed otherwise.
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [models, setModels] = useState<ModelInfoDto[] | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setModels(await window.bonaparte.scanModels());
  }, []);

  useEffect(() => {
    if (!open) return;
    // A fresh search every time the menu opens: a leftover filter would
    // hide models without saying why.
    setQuery('');
    if (models === null) void load();
  }, [open, models, load]);

  const shown = models === null ? [] : filterModels(models, query);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Pushed — along with anything that would follow — to the end of
            the row, with a LOGICAL margin: correct in RTL too. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="model-button ms-auto h-7 max-w-[230px] gap-1.5 rounded-full px-2 font-mono text-[10.5px] font-normal text-muted-foreground"
          disabled={busy}
          title={modelName ?? t.models.pick}
        >
          <Cpu className="size-3.5 opacity-75" aria-hidden="true" />
          <span className="model-name truncate">{modelName ?? t.models.pick}</span>
        </Button>
      </PopoverTrigger>
      {/* Opens UPWARD, and never taller than the space above the composer:
          a menu glued to the top edge reads as a bug. */}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="model-menu flex max-h-[min(50vh,calc(100vh-200px))] w-[min(340px,70vw)] flex-col p-0"
        aria-label={t.models.pick}
      >
        {/* The head stays put while the list scrolls: with dozens of GGUF
            files on a machine, the search is the way in, and the label
            says what this menu is even halfway down the list. */}
        <div className="model-menu-head flex flex-col gap-1.5 px-2.5 pt-2.5 pb-1.5">
          <p className={MENU_LABEL}>{t.models.pick}</p>
          {models !== null && models.length > 0 && (
            <div className="model-search flex items-center gap-1.5">
              <Input
                className="h-7 text-xs"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.picker.searchPlaceholder}
                spellCheck={false}
                autoFocus
                aria-label={t.picker.searchPlaceholder}
              />
              {query && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setQuery('')}
                  aria-label={t.common.clear}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto px-1.5 pb-1.5">
          {models === null ? (
            <p className={HINT}>{t.models.scanning}</p>
          ) : models.length === 0 ? (
            <p className={HINT}>{t.models.none}</p>
          ) : shown.length === 0 ? (
            <p className={HINT}>{t.picker.noMatch}</p>
          ) : (
            <>
              <div role="listbox" aria-label={t.models.pick}>
                {shown.map((model) => {
                  const current = modelName !== null && model.name === modelName;
                  return (
                    /* The current model isn't clickable: it's marked, not offered. */
                    <button
                      key={model.path}
                      type="button"
                      data-slot="model-item"
                      role="option"
                      aria-selected={current}
                      className={cn(
                        'model-item flex w-full items-baseline gap-2.5 rounded-md px-2 py-1.5 text-start text-[12.5px] text-foreground',
                        current ? 'cursor-default text-primary' : 'hover:bg-muted',
                      )}
                      disabled={current}
                      onClick={() => {
                        setOpen(false);
                        onPick(model.path);
                      }}
                      title={model.path}
                    >
                      <span className="model-item-name min-w-0 flex-1 truncate">{model.name}</span>
                      {/* What it will take in memory at the engine's context —
                          the cost, read from the header, before the click. */}
                      <span
                        className={cn('model-item-size font-mono text-[10.5px]', verdictTone(model.memory?.verdict))}
                        title={
                          model.memory
                            ? [
                                t.models.memoryHint
                                  .replace('{total}', formatBytes(model.memory.totalBytes, t.units))
                                  .replace('{ctx}', model.memory.nCtx.toLocaleString(locale))
                                  .replace('{weights}', formatBytes(model.memory.weightsBytes, t.units))
                                  .replace('{kv}', formatBytes(model.memory.kvBytes, t.units)),
                                model.memory.verdict === 'too-big'
                                  ? t.models.tooBig
                                  : model.memory.verdict === 'tight'
                                    ? t.models.tight
                                    : '',
                              ]
                                .filter(Boolean)
                                .join(' — ')
                            : undefined
                        }
                      >
                        {model.memory ? '≈ ' : ''}
                        {formatBytes(modelFootprint(model), t.units)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className={HINT}>{t.models.switchWarning}</p>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
