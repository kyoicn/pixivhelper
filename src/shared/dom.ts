// Minimal element builder shared by the content script and the options page. It never parses
// markup: attributes go through setAttribute and text through text nodes (system.md §11.1).

export type AttrValue = string | number | boolean | null | undefined;
export type Attrs = Readonly<Record<string, AttrValue>>;
export type Child = Node | string | number | null | undefined | false;

/**
 * Creates `<tag>` with `attrs` and `children`.
 *
 * - Attribute `true` sets an empty (boolean) attribute; `false`, `null` and `undefined` omit it.
 * - String and number children become text nodes, so `<b>` in a title stays literal text.
 * - `null`, `undefined` and `false` children are skipped, which allows `cond && h(...)`.
 *
 * Event listeners are attached by the caller with addEventListener.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === false || value == null) continue;
      el.setAttribute(name, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === false || child == null) continue;
    el.append(typeof child === 'object' ? child : String(child));
  }
  return el;
}
