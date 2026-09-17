'use client';
// Negative controls: correct patterns that must never be reported as failures.

import { useEffect, useId, useLayoutEffect, useState } from 'react';

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
