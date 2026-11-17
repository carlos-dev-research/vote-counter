// Admin login page (public/login.html): posts credentials, then goes to the back office.
import { api } from "./api";

const form = document.querySelector<HTMLFormElement>("#login-form");
const error = document.querySelector<HTMLElement>("#login-error");
const button = form?.querySelector<HTMLButtonElement>("button[type=submit]");

form?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!error || !button) return;
  const data = new FormData(form);
  error.classList.add("hidden");
  button.disabled = true;
  try {
    await api("/api/admin/login", { body: { email: data.get("email"), password: data.get("password") } });
    location.href = "/admin";
  } catch (e) {
    error.textContent = (e as Error).message;
    error.classList.remove("hidden");
    button.disabled = false;
  }
});
