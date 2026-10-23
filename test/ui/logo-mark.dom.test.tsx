// @vitest-environment jsdom
// The collapsed-sidebar mark is the new inflow mark (dot + streams), drawn as
// vectors rather than a typed ƒ, and it lightens its dot in dark themes.
import '../dom-setup';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logo, LogoMark } from '@/components/common/Wordmark';

it('draws the mark as shapes, not a font glyph', () => {
  const { container } = render(<LogoMark size={26} />);
  const svg = container.querySelector('svg')!;
  expect(svg.getAttribute('viewBox')).toBe('150 155 980 980');
  expect(svg.querySelector('text')).toBeNull();
  expect(svg.querySelector('circle')).toBeTruthy();
  // All three streams, like the full mark: the small cut only widens the gaps.
  expect(svg.querySelectorAll('path')).toHaveLength(3);
});

it('uses exactly the paths of the small master, so the sidebar and toolbar match', () => {
  const master = readFileSync(resolve(__dirname, '../../assets/brand/inflow-mark-small.svg'), 'utf8');
  const masterPaths = [...master.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  const { container } = render(<LogoMark />);
  const ours = [...container.querySelectorAll('path')].map((p) => p.getAttribute('d'));
  expect(ours).toEqual(masterPaths);
});

it('lightens the dot in dark themes', () => {
  const { container } = render(<LogoMark />);
  expect(container.querySelector('circle')!.getAttribute('class')).toContain('dark:fill-');
});

it('gives each instance its own gradient, so two marks on screen never share one', () => {
  const { container } = render(
    <>
      <LogoMark />
      <LogoMark />
    </>,
  );
  const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id);
  expect(new Set(ids).size).toBe(2);
});

it('shows the mark collapsed and the wordmark expanded', () => {
  expect(render(<Logo collapsed />).container.querySelector('svg')).toBeTruthy();
  const expanded = render(<Logo />).container;
  expect(expanded.querySelector('svg')).toBeNull();
  expect(expanded.textContent).toBe('inflow');
});
