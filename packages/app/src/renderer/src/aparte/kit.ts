/**
 * aparté's keyboard for the kit's menus and tabs, as React hooks: every menu
 * and every tab list of the app goes through them, none has a keyboard of its
 * own. Each hook gives the element to aparté once it is in the page, and
 * takes it back (the function aparté returns) when it leaves.
 */

import { enhanceContextMenu, enhanceMenu, enhanceTabs } from '@aparte/core';
import { useEffect, useRef, type RefObject } from 'react';

type MenuOptions = NonNullable<Parameters<typeof enhanceMenu>[2]>;
type ContextMenuOptions = NonNullable<Parameters<typeof enhanceContextMenu>[2]>;
type TabsOptions = NonNullable<Parameters<typeof enhanceTabs>[1]>;

/**
 * A menu opened by a button: Enter, Space and the arrows open it; arrows, Home, End and letters move;
 * Escape closes it. `present`: the two elements are in the page — given to aparté when they come.
 */
export function useMenu(
  trigger: RefObject<HTMLElement | null>,
  menu: RefObject<HTMLElement | null>,
  options: MenuOptions = {},
  present = true,
): void {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!trigger.current || !menu.current) return;
    return enhanceMenu(trigger.current, menu.current, {
      ...latest.current,
      onOpen: () => latest.current.onOpen?.(),
      onClose: () => latest.current.onClose?.(),
    });
  }, [trigger, menu, present]);
}

/** A menu opened on a region: a right click, Shift+F10 or the Menu key. */
export function useContextMenu(
  region: RefObject<HTMLElement | null>,
  menu: RefObject<HTMLElement | null>,
  options: ContextMenuOptions = {},
): void {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!region.current || !menu.current) return;
    return enhanceContextMenu(region.current, menu.current, {
      ...latest.current,
      onOpen: (target) => latest.current.onOpen?.(target),
      onClose: () => latest.current.onClose?.(),
    });
  }, [region, menu]);
}

/** A tab list: the arrows move between the tabs, each tab shows its panel. */
export function useTabs(tablist: RefObject<HTMLElement | null>, options: TabsOptions = {}): void {
  const activation = options.activation;
  useEffect(() => {
    if (!tablist.current) return;
    return enhanceTabs(tablist.current, activation ? { activation } : {});
  }, [tablist, activation]);
}
