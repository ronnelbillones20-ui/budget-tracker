// Applied immediately (non-module, runs before CSS paints) so there's
// no flash of the wrong theme on load.
(function () {
  const stored = localStorage.getItem("ledger-theme");
  const theme = stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();

const LEDGER_THEME_ORDER = ["light", "dark", "cute"];
const LEDGER_THEME_LABELS = {
  light: "☀ Light",
  dark: "☾ Dark",
  cute: "🐾 Cute"
};

function ledgerToggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const idx = LEDGER_THEME_ORDER.indexOf(current);
  const next = LEDGER_THEME_ORDER[(idx + 1) % LEDGER_THEME_ORDER.length];
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("ledger-theme", next);
  ledgerUpdateToggleLabel();
  document.dispatchEvent(new Event("ledger-theme-changed"));
}

function ledgerUpdateToggleLabel() {
  const theme = document.documentElement.getAttribute("data-theme") || "light";
  const label = LEDGER_THEME_LABELS[theme] || LEDGER_THEME_LABELS.light;
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.textContent = label;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  ledgerUpdateToggleLabel();
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.addEventListener("click", ledgerToggleTheme);
  });
});
