// Smagning – klient-app. Ingen build: ES-moduler direkte fra Firebase CDN.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, signOut, sendPasswordResetEmail, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection,
  query, orderBy, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Lokal udvikling: kør `firebase emulators:start`, så bruges emulatorerne i stedet for produktion.
if (["localhost", "127.0.0.1"].includes(location.hostname)) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

// ---------- Konstanter ----------
const DIMS = [
  { key: "udseende", label: "Udseende og farve", hint: "Klarhed, farve, viskositet" },
  { key: "naese",    label: "Næse (duft)",        hint: "Intensitet, kompleksitet, renhed" },
  { key: "smag",     label: "Smag og mundfølelse", hint: "Sødme, balance, fylde" },
  { key: "eftersmag", label: "Eftersmag (finish)", hint: "Længde, udvikling" },
  { key: "samlet",   label: "Samlet vurdering",   hint: "Din egen rettesnor – indgår ikke i den fælles score" },
];
// Den fælles score er et vægtet gennemsnit af de fire delkarakterer. Smagerens egen
// "samlet" er kun til smageren selv og indgår ikke.
const WEIGHTS = { udseende: 0.05, naese: 0.20, smag: 0.50, eftersmag: 0.25 };
const WEIGHTS_TEXT = "Vægtning: farve 5 %, duft 20 %, smag 50 %, eftersmag 25 %. Smagerens egen samlede vurdering indgår ikke.";
const weighted = (scores) => Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + w * (Number(scores?.[k]) || 0), 0);
// Gæt ved blindsmagning: {country, abv, name}. Ældre bedømmelser kan have en ren tekst.
const guessParts = (g) => {
  if (!g) return [];
  if (typeof g === "string") return [["Gæt", g]];
  return [["Land", g.country], ["Alkohol", g.abv ? g.abv + " %" : ""], ["Navn", g.name]].filter(([, v]) => v);
};
const guessText = (g) => guessParts(g).map(([k, v]) => `${k}: ${v}`).join(" · ");
// Markerer rigtige gæt, når rommens rigtige oplysninger er kendt (efter afsløring)
const guessHtml = (g, priv) => {
  const parts = guessParts(g);
  if (!parts.length) return "";
  const norm = (x) => String(x || "").trim().toLowerCase();
  const num = (x) => parseFloat(String(x || "").replace(",", "."));
  const hit = (k, v) => {
    if (!priv || typeof g === "string") return "";
    if (k === "Land") return norm(v) && norm(v) === norm(priv.country) ? " ✓" : "";
    if (k === "Alkohol") return !isNaN(num(g.abv)) && !isNaN(num(priv.abv)) && Math.abs(num(g.abv) - num(priv.abv)) <= 2 ? " ✓" : "";
    if (k === "Navn") return norm(v) && norm(priv.name).includes(norm(v)) ? " ✓" : "";
    return "";
  };
  return parts.map(([k, v]) => `${k}: ${esc(v)}${hit(k, v)}`).join(" · ");
};
const avgWeighted = (ratings) => ratings.length ? ratings.reduce((sum, r) => sum + weighted(r.scores), 0) / ratings.length : 0;
// Administratorens smagsprofil for en rom: faste, gængse markeringer, så intet skal skrives ind hver gang.
const PROFILE_GROUPS = [
  { key: "duft", label: "Duft (næse)", hint: "intensitet og karakter", options: [
    "Let", "Middel", "Kraftig", "Ren", "Sprittet", "Sød", "Tør", "Frugtig", "Krydret", "Træagtig", "Funky/estere", "Blomstret", "Røget", "Mørk (melasse)", "Lys (sukkerrør)",
  ] },
  { key: "smag", label: "Smag og mundfølelse", hint: "sødme, fylde, varme og eftersmag", options: [
    "Tør", "Let sød", "Sød", "Meget sød", "Let krop", "Middel krop", "Fyldig", "Olieagtig", "Mild", "Varm", "Skarp", "Blød", "Balanceret", "Kompleks", "Enkel", "Bitter", "Tannin/eg", "Kort eftersmag", "Middel eftersmag", "Lang eftersmag",
  ] },
  { key: "aromaer", label: "Aromaer", hint: "det, du finder i duft og smag", options: [
    "Vanilje", "Karamel", "Toffee", "Eg/fad", "Tropisk frugt", "Banan", "Ananas", "Kokos", "Tørret frugt", "Rosin", "Figen", "Æble/pære", "Citrus", "Melasse", "Sukkerrør/græs", "Funk/hogo", "Krydderi", "Kanel", "Nellike", "Peber", "Muskat", "Lakrids", "Tobak", "Læder", "Chokolade", "Kaffe", "Røg", "Honning", "Nødder", "Mandler", "Brun farin", "Mint", "Blomster", "Sherry/vin", "Bourbon",
  ] },
];
// Admins egne ord (settings/profileOptions) lægges oven i de faste lister
let extraOptions = { duft: [], smag: [], aromaer: [] };
const optionsFor = (key) => {
  const base = PROFILE_GROUPS.find((g) => g.key === key).options;
  return base.concat((extraOptions[key] || []).filter((o) => !base.includes(o)));
};
// Avatarer: rom-relaterede emojis. Brugeren kan også uploade sit eget billede.
const AVATARS = [
  ["🥃", "Romglas"], ["🍹", "Tiki-drink"], ["🍸", "Cocktail"], ["🍾", "Flaske"], ["🛢️", "Fad"], ["🍯", "Melasse"],
  ["🏴‍☠️", "Sørøver"], ["🦜", "Papegøje"], ["⚓", "Anker"], ["🚢", "Skib"], ["🌴", "Palme"], ["🏝️", "Ø"],
  ["🍌", "Banan"], ["🍍", "Ananas"], ["🥥", "Kokos"], ["🌶️", "Krydret"], ["🎩", "Gentleman"], ["🧔", "Ron Jeremy"],
];
const avatarHtml = (uid, cls = "") => {
  const a = users[uid]?.avatar;
  if (a?.type === "image" && a.data) return `<img class="avatar ${cls}" src="${a.data}" alt="">`;
  if (a?.type === "emoji" && a.value) return `<span class="avatar ${cls}">${esc(a.value)}</span>`;
  return `<span class="avatar ${cls} initial">${esc((users[uid]?.name || "?").trim().charAt(0).toUpperCase())}</span>`;
};
const RUM_TYPES = ["Melasse", "Agricole (sukkerrørssaft)", "Cachaça", "Spiced/aromatiseret", "Andet/ukendt"];
const STATUS = { tilmelding: "Åben for tilmelding", igang: "I gang", afsluttet: "Afsluttet" };
const STATUS_CLASS = { tilmelding: "ok", igang: "warn", afsluttet: "muted" };
const AUTH_ERRORS = {
  "auth/invalid-credential": "Forkert e-mail eller adgangskode.",
  "auth/user-not-found": "Ingen bruger med den e-mail.",
  "auth/wrong-password": "Forkert adgangskode.",
  "auth/email-already-in-use": "E-mailen er allerede i brug. Log ind i stedet.",
  "auth/weak-password": "Adgangskoden skal være mindst 6 tegn.",
  "auth/invalid-email": "E-mailen ser ikke rigtig ud.",
  "auth/popup-closed-by-user": "Google-login blev afbrudt.",
  "auth/unauthorized-domain": "Dette domæne er ikke godkendt til login i Firebase (Authentication → Settings → Authorized domains).",
};

// ---------- Tilstand ----------
const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
let user = null;        // Firebase Auth-bruger
let profile = null;     // users/{uid}
let pendingName = null; // navn fra oprettelsesformularen, bruges når profilen oprettes
let users = {};         // uid -> {name, email, role}
let unsubs = [];        // snapshot-lyttere for den aktuelle side
let usersUnsub = null;
let optionsUnsub = null;

const listen = (u) => unsubs.push(u);
const stopListeners = () => { unsubs.forEach((u) => u()); unsubs = []; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isAdmin = () => profile?.role === "admin";
const nameOf = (uid) => users[uid]?.name || "Ukendt";
const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const go = (hash) => { location.hash = hash; };
function fmtDate(d, t) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  const s = new Date(y, m - 1, day).toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  return t ? `${s} kl. ${t}` : s;
}
// Kort bekræftelse nederst på skærmen (fx "Gemt")
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2500);
}
function showError(err) {
  console.error(err);
  const msg = AUTH_ERRORS[err?.code] || (err?.code === "permission-denied" ? "Du har ikke adgang til at gøre det." : err?.message || String(err));
  const el = document.getElementById("error");
  if (el) { el.textContent = msg; el.hidden = false; } else alert(msg);
}

// ---------- Auth ----------
onAuthStateChanged(auth, async (u) => {
  user = u;
  if (usersUnsub) { usersUnsub(); usersUnsub = null; }
  if (optionsUnsub) { optionsUnsub(); optionsUnsub = null; }
  if (u) {
    try {
      profile = await ensureProfile(u);
      optionsUnsub = onSnapshot(doc(db, "settings", "profileOptions"), (s) => {
        extraOptions = { duft: [], smag: [], aromaer: [], ...(s.exists() ? s.data() : {}) };
      });
      usersUnsub = onSnapshot(collection(db, "users"), (snap) => {
        users = {};
        snap.forEach((d) => (users[d.id] = d.data()));
        if (users[u.uid]) profile = users[u.uid];
        renderNav();
      });
    } catch (e) { showError(e); }
  } else {
    profile = null; users = {};
  }
  renderNav();
  route();
});

async function ensureProfile(u) {
  const ref = doc(db, "users", u.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const data = {
    name: pendingName || u.displayName || (u.email || "").split("@")[0],
    email: u.email || "",
    role: "medlem",
    createdAt: serverTimestamp(),
  };
  pendingName = null;
  await setDoc(ref, data);
  return data;
}

function renderNav() {
  if (!user) { $nav.innerHTML = ""; return; }
  $nav.innerHTML = `
    <a href="#/">Smagninger</a>
    ${isAdmin() ? '<a href="#/bibliotek">Rombibliotek</a>' : ""}
    <a href="#/profil" class="row" style="gap:6px">${avatarHtml(user.uid, "small")}${esc(profile?.name || "Profil")}${isAdmin() ? " (admin)" : ""}</a>
    <button id="logout" class="small">Log ud</button>`;
  document.getElementById("logout").onclick = () => signOut(auth);
}

// ---------- Router ----------
window.addEventListener("hashchange", route);
function route() {
  stopListeners();
  window.scrollTo(0, 0);
  if (!user) return viewLogin();
  const p = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (p[0] === "smagning" && p[1] && p[2] === "rom" && p[3]) return viewRum(p[1], p[3]);
  if (p[0] === "smagning" && p[1]) return viewTasting(p[1]);
  if (p[0] === "admin" && p[1] === "smagning" && p[2] && p[3] === "manuskript") return isAdmin() ? viewScript(p[2]) : viewHome();
  if (p[0] === "admin" && p[1] === "smagning" && p[2]) return isAdmin() ? viewAdminTasting(p[2]) : viewHome();
  if (p[0] === "bibliotek" && p[1]) return isAdmin() ? viewLibraryRum(p[1]) : viewHome();
  if (p[0] === "bibliotek") return isAdmin() ? viewLibrary() : viewHome();
  if (p[0] === "profil") return viewProfile();
  return viewHome();
}

// ---------- Login ----------
function viewLogin() {
  $app.innerHTML = `
    <h1>Velkommen til smagning</h1>
    <p class="muted">Log ind eller opret dig som medlem for at deltage i smagninger.</p>
    <div id="error" class="error" hidden></div>
    <div class="card">
      <button id="google" class="secondary">Fortsæt med Google</button>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Log ind</h2>
      <form id="login">
        <label>E-mail<input type="email" name="email" required autocomplete="email"></label>
        <label>Adgangskode<input type="password" name="password" required autocomplete="current-password"></label>
        <p><button type="submit">Log ind</button> <button type="button" id="reset" class="secondary">Glemt adgangskode</button></p>
      </form>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Opret dig som medlem</h2>
      <form id="signup">
        <label>Navn <span class="hint">(vises for de andre deltagere)</span><input type="text" name="name" required autocomplete="name"></label>
        <label>E-mail<input type="email" name="email" required autocomplete="email"></label>
        <label>Adgangskode <span class="hint">(mindst 6 tegn)</span><input type="password" name="password" required minlength="6" autocomplete="new-password"></label>
        <p><button type="submit">Opret medlem</button></p>
      </form>
    </div>`;
  document.getElementById("google").onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { showError(e); }
  };
  document.getElementById("login").onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try { await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value); } catch (e) { showError(e); }
  };
  document.getElementById("reset").onclick = async () => {
    const email = document.querySelector("#login [name=email]").value.trim();
    if (!email) return showError({ message: "Skriv din e-mail i feltet først." });
    try { await sendPasswordResetEmail(auth, email); alert("Vi har sendt et link til at nulstille adgangskoden."); } catch (e) { showError(e); }
  };
  document.getElementById("signup").onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    pendingName = f.name.value.trim();
    try { await createUserWithEmailAndPassword(auth, f.email.value.trim(), f.password.value); } catch (e) { pendingName = null; showError(e); }
  };
}

// ---------- Profil ----------
function viewProfile() {
  $app.innerHTML = `
    <h1>Min profil</h1>
    <div id="error" class="error" hidden></div>
    <div class="card">
      <form id="profile">
        <label>Navn<input type="text" name="name" value="${esc(profile?.name)}" required></label>
        <p class="muted small">E-mail: ${esc(user.email)} · Rolle: ${isAdmin() ? "administrator" : "medlem"}</p>
        <label>Avatar <span class="hint">(vælg en, eller upload dit eget billede)</span></label>
        <div class="avatars">
          ${AVATARS.map(([v, l]) => `<label class="pick ${profile?.avatar?.type === "emoji" && profile.avatar.value === v ? "on" : ""}" title="${esc(l)}"><input type="radio" name="avatar" value="${esc(v)}" ${profile?.avatar?.type === "emoji" && profile.avatar.value === v ? "checked" : ""}><span class="avatar big">${v}</span><span class="small">${esc(l)}</span></label>`).join("")}
          <label class="pick ${profile?.avatar?.type === "image" ? "on" : ""}" id="pick-image" title="Eget billede">
            <input type="radio" name="avatar" value="__image__" ${profile?.avatar?.type === "image" ? "checked" : ""}>
            ${profile?.avatar?.type === "image" ? `<img class="avatar big" id="avatar-preview" src="${profile.avatar.data}" alt="">` : `<span class="avatar big initial" id="avatar-preview">📷</span>`}
            <span class="small">Eget billede</span>
          </label>
        </div>
        <p class="row"><input type="file" accept="image/*" id="avatar-file" style="margin:0"><button type="button" id="avatar-clear" class="small secondary">Ingen avatar</button></p>
        <input type="hidden" name="avatarImage" value="${profile?.avatar?.type === "image" ? profile.avatar.data : ""}">
        <p><button type="submit">Gem</button></p>
      </form>
    </div>
    ${isAdmin() ? `
    <div class="card">
      <h2 style="margin-top:0">Brugere</h2>
      <p class="small muted">Ny adgangskode til en bruger sættes fra GitHub: <a href="https://github.com/cvejleaa/smagning/actions/workflows/set-password.yml" target="_blank" rel="noopener">Actions → "Sæt adgangskode for bruger"</a> → "Run workflow" → skriv e-mail og ny adgangskode. Brugeren logges ud på alle enheder og kan logge ind med den nye kode et minut senere. Roller ændres i Firestore-konsollen.</p>
      <table><thead><tr><th>Bruger</th><th>E-mail</th><th>Rolle</th></tr></thead>
      <tbody>${Object.entries(users).sort((a, b) => (a[1].name || "").localeCompare(b[1].name || "", "da")).map(([uid, u]) => `<tr><td><span class="row" style="display:inline-flex;gap:6px">${avatarHtml(uid, "small")}${esc(u.name)}</span></td><td>${esc(u.email)}</td><td>${u.role === "admin" ? "administrator" : "medlem"}</td></tr>`).join("")}</tbody></table>
    </div>
    <div class="card">
      <h2 style="margin-top:0">AI-hjælp (Anthropic)</h2>
      <p class="small muted">Bruges til at foreslå rækkefølge og historier til en smagning. Nøglen gemmes i databasen, hvor kun administratorer kan læse den, og sendes direkte fra din browser til Anthropic. Opret en nøgle på console.anthropic.com.</p>
      <form id="aikey">
        <label>API-nøgle<input type="password" name="key" placeholder="sk-ant-…" autocomplete="off"></label>
        <p id="aikey-status" class="small muted">Henter…</p>
        <p><button type="submit">Gem nøgle</button> <button type="button" id="aikey-clear" class="danger">Fjern nøgle</button></p>
      </form>
    </div>` : ""}`;
  if (isAdmin()) {
    const $st = document.getElementById("aikey-status");
    getDoc(doc(db, "settings", "ai")).then((d) => {
      const k = d.exists() ? d.data().anthropicKey || "" : "";
      $st.textContent = k ? `Der er gemt en nøgle (slutter på …${k.slice(-4)}).` : "Ingen nøgle gemt endnu.";
    }).catch(showError);
    document.getElementById("aikey").onsubmit = async (ev) => {
      ev.preventDefault();
      const key = ev.target.key.value.trim();
      if (!key) return showError({ message: "Indsæt nøglen først." });
      try { await setDoc(doc(db, "settings", "ai"), { anthropicKey: key }, { merge: true }); toast("Nøglen er gemt"); ev.target.key.value = ""; $st.textContent = `Der er gemt en nøgle (slutter på …${key.slice(-4)}).`; } catch (e) { showError(e); }
    };
    document.getElementById("aikey-clear").onclick = async () => {
      try { await setDoc(doc(db, "settings", "ai"), { anthropicKey: "" }, { merge: true }); toast("Nøglen er fjernet"); $st.textContent = "Ingen nøgle gemt endnu."; } catch (e) { showError(e); }
    };
  }
  const pf = document.getElementById("profile");
  pf.querySelectorAll(".avatars input[type=radio]").forEach((r) => (r.onchange = () => pf.querySelectorAll(".avatars .pick").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked))));
  document.getElementById("avatar-file").onchange = async (ev) => {
    const fil = ev.target.files[0];
    if (!fil) return;
    try {
      const data = await resizeImage(fil, 160, 0.85);
      pf.avatarImage.value = data;
      const holder = document.getElementById("pick-image");
      holder.querySelector("#avatar-preview").outerHTML = `<img class="avatar big" id="avatar-preview" src="${data}" alt="">`;
      holder.querySelector("input").checked = true;
      pf.querySelectorAll(".avatars .pick").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked));
    } catch (e) { showError({ message: "Billedet kunne ikke læses: " + (e.message || e) }); }
  };
  document.getElementById("avatar-clear").onclick = () => {
    pf.querySelectorAll(".avatars input[type=radio]").forEach((r) => (r.checked = false));
    pf.querySelectorAll(".avatars .pick").forEach((l) => l.classList.remove("on"));
  };
  pf.onsubmit = async (ev) => {
    ev.preventDefault();
    const picked = pf.querySelector(".avatars input[type=radio]:checked")?.value || "";
    let avatar = null;
    if (picked === "__image__" && pf.avatarImage.value) avatar = { type: "image", data: pf.avatarImage.value };
    else if (picked && picked !== "__image__") avatar = { type: "emoji", value: picked };
    try {
      await updateDoc(doc(db, "users", user.uid), { name: pf.name.value.trim(), avatar });
      toast("Profilen er gemt");
      go("#/");
    } catch (e) { showError(e); }
  };
}

// ---------- Forside: liste af smagninger ----------
function viewHome() {
  $app.innerHTML = `
    <div class="row between"><h1>Smagninger</h1>${isAdmin() ? '<button id="new">+ Ny smagning</button>' : ""}</div>
    <div id="error" class="error" hidden></div>
    <div id="list"><p class="muted">Indlæser…</p></div>`;
  if (isAdmin()) document.getElementById("new").onclick = async () => {
    try {
      const ref = await addDoc(collection(db, "tastings"), {
        title: "Ny romsmagning", date: new Date().toISOString().slice(0, 10), time: "19:00",
        description: "", status: "tilmelding", blind: true, participantIds: [],
        createdBy: user.uid, createdAt: serverTimestamp(),
      });
      go(`#/admin/smagning/${ref.id}`);
    } catch (e) { showError(e); }
  };
  listen(onSnapshot(query(collection(db, "tastings"), orderBy("date", "desc")), (snap) => {
    const $list = document.getElementById("list");
    if (!$list) return;
    if (snap.empty) { $list.innerHTML = `<p class="muted">Der er ingen smagninger endnu.</p>`; return; }
    $list.innerHTML = "";
    snap.forEach((d) => {
      const t = d.data();
      const joined = (t.participantIds || []).includes(user.uid);
      const el = document.createElement("div");
      el.className = "card link";
      el.innerHTML = `
        <div class="row between">
          <strong>${esc(t.title)}</strong>
          <span class="badge ${STATUS_CLASS[t.status] || ""}">${esc(STATUS[t.status] || t.status)}</span>
        </div>
        <p class="muted small">${esc(fmtDate(t.date, t.time))} · ${(t.participantIds || []).length} tilmeldt${joined ? " · <span class='badge ok'>Du er tilmeldt</span>" : ""}</p>`;
      el.onclick = () => go(`#/smagning/${d.id}`);
      $list.appendChild(el);
    });
  }, showError));
}

// ---------- Smagning: detaljer, tilmelding, romliste, rangliste ----------
function viewTasting(tId) {
  let tasting = null, rums = [], ratings = [];
  const privateNames = {}; // rumId -> rigtigt navn, når man må se det
  $app.innerHTML = `<div id="error" class="error" hidden></div><div id="t"><p class="muted">Indlæser…</p></div>`;

  listen(onSnapshot(doc(db, "tastings", tId), (s) => {
    if (!s.exists()) { $app.innerHTML = `<p class="error">Smagningen findes ikke.</p>`; return; }
    tasting = { id: s.id, ...s.data() }; draw();
  }, showError));
  listen(onSnapshot(query(collection(db, "tastings", tId, "rums"), orderBy("order")), (s) => {
    rums = s.docs.map((d) => ({ id: d.id, ...d.data() })); draw();
  }, showError));
  listen(onSnapshot(collection(db, "tastings", tId, "ratings"), (s) => {
    ratings = s.docs.map((d) => ({ id: d.id, ...d.data() })); draw();
  }, showError));

  async function loadPrivateNames() {
    for (const r of rums) {
      const parts = tasting.participantIds || [];
      const allRated = parts.length > 0 && parts.every((u) => (r.ratedBy || []).includes(u));
      const mayRead = isAdmin() || tasting.status === "afsluttet" || r.status === "lukket" || allRated;
      if (!mayRead || privateNames[r.id] !== undefined) continue;
      privateNames[r.id] = null; // markér som undervejs
      try {
        const p = await getDoc(doc(db, "tastings", tId, "rums", r.id, "private", "info"));
        privateNames[r.id] = p.exists() ? p.data().name || "" : "";
        draw();
      } catch { privateNames[r.id] = ""; }
    }
  }

  function draw() {
    const $t = document.getElementById("t");
    if (!$t || !tasting) return;
    const parts = tasting.participantIds || [];
    const joined = parts.includes(user.uid);
    const canJoin = tasting.status !== "afsluttet";
    loadPrivateNames();

    // Rangliste: kun for romme hvor alle har bedømt, eller admin har lukket rommen
    const rows = rums.map((r) => {
      const rs = ratings.filter((x) => x.rumId === r.id);
      const complete = tasting.status === "afsluttet" || r.status === "lukket" || (parts.length > 0 && parts.every((u) => (r.ratedBy || []).includes(u)));
      const avg = avgWeighted(rs);
      const avgOwn = rs.length ? rs.reduce((s, x) => s + (Number(x.scores?.samlet) || 0), 0) / rs.length : 0;
      const mine = rs.find((x) => x.uid === user.uid);
      const label = privateNames[r.id] ? `${esc(privateNames[r.id])} <span class="muted small">(${esc(r.publicName)})</span>` : esc(r.publicName);
      return { r, rs, complete, avg, avgOwn, mine, label };
    });
    const ranked = rows.filter((x) => x.complete && x.rs.length).sort((a, b) => b.avg - a.avg);

    $t.innerHTML = `
      <div class="row between">
        <h1>${esc(tasting.title)}</h1>
        ${isAdmin() ? `<a class="btn secondary" href="#/admin/smagning/${tId}">Redigér</a>` : ""}
      </div>
      <p><span class="badge ${STATUS_CLASS[tasting.status] || ""}">${esc(STATUS[tasting.status] || tasting.status)}</span>
         ${tasting.blind ? '<span class="badge">Blindsmagning</span>' : ""}</p>
      <p class="muted">${esc(fmtDate(tasting.date, tasting.time))}</p>
      ${tasting.description ? `<p>${esc(tasting.description).replace(/\n/g, "<br>")}</p>` : ""}

      <div class="card">
        <div class="row between">
          <div><strong>Deltagere (${parts.length})</strong><br>
            <span class="small">${parts.map((u) => `<span class="row" style="display:inline-flex;gap:4px;margin-right:8px">${avatarHtml(u, "small")}${esc(nameOf(u))}</span>`).join("") || "<span class='muted'>Ingen endnu</span>"}</span></div>
          ${canJoin ? `<button id="join" class="${joined ? "secondary" : ""}">${joined ? "Meld fra" : "Tilmeld mig"}</button>` : ""}
        </div>
      </div>

      <h2>Romme (${rums.length})</h2>
      ${rums.length === 0 ? `<p class="muted">Administrator har ikke lagt romme ind endnu.</p>` : ""}
      ${rows.map((x) => `
        <div class="card link" data-rum="${x.r.id}">
          <div class="row between">
            <div><strong>${x.label}</strong><br>
              <span class="small muted">${x.rs.length} af ${parts.length} har bedømt${x.r.status === "lukket" ? " · frigivet" : ""}</span></div>
            <div>${x.mine ? `<span class="badge ok">Din score: ${esc(x.mine.scores?.samlet)}</span>` : (joined && x.r.status === "aaben" ? '<span class="badge warn">Bedøm</span>' : '<span class="badge muted">Se</span>')}</div>
          </div>
        </div>`).join("")}

      ${ranked.length ? `
        <h2>Rangliste</h2>
        <div class="card">
          <table><thead><tr><th>#</th><th>Rom</th><th class="num">Vægtet score</th><th class="num">Smagernes egen samlet</th></tr></thead>
          <tbody>${ranked.map((x, i) => `<tr><td>${i + 1}</td><td>${x.label}</td><td class="num"><strong>${fmt1(x.avg)}</strong></td><td class="num">${fmt1(x.avgOwn)}</td></tr>`).join("")}</tbody></table>
          <p class="muted small">Rangeret efter vægtet score. ${WEIGHTS_TEXT} "Smagernes egen samlet" er gennemsnittet af deltagernes egen samlede vurdering.</p>
          ${rows.some((x) => !x.complete) ? `<p class="muted small">Romme, hvor ikke alle har bedømt endnu, vises først når alle er færdige – eller når værten frigiver rommen.</p>` : ""}
        </div>` : ""}`;

    $t.querySelectorAll("[data-rum]").forEach((el) => (el.onclick = () => go(`#/smagning/${tId}/rom/${el.dataset.rum}`)));
    const $join = document.getElementById("join");
    if ($join) $join.onclick = async () => {
      try {
        await updateDoc(doc(db, "tastings", tId), { participantIds: joined ? arrayRemove(user.uid) : arrayUnion(user.uid) });
      } catch (e) { showError(e); }
    };
  }
}

// ---------- Rom: bedømmelse, afsløring, samlet vurdering ----------
function viewRum(tId, rId) {
  let tasting = null, rum = null, ratings = [], priv = null, privTried = false, formDrawn = false, editing = false;
  $app.innerHTML = `
    <p><a href="#/smagning/${tId}">← Tilbage til smagningen</a></p>
    <div id="error" class="error" hidden></div>
    <div id="head"></div>
    <div id="form"></div>
    <div id="reveal"></div>
    <div id="agg"></div>`;

  listen(onSnapshot(doc(db, "tastings", tId), (s) => { if (s.exists()) { tasting = { id: s.id, ...s.data() }; drawAll(); } }, showError));
  listen(onSnapshot(doc(db, "tastings", tId, "rums", rId), (s) => {
    if (!s.exists()) { $app.innerHTML = `<p class="error">Rommen findes ikke.</p>`; return; }
    rum = { id: s.id, ...s.data() }; drawAll();
  }, showError));
  listen(onSnapshot(query(collection(db, "tastings", tId, "ratings"), where("rumId", "==", rId)), (s) => {
    ratings = s.docs.map((d) => ({ id: d.id, ...d.data() })); drawAll();
  }, showError));

  const mine = () => ratings.find((x) => x.uid === user.uid);
  const parts = () => tasting?.participantIds || [];
  const allRated = () => parts().length > 0 && parts().every((u) => (rum?.ratedBy || []).includes(u));
  const released = () => tasting?.status === "afsluttet" || rum?.status === "lukket" || allRated();
  const mayReveal = () => isAdmin() || released();

  async function loadPrivate() {
    if (priv || privTried || !mayReveal()) return;
    privTried = true;
    try {
      const p = await getDoc(doc(db, "tastings", tId, "rums", rId, "private", "info"));
      priv = p.exists() ? p.data() : {};
      drawReveal(); drawForm(); drawAgg(); // gæt-markeringer og afsløring afhænger af priv
    } catch (e) {
      // Typisk: egen bedømmelse er endnu ikke bekræftet af serveren – prøv igen om lidt
      privTried = false;
      console.warn("afsløring endnu ikke læsbar, prøver igen", e?.code || e);
      setTimeout(loadPrivate, 1500);
    }
  }

  function drawAll() {
    if (!tasting || !rum) return;
    drawHead(); drawForm(); drawReveal(); drawAgg(); loadPrivate();
  }

  function drawHead() {
    document.getElementById("head").innerHTML = `
      <h1>${esc(rum.publicName)}</h1>
      <p class="muted">${esc(tasting.title)} · ${rum.status === "lukket" ? "Rommen er lukket for bedømmelse" : "Åben for bedømmelse"}</p>
      ${isAdmin() ? `<p><button id="toggle" class="small secondary">${rum.status === "lukket" ? "Genåbn rommen (skjul igen)" : "Frigiv afsløring og samlet vurdering (luk rommen)"}</button></p>` : ""}`;
    const $t = document.getElementById("toggle");
    if ($t) $t.onclick = async () => {
      try { await updateDoc(doc(db, "tastings", tId, "rums", rId), { status: rum.status === "lukket" ? "aaben" : "lukket" }); } catch (e) { showError(e); }
    };
  }

  function drawForm() {
    const $f = document.getElementById("form");
    const parts = tasting.participantIds || [];
    const m = mine();
    const canEdit = !!m && rum.status === "aaben" && tasting.status !== "afsluttet";
    if (m && !editing) {
      formDrawn = false;
      $f.innerHTML = `
        <div class="card">
          <h2 style="margin-top:0">Din bedømmelse</h2>
          <table><tbody>
            ${DIMS.map((d) => `<tr><td>${d.label}${d.key === "samlet" ? ' <span class="muted small">(din egen rettesnor)</span>' : ""}</td><td class="num"><strong>${esc(m.scores?.[d.key])}</strong></td></tr>`).join("")}
            <tr><td><strong>Din vægtede score</strong> <span class="muted small">(tæller i den fælles)</span></td><td class="num"><strong>${fmt1(weighted(m.scores))}</strong></td></tr>
          </tbody></table>
          ${(m.tags || []).length ? `<p class="small">Aromaer: ${m.tags.map(esc).join(", ")}</p>` : ""}
          ${guessParts(m.guess).length ? `<p class="small">Dit gæt: ${guessHtml(m.guess, priv)}</p>` : ""}
          ${m.comment ? `<p class="small">${esc(m.comment).replace(/\n/g, "<br>")}</p>` : ""}
          ${canEdit ? `<p><button type="button" id="edit-rating" class="small secondary">Redigér bedømmelse</button> <span class="muted small">Kan rettes, indtil værten frigiver rommen.</span></p>` : `<p class="muted small">Bedømmelsen er låst, fordi rommen er frigivet${tasting.status === "afsluttet" ? " og smagningen afsluttet" : ""}.</p>`}
        </div>`;
      const eb = document.getElementById("edit-rating");
      if (eb) eb.onclick = () => { editing = true; formDrawn = false; drawForm(); };
      return;
    }
    if (m && editing && !canEdit) { editing = false; return drawForm(); }
    if (!parts.includes(user.uid)) {
      $f.innerHTML = `<div class="notice">Du er ikke tilmeldt denne smagning. <a href="#/smagning/${tId}">Tilmeld dig her</a> for at kunne bedømme.</div>`;
      return;
    }
    if (rum.status === "lukket") {
      $f.innerHTML = `<div class="notice">Rommen er lukket for bedømmelse.</div>`;
      return;
    }
    if (formDrawn) return; // bevar det, brugeren er i gang med at skrive
    formDrawn = true;
    const init = m ? m.scores || {} : {};
    const sc = (k) => Number(init[k]) || 5;
    const g = (m && m.guess && typeof m.guess === "object") ? m.guess : {};
    $f.innerHTML = `
      <form id="rate" class="card">
        <h2 style="margin-top:0">${m ? "Redigér din bedømmelse" : "Din bedømmelse"}</h2>
        <p class="muted small">Giv 1–10 point pr. område. Bedømmelsen kan rettes, indtil værten frigiver rommen. Rommens identitet, administratorens noter og den samlede vurdering vises, når alle har bedømt – eller når værten frigiver dem.</p>
        <p class="small">Din vægtede score: <strong id="live-weighted">${fmt1(weighted({ udseende: sc("udseende"), naese: sc("naese"), smag: sc("smag"), eftersmag: sc("eftersmag") }))}</strong> <span class="muted">(${WEIGHTS_TEXT})</span></p>
        ${DIMS.map((d) => `
          <label>${d.label} <span class="hint">${d.hint}</span>
            <div class="score-row"><input type="range" name="${d.key}" min="1" max="10" step="1" value="${sc(d.key)}" oninput="this.nextElementSibling.value=this.value"><output>${sc(d.key)}</output></div>
          </label>`).join("")}
        <label>Aromaer og smagsnoter <span class="hint">(vælg dem, du finder)</span></label>
        <div class="tags">${optionsFor("aromaer").map((t) => { const on = (m?.tags || []).includes(t); return `<label class="${on ? "on" : ""}"><input type="checkbox" name="tags" value="${esc(t)}" ${on ? "checked" : ""}>${esc(t)}</label>`; }).join("")}</div>
        ${tasting.blind ? `
        <label>Dit gæt <span class="hint">(valgfrit – afsløres sammen med rommen)</span></label>
        <div class="grid3">
          <label class="sub">Land<input type="text" name="guessCountry" value="${esc(g.country)}" placeholder="Fx Jamaica"></label>
          <label class="sub">Alkohol %<input type="text" name="guessAbv" value="${esc(g.abv)}" inputmode="decimal" placeholder="Fx 43"></label>
          <label class="sub">Navn / destilleri<input type="text" name="guessName" value="${esc(g.name)}" placeholder="Fx Appleton"></label>
        </div>` : ""}
        <label>Kommentar <span class="hint">(valgfri)</span><textarea name="comment">${esc(m?.comment)}</textarea></label>
        <p><button type="submit">${m ? "Gem ændringer" : "Gem bedømmelse"}</button>${m ? ` <button type="button" id="cancel-edit" class="secondary">Fortryd</button>` : ""}</p>
      </form>`;
    const ce = document.getElementById("cancel-edit");
    if (ce) ce.onclick = () => { editing = false; formDrawn = false; drawForm(); };
    $f.querySelectorAll(".tags input").forEach((cb) => (cb.onchange = () => cb.parentElement.classList.toggle("on", cb.checked)));
    const rateForm = document.getElementById("rate");
    rateForm.addEventListener("input", () => {
      const sc = {}; Object.keys(WEIGHTS).forEach((k) => (sc[k] = Number(rateForm[k].value)));
      document.getElementById("live-weighted").textContent = fmt1(weighted(sc));
    });
    document.getElementById("rate").onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true;
      const scores = {};
      DIMS.forEach((d) => (scores[d.key] = Number(f[d.key].value)));
      const tags = [...f.querySelectorAll(".tags input:checked")].map((c) => c.value);
      try {
        const wasEdit = !!mine();
        await setDoc(doc(db, "tastings", tId, "ratings", `${rId}_${user.uid}`), {
          uid: user.uid, rumId: rId, scores, tags,
          guess: f.guessCountry ? { country: f.guessCountry.value.trim(), abv: f.guessAbv.value.trim(), name: f.guessName.value.trim() } : null,
          comment: f.comment.value.trim(),
          createdAt: wasEdit ? (mine().createdAt || serverTimestamp()) : serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        editing = false; formDrawn = false;
        // Markér at man har bedømt (bruges af reglerne til at afgøre, om alle er færdige)
        await updateDoc(doc(db, "tastings", tId, "rums", rId), { ratedBy: arrayUnion(user.uid) });
        toast(wasEdit ? "Din bedømmelse er opdateret" : "Din bedømmelse er gemt");
      } catch (e) { btn.disabled = false; showError(e); }
    };
  }

  function drawReveal() {
    const $r = document.getElementById("reveal");
    if (!$r) return;
    if (!mayReveal()) {
      const missing = parts().filter((u) => !(rum.ratedBy || []).includes(u)).map((u) => esc(nameOf(u)));
      $r.innerHTML = mine()
        ? `<div class="notice">Din bedømmelse er gemt. Afsløringen og den samlede vurdering vises, når alle har bedømt${missing.length ? ` (mangler: ${missing.join(", ")})` : ""} – eller når værten frigiver rommen.</div>`
        : `<p class="muted small">Rommens identitet, administratorens noter og den samlede vurdering vises, når alle har bedømt – eller når værten frigiver rommen.</p>`;
      return;
    }
    if (!priv) { $r.innerHTML = `<p class="muted small">Henter afsløring…</p>`; return; }
    const facts = [
      ["Destilleri", priv.distillery], ["Land", priv.country], ["Alder", priv.age], ["Alkohol", priv.abv ? priv.abv + " %" : ""],
      ["Type", priv.type], ["Fad", priv.cask], ["Pris", priv.price],
    ].filter(([, v]) => v);
    $r.innerHTML = `
      <div class="reveal">
        <h2 style="margin-top:0">Afsløring: ${esc(priv.name || rum.publicName)}</h2>
        ${priv.imageData ? `<p><img class="rumimg" src="${priv.imageData}" alt="${esc(priv.name)}"></p>` : ""}
        ${facts.length ? `<table><tbody>${facts.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>` : ""}
        ${profileHtml(priv.profile) ? `<h3>Administratorens smagsprofil</h3><table><tbody>${profileHtml(priv.profile)}</tbody></table>` : ""}
        ${priv.adminNotes ? `<h3>Administratorens noter</h3><pre class="info">${esc(priv.adminNotes)}</pre>` : (profileHtml(priv.profile) ? "" : `<p class="muted small">Administratoren har ikke skrevet noter til denne rom.</p>`)}
        ${priv.webInfo ? `<details><summary>Fra nettet</summary><pre class="info">${esc(priv.webInfo)}</pre></details>` : ""}
      </div>`;
  }

  function drawAgg() {
    const $a = document.getElementById("agg");
    const n = ratings.length;
    if (!released() && !isAdmin()) {
      $a.innerHTML = `<div class="card"><h2 style="margin-top:0">Samlet vurdering</h2>
        <p>${n} af ${parts().length} har bedømt. Den samlede vurdering vises, når alle er færdige – eller når værten frigiver rommen.</p>
        <p class="small muted">Mangler: ${parts().filter((u) => !ratings.some((r) => r.uid === u)).map((u) => esc(nameOf(u))).join(", ") || "ingen"}</p></div>`;
      return;
    }
    if (isAdmin() && !released()) {
      $a.innerHTML = `<div class="card"><h2 style="margin-top:0">Samlet vurdering (foreløbig – kun du kan se den)</h2>
        <p>${n} af ${parts().length} har bedømt. Deltagerne ser den, når alle er færdige, eller når du frigiver rommen.</p>
        <p class="small muted">Mangler: ${parts().filter((u) => !ratings.some((r) => r.uid === u)).map((u) => esc(nameOf(u))).join(", ") || "ingen"}</p>
        <div id="agg-admin"></div></div>`;
      if (!n) return;
      // fortsæt og tegn den foreløbige tabel for admin nedenfor
    }
    if (!n) { $a.innerHTML = `<div class="card"><h2 style="margin-top:0">Samlet vurdering</h2><p class="muted">Ingen bedømmelser.</p></div>`; return; }
    if (!n) { $a.innerHTML = `<div class="card"><h2 style="margin-top:0">Samlet vurdering</h2><p class="muted">Ingen bedømmelser.</p></div>`; return; }
    const avg = {};
    DIMS.forEach((d) => (avg[d.key] = ratings.reduce((s, r) => s + (Number(r.scores?.[d.key]) || 0), 0) / n));
    const perPerson = ratings.map((r) => weighted(r.scores));
    const total = avgWeighted(ratings);
    const tagCount = {};
    ratings.forEach((r) => (r.tags || []).forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1)));
    const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const sorted = [...ratings].sort((a, b) => weighted(b.scores) - weighted(a.scores));
    const target = document.getElementById("agg-admin") || $a;
    target.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0">Samlet vurdering</h2>
        <p class="big">${fmt1(total)} <span class="small muted" style="font-weight:400">/ 10 vægtet (${n} bedømmelser, laveste ${fmt1(Math.min(...perPerson))}, højeste ${fmt1(Math.max(...perPerson))})</span></p>
        <table><tbody>${DIMS.filter((d) => d.key !== "samlet").map((d) => `<tr><td>${d.label} <span class="muted small">${Math.round(WEIGHTS[d.key] * 100)} %</span></td><td class="num"><strong>${fmt1(avg[d.key])}</strong></td></tr>`).join("")}</tbody></table>
        <p class="muted small">${WEIGHTS_TEXT}</p>
        ${topTags.length ? `<p class="small">Mest fundne aromaer: ${topTags.map(([t, c]) => `${esc(t)} (${c})`).join(", ")}</p>` : ""}
        <h3>Deltagernes bedømmelser</h3>
        <table><thead><tr><th>Deltager</th>${DIMS.filter((d) => d.key !== "samlet").map((d) => `<th class="num">${d.label.split(" ")[0]}</th>`).join("")}<th class="num">Vægtet</th><th class="num muted">Egen</th>${isAdmin() ? "<th></th>" : ""}</tr></thead>
        <tbody>${sorted.map((r) => `<tr><td><span class="row" style="display:inline-flex;gap:6px">${avatarHtml(r.uid, "small")}${esc(nameOf(r.uid))}</span>${guessParts(r.guess).length ? `<br><span class="muted small">Gæt – ${guessHtml(r.guess, priv)}</span>` : ""}${r.comment ? `<br><span class="small">${esc(r.comment)}</span>` : ""}</td>
          ${DIMS.filter((d) => d.key !== "samlet").map((d) => `<td class="num">${esc(r.scores?.[d.key])}</td>`).join("")}
          <td class="num"><strong>${fmt1(weighted(r.scores))}</strong></td><td class="num muted">${esc(r.scores?.samlet)}</td>
          ${isAdmin() ? `<td><button class="small danger" data-del="${r.id}" title="Slet bedømmelsen, så deltageren kan bedømme igen">Slet</button></td>` : ""}</tr>`).join("")}</tbody></table>
      </div>`;
    $a.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm("Slet denne bedømmelse? Deltageren kan så bedømme igen.")) return;
      try {
        const uid = b.dataset.del.split("_").pop();
        await deleteDoc(doc(db, "tastings", tId, "ratings", b.dataset.del));
        await updateDoc(doc(db, "tastings", tId, "rums", rId), { ratedBy: arrayRemove(uid) });
      } catch (e) { showError(e); }
    }));
  }
}

// ---------- Admin: redigér smagning og romme ----------
function viewAdminTasting(tId) {
  $app.innerHTML = `<p><a href="#/smagning/${tId}">← Til smagningen</a></p><div id="error" class="error" hidden></div><div id="a"><p class="muted">Indlæser…</p></div>`;
  load();

  async function load() {
    try {
      const ts = await getDoc(doc(db, "tastings", tId));
      if (!ts.exists()) { $app.innerHTML = `<p class="error">Smagningen findes ikke.</p>`; return; }
      const tasting = { id: ts.id, ...ts.data() };
      const rs = await getDocs(query(collection(db, "tastings", tId, "rums"), orderBy("order")));
      const rums = [];
      for (const d of rs.docs) {
        const p = await getDoc(doc(db, "tastings", tId, "rums", d.id, "private", "info"));
        rums.push({ id: d.id, ...d.data(), priv: p.exists() ? p.data() : {} });
      }
      const library = await loadLibrary();
      const planSnap = await getDoc(doc(db, "tastings", tId, "private", "plan"));
      draw(tasting, rums, library, planSnap.exists() ? planSnap.data() : null);
    } catch (e) { showError(e); }
  }

  function draw(tasting, rums, library, plan) {
    const $a = document.getElementById("a");
    if (!$a) return;
    $a.innerHTML = `
      <h1>Redigér smagning</h1>
      <form id="tform" class="card">
        <label>Titel<input type="text" name="title" value="${esc(tasting.title)}" required></label>
        <div class="grid2">
          <label>Dato<input type="date" name="date" value="${esc(tasting.date)}" required></label>
          <label>Tidspunkt<input type="time" name="time" value="${esc(tasting.time || "")}"></label>
        </div>
        <label>Beskrivelse <span class="hint">(sted, tema, medbring…)</span><textarea name="description">${esc(tasting.description)}</textarea></label>
        <label>Status<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${tasting.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label><input type="checkbox" name="blind" ${tasting.blind ? "checked" : ""}> Blindsmagning <span class="hint">(rommene vises som "Rom nr. 1, 2, …" indtil deltageren har bedømt)</span></label>
        <p class="muted small">Afsluttet: ingen kan længere tilmelde sig, og alle kan se afsløringen for alle romme.</p>
        <p><button type="submit">Gem smagning</button> <button type="button" id="delt" class="danger">Slet smagning</button></p>
      </form>

      <h2>Værtens plan</h2>
      <div class="card" id="plan">
        <p class="small muted">Lad AI foreslå den rækkefølge, rommene bør smages i, og skrive en lille historie, du kan fortælle inden hver rom${tasting.blind ? " – uden at afsløre rommen, da smagningen er blind" : ""}.</p>
        <p class="row">
          <button type="button" id="genplan" ${rums.length < 2 ? "disabled" : ""}>Foreslå rækkefølge og historier</button>
          ${plan ? `<a class="btn secondary" href="#/admin/smagning/${tId}/manuskript">Åbn manuskript</a><button type="button" id="applyorder" class="secondary">Anvend rækkefølgen</button>` : ""}
        </p>
        ${rums.length < 2 ? `<p class="small muted">Tilføj mindst to romme først.</p>` : ""}
        ${plan ? planHtml(plan, rums) : ""}
      </div>

      <h2>Romme (${rums.length})</h2>
      <div class="card">
        <div class="row">
          <select id="libpick" style="flex:1;min-width:200px;margin:0">
            <option value="">– vælg rom fra biblioteket –</option>
            ${library.map((l) => `<option value="${l.id}">${esc(l.name || "(uden navn)")}${l.distillery ? " – " + esc(l.distillery) : ""}</option>`).join("")}
          </select>
          <button id="addlib" type="button">Tilføj fra biblioteket</button>
          <button id="addrum" type="button" class="secondary">+ Opret ny rom</button>
        </div>
        <p class="muted small">Alle romme gemmes i <a href="#/bibliotek">rombiblioteket</a> med billede, noter og resultater fra tidligere smagninger.</p>
      </div>
      ${rums.map((r) => `
        <form class="card rumform" data-id="${r.id}">
          <div class="row between">
            <strong>${esc(r.publicName)}</strong>
            <span class="badge ${r.status === "lukket" ? "muted" : "ok"}">${r.status === "lukket" ? "Frigivet" : "Åben for bedømmelse"}</span>
          </div>
          <div class="grid2">
            <label>Rækkefølge<input type="number" name="order" value="${esc(r.order)}" min="1" required></label>
            <label>Status<select name="status"><option value="aaben" ${r.status !== "lukket" ? "selected" : ""}>Åben for bedømmelse</option><option value="lukket" ${r.status === "lukket" ? "selected" : ""}>Frigivet (afsløring og samlet vurdering vises)</option></select></label>
          </div>
          ${rumFieldsHtml(r.priv)}
          ${r.libraryId ? `<p class="small"><a href="#/bibliotek/${r.libraryId}">Se rommen i biblioteket (tidligere smagninger)</a></p>` : ""}
          <p class="row">
            <button type="submit">Gem rom</button>
            ${rumToolsHtml()}
            <button type="button" class="danger delrum">Fjern fra smagningen</button>
          </p>
        </form>`).join("")}`;

    document.getElementById("genplan").onclick = async (ev) => {
      const btn = ev.target;
      btn.disabled = true; btn.textContent = "Tænker… (kan tage et halvt minut)";
      try {
        const result = await generatePlan(tasting, rums);
        await setDoc(doc(db, "tastings", tId, "private", "plan"), result);
        toast("Forslaget er klar");
        load();
      } catch (e) { showError(e); btn.disabled = false; btn.textContent = "Foreslå rækkefølge og historier"; }
    };
    const $apply = document.getElementById("applyorder");
    if ($apply) $apply.onclick = async () => {
      try {
        let n = 0;
        for (const item of plan.order) {
          const r = rums.find((x) => x.id === item.rumId);
          if (!r) continue;
          n += 1;
          await updateDoc(doc(db, "tastings", tId, "rums", r.id), { order: n, publicName: publicNameFor(tasting.blind, n, r.priv.name) });
        }
        toast("Rækkefølgen er anvendt");
        load();
      } catch (e) { showError(e); }
    };
    document.getElementById("tform").onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const blind = f.blind.checked;
      try {
        await updateDoc(doc(db, "tastings", tId), {
          title: f.title.value.trim(), date: f.date.value, time: f.time.value,
          description: f.description.value.trim(), status: f.status.value, blind,
        });
        // publicName afhænger af blind-flaget – opdatér alle romme
        for (const r of rums) {
          await updateDoc(doc(db, "tastings", tId, "rums", r.id), { publicName: publicNameFor(blind, r.order, r.priv.name) });
        }
        toast("Smagningen er gemt");
        load();
      } catch (e) { showError(e); }
    };
    document.getElementById("delt").onclick = async () => {
      if (!confirm("Slet hele smagningen med romme og bedømmelser?")) return;
      try {
        for (const r of rums) await deleteRum(r.id);
        const rs = await getDocs(collection(db, "tastings", tId, "ratings"));
        for (const d of rs.docs) await deleteDoc(d.ref);
        await deleteDoc(doc(db, "tastings", tId));
        go("#/");
      } catch (e) { showError(e); }
    };
    async function addRumToTasting(libraryId, priv) {
      const order = rums.length + 1;
      const ref = await addDoc(collection(db, "tastings", tId, "rums"), {
        order, status: "aaben", publicName: publicNameFor(tasting.blind, order, priv.name), libraryId, createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, "tastings", tId, "rums", ref.id, "private", "info"), priv);
    }
    document.getElementById("addrum").onclick = async () => {
      try {
        const priv = emptyPriv();
        const libraryId = await saveLibraryRum(null, priv, "");
        await addRumToTasting(libraryId, priv);
        toast("Ny rom tilføjet nederst");
        load();
      } catch (e) { showError(e); }
    };
    document.getElementById("addlib").onclick = async () => {
      const libraryId = document.getElementById("libpick").value;
      if (!libraryId) return showError({ message: "Vælg først en rom i listen." });
      if (rums.some((r) => r.libraryId === libraryId) && !confirm("Rommen er allerede med i smagningen. Tilføj den igen?")) return;
      try {
        const { info, imageData } = await loadLibraryRum(libraryId);
        await addRumToTasting(libraryId, { ...info, imageData });
        toast(`${info.name || "Rommen"} er tilføjet til smagningen`);
        load();
      } catch (e) { showError(e); }
    };
    $a.querySelectorAll(".rumform").forEach((f) => {
      const id = f.dataset.id;
      const rum = rums.find((r) => r.id === id);
      bindRumForm(f);
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        try { await saveRum(id, rum.libraryId, f, tasting.blind); toast("Rommen er gemt"); load(); } catch (e) { showError(e); }
      };
      f.querySelector(".delrum").onclick = async () => {
        if (!confirm("Fjern rommen fra smagningen og slet dens bedømmelser? (Den bliver i biblioteket.)")) return;
        try {
          await deleteRum(id);
          const rs = await getDocs(query(collection(db, "tastings", tId, "ratings"), where("rumId", "==", id)));
          for (const d of rs.docs) await deleteDoc(d.ref);
          load();
        } catch (e) { showError(e); }
      };
    });
  }

  // Gemmer rommen både i smagningen (kopi til afsløringen) og i biblioteket (master)
  async function saveRum(id, libraryId, f, blind) {
    const order = Number(f.order.value) || 1;
    const info = readRumFields(f);
    const imageData = f.imageData.value;
    await updateDoc(doc(db, "tastings", tId, "rums", id), { order, status: f.status.value, publicName: publicNameFor(blind, order, info.name) });
    await setDoc(doc(db, "tastings", tId, "rums", id, "private", "info"), { ...info, imageData });
    if (libraryId) await saveLibraryRum(libraryId, info, imageData);
  }
  async function deleteRum(id) {
    await deleteDoc(doc(db, "tastings", tId, "rums", id, "private", "info"));
    await deleteDoc(doc(db, "tastings", tId, "rums", id));
  }
}

// ---------- Fælles romfelter (bruges i smagning og bibliotek) ----------
function rumFieldsHtml(p) {
  return `
    <div class="grid2">
      <label>Navn på rommen<input type="text" name="name" value="${esc(p.name)}" placeholder="Fx Appleton Estate 12"></label>
      <label>Destilleri / producent<input type="text" name="distillery" value="${esc(p.distillery)}"></label>
      <label>Land<input type="text" name="country" value="${esc(p.country)}"></label>
      <label>Alder / årgang<input type="text" name="age" value="${esc(p.age)}" placeholder="Fx 12 år, NAS, 2009"></label>
      <label>Alkohol %<input type="text" name="abv" value="${esc(p.abv)}" placeholder="Fx 43"></label>
      <label>Type<select name="type"><option value="">–</option>${RUM_TYPES.map((t) => `<option ${p.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Fad / lagring<input type="text" name="cask" value="${esc(p.cask)}" placeholder="Fx ex-bourbon, sherry finish"></label>
      <label>Pris<input type="text" name="price" value="${esc(p.price)}" placeholder="Fx 450 kr."></label>
    </div>
    <label>Billede <span class="hint">(fx flasken – vises ved afsløringen; skaleres ned automatisk)</span></label>
    <div class="imgbox">
      <img class="rumimg preview" src="${p.imageData || ""}" alt="" ${p.imageData ? "" : "hidden"}>
      <input type="hidden" name="imageData" value="${p.imageData || ""}">
      <div class="row"><input type="file" accept="image/*" class="imgfile" style="margin:0"><button type="button" class="small secondary imgclear" ${p.imageData ? "" : "hidden"}>Fjern billede</button></div>
    </div>
    ${PROFILE_GROUPS.map((g) => {
      const chosen = p.profile?.[g.key] || [];
      const opts = optionsFor(g.key).concat(chosen.filter((o) => !optionsFor(g.key).includes(o)));
      return `
      <label>${g.label} <span class="hint">(${g.hint} – kryds af)</span></label>
      <div class="tags" data-group="${g.key}">${opts.map((o) => tagLabelHtml(g.key, o, chosen.includes(o))).join("")}</div>
      <div class="row addword"><input type="text" class="addword-input" data-group="${g.key}" placeholder="Tilføj eget ord til listen…" style="flex:1;margin:0"><button type="button" class="small secondary addword-btn" data-group="${g.key}">Tilføj</button></div>`;
    }).join("")}
    <label>Dine noter om rommen <span class="hint">(supplerende fritekst – afsløres for deltageren efter egen bedømmelse)</span><textarea name="adminNotes">${esc(p.adminNotes)}</textarea></label>
    <label>Info fra nettet <span class="hint">(hentes fra Wikipedia – ret gerne til)</span><textarea name="webInfo">${esc(p.webInfo)}</textarea></label>`;
}
const tagLabelHtml = (key, o, on) => `<label class="${on ? "on" : ""}"><input type="checkbox" name="${key}" value="${esc(o)}" ${on ? "checked" : ""}>${esc(o)}</label>`;
const rumToolsHtml = () => `
    <button type="button" class="secondary fetchweb">Hent info fra nettet</button>
    <a class="btn secondary" target="_blank" rel="noopener" data-search="google">Google</a>
    <a class="btn secondary" target="_blank" rel="noopener" data-search="rumratings">RumRatings</a>
    <a class="btn secondary" target="_blank" rel="noopener" data-search="rumx">Rum-X</a>`;

function readRumFields(f) {
  return {
    name: f.name.value.trim(), distillery: f.distillery.value.trim(), country: f.country.value.trim(),
    age: f.age.value.trim(), abv: f.abv.value.trim(), type: f.type.value, cask: f.cask.value.trim(),
    price: f.price.value.trim(), adminNotes: f.adminNotes.value.trim(), webInfo: f.webInfo.value.trim(),
    profile: Object.fromEntries(PROFILE_GROUPS.map((g) => [g.key, [...f.querySelectorAll(`input[name=${g.key}]:checked`)].map((c) => c.value)])),
  };
}
const profileHtml = (profile) => PROFILE_GROUPS
  .filter((g) => (profile?.[g.key] || []).length)
  .map((g) => `<tr><th>${g.label}</th><td>${profile[g.key].map(esc).join(", ")}</td></tr>`).join("");

// Binder søgelinks, "hent info" og billedvalg på en romformular
function bindRumForm(f) {
  const q = () => [f.name.value, f.distillery.value].filter(Boolean).join(" ");
  const links = {
    google: () => `https://www.google.com/search?q=${encodeURIComponent(q() + " rum")}`,
    rumratings: () => `https://www.rumratings.com/search?q=${encodeURIComponent(q())}`,
    rumx: () => `https://www.rum-x.com/search?q=${encodeURIComponent(q())}`,
  };
  f.querySelectorAll("[data-search]").forEach((a) => (a.onclick = () => { a.href = links[a.dataset.search](); }));
  const bindToggle = (cb) => (cb.onchange = () => cb.parentElement.classList.toggle("on", cb.checked));
  f.querySelectorAll(".tags input").forEach(bindToggle);
  // Egne ord: gemmes i settings/profileOptions og krydses af med det samme
  f.querySelectorAll(".addword-btn").forEach((btn) => {
    const key = btn.dataset.group;
    const input = f.querySelector(`.addword-input[data-group=${key}]`);
    input.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); btn.click(); } };
    btn.onclick = async () => {
      const word = input.value.trim();
      if (!word) return;
      const box = f.querySelector(`.tags[data-group=${key}]`);
      const existing = [...box.querySelectorAll("input")].find((c) => c.value.toLowerCase() === word.toLowerCase());
      if (existing) { existing.checked = true; existing.parentElement.classList.add("on"); input.value = ""; return; }
      try {
        await setDoc(doc(db, "settings", "profileOptions"), { [key]: arrayUnion(word) }, { merge: true });
        box.insertAdjacentHTML("beforeend", tagLabelHtml(key, word, true));
        bindToggle(box.lastElementChild.querySelector("input"));
        input.value = "";
      } catch (e) { showError(e); }
    };
  });
  const fw = f.querySelector(".fetchweb");
  if (fw) fw.onclick = async () => {
    if (!f.name.value.trim()) return showError({ message: "Skriv rommens navn først." });
    fw.disabled = true; fw.textContent = "Henter…";
    try {
      const text = await fetchWebInfo(q());
      f.webInfo.value = (f.webInfo.value ? f.webInfo.value + "\n\n" : "") + text;
    } catch (e) { showError(e); }
    fw.disabled = false; fw.textContent = "Hent info fra nettet";
  };
  const img = f.querySelector(".preview"), clear = f.querySelector(".imgclear"), file = f.querySelector(".imgfile");
  const setImage = (data) => { f.imageData.value = data; img.src = data || ""; img.hidden = !data; clear.hidden = !data; };
  file.onchange = async () => {
    const fil = file.files[0];
    if (!fil) return;
    try { setImage(await resizeImage(fil)); } catch (e) { showError({ message: "Billedet kunne ikke læses: " + (e.message || e) }); }
  };
  clear.onclick = () => { setImage(""); file.value = ""; };
}

// Skalerer et billede ned til max 800 px og returnerer en JPEG data-URL (holder Firestore-dokumentet lille)
function resizeImage(file, max = 800, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const scale = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement("canvas");
      c.width = Math.round(im.width * scale); c.height = Math.round(im.height * scale);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const data = c.toDataURL("image/jpeg", quality);
      if (data.length > 700000) reject(new Error("Billedet er for stort selv efter nedskalering."));
      else resolve(data);
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("ukendt billedformat")); };
    im.src = url;
  });
}

// ---------- Rombibliotek (kun admin): master-data for hver rom + billede ----------
async function loadLibrary() {
  const s = await getDocs(query(collection(db, "rumLibrary"), orderBy("name")));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function loadLibraryRum(id) {
  const [i, m] = await Promise.all([getDoc(doc(db, "rumLibrary", id)), getDoc(doc(db, "rumLibrary", id, "media", "image"))]);
  return { info: i.exists() ? { ...emptyPriv(), ...i.data() } : emptyPriv(), imageData: m.exists() ? m.data().data || "" : "" };
}
async function saveLibraryRum(id, info, imageData) {
  const ref = id ? doc(db, "rumLibrary", id) : doc(collection(db, "rumLibrary"));
  await setDoc(ref, { ...info, updatedAt: serverTimestamp() }, { merge: true });
  await setDoc(doc(db, "rumLibrary", ref.id, "media", "image"), { data: imageData || "" });
  return ref.id;
}

function viewLibrary() {
  $app.innerHTML = `
    <div class="row between"><h1>Rombibliotek</h1><button id="newlib">+ Ny rom</button></div>
    <p class="muted">Alle romme, der har været – eller skal – med i en smagning. Klik på en rom for at se og rette oplysninger og se resultater fra tidligere smagninger.</p>
    <div id="error" class="error" hidden></div>
    <div id="list"><p class="muted">Indlæser…</p></div>
    <h2>Egne ord i listerne</h2>
    <div class="card" id="words"></div>`;
  const drawWords = () => {
    const $w = document.getElementById("words");
    if (!$w) return;
    const any = PROFILE_GROUPS.some((g) => (extraOptions[g.key] || []).length);
    $w.innerHTML = `<p class="muted small">Ord, du selv har tilføjet i romformularen. De faste ord kan ikke fjernes. Fjernes et ord, bliver det stående på de romme, der allerede har det.</p>` +
      (any ? PROFILE_GROUPS.map((g) => (extraOptions[g.key] || []).length ? `<p><strong>${g.label}:</strong></p><div class="tags">${extraOptions[g.key].map((o) => `<label class="on" title="Klik for at fjerne">${esc(o)} ✕<input type="checkbox" data-remove="${g.key}" value="${esc(o)}"></label>`).join("")}</div>` : "").join("")
          : `<p class="muted">Ingen egne ord endnu. Skriv et ord i "Tilføj eget ord" under en liste i romformularen.</p>`);
    $w.querySelectorAll("[data-remove]").forEach((cb) => (cb.onchange = async () => {
      if (!confirm(`Fjern "${cb.value}" fra listen?`)) { cb.checked = false; return; }
      try { await updateDoc(doc(db, "settings", "profileOptions"), { [cb.dataset.remove]: arrayRemove(cb.value) }); } catch (e) { showError(e); }
    }));
  };
  drawWords();
  listen(onSnapshot(doc(db, "settings", "profileOptions"), () => setTimeout(drawWords, 0)));
  document.getElementById("newlib").onclick = async () => {
    try { go(`#/bibliotek/${await saveLibraryRum(null, emptyPriv(), "")}`); } catch (e) { showError(e); }
  };
  loadLibrary().then((rums) => {
    const $l = document.getElementById("list");
    if (!$l) return;
    if (!rums.length) { $l.innerHTML = `<p class="muted">Biblioteket er tomt. Opret en rom her, eller fra en smagning.</p>`; return; }
    $l.innerHTML = rums.map((r) => `
      <div class="card link" data-id="${r.id}">
        <strong>${esc(r.name || "(uden navn)")}</strong>
        <span class="muted small">${[r.distillery, r.country, r.age, r.abv ? r.abv + " %" : ""].filter(Boolean).map(esc).join(" · ")}</span>
      </div>`).join("");
    $l.querySelectorAll("[data-id]").forEach((el) => (el.onclick = () => go(`#/bibliotek/${el.dataset.id}`)));
  }).catch(showError);
}

function viewLibraryRum(id) {
  $app.innerHTML = `<p><a href="#/bibliotek">← Til rombiblioteket</a></p><div id="error" class="error" hidden></div><div id="lib"><p class="muted">Indlæser…</p></div>`;
  (async () => {
    const { info, imageData } = await loadLibraryRum(id);
    const $l = document.getElementById("lib");
    if (!$l) return;
    $l.innerHTML = `
      <h1>${esc(info.name || "Ny rom")}</h1>
      <form id="libform" class="card">
        ${rumFieldsHtml({ ...info, imageData })}
        <p class="row"><button type="submit">Gem</button>${rumToolsHtml()}<button type="button" id="dellib" class="danger">Slet fra biblioteket</button></p>
      </form>
      <h2>Tidligere smagninger</h2>
      <div id="hist"><p class="muted">Henter…</p></div>`;
    const f = document.getElementById("libform");
    bindRumForm(f);
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      try { await saveLibraryRum(id, readRumFields(f), f.imageData.value); toast("Rommen er gemt i biblioteket"); go("#/bibliotek"); } catch (e) { showError(e); }
    };
    document.getElementById("dellib").onclick = async () => {
      if (!confirm("Slet rommen fra biblioteket? Smagninger, den har været med i, beholder deres kopi.")) return;
      try { await deleteDoc(doc(db, "rumLibrary", id, "media", "image")); await deleteDoc(doc(db, "rumLibrary", id)); go("#/bibliotek"); } catch (e) { showError(e); }
    };
    drawHistory(id, info);
  })().catch(showError);

  // Finder rommen i alle smagninger og samler bedømmelserne pr. smagning
  async function drawHistory(libraryId, info) {
    const ts = await getDocs(query(collection(db, "tastings"), orderBy("date", "desc")));
    const blocks = [];
    let all = [];
    for (const t of ts.docs) {
      const rs = await getDocs(query(collection(db, "tastings", t.id, "rums"), where("libraryId", "==", libraryId)));
      for (const r of rs.docs) {
        const rat = await getDocs(query(collection(db, "tastings", t.id, "ratings"), where("rumId", "==", r.id)));
        const ratings = rat.docs.map((d) => d.data());
        all = all.concat(ratings);
        blocks.push({ t: { id: t.id, ...t.data() }, rum: { id: r.id, ...r.data() }, ratings });
      }
    }
    const $h = document.getElementById("hist");
    if (!$h) return;
    if (!blocks.length) { $h.innerHTML = `<p class="muted">Rommen har ikke været med i en smagning endnu.</p>`; return; }
    const avgOf = (list, key) => list.length ? list.reduce((s, r) => s + (Number(r.scores?.[key]) || 0), 0) / list.length : 0;
    const tagsOf = (list) => { const c = {}; list.forEach((r) => (r.tags || []).forEach((t) => (c[t] = (c[t] || 0) + 1))); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8); };
    $h.innerHTML = `
      ${all.length ? `<div class="card"><strong>På tværs af ${blocks.length} smagning${blocks.length === 1 ? "" : "er"}</strong>
        <p class="big">${fmt1(avgWeighted(all))} <span class="small muted" style="font-weight:400">/ 10 vægtet (${all.length} bedømmelser)</span></p>
        <table><tbody>${DIMS.filter((d) => d.key !== "samlet").map((d) => `<tr><td>${d.label}</td><td class="num"><strong>${fmt1(avgOf(all, d.key))}</strong></td></tr>`).join("")}</tbody></table>
        ${tagsOf(all).length ? `<p class="small">Mest fundne aromaer: ${tagsOf(all).map(([t, c]) => `${esc(t)} (${c})`).join(", ")}</p>` : ""}</div>` : ""}
      ${blocks.map(({ t, rum, ratings }) => `
        <div class="card">
          <div class="row between"><a href="#/smagning/${t.id}/rom/${rum.id}"><strong>${esc(t.title)}</strong></a><span class="muted small">${esc(fmtDate(t.date, t.time))}</span></div>
          ${ratings.length ? `
            <p><strong>${fmt1(avgWeighted(ratings))}</strong> / 10 vægtet · ${ratings.length} bedømmelser · ${DIMS.filter((d) => d.key !== "samlet").map((d) => `${d.label.split(" ")[0]} ${fmt1(avgOf(ratings, d.key))}`).join(" · ")}</p>
            ${tagsOf(ratings).length ? `<p class="small">Aromaer: ${tagsOf(ratings).map(([tg, c]) => `${esc(tg)} (${c})`).join(", ")}</p>` : ""}
            <table><tbody>${ratings.map((r) => `<tr><td><span class="row" style="display:inline-flex;gap:6px">${avatarHtml(r.uid, "small")}${esc(nameOf(r.uid))}</span>${guessParts(r.guess).length ? ` <span class="muted small">(gæt – ${guessHtml(r.guess, info)})</span>` : ""}${r.comment ? `<br><span class="small">${esc(r.comment)}</span>` : ""}</td><td class="num"><strong>${fmt1(weighted(r.scores))}</strong> <span class="muted small">(egen: ${esc(r.scores?.samlet)})</span></td></tr>`).join("")}</tbody></table>`
          : `<p class="muted small">Ingen bedømmelser.</p>`}
        </div>`).join("")}`;
  }
}

// ---------- AI-hjælp: rækkefølge og historier (Anthropic Messages API direkte fra admins browser) ----------
const AI_MODEL = "claude-opus-5";

function planHtml(plan, rums) {
  const nameOfRum = (id) => { const r = rums.find((x) => x.id === id); return r ? (r.priv.name || r.publicName) : "(rom fjernet)"; };
  return `
    ${plan.intro ? `<h3>Velkomst</h3><pre class="info">${esc(plan.intro)}</pre>` : ""}
    <h3>Foreslået rækkefølge</h3>
    <ol>${(plan.order || []).map((o) => `<li><strong>${esc(nameOfRum(o.rumId))}</strong>${o.why ? ` <span class="muted small">– ${esc(o.why)}</span>` : ""}
      ${plan.stories?.[o.rumId] ? `<pre class="info small">${esc(plan.stories[o.rumId])}</pre>` : ""}</li>`).join("")}</ol>
    <p class="muted small">Genereret ${plan.generatedAt ? new Date(plan.generatedAt).toLocaleString("da-DK") : ""} med ${esc(plan.model || "")}. Klik "Foreslå" igen for et nyt forslag.</p>`;
}

async function generatePlan(tasting, rums) {
  const keyDoc = await getDoc(doc(db, "settings", "ai"));
  const apiKey = keyDoc.exists() ? keyDoc.data().anthropicKey : "";
  if (!apiKey) throw new Error("Der er ikke gemt nogen AI-nøgle. Gå til din profil og indsæt en Anthropic API-nøgle.");
  const rumList = rums.map((r) => ({
    rumId: r.id, nuvaerendeNr: r.order, navn: r.priv.name, destilleri: r.priv.distillery, land: r.priv.country,
    alder: r.priv.age, alkoholProcent: r.priv.abv, type: r.priv.type, fad: r.priv.cask, pris: r.priv.price,
    profil: r.priv.profile || {}, admin_noter: r.priv.adminNotes, info_fra_nettet: (r.priv.webInfo || "").slice(0, 1500),
  }));
  const blind = !!tasting.blind;
  const system = `Du er en erfaren romkender og vært ved romsmagninger i en hyggelig dansk vennekreds. Du skriver på dansk, varmt og levende, uden at være højtravende.

Du får en liste af romme til en smagning. Din opgave:
1. Foreslå den rækkefølge rommene bør smages i, efter gængs praksis: lettere, yngre, lavere alkoholprocent og mildere stil før tungere, ældre, stærkere, mere fadpræget, røget eller "funky" stil, så ganen ikke bliver overdøvet. Agricole/sukkerrørssaft og melasse kan grupperes med omtanke. Begrund kort hvert valg.
2. Skriv en kort velkomst (3-5 sætninger), som værten kan sige inden første rom.
3. Skriv en lille historie pr. rom (70-130 ord), som værten fortæller inden rommen serveres. Byg på de oplysninger, du får (noter, profil, info fra nettet). Find ikke på konkrete fakta (årstal, priser, personer), som ikke er givet; brug hellere stemning, sanser og hvad gæsterne skal lægge mærke til.
${blind ? `VIGTIGT: Smagningen er BLIND. Historierne og velkomsten må IKKE afsløre rommens navn, destilleri, land, region, alder, aldersangivelse, pris eller andet, der gør det muligt at gætte den. Skriv i stedet om stemning, hvad gæsterne skal lægge mærke til i duft, smag og eftersmag, og gerne et lille mysterium eller et spørgsmål, gæsterne kan gætte på. Omtal rommen som "denne rom" eller "rom nummer N".` : `Smagningen er ikke blind, så du må gerne bruge navn, destilleri, land og alder i historierne.`}

Svar KUN med gyldig JSON uden anden tekst og uden markdown, i præcis denne form:
{"intro": "velkomst", "order": [{"rumId": "id", "why": "kort begrundelse"}], "stories": {"id": "historie"}}
Alle rumId'er fra listen skal med i "order" præcis én gang, og "stories" skal have en historie for hvert rumId.`;
  const userMsg = `Smagning: ${tasting.title}${tasting.description ? "\nBeskrivelse: " + tasting.description : ""}\nBlind: ${blind ? "ja" : "nej"}\n\nRomme (JSON):\n${JSON.stringify(rumList, null, 1)}`;

  const body = { model: AI_MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: userMsg }] };
  const headers = {
    "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  // Server-side fallback: hvis modellen afviser, prøver Anthropic automatisk en anden model i samme kald.
  let res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { ...headers, "anthropic-beta": "server-side-fallback-2026-07-01" }, body: JSON.stringify({ ...body, fallbacks: "default" }),
  });
  if (res.status === 400) {
    // Ældre API-udgave uden fallback-parameteren: prøv igen uden
    res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic svarede ${res.status}: ${data?.error?.message || res.statusText}`);
  if (data.stop_reason === "refusal") throw new Error("AI'en afviste at svare på denne forespørgsel.");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const parsed = parseJsonLoose(text);
  if (!parsed || !Array.isArray(parsed.order)) throw new Error("Kunne ikke læse AI'ens svar. Prøv igen.");
  const ids = new Set(rums.map((r) => r.id));
  const order = parsed.order.filter((o) => o && ids.has(o.rumId));
  rums.forEach((r) => { if (!order.some((o) => o.rumId === r.id)) order.push({ rumId: r.id, why: "" }); });
  return {
    intro: String(parsed.intro || ""), order: order.map((o) => ({ rumId: o.rumId, why: String(o.why || "") })),
    stories: Object.fromEntries(rums.map((r) => [r.id, String(parsed.stories?.[r.id] || "")])),
    generatedAt: new Date().toISOString(), model: data.model || AI_MODEL, blind,
  };
}

// Finder det første JSON-objekt i en tekst, også hvis modellen har pakket det ind i ```json
function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Manuskript til værten: velkomst og historier i rækkefølge, stort og læsevenligt
function viewScript(tId) {
  $app.innerHTML = `<p><a href="#/admin/smagning/${tId}">← Til redigering</a></p><div id="error" class="error" hidden></div><div id="s"><p class="muted">Indlæser…</p></div>`;
  (async () => {
    const [ts, rs, ps] = await Promise.all([
      getDoc(doc(db, "tastings", tId)),
      getDocs(query(collection(db, "tastings", tId, "rums"), orderBy("order"))),
      getDoc(doc(db, "tastings", tId, "private", "plan")),
    ]);
    const $s = document.getElementById("s");
    if (!$s) return;
    if (!ps.exists()) { $s.innerHTML = `<p class="notice">Der er ikke lavet et forslag endnu. Gå til redigering og klik "Foreslå rækkefølge og historier".</p>`; return; }
    const plan = ps.data();
    const rums = [];
    for (const d of rs.docs) {
      const p = await getDoc(doc(db, "tastings", tId, "rums", d.id, "private", "info"));
      rums.push({ id: d.id, ...d.data(), priv: p.exists() ? p.data() : {} });
    }
    const t = ts.data() || {};
    $s.innerHTML = `
      <h1>Manuskript: ${esc(t.title || "")}</h1>
      <p class="muted small">${plan.blind ? "Blindsmagning – historierne afslører ikke rommene." : ""} Rækkefølgen er forslagets; er den ikke anvendt, kan numrene afvige fra dem, gæsterne ser.</p>
      ${plan.intro ? `<div class="card script"><h2 style="margin-top:0">Velkomst</h2><p>${esc(plan.intro).replace(/\n/g, "<br>")}</p></div>` : ""}
      ${(plan.order || []).map((o, i) => {
        const r = rums.find((x) => x.id === o.rumId);
        if (!r) return "";
        return `<div class="card script">
          <h2 style="margin-top:0">${i + 1}. ${esc(r.priv.name || r.publicName)} <span class="muted small">(vises for gæsterne som ${esc(r.publicName)})</span></h2>
          ${o.why ? `<p class="small muted">Hvorfor her: ${esc(o.why)}</p>` : ""}
          <p>${esc(plan.stories?.[o.rumId] || "").replace(/\n/g, "<br>")}</p>
        </div>`;
      }).join("")}`;
  })().catch(showError);
}

const emptyPriv = () => ({ name: "", distillery: "", country: "", age: "", abv: "", type: "", cask: "", price: "", adminNotes: "", webInfo: "" });
const publicNameFor = (blind, order, name) => (blind || !name ? `Rom nr. ${order}` : name);

// Henter et kort resumé fra Wikipedia (dansk og engelsk). Wikipedias API tillader
// kald direkte fra browseren, så det kræver ingen server.
async function fetchWebInfo(searchText) {
  const out = [];
  for (const lang of ["da", "en"]) {
    try {
      const s = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch=${encodeURIComponent(searchText + " rum")}`).then((r) => r.json());
      const hit = s?.query?.search?.[0];
      if (!hit) continue;
      const sum = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`).then((r) => r.json());
      if (sum?.extract) out.push(`${sum.title} (${lang}.wikipedia.org):\n${sum.extract}\n${sum.content_urls?.desktop?.page || ""}`);
    } catch (e) { console.warn("wikipedia", lang, e); }
  }
  return out.join("\n\n") || "Ingen artikel fundet på Wikipedia. Brug søgelinkene og skriv selv det vigtigste ind.";
}
