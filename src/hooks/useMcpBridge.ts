import { useEffect } from 'react';
import { getOrCreatePairingCode, getMcpEnabled } from '@/lib/mcp/pairing';
import { startMcpBridge, stopMcpBridge } from '@/lib/mcp/bridge-client';

/**
 * App-level bridge lifecycle. Only connects when the user has the bridge turned
 * on (a persisted toggle) — so Disconnect stays off across refreshes. When on,
 * the extension retries the companion on localhost using its pairing code.
 */
export function useMcpBridge() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await getMcpEnabled())) return;
      const code = await getOrCreatePairingCode();
      if (!cancelled) startMcpBridge(code);
    })();
    return () => {
      cancelled = true;
      stopMcpBridge();
    };
  }, []);
}
