// Applied immediately (non-module, runs before CSS paints) so there's
// no flash of the wrong theme on load.
(function () {
  const stored = localStorage.getItem("ledger-theme");
  const theme = stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();

function ledgerToggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("ledger-theme", next);
  ledgerUpdateToggleLabel();
}

function ledgerUpdateToggleLabel() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.textContent = isDark ? "☀ Light" : "☾ Dark";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  ledgerUpdateToggleLabel();
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.addEventListener("click", ledgerToggleTheme);
  });
});
