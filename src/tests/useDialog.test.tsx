/** @vitest-environment jsdom */
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { useDialog } from '../hooks/useDialog';

function Dialog({ open, onClose, name }: { open: boolean; onClose: () => void; name: string }) {
  useDialog({ isOpen: open, onClose });
  if (!open) return null;
  return (
    <div data-overlay={name}>
      <section role="dialog" aria-modal="true" aria-label={name}>
        <button data-first={name}>first</button>
        <button data-last={name}>last</button>
      </section>
    </div>
  );
}

function Harness() {
  const [parent, setParent] = useState(false);
  const [child, setChild] = useState(false);
  return (
    <>
      <button data-opener onClick={() => setParent(true)}>open</button>
      <Dialog open={parent} onClose={() => setParent(false)} name="parent" />
      {parent && <button data-child-opener onClick={() => setChild(true)}>child</button>}
      <Dialog open={child} onClose={() => setChild(false)} name="child" />
    </>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.style.overflow = '';
  vi.unstubAllGlobals();
});

const click = (selector: string) => act(() => (host.querySelector(selector) as HTMLButtonElement).click());
const key = (value: string, shiftKey = false) => act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true })));
const frame = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 1)); });

describe('useDialog', () => {
  it('moves focus in, traps Tab, closes with Escape, and restores the opener', async () => {
    act(() => root.render(<Harness />));
    const opener = host.querySelector('[data-opener]') as HTMLButtonElement;
    opener.focus();
    click('[data-opener]');
    await frame();

    const first = host.querySelector('[data-first="parent"]') as HTMLButtonElement;
    const last = host.querySelector('[data-last="parent"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(first);
    expect(document.body.style.overflow).toBe('hidden');

    last.focus();
    key('Tab');
    expect(document.activeElement).toBe(first);
    key('Tab', true);
    expect(document.activeElement).toBe(last);

    key('Escape');
    expect(host.querySelector('[aria-label="parent"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });

  it('only dismisses the topmost nested dialog and keeps scroll locked', async () => {
    act(() => root.render(<Harness />));
    click('[data-opener]');
    await frame();
    const childOpener = host.querySelector('[data-child-opener]') as HTMLButtonElement;
    childOpener.focus();
    click('[data-child-opener]');
    await frame();

    key('Escape');
    expect(host.querySelector('[aria-label="child"]')).toBeNull();
    expect(host.querySelector('[aria-label="parent"]')).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(childOpener);

    key('Escape');
    expect(host.querySelector('[aria-label="parent"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
