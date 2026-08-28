import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Kbd,
  cn,
} from '@aparte/bonaparte-plugin-sdk/ui';
import { Plus, X } from 'lucide-react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import type { ToolingTabsApi } from '../tooling/use-tooling-tabs.js';

interface ToolingTabsProps {
  tooling: ToolingTabsApi;
}

/**
 * Tooling panel's tab strip — in the HEADER, not in the panel.
 *
 * This is the Codex model, and it has a reason: the tab strip and the
 * conversation title then live on the SAME line, the top bar is a single
 * piece, and opening the panel doesn't make a second bar appear under the
 * first.
 *
 * The opening menu is a real menu, rendered in a portal: the area carrying
 * the tab strip collapses by sliding and clips whatever overflows, which
 * used to swallow a menu positioned inside it — the click opened a
 * genuinely invisible menu, until it was anchored in window coordinates by
 * hand. A portal escapes the clipping for free.
 */
export function ToolingTabs({ tooling }: ToolingTabsProps) {
  const { t } = useTranslate();

  return (
    <div className="tooling-tabs flex min-w-0 flex-1 items-stretch gap-0.5 ps-2 pe-0.5 pt-1.5">
      {/* The tab strip scrolls; the `+` button, on the other hand, stays always reachable. */}
      <div
        className="tooling-tablist flex min-w-0 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label={t.tooling.heading}
      >
        {tooling.tabs.map((tab) => {
          const active = tab.instanceId === tooling.active?.instanceId;
          return (
            /* The active tab latches onto the panel it opens: it shares its
               background and bites one pixel into the bar's border. */
            <span
              key={tab.instanceId}
              className={cn(
                'tooling-tab group inline-flex items-center rounded-t-md border border-b-0 border-transparent whitespace-nowrap text-muted-foreground hover:text-foreground',
                active && 'tooling-tab-active -mb-px border-border bg-background text-foreground',
              )}
              data-active={active}
            >
              <button
                type="button"
                data-slot="tooling-tab"
                role="tab"
                aria-selected={active}
                className="tooling-tab-label inline-flex max-w-[16ch] items-center gap-1.5 py-1.5 ps-2.5 pe-1 text-[12.5px]"
                onClick={() => tooling.activate(tab.instanceId)}
                title={tab.title}
              >
                {tab.icon && (
                  <span className="tooling-tab-icon font-mono" aria-hidden="true">
                    {tab.icon}
                  </span>
                )}
                <span className="truncate">{tab.title}</span>
              </button>
              {/* The close cross only shows on the active tab or on hover: a
                  row of permanent crosses makes for a noisy panel, and an
                  opportunity to close a tab by mistake. It keeps its PLACE in
                  both cases (opacity, not display), so tabs don't jump around
                  when the mouse passes over. */}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="tooling-tab-close me-1 size-5 opacity-0 transition-opacity group-hover:opacity-60 group-data-[active=true]:opacity-60 hover:text-destructive hover:opacity-100 focus-visible:opacity-60"
                onClick={() => tooling.close(tab.instanceId)}
                aria-label={`${t.tooling.close} — ${tab.title}`}
                title={t.tooling.close}
              >
                <X className="size-3" />
              </Button>
            </span>
          );
        })}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="icon-button size-7 shrink-0 self-center text-muted-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
            aria-label={t.tooling.open}
            title={t.tooling.open}
          >
            <Plus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="tooling-menu min-w-58" aria-label={t.tooling.openMenu}>
          {tooling.views.length === 0 ? (
            <p className="tooling-menu-empty px-2 py-1.5 text-xs text-muted-foreground">
              {t.tooling.nothingToOpen}
            </p>
          ) : (
            tooling.views.map((view) => (
              <DropdownMenuItem
                key={`${view.pluginId}:${view.viewId}`}
                className="tooling-menu-item"
                onSelect={() => tooling.open(view)}
              >
                <span className="tooling-menu-icon w-4 text-center font-mono text-muted-foreground" aria-hidden="true">
                  {view.icon ?? '▫'}
                </span>
                <span className="tooling-menu-title flex-1">{view.title}</span>
                {view.shortcut && <Kbd className="tooling-menu-shortcut">{view.shortcut}</Kbd>}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
