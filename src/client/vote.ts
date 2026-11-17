// Voter page (public/vote.html, served at /v/:slug). Shows: not open yet → ballot → thanks → results.
import type { BallotCategory, MyVotes, PublicCampaign, ResultCategory } from "../shared/types";
import { api, ApiError } from "./api";
import { bar, h, mount } from "./dom";

const REFRESH_MS = 5000;
const root = document.getElementById("app") as HTMLElement;
const slug = location.pathname.split("/")[2] ?? "";
let timer: ReturnType<typeof setTimeout> | undefined;

/** Loads the campaign and renders the right view. `poll` re-checks later (waiting screens only). */
async function load(): Promise<void> {
  clearTimeout(timer);
  try {
    const state = await api<PublicCampaign>(`/api/campaigns/${encodeURIComponent(slug)}`);
    document.title = `${state.name} · Vote`;
    render(state);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      mount(root, message("🤔", "Campaign not found", "Check the QR code or link and try again."));
    } else {
      mount(root, message("📶", "Couldn't load", (e as Error).message));
      timer = setTimeout(load, REFRESH_MS);
    }
  }
}

function render(state: PublicCampaign): void {
  if (state.status === "draft") {
    mount(root, header(state.name), message("⏳", "Voting hasn't started yet", "This page will update automatically."));
    timer = setTimeout(load, REFRESH_MS);
  } else if (state.status === "open") {
    const pending = state.categories.filter((c) => !(c.id in state.myVotes));
    if (pending.length === 0) {
      mount(root, header(state.name), thanks(state.categories, state.myVotes));
      timer = setTimeout(load, REFRESH_MS); // switch to results when voting closes
    } else {
      mount(root, header(state.name), ballot(state.categories, state.myVotes));
    }
  } else {
    mount(root, header(state.name, "Results"), results(state.categories, state.voters));
  }
}

function header(name: string, eyebrow = "Vote"): HTMLElement {
  return h("header", { class: "vote-header" }, h("div", { class: "eyebrow" }, eyebrow), h("h1", {}, name));
}

function message(icon: string, title: string, text: string): HTMLElement {
  return h(
    "section",
    { class: "card center" },
    h("div", { class: "big-icon", "aria-hidden": "true" }, icon),
    h("h2", {}, title),
    h("p", { class: "muted" }, text),
  );
}

function ballot(categories: BallotCategory[], myVotes: MyVotes): HTMLElement {
  const error = h("div", { class: "notice error hidden", role: "alert" });
  const submit = h("button", { class: "btn primary block", type: "submit" }, "Submit vote");

  const form = h(
    "form",
    {
      onsubmit: async (ev: Event) => {
        ev.preventDefault();
        const votes = categories
          .filter((c) => !(c.id in myVotes))
          .map((c) => {
            const picked = form.querySelector<HTMLInputElement>(`input[name="cat-${c.id}"]:checked`);
            return picked ? { categoryId: c.id, candidateId: picked.value } : null;
          })
          .filter((v) => v !== null);
        if (votes.length === 0) {
          error.textContent = "Pick at least one candidate.";
          error.classList.remove("hidden");
          return;
        }
        submit.disabled = true;
        error.classList.add("hidden");
        try {
          await api(`/api/campaigns/${encodeURIComponent(slug)}/votes`, { body: { votes } });
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409)) {
            error.textContent = (e as Error).message;
            error.classList.remove("hidden");
            submit.disabled = false;
            return;
          }
          // 409: already voted or voting closed. Reload to show the current state.
        }
        window.scrollTo({ top: 0 });
        await load();
      },
    },
    categories.map((cat) => {
      const votedFor = myVotes[cat.id];
      const name = cat.candidates.find((c) => c.id === votedFor)?.name;
      return h(
        "fieldset",
        { class: "card" },
        h("legend", {}, cat.name),
        votedFor
          ? h("div", { class: "voted-line" }, "✓ You voted for ", h("strong", {}, name ?? "—"))
          : h(
              "div",
              {},
              cat.candidates.map((cand) =>
                h(
                  "label",
                  { class: "choice" },
                  h("input", { type: "radio", name: `cat-${cat.id}`, value: cand.id }),
                  h("span", {}, cand.name),
                ),
              ),
            ),
      );
    }),
    error,
    h("p", { class: "muted small center" }, "You can vote once per category from this device."),
    h("div", { class: "submit-bar" }, h("div", { class: "inner" }, submit)),
  );
  return form;
}

function thanks(categories: BallotCategory[], myVotes: MyVotes): HTMLElement {
  return h(
    "div",
    {},
    message("🎉", "Thanks for voting!", "Results will appear on this page when voting closes."),
    h(
      "section",
      { class: "card" },
      h("h2", {}, "Your votes"),
      h(
        "ul",
        { class: "cand-list" },
        categories.map((cat) =>
          h(
            "li",
            { class: "cand" },
            h(
              "div",
              { class: "cand-head" },
              h("span", { class: "cand-name muted" }, cat.name),
              h("strong", {}, cat.candidates.find((c) => c.id === myVotes[cat.id])?.name ?? "—"),
            ),
          ),
        ),
      ),
    ),
  );
}

function results(categories: ResultCategory[], voters: number): HTMLElement {
  return h(
    "div",
    {},
    h("p", { class: "muted center" }, `${voters} ${voters === 1 ? "person" : "people"} voted`),
    categories.map((cat) => {
      const max = cat.candidates[0]?.votes ?? 0;
      return h(
        "section",
        { class: "card" },
        h("h2", {}, cat.name),
        cat.totalVotes === 0
          ? h("p", { class: "muted" }, "No votes in this category.")
          : cat.candidates.map((cand) =>
              h(
                "div",
                { class: `result${cand.winner ? " winner" : ""}` },
                h(
                  "div",
                  { class: "cand-head" },
                  cand.winner ? h("span", { class: "trophy", "aria-label": "Winner" }, "🏆") : null,
                  h("span", { class: "cand-name" }, cand.name),
                  h("span", { class: "cand-count" }, cand.votes),
                ),
                bar(cand.votes, max),
              ),
            ),
      );
    }),
  );
}

load();
