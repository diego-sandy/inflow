import { useEffect, useState } from 'react';

const POLL_MS = 1500;

/**
 * Whether inflow is pinned to Chrome's toolbar, polled while `active`.
 *
 * Chrome has no event for pinning, so the setup wizard's Pin step polls while
 * it is on screen. That lets the step tick itself the moment the user clicks
 * the pin, instead of asking them to confirm something we can check.
 *
 * `null` means Chrome can't tell us (an older version, or no action API), in
 * which case the step simply lets the user carry on.
 */
export function useToolbarPinned(active: boolean): boolean | null {
  const [pinned, setPinned] = useState<boolean | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof chrome === 'undefined' || typeof chrome.action?.getUserSettings !== 'function') {
      setPinned(null);
      return;
    }
    let stopped = false;
    const check = async () => {
      try {
        const settings = await chrome.action.getUserSettings();
        if (!stopped) setPinned(!!settings.isOnToolbar);
      } catch {
        if (!stopped) setPinned(null);
      }
    };
    void check();
    const id = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active]);

  return pinned;
}
