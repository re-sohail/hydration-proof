// What attributes React renders for a host element, given its props.
//
// Mirrors `setProp` in react-dom 19 (and the equivalent DOMProperty rules in
// react-dom 18) for an allowlist of props whose output is identical in both
// versions. Anything outside the allowlist is reported as skipped, never
// guessed: a false "mismatch" is worse than a missed one.
//
// Pure: no DOM, no Node. Runs inside the page (runtime) and in unit tests.

export interface PropsView {
  /** Attribute name -> value React renders (`null` = no attribute). */
  attrs: Record<string, string | null>;
  /** Attribute names whose props were present but not audited. */
  skipped: string[];
  /** Style declarations React applies, in prop order. Custom properties keep their `--` name. */
  styles?: [name: string, value: string][];
  /** Text React renders when `children` is a primitive. */
  text?: string;
  /** `dangerouslySetInnerHTML.__html`. */
  html?: string;
  suppress?: true;
  /** The element is not audited at all (custom element, hoistable, ...). */
  opaque?: string;
}

// react-dom 19 `unitlessNumbers` (identical set to react-dom 18 after its
// vendor-prefix expansion).
const UNITLESS: ReadonlySet<string> = new Set(
  (
    'animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth ' +
    'boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive ' +
    'flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart ' +
    'gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight ' +
    'opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity ' +
    'stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth ' +
    'MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp ' +
    'msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder ' +
    'msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan ' +
    'WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup ' +
    'WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive ' +
    'WebkitFlexShrink WebkitLineClamp'
  ).split(' '),
);

const BOOLEAN_ATTRS: ReadonlySet<string> = new Set([
  'allowFullScreen', 'async', 'autoPlay', 'controls', 'default', 'defer', 'disabled',
  'disablePictureInPicture', 'disableRemotePlayback', 'formNoValidate', 'loop', 'noModule',
  'noValidate', 'open', 'playsInline', 'readOnly', 'required', 'reversed', 'scoped',
  'seamless', 'itemScope',
]);

const BOOLEANISH_ATTRS: ReadonlySet<string> = new Set([
  'contentEditable', 'spellCheck', 'draggable', 'autoReverse', 'externalResourcesRequired',
  'focusable', 'preserveAlpha',
]);

/** Plain string attributes rendered identically by React 18 and 19. */
const STRING_ATTRS: ReadonlyMap<string, string> = new Map([
  ['className', 'class'],
  ['tabIndex', 'tabindex'],
  ['htmlFor', 'for'],
  ['id', 'id'],
  ['title', 'title'],
  ['alt', 'alt'],
  ['lang', 'lang'],
  ['dir', 'dir'],
  ['role', 'role'],
  ['name', 'name'],
  ['type', 'type'],
  ['rel', 'rel'],
  ['target', 'target'],
  ['placeholder', 'placeholder'],
  ['width', 'width'],
  ['height', 'height'],
  ['viewBox', 'viewBox'],
]);

/** Attributes the audit covers on SVG / MathML elements. */
const FOREIGN_ALLOWED: ReadonlySet<string> = new Set([
  'className', 'id', 'role', 'tabIndex', 'width', 'height', 'viewBox',
]);

/**
 * SVG presentation and geometry props: the prop name React accepts and the
 * attribute it renders. Only consulted for foreign elements, and every entry is
 * checked against react-dom/server 18 and 19 by the differential test.
 */
const FOREIGN_ATTRS: ReadonlyMap<string, string> = new Map([
  // Geometry.
  ['d', 'd'], ['cx', 'cx'], ['cy', 'cy'], ['r', 'r'],
  ['x', 'x'], ['y', 'y'], ['x1', 'x1'], ['y1', 'y1'], ['x2', 'x2'], ['y2', 'y2'],
  ['rx', 'rx'], ['ry', 'ry'], ['dx', 'dx'], ['dy', 'dy'], ['points', 'points'],
  ['transform', 'transform'], ['preserveAspectRatio', 'preserveAspectRatio'],
  ['offset', 'offset'], ['xmlns', 'xmlns'],
  // Paint.
  ['fill', 'fill'], ['fillOpacity', 'fill-opacity'], ['fillRule', 'fill-rule'],
  ['stroke', 'stroke'], ['strokeWidth', 'stroke-width'], ['strokeOpacity', 'stroke-opacity'],
  ['strokeLinecap', 'stroke-linecap'], ['strokeLinejoin', 'stroke-linejoin'],
  ['strokeDasharray', 'stroke-dasharray'], ['strokeDashoffset', 'stroke-dashoffset'],
  ['strokeMiterlimit', 'stroke-miterlimit'], ['opacity', 'opacity'],
  ['stopColor', 'stop-color'], ['stopOpacity', 'stop-opacity'],
  ['clipPath', 'clip-path'], ['clipRule', 'clip-rule'], ['mask', 'mask'], ['filter', 'filter'],
  ['markerStart', 'marker-start'], ['markerMid', 'marker-mid'], ['markerEnd', 'marker-end'],
  ['vectorEffect', 'vector-effect'], ['paintOrder', 'paint-order'],
  // Text.
  ['textAnchor', 'text-anchor'], ['dominantBaseline', 'dominant-baseline'],
  ['fontFamily', 'font-family'], ['fontSize', 'font-size'], ['fontWeight', 'font-weight'],
  ['letterSpacing', 'letter-spacing'],
]);

/** Props that never become attributes, or that React applies as properties. */
const IGNORED_PROPS: ReadonlySet<string> = new Set([
  'key', 'ref', 'children', 'dangerouslySetInnerHTML', 'suppressHydrationWarning',
  'suppressContentEditableWarning', 'defaultValue', 'defaultChecked', 'innerHTML',
  'innerText', 'textContent', 'autoFocus', 'value', 'checked', 'multiple', 'muted', 'selected',
]);

/** Elements React hoists, replays or never hydrates attribute by attribute. */
const OPAQUE_TAGS: ReadonlyMap<string, string> = new Map([
  ['script', 'script elements are not hydrated'],
  ['style', 'style elements may be hoisted'],
  ['link', 'link elements may be hoisted'],
  ['meta', 'meta elements may be hoisted'],
  ['title', 'title elements may be hoisted'],
  ['noscript', 'noscript content is not hydrated'],
  ['base', 'base elements may be hoisted'],
]);

/** Tags whose `children` prop does not map 1:1 to text content. */
const NO_TEXT_TAGS: ReadonlySet<string> = new Set([
  'textarea', 'option', 'select', 'title', 'script', 'style', 'body', 'html', 'head',
]);

// react-dom `isJavaScriptProtocol`.
const JAVASCRIPT_URL =
  /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;

const NEWLINES = /\r\n?/g;
const NULL_AND_REPLACEMENT = /\u0000|\uFFFD/g;

/** react-dom `normalizeMarkupForTextOrAttribute`. */
export function normalizeReactText(text: string): string {
  return text.replace(NEWLINES, '\n').replace(NULL_AND_REPLACEMENT, '');
}

function isEventProp(key: string): boolean {
  return key.length > 2 && (key[0] === 'o' || key[0] === 'O') && (key[1] === 'n' || key[1] === 'N');
}

function isUnusable(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

/** react-dom `setValueForKnownAttribute`. */
function knownAttr(value: unknown): string | null {
  if (isUnusable(value) || typeof value === 'boolean') return null;
  return String(value);
}

/** react-dom `setValueForAttribute` (data-* and aria-* keep booleans). */
function genericAttr(name: string, value: unknown): string | null {
  if (isUnusable(value)) return null;
  if (typeof value === 'boolean') {
    const prefix = name.slice(0, 5).toLowerCase();
    return prefix === 'data-' || prefix === 'aria-' ? String(value) : null;
  }
  return String(value);
}

function attrName(key: string, foreign: boolean): string {
  return foreign ? key : key.toLowerCase();
}

/** Style declarations exactly as react-dom `setValueForStyle` applies them. */
export function styleDeclarations(style: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const name of Object.keys(style)) {
    const value = style[name];
    if (value === null || value === undefined || typeof value === 'boolean' || value === '') continue;
    if (name.startsWith('--')) {
      out.push([name, String(value)]);
    } else if (typeof value === 'number' && value !== 0 && !UNITLESS.has(name)) {
      out.push([name, `${value}px`]);
    } else {
      out.push([name, String(value).trim()]);
    }
  }
  return out;
}

export function propsView(tag: string, foreign: boolean, props: Record<string, unknown>): PropsView {
  const view: PropsView = { attrs: {}, skipped: [] };

  if (props['suppressHydrationWarning'] === true) view.suppress = true;

  const opaque = OPAQUE_TAGS.get(tag);
  if (opaque !== undefined) {
    view.opaque = opaque;
    return view;
  }
  if (tag.includes('-') || props['is'] != null) {
    view.opaque = 'custom elements receive props as properties';
    return view;
  }

  const children = props['children'];
  if (!foreign && !NO_TEXT_TAGS.has(tag)) {
    if (typeof children === 'string' || typeof children === 'number' || typeof children === 'bigint') {
      view.text = normalizeReactText(String(children));
    }
  }

  const inner = props['dangerouslySetInnerHTML'];
  if (inner !== null && typeof inner === 'object' && typeof (inner as { __html?: unknown }).__html === 'string') {
    view.html = (inner as { __html: string }).__html;
  }

  for (const key of Object.keys(props)) {
    if (IGNORED_PROPS.has(key) || isEventProp(key)) {
      if (key === 'value') view.skipped.push('value');
      continue;
    }
    const value = props[key];

    if (key === 'style') {
      if (value === null || value === undefined) {
        view.attrs['style'] = null;
      } else if (typeof value === 'object') {
        view.styles = styleDeclarations(value as Record<string, unknown>);
      } else {
        view.skipped.push('style');
      }
      continue;
    }

    const lower = key.toLowerCase();
    if (lower.startsWith('data-') || lower.startsWith('aria-')) {
      view.attrs[attrName(key, foreign)] = genericAttr(key, value);
      continue;
    }

    if (foreign) {
      const foreignName = FOREIGN_ATTRS.get(key);
      if (foreignName !== undefined) {
        view.attrs[foreignName] = knownAttr(value);
        continue;
      }
      if (!FOREIGN_ALLOWED.has(key)) {
        view.skipped.push(key);
        continue;
      }
    }

    const stringName = STRING_ATTRS.get(key);
    if (stringName !== undefined) {
      view.attrs[foreign ? stringName : stringName.toLowerCase()] = knownAttr(value);
      continue;
    }

    if (key === 'href' || key === 'src') {
      // React 18 and 19 disagree on empty strings and javascript: URLs.
      if (value === '' || (typeof value === 'string' && JAVASCRIPT_URL.test(value))) {
        view.skipped.push(key);
      } else {
        view.attrs[key] = knownAttr(value);
      }
      continue;
    }

    if (BOOLEAN_ATTRS.has(key)) {
      view.attrs[lower] = value && typeof value !== 'function' && typeof value !== 'symbol' ? '' : null;
      continue;
    }

    if (key === 'hidden') {
      // `hidden="until-found"` is handled differently across React versions.
      if (typeof value === 'string' && value !== '') view.skipped.push('hidden');
      else view.attrs['hidden'] = value && typeof value !== 'function' && typeof value !== 'symbol' ? '' : null;
      continue;
    }

    if (BOOLEANISH_ATTRS.has(key)) {
      view.attrs[attrName(key, foreign)] = isUnusable(value) ? null : String(value);
      continue;
    }

    view.skipped.push(attrName(key, foreign));
  }

  return view;
}

/** Attribute names the Node side may report as "extra" when present only in the DOM. */
export function isAuditedAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('data-') || lower.startsWith('aria-')) return true;
  switch (lower) {
    case 'class':
    case 'id':
    case 'style':
    case 'role':
    case 'title':
    case 'alt':
    case 'lang':
    case 'dir':
    case 'href':
    case 'src':
    case 'tabindex':
    case 'for':
    case 'name':
    case 'type':
      return true;
    default:
      return false;
  }
}
