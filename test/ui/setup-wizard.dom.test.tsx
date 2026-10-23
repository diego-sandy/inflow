// @vitest-environment jsdom
// The first-run setup wizard: when it opens, how it moves, and what each step
// saves. Steps that can be checked (signed in, pinned, key works) tick
// themselves; every step but LinkedIn can be skipped.
import '../dom-setup';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { mockFetch } from '../mocks/fetch';
import { SetupWizard } from '@/components/setup/SetupWizard';
import { useUIStore } from '@/store/ui-store';
import { getSetupStep, isSetupPending, markSetupPending, setSetupStep, getSetupCompletedAt } from '@/lib/setup-state';
import { getCategorizeMode, getConnectionInterests, getGeminiApiKey, getTierProvider } from '@/lib/ai-settings';

beforeEach(() => {
  act(() => useUIStore.setState({ setupOpen: false, setupFromStart: false, mcpStatus: 'disconnected' } as any));
  (chrome.action.getUserSettings as any).mockResolvedValue({ isOnToolbar: false });
});

const dialog = () => screen.findByRole('dialog', { name: 'Set up inflow' });

async function openAt(step: Parameters<typeof setSetupStep>[0]) {
  await markSetupPending();
  await setSetupStep(step);
  render(<SetupWizard />);
  await dialog();
}

describe('opening', () => {
  it('opens on its own after a fresh install', async () => {
    await markSetupPending();
    render(<SetupWizard />);
    await dialog();
    expect(screen.getByRole('heading', { name: 'Welcome to inflow' })).toBeInTheDocument();
  });

  it('stays closed for someone who did not just install', async () => {
    render(<SetupWizard />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resumes at the saved step', async () => {
    await openAt('ai');
    expect(screen.getByRole('heading', { name: 'What should AI help with?' })).toBeInTheDocument();
  });

  it('"Run setup again" starts from Welcome whatever was saved', async () => {
    await setSetupStep('key');
    render(<SetupWizard />);
    act(() => useUIStore.getState().openSetup({ fromStart: true }));
    await dialog();
    expect(screen.getByRole('heading', { name: 'Welcome to inflow' })).toBeInTheDocument();
  });

  it('Escape closes it, stops it reopening, and keeps the step', async () => {
    await openAt('pin');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await isSetupPending()).toBe(false);
    expect(await getSetupStep()).toBe('pin');
  });
});

describe('before sign-in (shown by the sign-in gate)', () => {
  it('cannot continue past LinkedIn, and cannot be closed', async () => {
    await setSetupStep('linkedin');
    render(<SetupWizard standalone auth="unauthenticated" onCheckAuth={() => {}} />);
    await dialog();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Close setup' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pin to the toolbar/ })).toBeDisabled();
    expect(screen.getByText(/Waiting for you to sign in/)).toBeInTheDocument();
  });

  it('never resumes past LinkedIn, even if a later step was saved', async () => {
    await setSetupStep('key');
    render(<SetupWizard standalone auth="unauthenticated" />);
    await dialog();
    expect(screen.getByRole('heading', { name: 'Sign in to LinkedIn' })).toBeInTheDocument();
  });

  it('shows who is signed in once the session is there', async () => {
    localStorage.setItem('inflow-account-name', 'Ada Lovelace');
    await openAt('linkedin');
    expect(screen.getByText('Signed in as Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});

describe('pin', () => {
  it('waits for the pin, then ticks itself', async () => {
    await openAt('pin');
    await screen.findByText(/Waiting for the pin/);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled();

    (chrome.action.getUserSettings as any).mockResolvedValue({ isOnToolbar: true });
    await screen.findByText(/Pinned\. inflow is one click away/, {}, { timeout: 4000 });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});

describe('choosing what AI does', () => {
  it('saves the choices and the tags as they change', async () => {
    await openAt('ai');
    fireEvent.click(screen.getByRole('switch', { name: 'Sort and tag my connections' }));
    await waitFor(async () => expect(await getCategorizeMode()).toBe('manual'));

    fireEvent.click(screen.getByRole('switch', { name: 'Sort and tag my connections' }));
    const input = await screen.findByPlaceholderText('Add a tag, like Hiring');
    fireEvent.change(input, { target: { value: 'Hiring' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(async () => expect(await getConnectionInterests()).toContain('Hiring'));
  });

  it('skipping AI goes past the key step to the MCP connector, which needs no key, and the end says AI is off', async () => {
    await openAt('ai');
    fireEvent.click(screen.getByRole('button', { name: 'Skip AI for now' }));
    await screen.findByRole('heading', { name: 'Set up the MCP connector' });
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: "You're all set" });
    expect(screen.getByText(/AI is off/)).toBeInTheDocument();
  });
});

describe('adding a key', () => {
  it('checks a Gemini key before saving it', async () => {
    mockFetch('generativelanguage.googleapis.com', async () => new Response('{}', { status: 200 }));
    await openAt('key');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'AIzaGOOD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check and save Gemini key' }));

    await screen.findByText('Key added');
    expect(await getGeminiApiKey()).toBe('AIzaGOOD');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('shows why a key was rejected and saves nothing', async () => {
    mockFetch('generativelanguage.googleapis.com', async () => new Response('{}', { status: 400 }));
    await openAt('key');
    fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'typo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check and save Gemini key' }));
    await screen.findByText('Invalid API key');
    expect(await getGeminiApiKey()).toBeNull();
  });

  it('a Claude key on its own is pointed at every job, so it is actually used', async () => {
    mockFetch('api.anthropic.com', async () => new Response('{}', { status: 200 }));
    await openAt('key');
    fireEvent.click(screen.getByRole('button', { name: /Prefer Claude/ }));
    fireEvent.change(screen.getByLabelText('Claude API key'), { target: { value: 'sk-ant-good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check and save Claude key' }));
    await screen.findByText('Key added');
    expect(await getTierProvider('fast')).toBe('anthropic');
    expect(await getTierProvider('quality')).toBe('anthropic');
  });

  it('can be put off, moving on to the MCP connector', async () => {
    await openAt('key');
    fireEvent.click(screen.getByRole('button', { name: 'Do this later' }));
    await screen.findByRole('heading', { name: 'Set up the MCP connector' });
  });
});

describe('finishing', () => {
  it('records completion and closes', async () => {
    await openAt('done');
    fireEvent.click(screen.getByRole('button', { name: 'Start using inflow' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await getSetupCompletedAt()).not.toBeNull();
    expect(await isSetupPending()).toBe(false);
  });

  it('names what is left to do, and offers to finish it', async () => {
    await openAt('done');
    // Unfinished rows read as tasks, not as unticked claims.
    expect(await screen.findByText('Pin inflow to the toolbar')).toBeInTheDocument();
    expect(screen.getByText('Add an AI key', { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finish' })[0]);
    await screen.findByRole('heading', { name: 'Pin inflow to your toolbar' });
  });

  it('ticks what is really done, whichever steps were clicked through', async () => {
    (chrome.action.getUserSettings as any).mockResolvedValue({ isOnToolbar: true });
    await chrome.storage.local.set({ geminiApiKey: 'AIzaSAVED' });
    await openAt('done');
    expect(await screen.findByText('Pinned to the toolbar')).toBeInTheDocument();
    expect(await screen.findByText('AI key added')).toBeInTheDocument();
    // Only the optional Claude row is left to finish.
    expect(screen.getAllByRole('button', { name: 'Finish' })).toHaveLength(1);
    expect(screen.getByText('Set up the MCP connector (optional)')).toBeInTheDocument();
  });

  it('does not tick the key step in the step list without a key', async () => {
    await openAt('done');
    const keyStep = screen.getByRole('button', { name: /Add an AI key/ });
    // An unticked step shows its number; a ticked one shows the check instead.
    expect(keyStep).toHaveTextContent('5');
  });
});

it('Back and the step list both move between steps', async () => {
  await openAt('ai');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await screen.findByRole('heading', { name: 'Pin inflow to your toolbar' });
  fireEvent.click(screen.getByRole('button', { name: /Add an AI key/ }));
  await screen.findByRole('heading', { name: 'Add an AI key' });
  expect(await getSetupStep()).toBe('key');
});

describe('closing when opened from Settings', () => {
  async function openFromSettings() {
    render(<SetupWizard />);
    act(() => useUIStore.getState().openSetup({ fromStart: true }));
    await dialog();
  }

  it('the close button sits above the animated step, so it can be clicked', async () => {
    await openFromSettings();
    // jsdom has no layout, so pin the fix itself: the step animates with a
    // transform, which stacks it over earlier siblings unless the button is lifted.
    expect(screen.getByRole('button', { name: 'Close setup' }).className).toMatch(/\bz-10\b/);
    fireEvent.click(screen.getByRole('button', { name: 'Close setup' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('clicking outside closes it, but clicking inside does not', async () => {
    await openFromSettings();
    fireEvent.click(screen.getByRole('heading', { name: 'Welcome to inflow' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('ticks on a working install', () => {
  const stepButton = (name: RegExp) => screen.getByRole('button', { name });
  const isTicked = (el: HTMLElement) => el.querySelector('.animate-setup-check') !== null;

  it('ticks choosing AI when a key is already working, even from Welcome', async () => {
    await chrome.storage.local.set({ geminiApiKey: 'AIzaSAVED' });
    render(<SetupWizard />);
    act(() => useUIStore.getState().openSetup({ fromStart: true }));
    await dialog();
    await waitFor(() => expect(isTicked(stepButton(/Choose what AI does/))).toBe(true));
    expect(isTicked(stepButton(/Add an AI key/))).toBe(true);
  });

  it('ticks All set once signed in, pinned and keyed', async () => {
    (chrome.action.getUserSettings as any).mockResolvedValue({ isOnToolbar: true });
    await chrome.storage.local.set({ geminiApiKey: 'AIzaSAVED' });
    render(<SetupWizard />);
    act(() => useUIStore.getState().openSetup({ fromStart: true }));
    await dialog();
    await waitFor(() => expect(isTicked(stepButton(/All set/))).toBe(true));
  });

  it('leaves All set unticked while something is missing', async () => {
    render(<SetupWizard />);
    act(() => useUIStore.getState().openSetup({ fromStart: true }));
    await dialog();
    await new Promise((r) => setTimeout(r, 50));
    expect(isTicked(stepButton(/All set/))).toBe(false);
    expect(isTicked(stepButton(/Choose what AI does/))).toBe(false);
  });

  it('ticks Welcome and AI after setup was finished once before', async () => {
    await chrome.storage.local.set({ setupCompletedAt: 1 });
    render(<SetupWizard />);
    act(() => useUIStore.getState().openSetup({ fromStart: true }));
    await dialog();
    await waitFor(() => expect(isTicked(stepButton(/Welcome/))).toBe(true));
    expect(isTicked(stepButton(/Choose what AI does/))).toBe(true);
  });
});
