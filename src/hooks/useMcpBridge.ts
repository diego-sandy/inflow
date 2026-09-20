import { useEffect } from 'react';
import { getPairingToken } from '@/lib/mcp/pairing';
import { startMcpBridge, stopMcpBridge } from '@/lib/mcp/bridge-client';

/**
 * App-level bridge lifecycle: if the user has paired the companion, start the
 * localhost bridge on load and tear it down when the app unmounts. Does nothing
 * (stays disconnected) until a pairing token exists.
 */
export function useMcpBridge() {
  useEffect(() => {
    let cancelled = false;
    getPairingToken().then((token) => {
      if (!cancelled && token) startMcpBridge(token);
    });
    return () => {
      cancelled = true;
      stopMcpBridge();
    };
  }, []);
}
