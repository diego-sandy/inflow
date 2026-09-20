import { useState } from 'react';
import { format } from 'date-fns';
import { db } from '@/db/database';
import { useOutbox } from '@/hooks/useOutbox';
import { useUIStore } from '@/store/ui-store';
import { sendBridgeMessage } from '@/lib/bridge';
import { statusLabel } from '@/lib/scheduled-messages';
import { makeDraftConversationId } from '@/lib/draft-conversation';
import { GroupAvatar } from '../common/GroupAvatar';
import { McpStatusBar } from './McpStatusBar';
import type { ScheduledMessage } from '@/types/scheduled-message';

/** Convert epoch ms → value for <input type="datetime-local">. */
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function badgeClass(status: ScheduledMessage['status'], ready: boolean): string {
  if (ready) return 'bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300';
  switch (status) {
    case 'scheduled':
    case 'sending':
      return 'bg-blue-500/15 text-blue-700 ring-blue-500/30 dark:text-blue-300';
    case 'sent':
      return 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300';
    case 'failed':
      return 'bg-red-500/15 text-red-700 ring-red-500/30 dark:text-red-300';
    default:
      return 'bg-surface-input text-fg-muted ring-edge';
  }
}

/**
 * Reopen an Outbox item in the real composer: recreate its draft conversation,
 * load the body into the thread's compose box, drop the Outbox row, and navigate
 * to the thread. Editing always happens in the one composer — never here.
 */
async function reopenInComposer(msg: ScheduledMessage) {
  if (!db) return;
  const convId = makeDraftConversationId(msg.recipientUrns);
  const names = (msg.recipientName || '').split(',').map((s) => s.trim()).filter(Boolean);
  await db.conversations.put({
    id: convId,
    participantUrns: msg.recipientUrns,
    participantNames: msg.recipientUrns.map((_, i) => names[i] || names[0] || 'Unknown'),
    participantPictures: msg.recipientUrns.map(() => ''),
    lastMessage: '',
    lastActivityAt: Date.now(),
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    draft: 1,
  });
  await db.draftAttachments.put({ conversationId: convId, text: msg.body, files: [], names: [], types: [] });
  await db.scheduledMessages.delete(msg.id);
  const store = useUIStore.getState();
  store.setActiveSection('inbox');
  store.setInboxTab('focused');
  store.setComposeNewActive(false);
  store.setSelectedConversationId(convId);
}

function OutboxRow({ msg, ready }: { msg: ScheduledMessage; ready?: boolean }) {
  const showToast = useUIStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [when, setWhen] = useState('');
  const pending = msg.status === 'draft' || msg.status === 'scheduled' || msg.status === 'failed';

  const save = async (patch: Partial<ScheduledMessage>) => {
    if (!db) return;
    await db.scheduledMessages.update(msg.id, { ...patch, updatedAt: Date.now() });
  };

  const sendNow = async () => {
    if (!db || busy) return;
    setBusy(true);
    await save({ status: 'sending' }); // claim locally so nothing double-sends
    try {
      const res = await sendBridgeMessage({ type: 'CREATE_CONVERSATION', recipientUrns: msg.recipientUrns, body: msg.body });
      if (res.success) {
        await save({ status: 'sent', sentAt: Date.now() });
        showToast({ message: `Message sent to ${msg.recipientName}` });
      } else {
        await save({ status: 'failed', error: res.error || 'Send failed' });
        showToast({ message: res.error || 'Could not send message' });
      }
    } catch (e: any) {
      await save({ status: 'failed', error: e?.message || 'Send failed' });
      showToast({ message: e?.message || 'Could not send message' });
    } finally {
      setBusy(false);
    }
  };

  const applyReschedule = async () => {
    const at = when ? new Date(when).getTime() : NaN;
    if (!Number.isFinite(at)) return;
    await save({ status: 'scheduled', scheduledAt: at });
    setRescheduling(false);
    setWhen('');
  };

  const remove = async () => {
    if (db) await db.scheduledMessages.delete(msg.id);
  };

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${ready ? 'border-amber-500/30 bg-amber-500/5' : 'border-edge'}`}>
      <div className="mb-1 flex items-center gap-2">
        <GroupAvatar names={[msg.recipientName || 'Unknown']} pictures={['']} size={24} />
        <span className="truncate text-sm font-semibold text-fg-strong">{msg.recipientName || 'Unknown'}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${badgeClass(msg.status, !!ready)}`}>
          {ready ? 'Ready to send' : statusLabel(msg.status)}
        </span>
        {!ready && msg.status === 'scheduled' && msg.scheduledAt && (
          <span className="shrink-0 text-[11px] text-fg-faint">{format(new Date(msg.scheduledAt), 'MMM d, h:mm a')}</span>
        )}
        {msg.status === 'sent' && msg.sentAt && (
          <span className="shrink-0 text-[11px] text-fg-faint">{format(new Date(msg.sentAt), 'MMM d, h:mm a')}</span>
        )}
      </div>

      <p className="whitespace-pre-wrap text-sm text-fg-secondary">{msg.body}</p>
      {msg.status === 'failed' && msg.error && <p className="mt-1 text-[11px] text-red-500 dark:text-red-400">{msg.error}</p>}

      {pending && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {rescheduling ? (
            <>
              <input
                type="datetime-local"
                value={when || (msg.scheduledAt ? toLocalInput(msg.scheduledAt) : '')}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded-md bg-surface-input px-2 py-1 text-xs text-fg-strong ring-1 ring-inset ring-edge outline-none focus:ring-blue-500/40"
              />
              <button onClick={applyReschedule} disabled={!when} className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 disabled:opacity-40 dark:text-blue-300">
                Set time
              </button>
              <button onClick={() => setRescheduling(false)} className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:text-fg-secondary">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={sendNow} disabled={busy} className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 disabled:opacity-40 dark:text-blue-300">
                {busy ? 'Sending…' : msg.status === 'failed' ? 'Retry send' : 'Send now'}
              </button>
              {msg.status === 'scheduled' && (
                <button onClick={() => setRescheduling(true)} className="rounded-md px-2 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge hover:text-fg-strong">
                  Reschedule
                </button>
              )}
              <button onClick={() => void reopenInComposer(msg)} className="rounded-md px-2 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge hover:text-fg-strong">
                Edit
              </button>
              <button onClick={remove} className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:text-red-500 dark:hover:text-red-400">
                {msg.status === 'scheduled' ? 'Cancel' : 'Delete'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{title}</h3>
        {hint && <span className="text-[11px] text-fg-faint">{hint}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/**
 * The Outbox — a status view of the local outbound pipeline. It never composes
 * (that happens in the one message composer) and never auto-sends: a scheduled
 * message whose time has arrived is *resurfaced* as "Ready to send" for a
 * one-click send. Composing a new message opens the shared composer.
 */
export function OutboxView() {
  const { ready, scheduled, drafts, failed, sent } = useOutbox();

  const openComposer = () => {
    const store = useUIStore.getState();
    store.setActiveSection('inbox');
    store.setSelectedConversationId(null);
    store.setComposeNewActive(true);
  };

  const isEmpty = ready.length + scheduled.length + drafts.length + failed.length + sent.length === 0;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-6 py-3">
        <h2 className="text-base font-semibold text-fg-strong">Outbox</h2>
        <span className="text-[11px] text-fg-faint">Drafts and scheduled messages — you always send.</span>
        <span className="flex-1" />
        <button
          onClick={openComposer}
          className="rounded-md bg-blue-500/15 px-3 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
        >
          New message
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 px-6 py-5">
          <McpStatusBar />

          {isEmpty && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-sm text-fg-muted">Your outbox is empty.</p>
              <p className="max-w-xs text-xs text-fg-faint">
                Compose a message and choose “Save as draft” or “Schedule”, or start one from a follow-up — it’ll show up here to review and send.
              </p>
            </div>
          )}

          {ready.length > 0 && (
            <Section title="Ready to send" hint="Scheduled time reached — send when you’re ready">
              {ready.map((m) => <OutboxRow key={m.id} msg={m} ready />)}
            </Section>
          )}
          {scheduled.length > 0 && (
            <Section title="Scheduled">
              {scheduled.map((m) => <OutboxRow key={m.id} msg={m} />)}
            </Section>
          )}
          {drafts.length > 0 && (
            <Section title="Drafts">
              {drafts.map((m) => <OutboxRow key={m.id} msg={m} />)}
            </Section>
          )}
          {failed.length > 0 && (
            <Section title="Failed">
              {failed.map((m) => <OutboxRow key={m.id} msg={m} />)}
            </Section>
          )}
          {sent.length > 0 && (
            <Section title="Sent">
              {sent.slice(0, 20).map((m) => <OutboxRow key={m.id} msg={m} />)}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
