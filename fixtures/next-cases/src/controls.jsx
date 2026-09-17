'use client';
// Negative controls: correct patterns that must never be reported as failures.

import { useEffect, useId, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

export function MountedControl() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <p id="mounted">{mounted ? `Mounted at ${new Date().toISOString()}` : 'Not mounted yet'}</p>;
}

export function SuppressControl() {
  return (
    <p id="suppress">
      Server time: <time suppressHydrationWarning>{new Date().toISOString()}</time>
    </p>
  );
}

export function UseIdControl() {
  const id = useId();
  return (
    <label htmlFor={id} id="use-id">
      Email <input id={id} type="email" defaultValue="test@example.com" />
    </label>
  );
}

export function LayoutEffectControl() {
  useLayoutEffect(() => {
    const tooltip = document.getElementById('layout-effect');
    if (tooltip) {
      tooltip.style.top = '24px';
      tooltip.setAttribute('data-placement', 'bottom');
    }
  }, []);
  return (
    <div id="layout-effect" role="tooltip" style={{ position: 'absolute' }}>
      Positioned tooltip
    </div>
  );
}

export function ThemeScriptControl() {
  return (
    <script
      id="theme-script"
      dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('dark')" }}
    />
  );
}

// --- Correct patterns for the values the broken pages get wrong -------------

const viewportStore = {
  subscribe(callback) {
    window.addEventListener('resize', callback);
    return () => window.removeEventListener('resize', callback);
  },
  getSnapshot: () => `${window.innerWidth}px`,
  // The server value is also what the client uses for hydration, so the first
  // render matches; React re-renders with the real width afterwards.
  getServerSnapshot: () => 'unknown',
};

export function SyncExternalStoreControl() {
  const width = useSyncExternalStore(viewportStore.subscribe, viewportStore.getSnapshot, viewportStore.getServerSnapshot);
  return <p id="sync-external-store">Viewport: {width}</p>;
}

export function PortalControl() {
  const [host, setHost] = useState(null);
  useEffect(() => {
    const node = document.createElement('div');
    node.id = 'portal-host';
    document.body.appendChild(node);
    setHost(node);
    return () => node.remove();
  }, []);
  return (
    <div id="portal">
      Opens a dialog
      {host ? createPortal(<p id="portal-content">Dialog body</p>, host) : null}
    </div>
  );
}

export function SuppressAttrControl() {
  // The text is the same on both sides; only `dateTime` differs, and
  // suppressHydrationWarning covers this element's own attributes.
  return (
    <time id="suppress-attr" dateTime={new Date().toISOString()} suppressHydrationWarning>
      just now
    </time>
  );
}

export function RandomInEffectControl() {
  const [token, setToken] = useState('pending');
  useEffect(() => setToken(Math.random().toFixed(6)), []);
  return <p id="random-in-effect">Token: {token}</p>;
}
