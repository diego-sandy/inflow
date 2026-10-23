import type { ReactNode } from 'react';
import { LogoMark } from '@/components/common/Wordmark';

/**
 * Animated drawings of the Claude Desktop screens the MCP connector guide
 * walks through, redrawn from real screenshots of installing inflow.mcpb:
 *
 *   1. inflow's page, with Install and the standard warning box;
 *   2. the "Do you want to install inflow?" confirmation;
 *   3. Configure inflow: the pairing code (required), two optional keys, Save;
 *   4. the Enabled switch;
 *   5. Settings › Extensions › inflow › Tool permissions › Always allow.
 *
 * Drawn rather than screenshotted, like the toolbar in PinIllustration, so
 * they never show anyone's data and stay sharp. They keep Claude's own dark
 * look regardless of the app theme, because that is what the user will see.
 * The wording on them is Claude's and the companion's (mcp-companion/
 * manifest.json), so it matches the real screens.
 *
 * Each runs a 7s loop of `setup-*` keyframes in global.css, with a cursor
 * moved by coordinate, so they're laid out in fixed pixels. With reduced
 * motion each stops on its most useful frame.
 */

const W = 340;
const H = 210;

function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      style={{ width: W, height: H }}
      className="relative mx-auto select-none overflow-hidden rounded-xl bg-[#262624] text-left text-[#e8e6e3] ring-1 ring-black/20"
    >
      {children}
    </div>
  );
}

function Cursor({ className }: { className: string }) {
  return (
    <svg className={`absolute left-0 top-0 z-20 h-4 w-4 drop-shadow ${className}`} viewBox="0 0 20 20">
      <path d="M1 1L1 15L5 11L8 18L10.5 17L7.5 10L13 10Z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function AppIcon({ size }: { size: number }) {
  return (
    <span className="flex items-center justify-center rounded-lg bg-[#1a1a19] ring-1 ring-white/5" style={{ width: size, height: size }}>
      <LogoMark size={Math.round(size * 0.66)} />
    </span>
  );
}

function Toggle({ className = '' }: { className?: string }) {
  return (
    <span className={`relative inline-flex h-[15px] w-[27px] items-center rounded-full bg-[#2c84db] px-[2px] ${className}`}>
      <span className="ml-auto h-[11px] w-[11px] rounded-full bg-white" />
    </span>
  );
}

const DESCRIPTION =
  'Let Claude work with your inflow LinkedIn network — search connections, read network stats, and draft messages into your Outbox.';

/** inflow's page in Claude, before and after installing. */
function ExtensionPage({ installed, installClass = '' }: { installed?: boolean; installClass?: string }) {
  return (
    <>
      <div className="absolute inset-x-0 top-0 h-[70px] bg-[#30302e]" />
      <div className="absolute left-3.5 top-3.5">
        <AppIcon size={42} />
      </div>
      <p className="absolute left-[66px] top-[14px] text-[13px]">inflow</p>
      <p className="absolute left-[66px] top-[33px] w-[188px] text-[7.5px] leading-[1.35] text-[#a3a19c]">{DESCRIPTION}</p>
      <span
        className={`absolute left-[268px] top-[22px] flex h-[20px] w-[58px] items-center justify-center rounded-md bg-white text-[9px] font-medium text-[#1a1a19] ${installClass}`}
      >
        {installed ? 'Uninstall' : 'Install'}
      </span>
      <div className="absolute inset-x-3.5 top-[82px] flex gap-1.5 rounded-md border border-[#4a4945] px-2 py-1.5 text-[7px] leading-[1.35] text-[#d6d3cd]">
        <span className="text-[#e5484d]">⚠</span>
        <span>
          Installing will grant this extension access to everything on your computer. Any developer information shown has not
          been verified by Anthropic.
        </span>
      </div>
    </>
  );
}

/** Open the file: inflow's page, click Install, then Install again to confirm. */
export function InstallAnimation() {
  return (
    <Frame>
      <ExtensionPage installClass="setup-click-hint" />
      <p className="absolute left-3.5 top-[134px] text-[9px]">Requirements</p>
      <p className="absolute left-3.5 top-[150px] text-[8px] text-[#5fb35f]">✓ All requirements met</p>

      <div className="setup-inst-dim absolute inset-0 z-10 bg-black/55" />
      <div className="setup-inst-dialog absolute left-[95px] top-[60px] z-10 h-[90px] w-[150px] rounded-xl bg-[#2b2b29] p-2.5 ring-1 ring-white/10">
        <p className="text-[8.5px] font-bold">Do you want to install inflow?</p>
        <p className="mt-1 text-[7px] leading-[1.35] text-[#d6d3cd]">
          This desktop extension will be installed on your computer and made available to Claude.
        </p>
        <span className="absolute left-[10px] top-[64px] flex h-[17px] w-[60px] items-center justify-center rounded-full bg-[#3d3d3a] text-[8px]">
          Cancel
        </span>
        <span className="absolute left-[80px] top-[64px] flex h-[17px] w-[60px] items-center justify-center rounded-full bg-[#3d3d3a] text-[8px]">
          Install
        </span>
      </div>
      <Cursor className="setup-inst-cursor" />
    </Frame>
  );
}

/** Configure inflow: paste the pairing code, then Save. */
export function ConfigureAnimation() {
  return (
    <Frame>
      <div className="absolute left-[20px] top-[12px] h-[186px] w-[300px] rounded-xl bg-[#30302e] ring-1 ring-white/10">
        <div className="absolute left-3 top-2.5 flex items-center gap-1.5 text-[11px]">
          Configure <AppIcon size={18} /> inflow
        </div>
        <p className="absolute left-3 top-[34px] text-[8.5px]">
          inflow pairing code <span className="text-[#a3a19c]">(required)</span>
        </p>
        <p className="absolute left-3 top-[47px] text-[7px] text-[#a3a19c]">Copy it from inflow → MCP connector.</p>
        <div className="absolute left-3 top-[60px] h-[20px] w-[276px] rounded-md bg-[#3a3a37] ring-1 ring-[#2c84db]">
          <span className="setup-cfg-typed absolute left-2 top-[5px] overflow-hidden whitespace-nowrap font-mono text-[9px] leading-[10px] tracking-[0.15em]">
            •••••••••
          </span>
        </div>
        <p className="absolute left-3 top-[88px] text-[8px]">Anthropic API key (optional) — for inflow's in-app Claude</p>
        <div className="absolute left-3 top-[100px] h-[16px] w-[276px] rounded-md bg-[#3a3a37]" />
        <p className="absolute left-3 top-[123px] text-[8px]">Gemini API key (optional) — runs Gemini server-side</p>
        <div className="absolute left-3 top-[135px] h-[16px] w-[276px] rounded-md bg-[#3a3a37]" />
        <span className="absolute left-3 top-[160px] flex h-[17px] w-[44px] items-center justify-center rounded-md bg-[#3d3d3a] text-[8px]">
          Cancel
        </span>
        <span className="setup-cfg-save absolute left-[244px] top-[160px] flex h-[17px] w-[44px] items-center justify-center rounded-md text-[8px]">
          Save
        </span>
      </div>
      <Cursor className="setup-cfg-cursor" />
    </Frame>
  );
}

/** After saving: inflow's page shows the Enabled switch on. */
export function EnabledIllustration() {
  return (
    <Frame>
      <ExtensionPage installed />
      <div className="absolute inset-x-3.5 top-[134px] flex items-center gap-2">
        <span className="setup-click-hint relative inline-flex rounded-full">
          <Toggle />
        </span>
        <span className="text-[9px]">Enabled</span>
        <span className="ml-auto flex h-[18px] items-center rounded-md bg-[#3d3d3a] px-2 text-[8px]">Configure</span>
      </div>
    </Frame>
  );
}

/** Settings › Extensions › inflow › Tool permissions: set Other tools to Always allow. */
export function PermissionsAnimation() {
  return (
    <Frame>
      {/* Settings sidebar */}
      <div className="absolute inset-y-0 left-0 w-[84px] border-r border-white/5 bg-[#262624] px-2 pt-2.5 text-[7.5px] text-[#d6d3cd]">
        <p className="mb-1.5 text-[9px] text-[#e8e6e3]">Settings</p>
        <p className="py-[3px]">General</p>
        <p className="py-[3px]">Privacy</p>
        <p className="py-[3px]">Capabilities</p>
        <p className="mt-1.5 text-[6.5px] text-[#8a8780]">This computer</p>
        <p className="py-[3px]">System</p>
        <p className="-mx-1 rounded bg-white/10 px-1 py-[3px] text-[#e8e6e3]">Extensions</p>
        <p className="py-[3px]">Developer</p>
      </div>
      {/* inflow's settings */}
      <p className="absolute left-[96px] top-[10px] text-[8px] text-[#d6d3cd]">← Extensions</p>
      <div className="absolute left-[96px] top-[26px] flex items-center gap-1.5 text-[12px]">
        <AppIcon size={22} /> inflow
      </div>
      <div className="absolute left-[96px] right-[10px] top-[56px] flex h-[26px] items-center gap-2 rounded-lg bg-[#1f1f1d] px-2">
        <Toggle />
        <span className="text-[8.5px]">Enabled</span>
        <span className="ml-auto rounded bg-[#3d3d3a] px-1.5 py-[2px] text-[7.5px]">Uninstall</span>
      </div>
      <div className="absolute left-[96px] right-[10px] top-[90px] h-[40px] rounded-lg bg-[#1f1f1d] px-2 pt-1.5 text-[7px] text-[#a3a19c]">
        <p className="text-[7.5px] text-[#e8e6e3]">
          inflow pairing code <span className="text-[#a3a19c]">(required)</span>
        </p>
        <div className="mt-1 h-[12px] rounded bg-[#2b2b29] px-1.5 font-mono text-[7px] leading-[12px] tracking-[0.15em] text-[#d6d3cd]">•••••••••</div>
      </div>
      <p className="absolute left-[96px] top-[140px] text-[9px] font-semibold">Tool permissions</p>
      <p className="absolute left-[96px] top-[154px] w-[230px] text-[7px] text-[#a3a19c]">Choose when Claude is allowed to use these tools.</p>
      <p className="absolute left-[96px] top-[176px] text-[8.5px]">
        ⌄ Other tools <span className="rounded-full bg-[#3d3d3a] px-1.5 text-[7px]">14</span>
      </p>
      <span className="absolute left-[244px] top-[171px] flex h-[19px] w-[86px] items-center justify-center rounded-md bg-[#3a3a37] text-[8px]">
        <span className="setup-perm-before absolute inset-0 flex items-center justify-center gap-1 text-[#a3a19c]">
          <span className="h-[5px] w-[38px] rounded-full bg-[#5a5955]" /> ⌄
        </span>
        <span className="setup-perm-after absolute inset-0 flex items-center justify-center gap-1">
          <span className="text-[#5fb35f]">✓</span> Always allow ⌄
        </span>
      </span>
      <div className="setup-perm-menu absolute left-[244px] top-[118px] z-10 w-[86px] rounded-md bg-[#2b2b29] p-1 shadow-lg ring-1 ring-white/10">
        <p className="rounded bg-white/10 px-1.5 py-[3px] text-[8px]">
          <span className="text-[#5fb35f]">✓</span> Always allow
        </p>
        <span className="mx-1.5 my-[5px] block h-[5px] w-[46px] rounded-full bg-[#4a4945]" />
        <span className="mx-1.5 my-[5px] block h-[5px] w-[54px] rounded-full bg-[#4a4945]" />
      </div>
      <Cursor className="setup-perm-cursor" />
    </Frame>
  );
}
