// Back office (public/admin.html). Routes: "#" → campaign list, "#/c/<id>" → campaign detail.
import type { AdminCampaignDetail, AdminCampaignList, Campaign, CategoryView } from "../shared/types";
import { api, ApiError } from "./api";
import { bar, h, mount, statusBadge, toast } from "./dom";

const DEFAULT_CATEGORIES = ["Best Speaker", "Best Table Topics", "Best Evaluator"];
const POLL_MS = 3000;

const root = document.getElementById("app") as HTMLElement;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let focusAfterRender: string | null = null; // id of an input to refocus after re-render

function handleError(e: unknown): void {
  if (e instanceof ApiError && e.status === 401) {
    location.href = "/login";
    return;
  }
  toast(e instanceof Error ? e.message : "Something went wrong");
}

/** Wraps an async handler: disables the triggering button while running, reports errors. */
function action(fn: (ev: Event) => Promise<void>) {
  return async (ev: Event) => {
    ev.preventDefault();
    const btn =
      ev.currentTarget instanceof HTMLButtonElement
        ? ev.currentTarget
        : (ev.currentTarget as HTMLElement | null)?.querySelector<HTMLButtonElement>("button[type=submit]");
    if (btn) btn.disabled = true;
    try {
      await fn(ev);
    } catch (e) {
      handleError(e);
    } finally {
      if (btn?.isConnected) btn.disabled = false;
    }
  };
}

function topbar(): HTMLElement {
  return h(
    "header",
    { class: "topbar" },
    h("a", { class: "brand", href: "#" }, "🗳️ Vote Counter"),
    h(
      "button",
      {
        class: "btn ghost small",
        onclick: action(async () => {
          await api("/api/admin/logout", { method: "POST" });
          location.href = "/login";
        }),
      },
      "Sign out",
    ),
  );
}

// ── Campaign list ──────────────────────────────────────────────────────────

async function showList(): Promise<void> {
  const { campaigns } = await api<AdminCampaignList>("/api/admin/campaigns");
  const input = h("input", {
    type: "text",
    name: "name",
    class: "grow",
    placeholder: "e.g. Club meeting · Nov 18",
    maxlength: 80,
    required: true,
    "aria-label": "Campaign name",
  });
  const form = h(
    "form",
    {
      class: "row",
      onsubmit: action(async () => {
        const { campaign } = await api<{ campaign: Campaign }>("/api/admin/campaigns", {
          body: { name: input.value },
        });
        location.hash = `#/c/${campaign.id}`;
      }),
    },
    input,
    h("button", { class: "btn primary", type: "submit" }, "Create"),
  );

  mount(
    root,
    topbar(),
    h("h1", {}, "Campaigns"),
    h("section", { class: "card" }, h("h2", {}, "New campaign"), form),
    h("h2", { class: "muted small" }, campaigns.length ? "All campaigns" : ""),
    campaigns.length === 0
      ? h("p", { class: "muted center" }, "No campaigns yet. Create one above.")
      : campaigns.map((c) =>
          h(
            "a",
            { class: "card", href: `#/c/${c.id}` },
            h("div", { class: "spread" }, h("span", { class: "card-title" }, c.name), statusBadge(c.status)),
            h(
              "div",
              { class: "muted small" },
              `${c.voters} voter${c.voters === 1 ? "" : "s"} · created ${new Date(c.created_at).toLocaleDateString()}`,
            ),
          ),
        ),
  );
  input.focus();
}

// ── Campaign detail ────────────────────────────────────────────────────────

/** Signature of the structure; when unchanged, polling only updates counts in place. */
const structureKey = (d: AdminCampaignDetail) =>
  d.campaign.status + "|" + d.categories.map((c) => c.id + ":" + c.candidates.map((x) => x.id).join(",")).join(";");

async function showDetail(id: string): Promise<void> {
  let data = await api<AdminCampaignDetail>(`/api/admin/campaigns/${id}`);
  renderDetail(data);
  if (data.campaign.status === "open") {
    pollTimer = setInterval(async () => {
      try {
        const next = await api<AdminCampaignDetail>(`/api/admin/campaigns/${id}`);
        if (structureKey(next) === structureKey(data)) updateCounts(next);
        else if (!isTyping()) renderDetail(next);
        data = next;
      } catch (e) {
        handleError(e);
      }
    }, POLL_MS);
  }
}

const reload = () => route();

function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement && el.value !== "";
}

function updateCounts(d: AdminCampaignDetail): void {
  const voters = document.getElementById("voters");
  if (voters) voters.textContent = String(d.voters);
  const total = document.getElementById("total-votes");
  if (total) total.textContent = String(d.categories.reduce((s, c) => s + c.candidates.reduce((t, x) => t + x.votes, 0), 0));
  for (const cat of d.categories) {
    const max = Math.max(0, ...cat.candidates.map((c) => c.votes));
    for (const cand of cat.candidates) {
      const row = document.querySelector<HTMLElement>(`[data-cand="${cand.id}"]`);
      if (!row) continue;
      row.querySelector(".cand-count")!.textContent = String(cand.votes);
      row.querySelector(".bar")!.replaceWith(bar(cand.votes, max));
      row.classList.toggle("winner", max > 0 && cand.votes === max);
    }
  }
}

function renderDetail(d: AdminCampaignDetail): void {
  const { campaign } = d;
  const isDraft = campaign.status === "draft";
  const isClosed = campaign.status === "closed";
  const totalVotes = d.categories.reduce((s, c) => s + c.candidates.reduce((t, x) => t + x.votes, 0), 0);

  const setStatus = (status: "open" | "closed", confirmText?: string) =>
    action(async () => {
      if (confirmText && !confirm(confirmText)) return;
      await api(`/api/admin/campaigns/${campaign.id}/status`, { body: { status } });
      toast(status === "open" ? "Voting is open" : "Voting is closed");
      await reload();
    });

  const statusButton =
    campaign.status === "draft"
      ? h("button", { class: "btn primary", onclick: setStatus("open") }, "Open voting")
      : campaign.status === "open"
        ? h(
            "button",
            { class: "btn primary", onclick: setStatus("closed", "Close voting? The QR code will show the results.") },
            "Close voting",
          )
        : h("button", { class: "btn", onclick: setStatus("open", "Reopen voting?") }, "Reopen voting");

  const deleteButton = h(
    "button",
    {
      class: "btn danger",
      onclick: action(async () => {
        if (!confirm(`Delete "${campaign.name}" and all its votes? This cannot be undone.`)) return;
        await api(`/api/admin/campaigns/${campaign.id}`, { method: "DELETE" });
        location.hash = "#";
      }),
    },
    "Delete",
  );

  const qrSrc = `/api/admin/campaigns/${campaign.id}/qr.svg`;
  const qrCard = h(
    "section",
    { class: "card" },
    h("h2", {}, "Voting link"),
    h(
      "div",
      { class: "qr-wrap" },
      h("img", { class: "qr-img", src: qrSrc, alt: "QR code for the voting page" }),
      h(
        "div",
        { class: "stack" },
        h("a", { class: "url", href: d.voteUrl, target: "_blank", rel: "noopener" }, d.voteUrl),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn primary small", onclick: () => present(campaign.name, qrSrc, d.voteUrl) }, "Present QR"),
          h(
            "button",
            {
              class: "btn small",
              onclick: action(async () => {
                await navigator.clipboard.writeText(d.voteUrl);
                toast("Link copied");
              }),
            },
            "Copy link",
          ),
          h("a", { class: "btn small", href: qrSrc, download: `vote-${campaign.slug}.svg` }, "Download"),
        ),
        h(
          "p",
          { class: "muted small" },
          isClosed ? "Voting is closed: this link now shows the results." : "Same link before, during and after voting.",
        ),
      ),
    ),
  );

  const existing = new Set(d.categories.map((c) => c.name.toLowerCase()));
  const missingDefaults = DEFAULT_CATEGORIES.filter((n) => !existing.has(n.toLowerCase()));
  const addCategory = (name: string) =>
    api(`/api/admin/campaigns/${campaign.id}/categories`, { body: { name } }).then(reload);

  const catInput = h("input", {
    id: "new-category",
    type: "text",
    class: "grow",
    placeholder: "Category name",
    maxlength: 80,
    required: true,
    "aria-label": "Category name",
  });
  const addCategoryCard = isClosed
    ? null
    : h(
        "section",
        { class: "card stack" },
        h("h2", {}, "Add category"),
        missingDefaults.length
          ? h(
              "div",
              { class: "chips" },
              missingDefaults.map((n) =>
                h("button", { class: "chip", type: "button", onclick: action(() => addCategory(n)) }, `+ ${n}`),
              ),
            )
          : null,
        h(
          "form",
          {
            class: "row",
            onsubmit: action(async () => {
              focusAfterRender = "new-category";
              await addCategory(catInput.value);
            }),
          },
          catInput,
          h("button", { class: "btn", type: "submit" }, "Add"),
        ),
      );

  mount(
    root,
    topbar(),
    h("a", { class: "back", href: "#" }, "← All campaigns"),
    h("div", { class: "spread" }, h("h1", {}, campaign.name), statusBadge(campaign.status)),
    h("div", { class: "row" }, statusButton, deleteButton),
    h(
      "section",
      { class: "card stats", "aria-live": "polite" },
      h("div", { class: "stat" }, h("div", { class: "stat-value", id: "voters" }, d.voters), h("div", { class: "stat-label" }, "voters")),
      h("div", { class: "stat" }, h("div", { class: "stat-value", id: "total-votes" }, totalVotes), h("div", { class: "stat-label" }, "votes cast")),
      h("div", { class: "stat" }, h("div", { class: "stat-value" }, d.categories.length), h("div", { class: "stat-label" }, "categories")),
    ),
    qrCard,
    d.categories.length === 0
      ? h("p", { class: "muted center" }, "No categories yet. Add one below.")
      : d.categories.map((cat) => categoryCard(cat, isDraft, isClosed)),
    addCategoryCard,
    campaign.status === "open" ? h("p", { class: "muted small center" }, "Counts refresh every few seconds.") : null,
  );

  if (focusAfterRender) {
    document.getElementById(focusAfterRender)?.focus();
    focusAfterRender = null;
  }
}

function categoryCard(cat: CategoryView, isDraft: boolean, isClosed: boolean): HTMLElement {
  const max = Math.max(0, ...cat.candidates.map((c) => c.votes));
  const inputId = `cand-input-${cat.id}`;
  const input = h("input", {
    id: inputId,
    type: "text",
    class: "grow",
    placeholder: "Candidate name",
    maxlength: 80,
    required: true,
    "aria-label": `Add candidate to ${cat.name}`,
  });

  return h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "spread" },
      h("h2", {}, cat.name),
      isDraft
        ? h(
            "button",
            {
              class: "icon-btn",
              title: "Remove category",
              "aria-label": `Remove category ${cat.name}`,
              onclick: action(async () => {
                if (!confirm(`Remove "${cat.name}" and its candidates?`)) return;
                await api(`/api/admin/categories/${cat.id}`, { method: "DELETE" });
                await reload();
              }),
            },
            "✕",
          )
        : null,
    ),
    cat.candidates.length === 0
      ? h("p", { class: "muted small" }, "No candidates yet.")
      : h(
          "ul",
          { class: "cand-list" },
          cat.candidates.map((cand) =>
            h(
              "li",
              { class: `cand${max > 0 && cand.votes === max ? " winner" : ""}`, "data-cand": cand.id },
              h(
                "div",
                { class: "cand-head" },
                h("span", { class: "cand-name" }, cand.name),
                h("span", { class: "cand-count" }, cand.votes),
                isDraft
                  ? h(
                      "button",
                      {
                        class: "icon-btn",
                        title: "Remove candidate",
                        "aria-label": `Remove ${cand.name}`,
                        onclick: action(async () => {
                          await api(`/api/admin/candidates/${cand.id}`, { method: "DELETE" });
                          await reload();
                        }),
                      },
                      "✕",
                    )
                  : null,
              ),
              bar(cand.votes, max),
            ),
          ),
        ),
    isClosed
      ? null
      : h(
          "form",
          {
            class: "row",
            onsubmit: action(async () => {
              await api(`/api/admin/categories/${cat.id}/candidates`, { body: { name: input.value } });
              focusAfterRender = inputId;
              await reload();
            }),
          },
          input,
          h("button", { class: "btn", type: "submit" }, "Add"),
        ),
  );
}

/** Full-screen QR for the projector. Click or Esc to close. */
function present(name: string, src: string, url: string): void {
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  const overlay = h(
    "div",
    { class: "presenter", role: "dialog", "aria-label": "Voting QR code", onclick: close },
    h("h1", {}, name),
    h("img", { src, alt: "QR code for the voting page" }),
    h("div", { class: "url" }, url),
    h("p", {}, "Scan to vote · click anywhere to close"),
  );
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
}

// ── Router ─────────────────────────────────────────────────────────────────

async function route(): Promise<void> {
  clearInterval(pollTimer);
  const match = location.hash.match(/^#\/c\/([0-9a-f-]{36})$/);
  try {
    if (match?.[1]) await showDetail(match[1]);
    else await showList();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) location.hash = "#";
    else handleError(e);
  }
}

window.addEventListener("hashchange", route);
route();
