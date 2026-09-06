// Applied immediately (non-module, runs before CSS paints) so there's
// no flash of the wrong theme on load. Default for new visitors is
// "system", so the app matches their device automatically.
(function () {
  const pref = localStorage.getItem("ledger-theme") || "system";
  ledgerApplyTheme(pref);
})();

function ledgerResolveTheme(pref) {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref; // "light" | "dark"
}

function ledgerApplyTheme(pref) {
  document.documentElement.setAttribute("data-theme", ledgerResolveTheme(pref));
  document.documentElement.dataset.themePref = pref;
}

const LEDGER_THEME_ORDER = ["system", "light", "dark"];
const LEDGER_THEME_LABELS = {
  system: "🖥 System",
  light: "☀ Light",
  dark: "☾ Dark"
};

function ledgerToggleTheme() {
  const current = document.documentElement.dataset.themePref || "system";
  const idx = LEDGER_THEME_ORDER.indexOf(current);
  const next = LEDGER_THEME_ORDER[(idx + 1) % LEDGER_THEME_ORDER.length];
  localStorage.setItem("ledger-theme", next);
  ledgerApplyTheme(next);
  ledgerUpdateToggleLabel();
  document.dispatchEvent(new Event("ledger-theme-changed"));
}

function ledgerUpdateToggleLabel() {
  const pref = document.documentElement.dataset.themePref || "system";
  const label = LEDGER_THEME_LABELS[pref] || LEDGER_THEME_LABELS.system;
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.textContent = label;
  });
}

// While the preference is "system", follow the OS setting live —
// if you switch your phone/computer to dark mode, the app follows
// without needing a manual toggle.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if ((document.documentElement.dataset.themePref || "system") === "system") {
    ledgerApplyTheme("system");
    document.dispatchEvent(new Event("ledger-theme-changed"));
  }
});

document.addEventListener("DOMContentLoaded", () => {
  ledgerUpdateToggleLabel();
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.addEventListener("click", ledgerToggleTheme);
  });
});
