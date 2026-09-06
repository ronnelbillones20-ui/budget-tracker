# Ledger — Budget Tracker

A simple budget tracker with Firebase accounts, a monthly dashboard, and
badges you earn for budgeting well. Pure HTML/CSS/JS — no build step,
deploys straight to GitHub Pages.

## What's inside

```
budget-ledger/
├── index.html          # Login / sign up
├── dashboard.html       # Main app
├── css/style.css
├── js/
│   ├── firebase-config.js   # ← you edit this
│   ├── auth.js
│   └── app.js
└── firestore.rules      # security rules reference
```

## Part 1 — Create your Firebase project

1. Go to **console.firebase.google.com** and click **Add project**.
2. Name it (e.g. "budget-ledger"), disable Google Analytics unless you
   want it (not needed here), and click **Create project**.

### Enable Email/Password sign-in
3. In the left sidebar, go to **Build → Authentication**.
4. Click **Get started**.
5. Under **Sign-in method**, click **Email/Password**, toggle it **on**, and **Save**.

### Create the database
6. In the left sidebar, go to **Build → Firestore Database**.
7. Click **Create database**.
8. Choose **Start in production mode** (we'll add our own rules), pick a
   location close to you, and click **Enable**.
9. Once created, go to the **Rules** tab and replace the contents with
   what's in `firestore.rules` in this project, then click **Publish**.
   This makes sure each person can only read/write their own data.

### Get your web app config
10. Click the **gear icon → Project settings** (top left, next to "Project Overview").
11. Scroll to **Your apps**, click the **</> (Web)** icon.
12. Give the app a nickname (e.g. "ledger-web"), click **Register app**.
    You do **not** need Firebase Hosting for this step — skip it.
13. Firebase will show you a `firebaseConfig` object with your keys —
    copy it.

## Part 2 — Connect the code to your project

14. Open `js/firebase-config.js` in this project.
15. Replace the placeholder `firebaseConfig` object with the one you
    copied from step 13. It looks like:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "budget-ledger-xxxxx.firebaseapp.com",
  projectId: "budget-ledger-xxxxx",
  storageBucket: "budget-ledger-xxxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};
```

16. Save the file. That's the only file you need to edit to get the app running.

## Part 3 — Test it locally (optional but recommended)

Browsers block ES modules from `file://` paths, so serve the folder locally:

```bash
cd budget-ledger
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser. Sign up for an
account, add a transaction, and confirm it appears in Firestore
(Firebase Console → Firestore Database → Data tab).

## Part 4 — Deploy to GitHub Pages

17. Create a new GitHub repository (e.g. `budget-ledger`).
18. Push this folder's contents to the repo root:

```bash
cd budget-ledger
git init
git add .
git commit -m "Initial commit: budget ledger app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/budget-ledger.git
git push -u origin main
```

19. On GitHub, go to your repo's **Settings → Pages**.
20. Under **Build and deployment**, set **Source** to **Deploy from a branch**,
    branch **main**, folder **/ (root)**. Click **Save**.
21. GitHub will give you a URL like
    `https://YOUR-USERNAME.github.io/budget-ledger/` — that's your live app.

### One more Firebase step after deploying
22. Back in Firebase Console → **Authentication → Settings → Authorized domains**,
    click **Add domain** and add your GitHub Pages domain
    (`YOUR-USERNAME.github.io`). Without this, sign-in will be blocked
    on the live site even though it works locally.

## New: payment methods & category budgets

- **Payment method** — every transaction now records how you paid
  (Cash, GCash, Maya, Bank, Card, Other), shown as a small tag on each
  register row. A new "Spending by payment method" section breaks
  down the current month the same way as the category breakdown.
- **Category budgets** — separate from your overall monthly budget,
  you can now cap individual categories (e.g. Food ₱6,000, Transport
  ₱3,000). Each one shows a progress bar, amount used vs. the limit,
  and turns red when you go over. Remove a limit any time with the
  "Remove" link.

These add two new fields to your Firestore user document:
`categoryBudgets` (a map of category → limit) and `method` on each
transaction. No security rule changes needed — they're covered by the
existing per-user rules.

## Dark mode

There's a ☾/☀ toggle button (top-left on the sign-in page, top-right
in the dashboard header). It respects your system preference on first
visit, then remembers your choice in the browser's local storage —
each device remembers its own preference, since this isn't synced to
your account in Firestore.

## New: warnings, monthly challenge, category breakdown

- **Budget warning banner** — once you're 80% through your monthly
  budget, a caution banner appears under the progress bar; at 100%+ it
  switches to a stronger warning. A toast also pops the first time you
  cross each threshold in a session.
- **This month's challenge** — a card showing "stay under ₱X this
  month" with days remaining and a status (On track / Cutting it close
  / Over budget). Unlike badges, this isn't stored anywhere — it's
  recalculated from today's date every time you load the page, so it
  naturally resets on the 1st of each month.
- **Spending by category** — a breakdown of this month's expenses
  grouped by whatever you typed in the Category field, sorted highest
  to lowest.

None of these needed new Firestore fields — they're all computed
client-side from your existing transactions and budget.

## How the badges work

Badges are evaluated client-side every time your transactions or budget
change, and saved permanently in Firestore once earned (they won't
un-earn if you later go over budget):

| Badge | How to earn it |
|---|---|
| First Entry | Log your first transaction |
| Budget Keeper | Stay under your monthly budget for the current month |
| Three in a Row | Stay under budget for 3 consecutive months |
| Half-Year Hero | Stay under budget for 6 consecutive months |
| Big Saver | Save 20%+ of your income in any single month |

You can add more badges by editing the `BADGE_DEFS` array at the top
of `js/app.js` — each one just needs an id, name, icon, description,
and a `test(stats)` function that returns true/false.

## Data model (Firestore)

```
users/{uid}
  ├─ name, email, monthlyBudget, currency
  ├─ transactions/{transactionId}
  │     type: "income" | "expense"
  │     category, amount, note, date (YYYY-MM-DD)
  └─ badges/{badgeId}
        earnedAt: timestamp
```

## Customizing

- **Currency symbol**: defaults to `₱` (Philippine Peso) for new accounts.
  To change it, update the `currency` field on the user's document in
  Firestore, or add a small settings input in `dashboard.html` that
  calls `updateDoc`.
- **Colors/fonts**: all design tokens are CSS variables at the top of
  `css/style.css`.
