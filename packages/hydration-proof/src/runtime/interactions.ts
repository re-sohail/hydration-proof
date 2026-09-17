import type { InputState, InteractionTargets, PageObservation } from '../shared/protocol.ts';

// Page-side helpers of the interaction checks. They only read the page (and
// move focus, selection and scroll); they never change the DOM.

function visible(el: Element): boolean {
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function usable(el: Element): boolean {
  const control = el as HTMLInputElement;
  return visible(el) && !control.disabled && !control.readOnly && el.closest('[inert], [aria-hidden="true"]') === null;
}

/** A selector that finds `el` again, even in a re-rendered document. */
export function selectorOf(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    if (current.id && document.querySelectorAll(`#${CSS.escape(current.id)}`).length === 1) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const tag = current.localName;
    const parent: Element | null = current.parentElement;
    const index = parent ? Array.from(parent.children).filter((child) => child.localName === tag).indexOf(current) + 1 : 1;
    parts.unshift(`${tag}:nth-of-type(${index})`);
    current = parent;
  }
  return parts.join(' > ');
}

const TEXT_FIELDS =
  'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="tel"], input[type="url"], textarea';

export function interactionTargets(): InteractionTargets {
  const input = Array.from(document.querySelectorAll(TEXT_FIELDS)).find(usable);
  const checkbox = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(
    (el) => usable(el) && !(el as HTMLInputElement).checked,
  );
  const button = Array.from(document.querySelectorAll('button')).find(
    (el) => usable(el) && el.closest('a') === null && (el.closest('form') === null || el.getAttribute('type') === 'button'),
  );
  const out: InteractionTargets = { scrollable: document.documentElement.scrollHeight > window.innerHeight + 200 };
  if (input) out.input = selectorOf(input);
  if (checkbox) out.checkbox = selectorOf(checkbox);
  if (button) out.button = selectorOf(button);
  return out;
}

let rememberedField: Element | null = null;

/** Scroll, focus the field without scrolling, select some of its text, and remember the node. */
export function prepareInput(targets: InteractionTargets): void {
  if (targets.scrollable) window.scrollTo(0, Math.min(400, document.documentElement.scrollHeight - window.innerHeight));
  if (!targets.input) return;
  const field = document.querySelector(targets.input) as HTMLInputElement | null;
  rememberedField = field;
  field?.focus({ preventScroll: true });
  try {
    field?.setSelectionRange(2, 9);
  } catch {
    // Some input types do not support selection.
  }
}

export function inputState(targets: InteractionTargets): InputState {
  const field = targets.input ? (document.querySelector(targets.input) as HTMLInputElement | null) : null;
  const box = targets.checkbox ? (document.querySelector(targets.checkbox) as HTMLInputElement | null) : null;
  const state: InputState = { focused: field !== null && document.activeElement === field, scrollY: Math.round(window.scrollY) };
  if (field) {
    state.value = field.value;
    if (field.selectionStart !== null && field.selectionEnd !== null) state.selection = [field.selectionStart, field.selectionEnd];
  }
  if (box) state.checked = box.checked;
  if (rememberedField) state.fieldReplaced = !rememberedField.isConnected;
  return state;
}

export function observePage(): PageObservation {
  return { text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim(), url: location.href };
}
