import { useEffect } from 'react';
import { getOrCreatePairingCode } from '@/lib/mcp/pairing';
import { startMcpBridge, stopMcpBridge } from '@/lib/mcp/bridge-client';

/**
 * App-level bridge lifecycle: the extension always has a pairing code (its
 * identity), so it keeps trying to reach the companion on localhost. The
 * companion only accepts the connection once it's been configured with the same
 * code (via the .mcpb install prompt), so this is a harmless retry until then.
 */
export function useMcpBridge() {
  useEffect(() => {
    let cancelled = false;
    getOrCreatePairingCode().then((code) => {
      if (!cancelled) startMcpBridge(code);
    });
    return () => {
      cancelled = true;
      stopMcpBridge();
    };
  }, []);
}
