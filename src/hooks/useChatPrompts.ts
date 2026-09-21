import { useEffect, useState } from 'react';
import { getChatPrompts, DEFAULT_CHAT_PROMPTS } from '@/lib/ai-settings';

/**
 * The user's editable starter questions for AI Chat. Loads from storage and
 * stays in sync when they're changed in Settings (chrome.storage change event).
 */
export function useChatPrompts(): string[] {
  const [prompts, setPrompts] = useState<string[]>(DEFAULT_CHAT_PROMPTS);

  useEffect(() => {
    let cancelled = false;
    const load = () => getChatPrompts().then((p) => { if (!cancelled) setPrompts(p); });
    load();
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('aiChatPrompts' in changes) load();
    };
    chrome?.storage?.local?.onChanged?.addListener?.(listener);
    return () => {
      cancelled = true;
      chrome?.storage?.local?.onChanged?.removeListener?.(listener);
    };
  }, []);

  return prompts;
}
