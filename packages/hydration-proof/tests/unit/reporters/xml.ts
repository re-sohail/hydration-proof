// A small, strict XML 1.0 well-formedness checker for the JUnit tests. It
// supports what the reporter can produce (declaration, elements, attributes,
// text, entity and character references, comments, CDATA) and throws on
// anything malformed.

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Decoded text directly inside the element. */
  text: string;
}

const NAME = /^[A-Za-z_:][A-Za-z0-9._:-]*/;

export function isXmlChar(cp: number): boolean {
  return (
    cp === 0x9 ||
    cp === 0xa ||
    cp === 0xd ||
    (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) ||
    (cp >= 0x10000 && cp <= 0x10ffff)
  );
}

function fail(message: string, at: number): never {
  throw new Error(`Malformed XML at ${at}: ${message}`);
}

function decode(raw: string, at: number, inAttribute: boolean): string {
  if (inAttribute && raw.includes('<')) fail('"<" in attribute value', at);
  // Line-end normalization, then (attributes) whitespace normalization, as a real parser does.
  const lines = raw.replace(/\r\n?/g, '\n');
  const normalized = inAttribute ? lines.replace(/[\t\n]/g, ' ') : lines;
  return normalized.replace(/&([^;&]*);?/g, (match, body: string) => {
    if (!match.endsWith(';')) fail(`bare "&" (${JSON.stringify(match.slice(0, 12))})`, at);
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (body in named) return named[body]!;
    const numeric = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(body);
    if (!numeric) fail(`unknown entity &${body};`, at);
    const cp = numeric[1] !== undefined ? parseInt(numeric[1], 16) : parseInt(numeric[2]!, 10);
    if (!isXmlChar(cp)) fail(`character reference to an invalid character (${cp})`, at);
    return String.fromCodePoint(cp);
  });
}

export function parseXml(xml: string): XmlElement {
  let offset = 0;
  for (const char of xml) {
    const cp = char.codePointAt(0)!;
    if (!isXmlChar(cp)) fail(`invalid character U+${cp.toString(16).padStart(4, '0')}`, offset);
    offset += char.length;
  }

  let i = 0;
  if (xml.startsWith('<?xml')) {
    const end = xml.indexOf('?>');
    if (end < 0) fail('unterminated declaration', 0);
    if (!/^<\?xml\s+version="1\.[0-9]"(\s+encoding="[A-Za-z][A-Za-z0-9._-]*")?(\s+standalone="(yes|no)")?\s*\?>$/.test(xml.slice(0, end + 2))) {
      fail('bad XML declaration', 0);
    }
    i = end + 2;
  }

  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;

  const addText = (raw: string, at: number): void => {
    if (raw.includes(']]>')) fail('"]]>" in text', at);
    const text = decode(raw, at, false);
    const current = stack.at(-1);
    if (current) current.text += text;
    else if (text.trim() !== '') fail('text outside the root element', at);
  };

  while (i < xml.length) {
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end < 0) fail('unterminated comment', i);
      if (xml.slice(i + 4, end).includes('--')) fail('"--" in comment', i);
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', i)) {
      if (stack.length === 0) fail('CDATA outside the root element', i);
      const end = xml.indexOf(']]>', i + 9);
      if (end < 0) fail('unterminated CDATA section', i);
      stack.at(-1)!.text += xml.slice(i + 9, end);
      i = end + 3;
    } else if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end < 0) fail('unterminated processing instruction', i);
      if (/^xml\b/i.test(xml.slice(i + 2))) fail('XML declaration not at the start', i);
      i = end + 2;
    } else if (xml.startsWith('<!', i)) {
      fail('DOCTYPE and other declarations are not expected', i);
    } else if (xml.startsWith('</', i)) {
      const name = NAME.exec(xml.slice(i + 2))?.[0];
      if (!name) fail('bad closing tag', i);
      const after = i + 2 + name.length;
      const close = /^\s*>/.exec(xml.slice(after));
      if (!close) fail('bad closing tag', i);
      const open = stack.pop();
      if (!open || open.name !== name) fail(`</${name}> does not match <${open?.name ?? '(none)'}>`, i);
      i = after + close[0].length;
    } else if (xml[i] === '<') {
      const name = NAME.exec(xml.slice(i + 1))?.[0];
      if (!name) fail('bad tag name', i);
      if (stack.length === 0 && root) fail('more than one root element', i);
      let j = i + 1 + name.length;
      const element: XmlElement = { name, attributes: {}, children: [], text: '' };
      for (;;) {
        const rest = xml.slice(j);
        const end = /^\s*(\/?)>/.exec(rest);
        if (end) {
          j += end[0].length;
          const parent = stack.at(-1);
          if (parent) parent.children.push(element);
          else root = element;
          if (end[1] !== '/') stack.push(element);
          break;
        }
        const attribute = /^\s+([A-Za-z_:][A-Za-z0-9._:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
        if (!attribute) fail(`bad attribute in <${name}>: ${JSON.stringify(rest.slice(0, 30))}`, j);
        const key = attribute[1]!;
        if (key in element.attributes) fail(`duplicate attribute ${key}`, j);
        element.attributes[key] = decode(attribute[2] ?? attribute[3] ?? '', j, true);
        j += attribute[0].length;
      }
      i = j;
    } else {
      const end = xml.indexOf('<', i);
      const stop = end < 0 ? xml.length : end;
      addText(xml.slice(i, stop), i);
      i = stop;
    }
  }
  if (stack.length > 0) fail(`<${stack.at(-1)!.name}> is not closed`, xml.length);
  if (!root) fail('no root element', 0);
  return root;
}

export function findAll(element: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  for (const child of element.children) {
    if (child.name === name) found.push(child);
    found.push(...findAll(child, name));
  }
  return found;
}
