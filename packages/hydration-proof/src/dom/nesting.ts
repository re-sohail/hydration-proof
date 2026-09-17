// HTML nesting rules, ported from React's validateDOMNesting
// (react-dom 19.3.0, packages/react-dom-bindings/src/client/validateDOMNesting.js).
// Copyright (c) Meta Platforms, Inc. and affiliates. MIT License.
//
// React warns about exactly these cases because the browser's HTML parser
// repairs them, so the server HTML and React's tree stop matching.

const SPECIAL_TAGS = new Set(
  (
    'address applet area article aside base basefont bgsound blockquote body br button caption center col ' +
    'colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 ' +
    'h4 h5 h6 head header hgroup hr html iframe img input isindex li link listing main marquee menu menuitem ' +
    'meta nav noembed noframes noscript object ol p param plaintext pre script section select source style ' +
    'summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp'
  ).split(' '),
);
const IN_SCOPE_TAGS = new Set(
  'applet caption html table td th marquee object select template foreignObject desc title'.split(' '),
);
const BUTTON_SCOPE_TAGS = new Set([...IN_SCOPE_TAGS, 'button']);
const IMPLIED_END_TAGS = new Set('dd dt li option optgroup p rp rt'.split(' '));

export interface AncestorInfo<T> {
  current: { tag: string; node: T } | null;
  formTag: { tag: string; node: T } | null;
  aTagInScope: { tag: string; node: T } | null;
  buttonTagInScope: { tag: string; node: T } | null;
  nobrTagInScope: { tag: string; node: T } | null;
  pTagInButtonScope: { tag: string; node: T } | null;
  listItemTagAutoclosing: { tag: string; node: T } | null;
  dlItemTagAutoclosing: { tag: string; node: T } | null;
  containerTagInScope: { tag: string; node: T } | null;
  implicitRootScope: boolean;
}

export function emptyAncestorInfo<T>(): AncestorInfo<T> {
  return {
    current: null,
    formTag: null,
    aTagInScope: null,
    buttonTagInScope: null,
    nobrTagInScope: null,
    pTagInButtonScope: null,
    listItemTagAutoclosing: null,
    dlItemTagAutoclosing: null,
    containerTagInScope: null,
    implicitRootScope: false,
  };
}

export function updatedAncestorInfo<T>(old: AncestorInfo<T> | null, tag: string, node: T): AncestorInfo<T> {
  const info: AncestorInfo<T> = { ...(old ?? emptyAncestorInfo<T>()) };
  const entry = { tag, node };
  if (IN_SCOPE_TAGS.has(tag)) {
    info.aTagInScope = null;
    info.buttonTagInScope = null;
    info.nobrTagInScope = null;
  }
  if (BUTTON_SCOPE_TAGS.has(tag)) info.pTagInButtonScope = null;
  if (SPECIAL_TAGS.has(tag) && tag !== 'address' && tag !== 'div' && tag !== 'p') {
    info.listItemTagAutoclosing = null;
    info.dlItemTagAutoclosing = null;
  }
  info.current = entry;
  if (tag === 'form') info.formTag = entry;
  if (tag === 'a') info.aTagInScope = entry;
  if (tag === 'button') info.buttonTagInScope = entry;
  if (tag === 'nobr') info.nobrTagInScope = entry;
  if (tag === 'p') info.pTagInButtonScope = entry;
  if (tag === 'li') info.listItemTagAutoclosing = entry;
  if (tag === 'dd' || tag === 'dt') info.dlItemTagAutoclosing = entry;
  if (tag === '#document' || tag === 'html') info.containerTagInScope = null;
  else info.containerTagInScope ??= entry;
  if (old === null && (tag === '#document' || tag === 'html' || tag === 'body')) info.implicitRootScope = true;
  else if (info.implicitRootScope) info.implicitRootScope = false;
  return info;
}

export function isTagValidWithParent(tag: string, parentTag: string | null, implicitRootScope: boolean): boolean {
  switch (parentTag) {
    case 'tr':
      return tag === 'th' || tag === 'td' || tag === 'style' || tag === 'script' || tag === 'template';
    case 'tbody':
    case 'thead':
    case 'tfoot':
      return tag === 'tr' || tag === 'style' || tag === 'script' || tag === 'template';
    case 'colgroup':
      return tag === 'col' || tag === 'template';
    case 'table':
      return (
        tag === 'caption' || tag === 'colgroup' || tag === 'tbody' || tag === 'tfoot' || tag === 'thead' ||
        tag === 'style' || tag === 'script' || tag === 'template'
      );
    case 'head':
      return (
        tag === 'base' || tag === 'basefont' || tag === 'bgsound' || tag === 'link' || tag === 'meta' ||
        tag === 'title' || tag === 'noscript' || tag === 'noframes' || tag === 'style' || tag === 'script' ||
        tag === 'template'
      );
    case 'html':
      if (!implicitRootScope) return tag === 'head' || tag === 'body' || tag === 'frameset';
      break;
    case 'frameset':
      return tag === 'frame';
    case '#document':
      if (!implicitRootScope) return tag === 'html';
      break;
  }
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return !(parentTag !== null && /^h[1-6]$/.test(parentTag));
    case 'rp':
    case 'rt':
      return parentTag === null || !IMPLIED_END_TAGS.has(parentTag);
    case 'caption':
    case 'col':
    case 'colgroup':
    case 'input':
      return parentTag !== 'select';
    case 'frameset':
    case 'frame':
    case 'tbody':
    case 'td':
    case 'tfoot':
    case 'th':
    case 'thead':
    case 'tr':
      return parentTag === null;
    case 'head':
      return implicitRootScope || parentTag === null;
    case 'html':
      return (implicitRootScope && parentTag === '#document') || parentTag === null;
    case 'body':
      return (implicitRootScope && (parentTag === '#document' || parentTag === 'html')) || parentTag === null;
  }
  return true;
}

const P_CLOSING_TAGS = new Set(
  (
    'address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer ' +
    'header hgroup main menu nav ol p section summary ul pre listing table hr xmp h1 h2 h3 h4 h5 h6'
  ).split(' '),
);

export function findInvalidAncestorForTag<T>(tag: string, info: AncestorInfo<T>): { tag: string; node: T } | null {
  if (P_CLOSING_TAGS.has(tag)) return info.pTagInButtonScope;
  switch (tag) {
    case 'form':
      return info.formTag ?? info.pTagInButtonScope;
    case 'li':
      return info.listItemTagAutoclosing;
    case 'dd':
    case 'dt':
      return info.dlItemTagAutoclosing;
    case 'button':
      return info.buttonTagInScope;
    case 'a':
      return info.aTagInScope;
    case 'nobr':
      return info.nobrTagInScope;
    default:
      return null;
  }
}

export interface NestingViolation<T> {
  child: T;
  childTag: string;
  ancestor: T;
  ancestorTag: string;
  /** The invalid relation is with the direct parent (vs. any ancestor). */
  direct: boolean;
}

/** React's validateDOMNesting without the logging. */
export function checkNesting<T>(tag: string, info: AncestorInfo<T>, node: T): NestingViolation<T> | null {
  const parent = info.current;
  const invalidParent = isTagValidWithParent(tag, parent?.tag ?? null, info.implicitRootScope) ? null : parent;
  const invalidAncestor = invalidParent ? null : findInvalidAncestorForTag(tag, info);
  const culprit = invalidParent ?? invalidAncestor;
  if (!culprit) return null;
  return { child: node, childTag: tag, ancestor: culprit.node, ancestorTag: culprit.tag, direct: invalidParent !== null };
}

export const INTERACTIVE_TAGS: ReadonlySet<string> = new Set(['a', 'button', 'form', 'nobr']);
