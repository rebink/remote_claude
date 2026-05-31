type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string>; events?: Record<string, EventListener> } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { dataset, events, ...rest } = props as Record<string, unknown>;
  for (const k in rest) {
    if (k === 'className') (el as HTMLElement).className = String(rest[k]);
    else if (k === 'style') Object.assign((el as HTMLElement).style, rest[k] as object);
    else if (k in el) (el as Record<string, unknown>)[k] = rest[k];
    else (el as HTMLElement).setAttribute(k, String(rest[k]));
  }
  if (dataset) for (const k in dataset as Record<string, string>) (el as HTMLElement).dataset[k] = (dataset as Record<string, string>)[k];
  if (events) for (const k in events as Record<string, EventListener>) el.addEventListener(k, (events as Record<string, EventListener>)[k]);
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void { while (el.firstChild) el.removeChild(el.firstChild); }
