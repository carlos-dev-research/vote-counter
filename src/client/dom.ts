/**
 * Tiny, safe DOM builder. Text is always inserted as text nodes (never innerHTML), so names
 * typed by the admin can't inject markup or scripts into anyone's page.
 */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((ev: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.replace(/^on/, ""), value);
    else if (key === "class") el.className = String(value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "object" ? child : String(child));
  }
  return el;
}

/** Replaces the contents of `root`. */
export function mount(root: HTMLElement, ...children: (Child | Child[])[]): void {
  root.replaceChildren();
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    root.append(typeof child === "object" ? child : String(child));
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Brief message at the bottom of the screen. */
export function toast(message: string): void {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const el = h("div", { class: "toast", role: "status" }, message);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 3500);
}

export function statusBadge(status: string): HTMLSpanElement {
  return h("span", { class: `badge ${status}` }, status);
}

/** Bar width as a percentage of the max (CSSOM style edits are allowed by the CSP). */
export function bar(value: number, max: number): HTMLDivElement {
  const fill = h("div", { class: "bar-fill" });
  fill.style.width = `${max > 0 ? Math.round((value / max) * 100) : 0}%`;
  return h("div", { class: "bar" }, fill);
}
