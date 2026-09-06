import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authError = document.getElementById("authError");

// If already logged in, skip straight to the dashboard.
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "dashboard.html";
});

function showTab(tab) {
  const isLogin = tab === "login";
  tabLogin.classList.toggle("active", isLogin);
  tabSignup.classList.toggle("active", !isLogin);
  loginForm.style.display = isLogin ? "block" : "none";
  signupForm.style.display = isLogin ? "none" : "block";
  hideError();
}

tabLogin.addEventListener("click", () => showTab("login"));
tabSignup.addEventListener("click", () => showTab("signup"));

function showError(message) {
  authError.textContent = message;
  authError.classList.add("show");
}
function hideError() {
  authError.classList.remove("show");
}

function friendlyError(err) {
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account already exists with that email.",
    "auth/weak-password": "Password should be at least 6 characters."
  };
  return map[err.code] || "Something went wrong. Please try again.";
}

// ---------- Log in ----------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const submitBtn = document.getElementById("loginSubmit");

  submitBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "dashboard.html";
  } catch (err) {
    showError(friendlyError(err));
    submitBtn.disabled = false;
  }
});

// ---------- Sign up ----------
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const submitBtn = document.getElementById("signupSubmit");

  submitBtn.disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });

    // Create the user's profile document in Firestore.
    await setDoc(doc(db, "users", cred.user.uid), {
      name,
      email,
      monthlyBudget: 0,
      categoryBudgets: {},
      currency: "₱",
      createdAt: serverTimestamp()
    });

    window.location.href = "dashboard.html";
  } catch (err) {
    showError(friendlyError(err));
    submitBtn.disabled = false;
  }
});
