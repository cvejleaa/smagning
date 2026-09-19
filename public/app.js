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
  { key: "samlet",   label: "Samlet vurdering",   hint: "Din helhedsscore" },
];
const TAGS = [
  "Vanilje", "Karamel", "Toffee", "Eg/fad", "Tropisk frugt", "Banan", "Tørret frugt", "Rosin",
  "Melasse", "Sukkerrør/græs", "Funk/hogo", "Krydderi", "Kanel", "Peber", "Tobak", "Læder",
  "Chokolade", "Kaffe", "Røg", "Honning", "Citrus", "Nødder", "Sprit/skarp", "Sødet",
];
const RUM_TYPES = ["Melasse (pot still)", "Melasse (column still)", "Melasse (blend)", "Agricole (sukkerrørssaft)", "Cachaça", "Spiced/aromatiseret", "Andet/ukendt"];
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
  if (u) {
    try {
      profile = await ensureProfile(u);
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
    <a href="#/profil">${esc(profile?.name || "Profil")}${isAdmin() ? " (admin)" : ""}</a>
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
  if (p[0] === "admin" && p[1] === "smagning" && p[2]) return isAdmin() ? viewAdminTasting(p[2]) : viewHome();
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
        <p><button type="submit">Gem</button></p>
      </form>
    </div>`;
  document.getElementById("profile").onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await updateDoc(doc(db, "users", user.uid), { name: ev.target.name.value.trim() });
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
      const mayRead = isAdmin() || tasting.status === "afsluttet" || ratings.some((x) => x.rumId === r.id && x.uid === user.uid);
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
      const complete = r.status === "lukket" || (parts.length > 0 && rs.length >= parts.length);
      const avg = rs.length ? rs.reduce((s, x) => s + (Number(x.scores?.samlet) || 0), 0) / rs.length : 0;
      const mine = rs.find((x) => x.uid === user.uid);
      const label = privateNames[r.id] ? `${esc(privateNames[r.id])} <span class="muted small">(${esc(r.publicName)})</span>` : esc(r.publicName);
      return { r, rs, complete, avg, mine, label };
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
            <span class="small">${parts.map((u) => esc(nameOf(u))).join(", ") || "<span class='muted'>Ingen endnu</span>"}</span></div>
          ${canJoin ? `<button id="join" class="${joined ? "secondary" : ""}">${joined ? "Meld fra" : "Tilmeld mig"}</button>` : ""}
        </div>
      </div>

      <h2>Romme (${rums.length})</h2>
      ${rums.length === 0 ? `<p class="muted">Administrator har ikke lagt romme ind endnu.</p>` : ""}
      ${rows.map((x) => `
        <div class="card link" data-rum="${x.r.id}">
          <div class="row between">
            <div><strong>${x.label}</strong><br>
              <span class="small muted">${x.rs.length} af ${parts.length} har bedømt${x.r.status === "lukket" ? " · lukket" : ""}</span></div>
            <div>${x.mine ? `<span class="badge ok">Din score: ${esc(x.mine.scores?.samlet)}</span>` : (joined && x.r.status === "aaben" ? '<span class="badge warn">Bedøm</span>' : '<span class="badge muted">Se</span>')}</div>
          </div>
        </div>`).join("")}

      ${ranked.length ? `
        <h2>Rangliste</h2>
        <div class="card">
          <table><thead><tr><th>#</th><th>Rom</th><th class="num">Gns. samlet</th><th class="num">Bedømt</th></tr></thead>
          <tbody>${ranked.map((x, i) => `<tr><td>${i + 1}</td><td>${x.label}</td><td class="num"><strong>${fmt1(x.avg)}</strong></td><td class="num">${x.rs.length}</td></tr>`).join("")}</tbody></table>
          ${rows.some((x) => !x.complete) ? `<p class="muted small">Romme, hvor ikke alle har bedømt endnu, vises først når alle er færdige (eller admin lukker rommen).</p>` : ""}
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
  let tasting = null, rum = null, ratings = [], priv = null, privTried = false, formDrawn = false;
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
  const mayReveal = () => isAdmin() || tasting?.status === "afsluttet" || !!mine();

  async function loadPrivate() {
    if (priv || privTried || !mayReveal()) return;
    privTried = true;
    try {
      const p = await getDoc(doc(db, "tastings", tId, "rums", rId, "private", "info"));
      priv = p.exists() ? p.data() : {};
      drawReveal();
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
      ${isAdmin() ? `<p><button id="toggle" class="small secondary">${rum.status === "lukket" ? "Genåbn rommen" : "Luk rommen og vis samlet vurdering"}</button></p>` : ""}`;
    const $t = document.getElementById("toggle");
    if ($t) $t.onclick = async () => {
      try { await updateDoc(doc(db, "tastings", tId, "rums", rId), { status: rum.status === "lukket" ? "aaben" : "lukket" }); } catch (e) { showError(e); }
    };
  }

  function drawForm() {
    const $f = document.getElementById("form");
    const parts = tasting.participantIds || [];
    const m = mine();
    if (m) {
      formDrawn = false;
      $f.innerHTML = `
        <div class="card">
          <h2 style="margin-top:0">Din bedømmelse</h2>
          <table><tbody>
            ${DIMS.map((d) => `<tr><td>${d.label}</td><td class="num"><strong>${esc(m.scores?.[d.key])}</strong></td></tr>`).join("")}
          </tbody></table>
          ${(m.tags || []).length ? `<p class="small">Aromaer: ${m.tags.map(esc).join(", ")}</p>` : ""}
          ${m.guess ? `<p class="small">Dit gæt: ${esc(m.guess)}</p>` : ""}
          ${m.comment ? `<p class="small">${esc(m.comment).replace(/\n/g, "<br>")}</p>` : ""}
        </div>`;
      return;
    }
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
    $f.innerHTML = `
      <form id="rate" class="card">
        <h2 style="margin-top:0">Din bedømmelse</h2>
        <p class="muted small">Giv 1–10 point pr. område. Når du gemmer, kan bedømmelsen ikke ændres – og først da afsløres, hvad administratoren har skrevet om rommen.</p>
        ${DIMS.map((d) => `
          <label>${d.label} <span class="hint">${d.hint}</span>
            <div class="score-row"><input type="range" name="${d.key}" min="1" max="10" step="1" value="5" oninput="this.nextElementSibling.value=this.value"><output>5</output></div>
          </label>`).join("")}
        <label>Aromaer og smagsnoter <span class="hint">(vælg dem, du finder)</span></label>
        <div class="tags">${TAGS.map((t) => `<label><input type="checkbox" name="tags" value="${esc(t)}">${esc(t)}</label>`).join("")}</div>
        ${tasting.blind ? `<label>Dit gæt <span class="hint">(fx land, alder, type – valgfrit)</span><input type="text" name="guess" placeholder="Fx Jamaica, 12 år, pot still"></label>` : ""}
        <label>Kommentar <span class="hint">(valgfri)</span><textarea name="comment"></textarea></label>
        <p><button type="submit">Gem bedømmelse</button></p>
      </form>`;
    $f.querySelectorAll(".tags input").forEach((cb) => (cb.onchange = () => cb.parentElement.classList.toggle("on", cb.checked)));
    document.getElementById("rate").onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true;
      const scores = {};
      DIMS.forEach((d) => (scores[d.key] = Number(f[d.key].value)));
      const tags = [...f.querySelectorAll(".tags input:checked")].map((c) => c.value);
      try {
        await setDoc(doc(db, "tastings", tId, "ratings", `${rId}_${user.uid}`), {
          uid: user.uid, rumId: rId, scores, tags,
          guess: f.guess ? f.guess.value.trim() : "", comment: f.comment.value.trim(),
          createdAt: serverTimestamp(),
        });
      } catch (e) { btn.disabled = false; showError(e); }
    };
  }

  function drawReveal() {
    const $r = document.getElementById("reveal");
    if (!$r) return;
    if (!mayReveal()) {
      $r.innerHTML = `<p class="muted small">Rommens identitet og administratorens noter vises, når du har gemt din bedømmelse.</p>`;
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
        ${facts.length ? `<table><tbody>${facts.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>` : ""}
        ${priv.adminNotes ? `<h3>Administratorens noter</h3><pre class="info">${esc(priv.adminNotes)}</pre>` : `<p class="muted small">Administratoren har ikke skrevet noter til denne rom.</p>`}
        ${priv.webInfo ? `<details><summary>Fra nettet</summary><pre class="info">${esc(priv.webInfo)}</pre></details>` : ""}
      </div>`;
  }

  function drawAgg() {
    const $a = document.getElementById("agg");
    const parts = tasting.participantIds || [];
    const n = ratings.length;
    const complete = rum.status === "lukket" || (parts.length > 0 && n >= parts.length);
    if (!complete) {
      $a.innerHTML = `<div class="card"><h2 style="margin-top:0">Samlet vurdering</h2>
        <p>${n} af ${parts.length} har bedømt. Den samlede vurdering vises, når alle er færdige${isAdmin() ? " – eller når du lukker rommen" : ""}.</p>
        <p class="small muted">Mangler: ${parts.filter((u) => !ratings.some((r) => r.uid === u)).map((u) => esc(nameOf(u))).join(", ") || "ingen"}</p></div>`;
      return;
    }
    if (!n) { $a.innerHTML = `<div class="card"><h2 style="margin-top:0">Samlet vurdering</h2><p class="muted">Ingen bedømmelser.</p></div>`; return; }
    const avg = {};
    DIMS.forEach((d) => (avg[d.key] = ratings.reduce((s, r) => s + (Number(r.scores?.[d.key]) || 0), 0) / n));
    const samlet = ratings.map((r) => Number(r.scores?.samlet) || 0);
    const tagCount = {};
    ratings.forEach((r) => (r.tags || []).forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1)));
    const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const sorted = [...ratings].sort((a, b) => (Number(b.scores?.samlet) || 0) - (Number(a.scores?.samlet) || 0));
    $a.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0">Samlet vurdering</h2>
        <p class="big">${fmt1(avg.samlet)} <span class="small muted" style="font-weight:400">/ 10 i gennemsnit (${n} bedømmelser, laveste ${Math.min(...samlet)}, højeste ${Math.max(...samlet)})</span></p>
        <table><tbody>${DIMS.filter((d) => d.key !== "samlet").map((d) => `<tr><td>${d.label}</td><td class="num"><strong>${fmt1(avg[d.key])}</strong></td></tr>`).join("")}</tbody></table>
        ${topTags.length ? `<p class="small">Mest fundne aromaer: ${topTags.map(([t, c]) => `${esc(t)} (${c})`).join(", ")}</p>` : ""}
        <h3>Deltagernes bedømmelser</h3>
        <table><thead><tr><th>Deltager</th>${DIMS.map((d) => `<th class="num">${d.label.split(" ")[0]}</th>`).join("")}${isAdmin() ? "<th></th>" : ""}</tr></thead>
        <tbody>${sorted.map((r) => `<tr><td>${esc(nameOf(r.uid))}${r.guess ? `<br><span class="muted small">Gæt: ${esc(r.guess)}</span>` : ""}${r.comment ? `<br><span class="small">${esc(r.comment)}</span>` : ""}</td>
          ${DIMS.map((d) => `<td class="num">${esc(r.scores?.[d.key])}</td>`).join("")}
          ${isAdmin() ? `<td><button class="small danger" data-del="${r.id}" title="Slet bedømmelsen, så deltageren kan bedømme igen">Slet</button></td>` : ""}</tr>`).join("")}</tbody></table>
      </div>`;
    $a.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm("Slet denne bedømmelse? Deltageren kan så bedømme igen.")) return;
      try { await deleteDoc(doc(db, "tastings", tId, "ratings", b.dataset.del)); } catch (e) { showError(e); }
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
      draw(tasting, rums);
    } catch (e) { showError(e); }
  }

  function draw(tasting, rums) {
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

      <div class="row between"><h2>Romme (${rums.length})</h2><button id="addrum">+ Tilføj rom</button></div>
      ${rums.map((r) => `
        <form class="card rumform" data-id="${r.id}">
          <div class="row between">
            <strong>${esc(r.publicName)}</strong>
            <span class="badge ${r.status === "lukket" ? "muted" : "ok"}">${r.status === "lukket" ? "Lukket" : "Åben for bedømmelse"}</span>
          </div>
          <div class="grid2">
            <label>Rækkefølge<input type="number" name="order" value="${esc(r.order)}" min="1" required></label>
            <label>Navn på rommen<input type="text" name="name" value="${esc(r.priv.name)}" placeholder="Fx Appleton Estate 12"></label>
            <label>Destilleri / producent<input type="text" name="distillery" value="${esc(r.priv.distillery)}"></label>
            <label>Land<input type="text" name="country" value="${esc(r.priv.country)}"></label>
            <label>Alder / årgang<input type="text" name="age" value="${esc(r.priv.age)}" placeholder="Fx 12 år, NAS, 2009"></label>
            <label>Alkohol %<input type="text" name="abv" value="${esc(r.priv.abv)}" placeholder="Fx 43"></label>
            <label>Type<select name="type"><option value="">–</option>${RUM_TYPES.map((t) => `<option ${r.priv.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
            <label>Fad / lagring<input type="text" name="cask" value="${esc(r.priv.cask)}" placeholder="Fx ex-bourbon, sherry finish"></label>
            <label>Pris<input type="text" name="price" value="${esc(r.priv.price)}" placeholder="Fx 450 kr."></label>
            <label>Status<select name="status"><option value="aaben" ${r.status !== "lukket" ? "selected" : ""}>Åben for bedømmelse</option><option value="lukket" ${r.status === "lukket" ? "selected" : ""}>Lukket (vis samlet vurdering)</option></select></label>
          </div>
          <label>Dine noter om rommen <span class="hint">(afsløres for deltageren efter egen bedømmelse)</span><textarea name="adminNotes">${esc(r.priv.adminNotes)}</textarea></label>
          <label>Info fra nettet <span class="hint">(hentes fra Wikipedia – ret gerne til)</span><textarea name="webInfo">${esc(r.priv.webInfo)}</textarea></label>
          <p class="row">
            <button type="submit">Gem rom</button>
            <button type="button" class="secondary fetchweb">Hent info fra nettet</button>
            <a class="btn secondary" target="_blank" rel="noopener" data-search="google">Google</a>
            <a class="btn secondary" target="_blank" rel="noopener" data-search="rumratings">RumRatings</a>
            <a class="btn secondary" target="_blank" rel="noopener" data-search="rumx">Rum-X</a>
            <button type="button" class="danger delrum">Slet rom</button>
          </p>
        </form>`).join("")}`;

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
    document.getElementById("addrum").onclick = async () => {
      const order = rums.length + 1;
      try {
        const ref = await addDoc(collection(db, "tastings", tId, "rums"), {
          order, status: "aaben", publicName: publicNameFor(tasting.blind, order, ""), createdAt: serverTimestamp(),
        });
        await setDoc(doc(db, "tastings", tId, "rums", ref.id, "private", "info"), emptyPriv());
        load();
      } catch (e) { showError(e); }
    };
    $a.querySelectorAll(".rumform").forEach((f) => {
      const id = f.dataset.id;
      const q = () => [f.name.value, f.distillery.value].filter(Boolean).join(" ");
      const links = {
        google: () => `https://www.google.com/search?q=${encodeURIComponent(q() + " rum")}`,
        rumratings: () => `https://www.rumratings.com/search?q=${encodeURIComponent(q())}`,
        rumx: () => `https://www.rum-x.com/search?q=${encodeURIComponent(q())}`,
      };
      f.querySelectorAll("[data-search]").forEach((a) => (a.onclick = () => { a.href = links[a.dataset.search](); }));
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        try { await saveRum(id, f, tasting.blind); load(); } catch (e) { showError(e); }
      };
      f.querySelector(".fetchweb").onclick = async (ev) => {
        const btn = ev.target;
        if (!f.name.value.trim()) return showError({ message: "Skriv rommens navn først." });
        btn.disabled = true; btn.textContent = "Henter…";
        try {
          const text = await fetchWebInfo(q());
          f.webInfo.value = (f.webInfo.value ? f.webInfo.value + "\n\n" : "") + text;
        } catch (e) { showError(e); }
        btn.disabled = false; btn.textContent = "Hent info fra nettet";
      };
      f.querySelector(".delrum").onclick = async () => {
        if (!confirm("Slet rommen og dens bedømmelser?")) return;
        try {
          await deleteRum(id);
          const rs = await getDocs(query(collection(db, "tastings", tId, "ratings"), where("rumId", "==", id)));
          for (const d of rs.docs) await deleteDoc(d.ref);
          load();
        } catch (e) { showError(e); }
      };
    });
  }

  async function saveRum(id, f, blind) {
    const order = Number(f.order.value) || 1;
    const priv = {
      name: f.name.value.trim(), distillery: f.distillery.value.trim(), country: f.country.value.trim(),
      age: f.age.value.trim(), abv: f.abv.value.trim(), type: f.type.value, cask: f.cask.value.trim(),
      price: f.price.value.trim(), adminNotes: f.adminNotes.value.trim(), webInfo: f.webInfo.value.trim(),
    };
    await updateDoc(doc(db, "tastings", tId, "rums", id), { order, status: f.status.value, publicName: publicNameFor(blind, order, priv.name) });
    await setDoc(doc(db, "tastings", tId, "rums", id, "private", "info"), priv);
  }
  async function deleteRum(id) {
    await deleteDoc(doc(db, "tastings", tId, "rums", id, "private", "info"));
    await deleteDoc(doc(db, "tastings", tId, "rums", id));
  }
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
