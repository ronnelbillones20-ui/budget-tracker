import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc,
  collection, addDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp
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
let allTransactions = []; // all-time, newest first
let earnedBadgeIds = new Set();
let lastWarningLevel = 0; // 0 = none, 1 = caution (80%+), 2 = danger (100%+) — resets on page load / new month

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
  } else {
    await setDoc(ref, { monthlyBudget: 0, currency: "₱", email: currentUser.email, createdAt: serverTimestamp() });
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
  const note = document.getElementById("entryNote").value.trim();
  const date = document.getElementById("entryDate").value;

  if (!category || !amount || !date) return;

  await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
    type, category, amount, note, date, createdAt: serverTimestamp()
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
// Category breakdown — this month's expenses, grouped by category
// ---------------------------------------------------------------
function renderCategoryBreakdown(currentYm) {
  const section = document.getElementById("categorySection");
  const list = document.getElementById("categoryList");

  const monthExpenses = allTransactions.filter(
    (t) => monthKey(t.date) === currentYm && t.type === "expense"
  );

  if (monthExpenses.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  const totals = {};
  for (const t of monthExpenses) {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
  }

  const totalExpense = Object.values(totals).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

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
