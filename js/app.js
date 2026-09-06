import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc,
  collection, addDoc, deleteDoc, getDocs, onSnapshot,
  query, orderBy, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------------------------------------------------------------
// Badge definitions — simple, readable conditions.
// `test(stats)` receives the computed stats object (see computeStats)
// and returns true if the badge should be considered earned.
// ---------------------------------------------------------------
const BADGE_DEFS = [
  {
    id: "first-entry",
    name: "First Entry",
    icon: "✎",
    desc: "Logged your first transaction.",
    test: (s) => s.totalEntries >= 1
  },
  {
    id: "budget-keeper",
    name: "Budget Keeper",
    icon: "✓",
    desc: "Stayed under budget this month.",
    test: (s) => s.budget > 0 && s.currentMonthUnderBudget
  },
  {
    id: "three-in-a-row",
    name: "Three in a Row",
    icon: "III",
    desc: "Under budget 3 months running.",
    test: (s) => s.consecutiveUnderBudget >= 3
  },
  {
    id: "half-year-hero",
    name: "Half-Year Hero",
    icon: "★",
    desc: "Under budget 6 months running.",
    test: (s) => s.consecutiveUnderBudget >= 6
  },
  {
    id: "big-saver",
    name: "Big Saver",
    icon: "$",
    desc: "Saved 20%+ of income in a month.",
    test: (s) => s.bestSavingsRate >= 0.2
  }
];

let currentUser = null;
let userCurrency = "₱";
let monthlyBudget = 0;
let categoryBudgets = {}; // { categoryName: limitAmount }
let allTransactions = []; // all-time, newest first
let earnedBadgeIds = new Set();
let lastWarningLevel = 0; // 0 = none, 1 = caution (80%+), 2 = danger (100%+) — resets on page load / new month
let categoryChartInstance = null;
let incomeExpenseChartInstance = null;

document.addEventListener("ledger-theme-changed", () => {
  if (currentUser) renderAll(); // recolor charts to match the new theme
});

const toastStack = document.getElementById("toastStack");

// ---------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  document.getElementById("userEmail").textContent = user.email;
  document.getElementById("entryDate").valueAsDate = new Date();

  await loadUserProfile();
  listenToTransactions();
  listenToBadges();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---------------------------------------------------------------
// User profile (budget + currency)
// ---------------------------------------------------------------
async function loadUserProfile() {
  const ref = doc(db, "users", currentUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    monthlyBudget = data.monthlyBudget || 0;
    userCurrency = data.currency || "₱";
    categoryBudgets = data.categoryBudgets || {};
  } else {
    await setDoc(ref, { monthlyBudget: 0, currency: "₱", categoryBudgets: {}, email: currentUser.email, createdAt: serverTimestamp() });
  }
  document.getElementById("budgetInput").value = monthlyBudget || "";
}

document.getElementById("budgetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const val = parseFloat(document.getElementById("budgetInput").value) || 0;
  monthlyBudget = val;
  await updateDoc(doc(db, "users", currentUser.uid), { monthlyBudget: val });
  renderAll();
});

document.getElementById("categoryBudgetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const category = document.getElementById("catBudgetCategory").value.trim();
  const limit = parseFloat(document.getElementById("catBudgetAmount").value);
  if (!category || !limit) return;

  categoryBudgets[category] = limit;
  await updateDoc(doc(db, "users", currentUser.uid), { [`categoryBudgets.${category}`]: limit });
  e.target.reset();
  renderAll();
});

async function removeCategoryBudget(category) {
  if (!confirm(`Remove the budget limit for "${category}"?`)) return;
  delete categoryBudgets[category];
  await updateDoc(doc(db, "users", currentUser.uid), { [`categoryBudgets.${category}`]: deleteField() });
  renderAll();
}

// ---------------------------------------------------------------
// Reset all data — for testing before you invite real users
// ---------------------------------------------------------------
document.getElementById("resetDataBtn").addEventListener("click", async () => {
  const sure = confirm(
    "This permanently deletes ALL transactions, badges, and budget settings on this account. This cannot be undone. Continue?"
  );
  if (!sure) return;

  const typed = prompt('Type RESET (all caps) to confirm:');
  if (typed !== "RESET") return;

  const [txSnap, badgeSnap] = await Promise.all([
    getDocs(collection(db, "users", currentUser.uid, "transactions")),
    getDocs(collection(db, "users", currentUser.uid, "badges"))
  ]);

  await Promise.all([
    ...txSnap.docs.map((d) => deleteDoc(d.ref)),
    ...badgeSnap.docs.map((d) => deleteDoc(d.ref))
  ]);

  await updateDoc(doc(db, "users", currentUser.uid), { monthlyBudget: 0, categoryBudgets: {} });

  monthlyBudget = 0;
  categoryBudgets = {};
  document.getElementById("budgetInput").value = "";
  // allTransactions/earnedBadgeIds will clear themselves via the live listeners.

  alert("All data has been reset.");
});

// ---------------------------------------------------------------
// Export to CSV — opens directly in Excel or Google Sheets
// ---------------------------------------------------------------
document.getElementById("exportCsvBtn").addEventListener("click", () => {
  if (allTransactions.length === 0) {
    alert("No transactions to export yet.");
    return;
  }

  const header = ["Date", "Type", "Category", "Amount", "Method", "Note"];
  const rows = allTransactions.map((t) => [
    t.date, t.type, t.category, t.amount, t.method || "", t.note || ""
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ledger-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------------------------------------------------------------
// Transactions — live sync
// ---------------------------------------------------------------
function listenToTransactions() {
  const q = query(collection(db, "users", currentUser.uid, "transactions"), orderBy("date", "desc"));
  onSnapshot(q, (snap) => {
    allTransactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}

document.getElementById("entryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = document.getElementById("entryType").value;
  const category = document.getElementById("entryCategory").value.trim();
  const amount = parseFloat(document.getElementById("entryAmount").value);
  const method = document.getElementById("entryMethod").value;
  const note = document.getElementById("entryNote").value.trim();
  const date = document.getElementById("entryDate").value;

  if (!category || !amount || !date) return;

  await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
    type, category, amount, method, note, date, createdAt: serverTimestamp()
  });

  e.target.reset();
  document.getElementById("entryDate").valueAsDate = new Date();
});

async function deleteTransaction(id) {
  if (!confirm("Delete this entry?")) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "transactions", id));
}

// ---------------------------------------------------------------
// Badges — live sync of what's already been earned
// ---------------------------------------------------------------
function listenToBadges() {
  const q = collection(db, "users", currentUser.uid, "badges");
  onSnapshot(q, (snap) => {
    earnedBadgeIds = new Set(snap.docs.map((d) => d.id));
    renderBadges();
    checkForNewBadges();
  });
}

async function checkForNewBadges() {
  const stats = computeStats();
  for (const badge of BADGE_DEFS) {
    if (!earnedBadgeIds.has(badge.id) && badge.test(stats)) {
      earnedBadgeIds.add(badge.id); // optimistic, avoids duplicate writes
      await setDoc(doc(db, "users", currentUser.uid, "badges", badge.id), {
        earnedAt: serverTimestamp()
      });
      showToast(badge);
    }
  }
}

function showToast(badge) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<strong>New award earned</strong>${badge.icon}  ${badge.name} — ${badge.desc}`;
  toastStack.appendChild(el);
  setTimeout(() => el.remove(), 6000);
  fireConfetti();
}

function fireConfetti() {
  if (typeof confetti !== "function") return; // library failed to load — skip quietly
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const colors = [
    cssVar("--gold-bright", "#D9A63E"),
    cssVar("--green-pos", "#2F6B4F"),
    cssVar("--coral", "#B24B37")
  ];

  confetti({ particleCount: 90, spread: 75, origin: { y: 0.3 }, colors });
  confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0, y: 0.4 }, colors });
  confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1, y: 0.4 }, colors });
}

// ---------------------------------------------------------------
// Stats computation (used by both the dashboard and badge logic)
// ---------------------------------------------------------------
function monthKey(dateStr) {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function computeStats() {
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const byMonth = {}; // ym -> { income, expense }
  for (const t of allTransactions) {
    const ym = monthKey(t.date);
    if (!byMonth[ym]) byMonth[ym] = { income: 0, expense: 0 };
    byMonth[ym][t.type] += t.amount;
  }

  const sortedYms = Object.keys(byMonth).sort(); // ascending

  // Consecutive under-budget streak ending at the most recent month with data.
  let consecutiveUnderBudget = 0;
  if (monthlyBudget > 0) {
    for (let i = sortedYms.length - 1; i >= 0; i--) {
      const m = byMonth[sortedYms[i]];
      if (m.expense <= monthlyBudget) consecutiveUnderBudget++;
      else break;
    }
  }

  // Best savings rate across all months with income.
  let bestSavingsRate = 0;
  for (const ym of sortedYms) {
    const m = byMonth[ym];
    if (m.income > 0) {
      const rate = (m.income - m.expense) / m.income;
      if (rate > bestSavingsRate) bestSavingsRate = rate;
    }
  }

  const currentMonthData = byMonth[currentYm] || { income: 0, expense: 0 };

  return {
    totalEntries: allTransactions.length,
    budget: monthlyBudget,
    currentMonthUnderBudget: monthlyBudget > 0 && currentMonthData.expense <= monthlyBudget,
    consecutiveUnderBudget,
    bestSavingsRate,
    currentMonthData,
    currentYm
  };
}

// ---------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------
function fmt(amount) {
  return `${userCurrency}${Math.abs(amount).toFixed(2)}`;
}

function renderAll() {
  const stats = computeStats();
  const { income, expense } = stats.currentMonthData;
  const balance = income - expense;

  const heroEl = document.getElementById("heroAmount");
  heroEl.textContent = (balance < 0 ? "-" : "") + fmt(balance);
  heroEl.classList.toggle("negative", balance < 0);

  document.getElementById("statIncome").textContent = fmt(income);
  document.getElementById("statExpense").textContent = fmt(expense);

  const budgetLine = document.getElementById("budgetLine");
  const budgetFill = document.getElementById("budgetFill");
  if (monthlyBudget > 0) {
    const pct = Math.min(100, (expense / monthlyBudget) * 100);
    budgetLine.textContent = `${fmt(expense)} of ${fmt(monthlyBudget)} monthly budget used`;
    budgetFill.style.width = `${pct}%`;
    budgetFill.classList.toggle("over", expense > monthlyBudget);
  } else {
    budgetLine.textContent = "No monthly budget set yet — set one below.";
    budgetFill.style.width = "0%";
  }

  renderBudgetWarning(expense);
  renderChallenge(stats);
  renderRegister(stats.currentYm);
  renderCategoryBreakdown(stats.currentYm);
  renderMethodBreakdown(stats.currentYm);
  renderCategoryBudgets(stats.currentYm);
  renderCharts(stats);
  renderBadges();
}

// ---------------------------------------------------------------
// Budget warning banner — fires once per threshold crossing per session
// ---------------------------------------------------------------
function renderBudgetWarning(expense) {
  const el = document.getElementById("budgetWarning");

  if (monthlyBudget <= 0) {
    el.style.display = "none";
    lastWarningLevel = 0;
    return;
  }

  const pct = (expense / monthlyBudget) * 100;
  let level = 0;
  let message = "";
  let cssClass = "";

  if (pct >= 100) {
    level = 2;
    cssClass = "danger";
    message = `You've reached your monthly budget of ${fmt(monthlyBudget)}.`;
  } else if (pct >= 80) {
    level = 1;
    cssClass = "caution";
    message = `Heads up — you've used ${Math.round(pct)}% of your monthly budget.`;
  }

  if (level > 0) {
    el.textContent = message;
    el.className = `budget-warning ${cssClass}`;
    el.style.display = "block";
  } else {
    el.style.display = "none";
  }

  // Toast once per session when newly crossing into a higher level.
  if (level > lastWarningLevel) {
    showBanner(level === 2 ? "Budget limit reached" : "Approaching your budget", message);
  }
  lastWarningLevel = level;
}

function showBanner(title, message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<strong>${title}</strong>${message}`;
  toastStack.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// ---------------------------------------------------------------
// Monthly challenge — resets naturally every month since it's computed
// live from the current date; nothing is stored for it.
// ---------------------------------------------------------------
function renderChallenge(stats) {
  const section = document.getElementById("challengeSection");
  const card = document.getElementById("challengeCard");
  const daysLeftEl = document.getElementById("challengeDaysLeft");

  if (monthlyBudget <= 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  const { expense } = stats.currentMonthData;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate();
  daysLeftEl.textContent = daysLeft === 0 ? "Last day" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;

  const pct = Math.min(100, (expense / monthlyBudget) * 100);
  const remaining = monthlyBudget - expense;

  let statusClass = "on-track";
  let statusText = "On track";
  if (expense > monthlyBudget) {
    statusClass = "over";
    statusText = "Over budget";
  } else if (pct >= 80) {
    statusClass = "caution";
    statusText = "Cutting it close";
  }

  card.innerHTML = `
    <p class="challenge-goal">Stay under <strong>${fmt(monthlyBudget)}</strong> this month.</p>
    <div class="budget-track"><div class="budget-fill ${expense > monthlyBudget ? "over" : ""}" style="width:${pct}%"></div></div>
    <p class="challenge-goal" style="margin-top:10px; margin-bottom:0;">
      ${remaining >= 0 ? `${fmt(remaining)} left to spend` : `${fmt(Math.abs(remaining))} over`}
    </p>
    <span class="challenge-status ${statusClass}">${statusText}</span>
  `;
}

// ---------------------------------------------------------------
// Shared helper: group this month's expenses by a given field
// ---------------------------------------------------------------
function groupExpensesBy(currentYm, field) {
  const monthExpenses = allTransactions.filter(
    (t) => monthKey(t.date) === currentYm && t.type === "expense"
  );
  const totals = {};
  for (const t of monthExpenses) {
    const key = t[field] || "Other";
    totals[key] = (totals[key] || 0) + t.amount;
  }
  const totalExpense = Object.values(totals).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  return { sorted, totalExpense };
}

// ---------------------------------------------------------------
// Category breakdown — this month's expenses, grouped by category
// ---------------------------------------------------------------
function renderCategoryBreakdown(currentYm) {
  const section = document.getElementById("categorySection");
  const list = document.getElementById("categoryList");
  const { sorted, totalExpense } = groupExpensesBy(currentYm, "category");

  if (sorted.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  list.innerHTML = sorted.map(([category, amount]) => {
    const pct = totalExpense > 0 ? (amount / totalExpense) * 100 : 0;
    return `
      <div class="category-row">
        <div class="category-row-head">
          <span class="cat-name">${escapeHtml(category)}</span>
          <span class="cat-amount">${fmt(amount)}</span>
        </div>
        <div class="category-bar-track"><div class="category-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join("");
}

// ---------------------------------------------------------------
// Payment method breakdown — same idea, grouped by method
// ---------------------------------------------------------------
function renderMethodBreakdown(currentYm) {
  const section = document.getElementById("methodSection");
  const list = document.getElementById("methodList");
  const { sorted, totalExpense } = groupExpensesBy(currentYm, "method");

  if (sorted.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  list.innerHTML = sorted.map(([method, amount]) => {
    const pct = totalExpense > 0 ? (amount / totalExpense) * 100 : 0;
    return `
      <div class="category-row">
        <div class="category-row-head">
          <span class="cat-name">${escapeHtml(method)}</span>
          <span class="cat-amount">${fmt(amount)}</span>
        </div>
        <div class="category-bar-track"><div class="category-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join("");
}

// ---------------------------------------------------------------
// Category budgets — user-defined per-category caps vs this month's spend
// ---------------------------------------------------------------
function renderCategoryBudgets(currentYm) {
  const list = document.getElementById("categoryBudgetList");
  const categories = Object.keys(categoryBudgets);

  if (categories.length === 0) {
    list.innerHTML = `<div class="empty-state">No category budgets set yet.</div>`;
    return;
  }

  const monthExpenses = allTransactions.filter(
    (t) => monthKey(t.date) === currentYm && t.type === "expense"
  );
  const usedByCategory = {};
  for (const t of monthExpenses) {
    usedByCategory[t.category] = (usedByCategory[t.category] || 0) + t.amount;
  }

  list.innerHTML = categories.map((category) => {
    const limit = categoryBudgets[category];
    const used = usedByCategory[category] || 0;
    const remaining = limit - used;
    const pct = Math.min(100, (used / limit) * 100);

    let fillClass = "";
    if (used > limit) fillClass = "over";

    return `
      <div class="cbudget-row">
        <div class="cbudget-head">
          <span class="cat-name">${escapeHtml(category)}</span>
          <span>
            <span class="cbudget-numbers">${fmt(used)} / ${fmt(limit)}</span>
            <button class="cbudget-remove" data-cat="${escapeHtml(category)}">Remove</button>
          </span>
        </div>
        <div class="budget-track"><div class="budget-fill ${fillClass}" style="width:${pct}%"></div></div>
        <p class="budget-line" style="margin:6px 0 0;">
          ${remaining >= 0 ? `${fmt(remaining)} remaining` : `${fmt(Math.abs(remaining))} over`}
        </p>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".cbudget-remove").forEach((btn) => {
    btn.addEventListener("click", () => removeCategoryBudget(btn.dataset.cat));
  });
}

// ---------------------------------------------------------------
// Charts — a donut for category spending, a bar for income vs. expense.
// Colors are read live from the current theme's CSS variables so they
// stay legible across light, dark, and cute mode.
// ---------------------------------------------------------------
function cssVar(name, fallback) {
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

function chartPalette(n) {
  const base = ["#B9862C", "#2F6B4F", "#B24B37", "#3F5C52", "#6E8B7A", "#D9A63E", "#8A6416", "#4C6B5C"];
  return Array.from({ length: n }, (_, i) => base[i % base.length]);
}

function renderCharts(stats) {
  const section = document.getElementById("chartsSection");
  if (!window.Chart) return; // Chart.js failed to load — charts just won't render

  const { sorted: catSorted } = groupExpensesBy(stats.currentYm, "category");
  const { income, expense } = stats.currentMonthData;

  if (catSorted.length === 0 && income === 0 && expense === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  const ink = cssVar("--ink", "#16302A");
  const line = cssVar("--line", "#D8DCC9");
  const surface = cssVar("--surface", "#FBFAF5");
  const greenPos = cssVar("--green-pos", "#2F6B4F");
  const coral = cssVar("--coral", "#B24B37");

  if (categoryChartInstance) categoryChartInstance.destroy();
  if (catSorted.length > 0) {
    categoryChartInstance = new Chart(document.getElementById("categoryChart"), {
      type: "doughnut",
      data: {
        labels: catSorted.map(([c]) => c),
        datasets: [{
          data: catSorted.map(([, amt]) => amt),
          backgroundColor: chartPalette(catSorted.length),
          borderColor: surface,
          borderWidth: 2
        }]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 }, color: ink } } }
      }
    });
  }

  if (incomeExpenseChartInstance) incomeExpenseChartInstance.destroy();
  incomeExpenseChartInstance = new Chart(document.getElementById("incomeExpenseChart"), {
    type: "bar",
    data: {
      labels: ["This month"],
      datasets: [
        { label: "Income", data: [income], backgroundColor: greenPos },
        { label: "Expenses", data: [expense], backgroundColor: coral }
      ]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { color: ink } } },
      scales: {
        y: { beginAtZero: true, ticks: { color: ink }, grid: { color: line } },
        x: { ticks: { color: ink }, grid: { display: false } }
      }
    }
  });
}

function renderRegister(currentYm) {
  const register = document.getElementById("register");
  const monthEntries = allTransactions.filter((t) => monthKey(t.date) === currentYm);

  if (monthEntries.length === 0) {
    register.innerHTML = `<div class="empty-state">No entries yet this month — add your first one above.</div>`;
    return;
  }

  register.innerHTML = monthEntries.map((t) => {
    const d = new Date(t.date + "T00:00:00");
    const dateLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const sign = t.type === "income" ? "+" : "−";
    return `
      <div class="register-row" data-id="${t.id}">
        <div class="register-date">${dateLabel}</div>
        <div class="register-desc">
          <div class="cat">${escapeHtml(t.category)}</div>
          ${t.note ? `<div class="note">${escapeHtml(t.note)}</div>` : ""}
          ${t.method ? `<span class="method-tag">${escapeHtml(t.method)}</span>` : ""}
        </div>
        <div class="register-amount ${t.type}">${sign}${fmt(t.amount)}</div>
        <button class="row-delete" data-id="${t.id}">Delete</button>
      </div>
    `;
  }).join("");

  register.querySelectorAll(".row-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteTransaction(btn.dataset.id));
  });
}

function renderBadges() {
  const strip = document.getElementById("badgeStrip");
  strip.innerHTML = BADGE_DEFS.map((b) => {
    const earned = earnedBadgeIds.has(b.id);
    return `
      <div class="badge ${earned ? "earned" : ""}">
        <div class="badge-medal">${b.icon}</div>
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
      </div>
    `;
  }).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
