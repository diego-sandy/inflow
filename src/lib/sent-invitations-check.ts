import { sendBridgeMessage } from './bridge';
import type { SentInvitationsProbe } from '../../entrypoints/background/api/relationships';

/**
 * The command-palette side of the one-off "does Voyager still serve sent
 * invitations?" check (see probeSentInvitations). It decides whether a Sent tab
 * can use the regular API or would have to read LinkedIn's web page.
 */
export function describeSentProbe(p: SentInvitationsProbe): string {
  const head = `sentInvitationViewsV2 → HTTP ${p.status}`;
  if (!p.ok) {
    const why =
      p.status === 404 ? 'LinkedIn no longer serves this address.'
        : p.status === 400 ? 'LinkedIn rejected the request as malformed (the address exists, the query may have changed).'
          : p.status === 401 || p.status === 403 ? 'Not allowed with this session.'
            : p.status === 429 || p.status === 999 ? 'Throttled. Try again later; nothing is known yet.'
              : 'Unexpected answer.';
    return `${head}\n${why}`;
  }
  const lines = [head];
  if (p.rows === undefined) {
    lines.push('It answered, but not with a list inflow recognises.');
  } else {
    lines.push(
      p.rows > 0
        ? `It works: ${p.rows} sent invitation${p.rows === 1 ? '' : 's'} on the first page${p.total ? ` (of ${p.total})` : ''}.`
        : 'It answered with an empty list. If you have pending sent invitations, it may not be the right query.',
    );
  }
  if (p.included !== undefined) lines.push(`Linked records: ${p.included}.`);
  if (p.fields?.length) lines.push(`Fields: ${p.fields.join(', ')}.`);
  return lines.join('\n');
}

/** Run the check, show the answer until dismissed, and copy it for pasting. */
export async function runSentInvitationsCheck(): Promise<string> {
  let text: string;
  try {
    const res = await sendBridgeMessage({ type: 'PROBE_SENT_INVITATIONS' });
    text = res.success && res.data ? describeSentProbe(res.data as SentInvitationsProbe) : `The check failed: ${res.error || 'no answer'}`;
  } catch (e: any) {
    text = `The check failed: ${e?.message || e}`;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    /* the click's user gesture may have lapsed; the dialog still shows it */
  }
  window.alert(`Sent invitations check\n\n${text}${copied ? '\n\n(Copied to the clipboard.)' : ''}`);
  return text;
}
