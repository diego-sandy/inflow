/**
 * MCP bridge client — owns the localhost WebSocket to the companion and wires
 * the pure {@link createBridgeSession} protocol to the UI store. Runs in the app
 * tab (which has DB access and outlives the MV3 service worker while open).
 *
 * The connection is best-effort: if the companion isn't running the socket fails
 * and we retry with backoff. Closing the inflow tab drops the bridge — that's an
 * accepted trade for keeping everything local and keyless.
 */
import { createBridgeSession, type BridgeStatus } from './bridge-protocol';
import { toolDescriptors, callTool } from './tools';
import { DEFAULT_MCP_URL } from './pairing';
import { useUIStore } from '@/store/ui-store';

let ws: WebSocket | null = null;
let stopped = true;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let activeToken = '';
let activeUrl = DEFAULT_MCP_URL;
// Track transitions so the activity feed shows connection progress without
// spamming a line on every backoff tick.
let wasConnected = false;
let loggedWaiting = false;

function setStatus(status: BridgeStatus, error?: string) {
  useUIStore.getState().setMcpStatus(status, error ?? null);
}
function pushActivity(text: string) {
  useUIStore.getState().pushMcpActivity(text);
}

/** Backoff schedule (ms), capped — companion may simply not be running yet. */
function nextDelay(): number {
  const steps = [1000, 2000, 5000, 10000, 20000, 30000];
  return steps[Math.min(retry, steps.length - 1)];
}

function scheduleReconnect() {
  if (stopped) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retry += 1;
    open();
  }, nextDelay());
}

function open() {
  if (stopped) return;
  try {
    ws = new WebSocket(activeUrl);
  } catch {
    setStatus('error', 'Could not open a local connection');
    scheduleReconnect();
    return;
  }

  const session = createBridgeSession({
    token: activeToken,
    tools: toolDescriptors(),
    callTool,
    send: (msg) => {
      try {
        ws?.send(JSON.stringify(msg));
      } catch {
        /* socket closed mid-send */
      }
    },
    onStatus: (s, e) => {
      setStatus(s, e);
      if (s === 'connected') {
        wasConnected = true;
        loggedWaiting = false;
      }
    },
    onActivity: (t) => pushActivity(t),
  });

  setStatus('connecting');

  ws.onopen = () => {
    retry = 0;
    session.open();
  };
  ws.onmessage = (ev) => {
    void session.handleMessage(typeof ev.data === 'string' ? ev.data : '');
  };
  ws.onerror = () => {
    // onclose fires next and handles the retry; keep the message quiet since a
    // missing companion is the common, expected case.
  };
  ws.onclose = () => {
    ws = null;
    if (stopped) {
      setStatus('disconnected');
      return;
    }
    setStatus('connecting');
    if (wasConnected) {
      pushActivity('Connection to the companion lost — reconnecting…');
      wasConnected = false;
    } else if (!loggedWaiting) {
      pushActivity('Waiting for the companion — run npx inflow-mcp, then keep this tab open.');
      loggedWaiting = true;
    }
    scheduleReconnect();
  };
}

/** Start (or restart) the bridge with a pairing token. Idempotent. */
export function startMcpBridge(token: string, url: string = DEFAULT_MCP_URL) {
  activeToken = token;
  activeUrl = url;
  stopped = false;
  retry = 0;
  wasConnected = false;
  loggedWaiting = false;
  pushActivity('Connecting to the companion…');
  clearTimeout(retryTimer);
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  ws = null;
  open();
}

/** Stop the bridge and mark disconnected. */
export function stopMcpBridge() {
  stopped = true;
  clearTimeout(retryTimer);
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  ws = null;
  setStatus('disconnected');
}
