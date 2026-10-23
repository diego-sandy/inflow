import { useEffect, useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { getAnthropicApiKey, getGeminiApiKey } from '@/lib/ai-settings';

const KEY_NAMES = ['geminiApiKey', 'anthropicApiKey'];

/**
 * Whether any AI key is usable: one saved in the browser, or one the Claude
 * companion holds while it's connected. Follows storage changes, so a key
 * saved in one place (the wizard's key step, Settings) shows everywhere.
 */
export function useHasAIKey(): boolean {
  const mcpConnected = useUIStore((s) => s.mcpStatus === 'connected');
  const mcpKeys = useUIStore((s) => s.mcpKeys);
  const [inBrowser, setInBrowser] = useState(false);

  useEffect(() => {
    let alive = true;
    const read = () =>
      Promise.all([getGeminiApiKey(), getAnthropicApiKey()]).then(([g, a]) => {
        if (alive) setInBrowser(!!g || !!a);
      });
    void read();
    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && KEY_NAMES.some((k) => k in changes)) void read();
    };
    chrome.storage?.onChanged?.addListener(onChange);
    return () => {
      alive = false;
      chrome.storage?.onChanged?.removeListener(onChange);
    };
  }, []);

  return inBrowser || (mcpConnected && (mcpKeys.gemini || mcpKeys.anthropic));
}
