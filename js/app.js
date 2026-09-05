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

  renderRegister(stats.currentYm);
  renderBadges();
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
