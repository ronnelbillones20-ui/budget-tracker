// ============================================================
// FIREBASE CONFIG
// Replace the values below with YOUR OWN project's config.
// You get this from: Firebase Console > Project settings >
// General tab > "Your apps" > SDK setup and configuration.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDgwzfbMlz38Eq4FaBflcVx-sWdrrppWEk",
  authDomain: "budget-ledger-99d9c.firebaseapp.com",
  projectId: "budget-ledger-99d9c",
  storageBucket: "budget-ledger-99d9c.firebasestorage.app",
  messagingSenderId: "765961450386",
  appId: "1:765961450386:web:b614df15104ec37179074b"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
