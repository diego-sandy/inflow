import { useState } from 'react';
import { format } from 'date-fns';
import { db } from '@/db/database';
import { useUIStore } from '@/store/ui-store';
import { sendBridgeMessage } from '@/lib/bridge';
import { statusLabel, awaitsRecipientConfirmation, isTooLateToAutoSend } from '@/lib/scheduled-messages';
import { GroupAvatar } from '../common/GroupAvatar';
import type { ScheduledMessage } from '@/types/scheduled-message';
import { INMAIL_WAIT_ERROR_RE, type QueueHold } from '@/lib/queue-holds';

/** Convert epoch ms → value for <input type="datetime-local">. */
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

const HOLD_CHIP: Record<QueueHold['kind'], string> = {
  waiting: 'bg-surface-input text-fg-secondary ring-edge',
  replied: 'bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-300',
};

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


/** One draft / scheduled / sent item, with inline actions. Shared by the MCP
 *  connector section (as the reading pane of its split view) and the Inbox
 *  Drafts/Scheduled views.
 *
 *  `expanded` is the reading pane: the whole message, never clamped, and the
 *  card sized to its content rather than stretched to its neighbours.
 *
 *  `hold` says why it shouldn't go out yet (lib/queue-holds): Send is off
 *  until that's resolved, and the reason is shown in place of a bare error. */
export function OutboxRow({
  msg,
  ready: dueNow,
  dense,
  expanded,
  hold,
}: {
  msg: ScheduledMessage;
  ready?: boolean;
  dense?: boolean;
  expanded?: boolean;
  hold?: QueueHold;
}) {
  // A held message is not "ready to send", whatever its time says.
  const ready = dueNow && !hold;
  const showToast = useUIStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const confirmDelete = useUIStore((s) => s.confirmDelete);
  // Cheap heuristic rather than measuring: the toggle only has to appear when
  // the clamp plausibly bites, and a wrong guess costs a redundant link.
  const longBody = !expanded && (dense || msg.body.split('\n').length > 9 || msg.body.length > 420);
  const autoSendScheduled = useUIStore((s) => s.autoSendScheduled);
  const [when, setWhen] = useState('');
  const pending = msg.status === 'draft' || msg.status === 'scheduled' || msg.status === 'failed';
  const confirmRecipient = useUIStore((s) => s.confirmRecipient);
  // Only a draft Claude created: it resolved a name to a URN out of sight, and
  // a name search can return two different people with the same name. A draft
  // written in the composer is already confirmed, because the user picked the
  // recipient from a list showing their name, headline and photo. Connections
  // are exempt either way — their URN came from the user's own synced list.
  const claudeInMail = msg.source === 'mcp' && msg.inMailSubject !== undefined;
  const needsConfirm = awaitsRecipientConfirmation(msg, confirmRecipient);

  const save = async (patch: Partial<ScheduledMessage>) => {
    if (!db) return;
    await db.scheduledMessages.update(msg.id, { ...patch, updatedAt: Date.now() });
  };

  const sendNow = async () => {
    if (!db || busy || hold) return;
    setBusy(true);
    await save({ status: 'sending' }); // claim locally so nothing double-sends
    try {
      // A reply (conversationId set) sends into the existing thread; a new
      // outbound message creates a fresh conversation from the recipient URNs.
      const res = msg.conversationId
        ? await sendBridgeMessage({ type: 'SEND_MESSAGE', conversationId: msg.conversationId, body: msg.body })
        : await sendBridgeMessage({
            type: 'CREATE_CONVERSATION',
            recipientUrns: msg.recipientUrns,
            body: msg.body,
            // Queued as an InMail, so it still goes out as one (and spends a credit).
            ...(msg.inMailSubject !== undefined ? { inMail: { subject: msg.inMailSubject } } : {}),
          });
      if (res.success) {
        await save({ status: 'sent', sentAt: Date.now() });
        // Sent items don't linger in the queue anymore — they surface in the
        // connector's activity log instead.
        useUIStore.getState().pushMcpActivity(`Sent to ${msg.recipientName || 'Unknown'}`);
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

  const beginEdit = () => {
    setEditBody(msg.body);
    setEditSubject(msg.inMailSubject ?? '');
    setEditing(true);
  };

  const saveEdit = async () => {
    const body = editBody.trim();
    if (!db || !body) return;
    const subject = editSubject.trim();
    await db.scheduledMessages.update(msg.id, {
      body,
      // Only on something already queued as an InMail; adding a subject here
      // would turn a free message into one that spends a credit.
      ...(msg.inMailSubject !== undefined ? { inMailSubject: subject } : {}),
      // What the user confirmed was a particular message. Changing it means
      // that approval no longer describes what would send — and auto-send may
      // act on it with nobody watching.
      ...(body !== msg.body || subject !== (msg.inMailSubject ?? '')
        ? { recipientConfirmedAt: undefined }
        : {}),
      // Saving an edit is looking it over: a reply that came before this no
      // longer holds it (lib/queue-holds).
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
    });
    setEditing(false);
  };

  const remove = async () => {
    if (db) await db.scheduledMessages.delete(msg.id);
  };

  const name = msg.recipientName || 'Unknown';
  const statusChip = hold ? (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${HOLD_CHIP[hold.kind]}`}>
      {hold.kind === 'waiting' ? 'Waiting for their reply' : 'They replied'}
    </span>
  ) : (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${badgeClass(msg.status, !!ready)}`}>
      {ready ? 'Ready to send' : statusLabel(msg.status)}
    </span>
  );
  // "Still send it": the user has looked again and it still stands.
  const keepAfterReply = () => save({ reviewedAt: Date.now() });
  const openReply = (conversationId: string) => {
    const store = useUIStore.getState();
    store.setActiveSection('inbox');
    store.openThread(conversationId, 0);
  };
  const inMailChip = msg.inMailSubject !== undefined && (
    <span
      title="Sends as a Premium InMail and uses one credit"
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300"
    >
      InMail
    </span>
  );
  // The time worth naming in the reading pane's header.
  const headerTime =
    msg.status === 'sent' && msg.sentAt
      ? `Sent ${format(new Date(msg.sentAt), 'MMM d, h:mm a')}`
      : (msg.status === 'scheduled' || ready) && msg.scheduledAt
        ? `${ready ? 'Was due' : 'Sends'} ${format(new Date(msg.scheduledAt), 'MMM d, h:mm a')}`
        : msg.updatedAt > 1000
          ? `Last edited ${format(new Date(msg.updatedAt), 'MMM d, h:mm a')}`
          : '';

  return (
    // Card: h-full + flex so every card in a row is the same height and their
    // buttons line up, instead of each ending wherever its text happened to.
    // Reading pane (expanded): no box at all. It fills the pane like an open
    // email, with the subject as its title and the person beneath it.
    <div
      className={`flex flex-col ${
        expanded
          ? ''
          : `h-full rounded-lg border px-3 py-2.5 ${ready ? 'border-amber-500/30 bg-amber-500/5' : 'border-edge'}`
      }`}
    >
      {expanded && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 text-xl font-semibold text-fg-strong">
              {msg.inMailSubject || (msg.conversationId ? `Reply to ${name}` : `New message to ${name}`)}
            </h2>
            {statusChip}
            {inMailChip}
          </div>
          <div className="mb-4 flex items-start gap-3">
            <GroupAvatar names={[name]} pictures={['']} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <span className="truncate text-sm font-semibold text-fg-strong">{name}</span>
                <span className="flex-1" />
                {headerTime && <span className="shrink-0 text-xs text-fg-faint">{headerTime}</span>}
              </div>
              <p className="text-xs text-fg-muted">
                {msg.source === 'mcp' ? 'Drafted by Claude' : 'Saved from the composer'}
                {msg.createdAt > 1000 && ` · ${format(new Date(msg.createdAt), 'MMM d, h:mm a')}`}
                {msg.conversationId ? ' · reply in an existing thread' : ''}
              </p>
            </div>
          </div>
        </>
      )}

      {/* In the reading pane everything below lines up under the name, as in
          Gmail; on a card it simply flows. */}
      <div className={expanded ? 'pl-[52px]' : 'contents'}>
      {!expanded && (
      <div className="mb-1 flex items-center gap-2">
        <GroupAvatar names={[msg.recipientName || 'Unknown']} pictures={['']} size={24} />
        <span className="truncate text-sm font-semibold text-fg-strong">{msg.recipientName || 'Unknown'}</span>
        {statusChip}
        {msg.inMailSubject !== undefined && (
          <span
            title="Sends as a Premium InMail and uses one credit"
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300"
          >
            InMail
          </span>
        )}
        {!ready && msg.status === 'scheduled' && msg.scheduledAt && (
          <span className="shrink-0 text-[11px] text-fg-faint">{format(new Date(msg.scheduledAt), 'MMM d, h:mm a')}</span>
        )}
        {msg.status === 'sent' && msg.sentAt && (
          <span className="shrink-0 text-[11px] text-fg-faint">{format(new Date(msg.sentAt), 'MMM d, h:mm a')}</span>
        )}
      </div>
      )}

      {/* Editing happens here rather than in the composer: reopening there
          moved the draft into Primary as a fake conversation, dropped its
          Outbox row, and lost the InMail subject, which draftAttachments has
          nowhere to store. */}
      {editing ? (
        <div className="space-y-1.5">
          {msg.inMailSubject !== undefined && (
            <input
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
              placeholder="InMail subject"
              aria-label="InMail subject"
              maxLength={200}
              className="w-full rounded-md bg-surface-input px-2 py-1 text-sm font-semibold text-fg-strong ring-1 ring-inset ring-edge outline-none focus:ring-blue-500/40"
            />
          )}
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            aria-label="Message body"
            rows={Math.min(16, editBody.split('\n').length + 1)}
            className="w-full resize-y rounded-md bg-surface-input px-2 py-1.5 text-sm text-fg-secondary ring-1 ring-inset ring-edge outline-none focus:ring-blue-500/40"
          />
        </div>
      ) : (
        <>
          {/* An InMail's subject is part of what gets sent, so show it with the
              body. (The reading pane already has it as its title.) */}
          {!!msg.inMailSubject && !expanded && (
            <p className="truncate text-sm font-semibold text-fg-strong">{msg.inMailSubject}</p>
          )}
          {/* Clamped by default: these sit in a grid, where one long message
              stretches its whole row and leaves the shorter cards trailing
              white space. The full text is a click away, and always present
              under Edit. */}
          <p
            className={`whitespace-pre-wrap text-sm ${
              expanded ? 'leading-relaxed text-fg' : 'text-fg-secondary'
            } ${showFull || expanded ? '' : dense ? 'line-clamp-2' : 'line-clamp-[9]'}`}
          >
            {msg.body}
          </p>
          {longBody && (
            <button
              onClick={() => setShowFull((v) => !v)}
              className="mt-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:text-fg-secondary"
            >
              {showFull ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      )}
      {/* LinkedIn's refusal is explained by the hold below, in plainer words. */}
      {msg.status === 'failed' && msg.error && !(hold && INMAIL_WAIT_ERROR_RE.test(msg.error)) && (
        <p className="mt-1 text-[11px] text-red-500 dark:text-red-400">{msg.error}</p>
      )}

      {hold?.kind === 'waiting' && (
        <div role="note" className="mt-3 rounded-md bg-surface-input px-3 py-2 text-xs text-fg-secondary ring-1 ring-inset ring-edge">
          <p>
            <span className="font-medium text-fg-strong">{name}</span> hasn’t replied to your InMail of{' '}
            {format(new Date(hold.since), 'MMM d')} (“{hold.subject}”). LinkedIn won’t deliver another message until
            they do, so this one is held.
          </p>
          <p className="mt-1 text-fg-muted">
            If they reply, it moves to “They replied” for you to look over. It never goes out on its own.
          </p>
        </div>
      )}
      {hold?.kind === 'replied' && (
        <div role="note" className="mt-3 rounded-md bg-violet-500/10 px-3 py-2 text-xs text-fg-secondary ring-1 ring-inset ring-violet-500/25">
          <p>
            <span className="font-medium text-fg-strong">{name}</span> replied on {format(new Date(hold.at), 'MMM d, h:mm a')}, after
            this was written. Read the reply first: this may no longer fit.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => openReply(hold.conversationId)}
              className="rounded-md px-2 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge hover:text-fg-strong"
            >
              Open the conversation
            </button>
            <button
              onClick={keepAfterReply}
              className="rounded-md px-2 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge hover:text-fg-strong"
            >
              Still send it
            </button>
          </div>
        </div>
      )}

      {/* Otherwise its silence is a mystery: auto-send is on, the time has
          passed, and nothing happened. */}
      {ready && autoSendScheduled && isTooLateToAutoSend(msg, Date.now()) && (
        <p className="mt-1 text-[11px] text-fg-muted">
          Too far past its time to send itself — send it when you are ready.
        </p>
      )}

      {/* Checking the recipient is about the draft, not part of it: separated
          by a rule and set in the muted metadata scale so it cannot be read as
          another line of the message that would go out. */}
      {pending && claudeInMail && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-edge pt-2 text-[11px]">
          <span className="text-fg-faint">Sending to</span>
          {msg.profileUrl ? (
            <a
              href={msg.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-medium text-blue-700 underline underline-offset-2 hover:text-blue-600 dark:text-blue-300"
            >
              {msg.profileUrl.replace(/^https:\/\/(www\.)?linkedin\.com/, '')}
            </a>
          ) : (
            <span className="text-fg-faint">no profile link on this draft</span>
          )}
          {confirmRecipient && (
            // A checkbox, not a one-way button: confirming is a claim the user
            // might want to take back after opening the profile and finding
            // the wrong person — which is the whole reason the check exists.
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
              <input
                type="checkbox"
                checked={!!msg.recipientConfirmedAt}
                onChange={(e) =>
                  db?.scheduledMessages.update(msg.id, {
                    recipientConfirmedAt: e.target.checked ? Date.now() : undefined,
                    updatedAt: Date.now(),
                  })
                }
                className="h-3.5 w-3.5 accent-emerald-600"
              />
              <span
                className={
                  msg.recipientConfirmedAt
                    ? 'font-medium text-emerald-700 dark:text-emerald-400'
                    : 'font-medium text-amber-700 dark:text-amber-300'
                }
              >
                {msg.recipientConfirmedAt ? 'Recipient confirmed' : 'This is the right person'}
              </span>
            </label>
          )}
        </div>
      )}

      {pending && (
        <div className={`flex flex-wrap items-center gap-2 ${expanded ? 'mt-3 pt-1' : 'mt-auto pt-2'}`}>
          {editing ? (
            <>
              <button
                onClick={saveEdit}
                disabled={!editBody.trim()}
                className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 disabled:opacity-40 dark:text-blue-300"
              >
                Save
              </button>
              <button onClick={() => setEditing(false)} className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:text-fg-secondary">
                Cancel
              </button>
            </>
          ) : rescheduling ? (
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
              <button
                onClick={sendNow}
                disabled={busy || needsConfirm || !!hold}
                title={
                  hold?.kind === 'waiting'
                    ? 'LinkedIn won’t deliver this until they reply to your InMail'
                    : hold?.kind === 'replied'
                      ? 'They replied after this was written: read it, then edit or choose Still send it'
                      : needsConfirm
                        ? 'Open the profile and confirm this is the right person first'
                        : undefined
                }
                className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 disabled:opacity-40 dark:text-blue-300"
              >
                {busy ? 'Sending…' : msg.status === 'failed' ? 'Retry send' : 'Send now'}
              </button>
              {/* Also offered on a plain draft: a draft with no time is the
                  most likely thing to want one, and the picker already exists.
                  Not while held: auto-send would only skip it. */}
              {!hold && (
              <button
                onClick={() => setRescheduling(true)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge hover:text-fg-strong"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                {msg.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
              </button>
              )}
              <button onClick={beginEdit} className="rounded-md px-2 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge hover:text-fg-strong">
                Edit
              </button>
              {confirmingDelete ? (
                <>
                  <span className="text-xs text-fg-secondary">Discard this draft?</span>
                  <button
                    onClick={remove}
                    className="rounded-md px-2 py-1 text-xs font-semibold text-red-600 ring-1 ring-inset ring-red-500/40 transition-colors hover:bg-red-500/10 dark:text-red-400"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:text-fg-secondary"
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  onClick={() => (confirmDelete ? setConfirmingDelete(true) : void remove())}
                  className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:text-red-500 dark:hover:text-red-400"
                >
                  {msg.status === 'scheduled' ? 'Cancel' : 'Delete'}
                </button>
              )}
            </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
