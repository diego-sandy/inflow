import { SparkleIcon } from '@/components/common/SparkleIcon';
import type { AiComposeApi } from '@/hooks/useAiCompose';

/**
 * The pending AI Compose draft, shown as a right-aligned bubble in the thread —
 * clearly marked "not sent". The user approves it (loads into the composer to
 * edit and send), regenerates, or discards it. Nothing here ever sends.
 */
export function AiDraftBubble({ ai }: { ai: AiComposeApi }) {
  const generating = ai.status === 'generating';
  const isError = ai.status === 'error';
  const hasText = !!ai.draft && ai.draft.length > 0;

  return (
    <div className="flex flex-col items-end" data-ai-draft="">
      <div className="mb-1 flex items-center gap-1.5">
        <SparkleIcon className="h-3.5 w-3.5 text-blue-500 dark:text-blue-300" />
        <span className="text-[11px] font-medium text-blue-600 dark:text-blue-300">
          {generating ? 'AI is writing…' : isError ? 'AI draft failed' : 'AI draft · not sent'}
        </span>
      </div>

      <div className="max-w-[80%] rounded-2xl rounded-br-md border border-dashed border-blue-500/40 bg-blue-500/5 px-3.5 py-2.5 text-sm leading-relaxed text-fg">
        {isError ? (
          <span className="text-red-500 dark:text-red-400">{ai.error || 'Something went wrong.'}</span>
        ) : hasText ? (
          <span className="whitespace-pre-wrap">{ai.draft}</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-fg-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500/60" />
            Thinking…
          </span>
        )}
      </div>

      {/* Actions appear once there's something to act on (idle+text, or error). */}
      {!generating && (hasText || isError) && (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={ai.generate}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
            {isError ? 'Try again' : 'Regenerate'}
          </button>
          <button
            type="button"
            onClick={ai.discard}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            Discard
          </button>
          {hasText && (
            <button
              type="button"
              onClick={ai.approve}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              Approve → edit &amp; send
            </button>
          )}
        </div>
      )}
    </div>
  );
}
