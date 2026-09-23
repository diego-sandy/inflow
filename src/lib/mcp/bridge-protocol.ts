/**
 * Bridge protocol — the message contract between the inflow extension (tool
 * provider) and the local companion (MCP server / relay), spoken over a
 * localhost WebSocket. Kept pure and transport-free so it can be unit-tested;
 * bridge-client.ts wires it to a real WebSocket and the store.
 *
 * Flow: on open the extension sends `hello` (pairing token + advertised tools).
 * The companion replies `hello_ack` (or `error`). Thereafter the companion
 * forwards each of Claude's tool calls as `call`; the extension runs it and
 * replies `result`. `ping`/`pong` keep the socket warm.
 */
import type { McpToolDescriptor } from './tools';

export type BridgeStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

/** Which provider keys the companion holds (advertised in hello_ack). */
export interface CompanionKeys {
  anthropic: boolean;
  gemini: boolean;
}

/** Messages the companion sends to the extension. */
export type InboundMessage =
  // `keys` tells the extension which provider keys the companion holds, so it can
  // route a provider through the companion only when that key is actually set.
  | { type: 'hello_ack'; keys?: Partial<CompanionKeys> }
  | { type: 'error'; message?: string }
  | { type: 'call'; id: string; name: string; args?: Record<string, any> }
  | { type: 'ping' }
  // Reply to an `anthropic` request the extension sent (the in-app Claude agent).
  | { type: 'anthropic_result'; id: string; ok: boolean; data?: any; error?: string }
  // Reply to a `gemini` request (server-side Gemini, key kept in the companion).
  | { type: 'gemini_result'; id: string; ok: boolean; data?: any; error?: string };

export interface BridgeHandlers {
  token: string;
  tools: McpToolDescriptor[];
  callTool: (name: string, args: Record<string, any>) => Promise<unknown>;
  send: (msg: object) => void;
  onStatus: (status: BridgeStatus, error?: string) => void;
  onActivity: (text: string) => void;
  /** Learn which provider keys the companion holds (from hello_ack). */
  onCompanionKeys?: (keys: CompanionKeys) => void;
  /** Resolve a pending Anthropic proxy request (bridge-client owns the map). */
  onAnthropicResult?: (id: string, ok: boolean, data: any, error?: string) => void;
  /** Resolve a pending Gemini proxy request (bridge-client owns the map). */
  onGeminiResult?: (id: string, ok: boolean, data: any, error?: string) => void;
}

/** Friendly one-line description of a tool call for the activity feed. */
export function activityLabel(name: string, args: Record<string, any> = {}): string {
  switch (name) {
    case 'search_connections':
      return `Claude searched your connections${args.query ? ` for “${args.query}”` : ''}`;
    case 'list_connections':
      return `Claude listed connections${args.role ? ` (${args.role})` : args.interest ? ` (${args.interest})` : ''}`;
    case 'get_connection':
      return 'Claude looked up a connection';
    case 'get_network_stats':
      return 'Claude reviewed your network stats';
    case 'get_conversation_summary':
      return 'Claude read a conversation summary';
    case 'create_draft':
      return 'Claude drafted a message → Outbox';
    default:
      return `Claude used ${name}`;
  }
}

export function createBridgeSession(h: BridgeHandlers) {
  return {
    /** Call once the socket opens: authenticate and advertise the toolbox. */
    open() {
      h.onStatus('connecting');
      h.send({ type: 'hello', token: h.token, tools: h.tools });
    },

    /** Handle one raw message from the companion. */
    async handleMessage(raw: string) {
      let msg: InboundMessage;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // ignore malformed frames
      }
      switch (msg.type) {
        case 'hello_ack':
          h.onStatus('connected');
          h.onActivity('Connected to Claude');
          // Older companions omit `keys`. Preserve the prior behavior (Anthropic
          // routed through the companion when connected) and require an explicit
          // signal to route Gemini through it.
          h.onCompanionKeys?.({
            anthropic: msg.keys ? !!msg.keys.anthropic : true,
            gemini: msg.keys ? !!msg.keys.gemini : false,
          });
          return;
        case 'error':
          h.onStatus('error', msg.message || 'Connection rejected');
          return;
        case 'ping':
          h.send({ type: 'pong' });
          return;
        case 'anthropic_result':
          h.onAnthropicResult?.(msg.id, msg.ok, msg.data, msg.error);
          return;
        case 'gemini_result':
          h.onGeminiResult?.(msg.id, msg.ok, msg.data, msg.error);
          return;
        case 'call': {
          h.onActivity(activityLabel(msg.name, msg.args));
          try {
            const data = await h.callTool(msg.name, msg.args || {});
            h.send({ type: 'result', id: msg.id, ok: true, data });
          } catch (e: any) {
            h.send({ type: 'result', id: msg.id, ok: false, error: e?.message || 'Tool failed' });
          }
          return;
        }
      }
    },
  };
}
