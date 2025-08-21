// === script.js ===

// Base URL
const BASE_URL = "https://taskmanager-m90d.onrender.com";

// --- KEY NORMALIZATION (kritik) ---
// pg -> JS dönüşünde gelen küçük harfli alanları, UI'nin beklediği camelCase isimlere çeviriyoruz.
function normalizeKeys(row) {
  if (!row || typeof row !== "object") return row;
  const map = {
    // users
    fullname: "fullName",
    isadmin: "isAdmin",

    // tasks
    assignedto: "assignedTo",
    approvedat: "approvedAt",
    assignedat: "assignedAt",

    // goals/user_goals
    goalid: "goalId",

    // daily_points
    pointsearned: "pointsEarned",
  };
  const out = { ...row };
  for (const [from, to] of Object.entries(map)) {
    if (from in out && !(to in out)) {
      out[to] = out[from];
      delete out[from];
    }
  }
  return out;
}
const normalizeArray = (arr) => Array.isArray(arr) ? arr.map(normalizeKeys) : arr;

// Kullanıcı bilgileri ve yönlendirme
const user = JSON.parse(localStorage.getItem("user"));
if (!user) location.href = "login.html";

document.getElementById("name").innerText   = user.fullName;
document.getElementById("level").innerText  = user.level;
document.getElementById("points").innerText = user.points;

// Admin panelini göster ve yüklemeleri yap
if (user.isAdmin) {
  document.getElementById("adminPanel").style.display = "block";
  loadUserOptions();
  loadPendingTasks();
  loadPendingGoals();
  loadActiveTasks();
}

// --- Uzun Vadeli Hedefler ---

async function loadGoals() {
  const res   = await fetch(`${BASE_URL}/goals`);
  const goals = normalizeArray(await res.json());
  const select = document.getElementById("goalSelect");
  select.innerHTML = `<option value="">Hedef Seç…</option>`;
  goals.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = `${g.goal} (${g.points} puan)`;
    select.appendChild(opt);
  });
}

async function selectGoal() {
  const goalId = +document.getElementById("goalSelect").value;
  if (!goalId) return alert("Lütfen bir hedef seçin!");
  await fetch(`${BASE_URL}/addGoal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, goalId }),
  });
  loadSelectedGoals();
}

async function loadSelectedGoals() {
  const res      = await fetch(`${BASE_URL}/selectedGoals`);
  const allGoals = normalizeArray(await res.json());
  const myList   = document.getElementById("myGoals");
  const teamList = document.getElementById("teamGoals");
  myList.innerHTML   = "";
  teamList.innerHTML = "";

  allGoals.forEach(g => {
    if (g.username === user.username) {
      const li = document.createElement("li");
      let btn = "";
      switch (g.status) {
        case "available":
          btn = `<button onclick="startGoal(${g.goalId})">Başla</button>`;
          break;
        case "in-progress":
          btn = `<button onclick="finishGoal(${g.goalId})">Bitir</button>`;
          break;
        case "pending":
          btn = `<button class="waiting" disabled>Onay Bekliyor</button>`;
          break;
        case "approved":
          btn = `<span class="approved">Tamamlandı</span>`;
          break;
      }
      li.innerHTML = `${g.goal} (${g.points} puan) ${btn}`;
      myList.appendChild(li);
    } else {
      const li = document.createElement("li");
      li.innerText = `${g.goal} — ${g.username} — ${statusText(g.status)}`;
      teamList.appendChild(li);
    }
  });
}

async function startGoal(goalId) {
  await fetch(`${BASE_URL}/startGoal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, goalId }),
  });
  loadSelectedGoals();
}

async function finishGoal(goalId) {
  await fetch(`${BASE_URL}/finishGoal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, goalId }),
  });
  loadSelectedGoals();
}

function statusText(status) {
  switch (status) {
    case "available":    return "Hazır";
    case "in-progress":  return "Devam Ediyor";
    case "pending":      return "Onay Bekliyor";
    case "approved":     return "Tamamlandı";
    default:             return "";
  }
}

// --- Günlük Görevler ---

async function loadTasks() {
  const res   = await fetch(`${BASE_URL}/tasks/${user.username}`);
  const tasks = normalizeArray(await res.json());
  const ul    = document.getElementById("personalTasks");
  ul.innerHTML = "";
  tasks.forEach(t => {
    const li = document.createElement("li");
    let btn = "";
    switch (t.status) {
      case "available":
        btn = `<span style="display:flex; justify-content:flex-end; gap:6px;">
                 <button onclick="startTask(${t.id})">Başla</button>
               </span>`;
        break;
      case "in-progress":
        btn = `<span style="display:flex; justify-content:flex-end; gap:6px;">
                 <button onclick="finishTask(${t.id})">Bitir</button>
               </span>`;
        break;
      case "pending":
        btn = `<button class="waiting" disabled>Onay Bekliyor</button>`;
        break;
      case "approved":
        btn = `<span class="approved">Tamamlandı</span>`;
        break;
    }
    li.innerHTML = `${t.title} (${t.points} puan) ${btn}`;
    ul.appendChild(li);
  });
}


async function assignTaskToMe() {
  const title  = document.getElementById("adminTaskSelect").value;
  const points = 0; // istersen input ekleyip puanı da alabilirsin

  if (!title) return alert("Görev boş olamaz!");

  // giriş yapan kullanıcını localStorage’dan oku
  const currentUser = JSON.parse(localStorage.getItem("user"));
  if (!currentUser) return alert("Kullanıcı bilgisi bulunamadı!");

  try {
    const res = await fetch(`${BASE_URL}/assignTask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        points,
        assignedTo: currentUser.username   // ✨ burası kritik
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || "Görev atanamadı");

    document.getElementById("assignMsg").innerText = "✔️ Görev atandı";
    loadTasks(); // var olan görevleri yeniden yükle
  } catch (e) {
    console.error(e);
    alert("Görev atanamadı: " + e.message);
  }
}

async function startTask(id) {
  await fetch(`${BASE_URL}/startTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, taskId: id }),
  });
  loadTasks();
}

async function finishTask(id) {
  await fetch(`${BASE_URL}/finishTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, taskId: id }),
  });
  loadTasks();
}

// --- Tamamlananlar & Lider Tablosu ---

async function loadCompleted() {
  const res  = await fetch(`${BASE_URL}/completed/${user.username}`);
  const done = normalizeArray(await res.json());
  const ul   = document.getElementById("dailyDone");
  ul.innerHTML = "";
  done.forEach(t => {
    const li = document.createElement("li");
    li.innerText = `✔️ ${t.title} (${t.points} puan)`;
    ul.appendChild(li);
  });
}

async function loadLeaderboard() {
  const res = await fetch(`${BASE_URL}/leaderboard`);
  const data = normalizeArray(await res.json());
  const ol = document.getElementById("leaderboard");
  ol.innerHTML = "";

  data.forEach((u, idx) => {
    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "";
    const li = document.createElement("li");
    li.textContent = `${idx + 1}. ${u.fullName} ${medal} – ${u.points} puan (Seviye ${u.level})`;
    ol.appendChild(li);
  });
}

// --- Haftalık Performans Grafiği ---
function parseDateSafe(val) {
  if (val instanceof Date) return val;
  if (typeof val !== "string") return new Date(NaN);
  let v = val.trim();

  // ISO veya datetime ise direkt dene
  if (v.includes("T") || v.includes(" ")) return new Date(v);

  // Y-M-D / Y-MM-D / Y-M-DD / Y-MM-DD → sıfırla ve ISO'ya çevir
  const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const y = +m[1], mn = String(+m[2]).padStart(2, "0"), d = String(+m[3]).padStart(2, "0");
    return new Date(`${y}-${mn}-${d}T00:00:00`);
  }

  // "+03" gibi ekleri varsa kırp
  if (v.includes("+")) {
    const n = v.split("+")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(n)) return new Date(`${n}T00:00:00`);
  }

  return new Date(v);
}

async function loadWeeklyStats() {
  const cvs = document.getElementById("weeklyChart");
  if (!cvs || typeof Chart === "undefined") return;

  const res = await fetch(`${BASE_URL}/weeklyStats/${user.username}`);
  const stats = normalizeArray(await res.json()) || [];

  // Yalnızca son 7 kayıt
  const last7 = stats.slice(-7);

  const labels = last7.map(s => {
    const d = new Date(`${s.date}T00:00:00`);
    return d.toLocaleDateString("tr-TR", { weekday: "short" }); // Pzt, Sal, ...
  });
  const data = last7.map(s => s.pointsEarned ?? 0);

  if (window.__weeklyChart) window.__weeklyChart.destroy();
  window.__weeklyChart = new Chart(cvs.getContext("2d"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Günlük Puan", data, backgroundColor: "#00bfff" }] },
    options: { responsive: true, maintainAspectRatio: true, aspectRatio: 2, scales: { y: { beginAtZero: true } } }
  });
}





// --- Admin: Görev Atama & Onaylar ---

async function loadUserOptions() {
  const res  = await fetch(`${BASE_URL}/users`);
  const list = normalizeArray(await res.json());
  const sel  = document.getElementById("assignToUser");
  sel.innerHTML = "";
  list.forEach(u => {
    const opt = document.createElement("option");
    opt.value   = u.username;
    opt.innerText = u.fullName;
    sel.appendChild(opt);
  });
}

async function assignTask() {
  const title      = document.getElementById("newTaskTitle").value;
  const points     = parseInt(document.getElementById("newTaskPoints").value) || 10;
  const assignedTo = document.getElementById("assignToUser").value;
  if (!title || !assignedTo) return alert("Tüm alanları doldurun!");
  await fetch(`${BASE_URL}/assignTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, points, assignedTo }),
  });
  document.getElementById("assignMessage").innerText = "✔️ Görev atandı";
  loadTasks();
}

async function loadPendingTasks() {
  const res  = await fetch(`${BASE_URL}/pendingTasks`);
  const pend = normalizeArray(await res.json());
  const ul   = document.getElementById("pendingList");
  ul.innerHTML = "";
  pend.forEach(t => {
    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.justifyContent = "space-between";
    li.style.marginBottom = "10px";
    li.style.padding = "8px";
    li.style.background = "#eaf6ff";
    li.style.borderRadius = "6px";

    const spanText = document.createElement("span");
    spanText.textContent = `${t.title}  — ${t.assignedTo}`;
    spanText.style.flexGrow = "1";

    const rightControls = document.createElement("div");
    rightControls.style.display = "flex";
    rightControls.style.alignItems = "center";
    rightControls.style.gap = "6px";

    const pointsInput = document.createElement("input");
    pointsInput.type = "number";
    pointsInput.min = "0";
    pointsInput.placeholder = "Puan";
    pointsInput.style.width = "60px";
    pointsInput.style.height = "30px";
    pointsInput.style.textAlign = "center";
    pointsInput.value = t.points ?? "";

    const btn = document.createElement("button");
    btn.innerText = "Onayla";
    btn.style.height = "34px";
    btn.style.backgroundColor = "#00bfff";
    btn.style.color = "white";
    btn.style.border = "none";
    btn.style.borderRadius = "4px";
    btn.style.cursor = "pointer";
    btn.onclick = () => approveTask(t.id, t.assignedTo, parseInt(pointsInput.value) || 0);

    rightControls.appendChild(pointsInput);
    rightControls.appendChild(btn);
    li.appendChild(spanText);
    li.appendChild(rightControls);
    ul.appendChild(li);
  });
}
async function loadActiveTasks() {
  const ul = document.getElementById("activeTasksList");
  if (!ul) return; // Bu sayfada değilse sessiz geç

  try {
    const res = await fetch(`${BASE_URL}/activeTasks`);
    if (!res.ok) throw new Error("Aktif görevler alınamadı");
    const active = await res.json();

    ul.innerHTML = "";
    if (!active.length) {
      ul.innerHTML = "<li>Şu anda aktif görev bulunmuyor.</li>";
      return;
    }

    active.forEach(t => {
      const durum = t.status === "in-progress" ? "Devam Ediyor" : "Başlamadı";
      const li = document.createElement("li");
      li.textContent = `${t.fullName} → ${t.title} (${t.points} puan) [${durum}]`;
      ul.appendChild(li);
    });
  } catch (e) {
    console.error(e);
    ul.innerHTML = "<li>Hata: veriler alınamadı.</li>";
  }
}

// Onay fonksiyonu
async function approveTask(id, username, points) {
  await fetch(`${BASE_URL}/approveTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: id, username, points })
  });
  loadPendingTasks();
  loadTasks();
  loadCompleted();
  loadLeaderboard();
}

// --- Admin: Hedef Onayı ---

async function loadPendingGoals() {
  const res  = await fetch(`${BASE_URL}/pendingGoals`);
  const pend = normalizeArray(await res.json());
  const ul   = document.getElementById("pendingGoalsList");
  ul.innerHTML = "";
  pend.forEach(g => {
    const li = document.createElement("li");
    li.innerHTML = `
      ${g.goal} (${g.points} puan) — ${g.username}
      <button onclick="approveGoal(${g.goalId},'${g.username}')">Onayla</button>
    `;
    ul.appendChild(li);
  });
}

async function approveGoal(goalId, who) {
  await fetch(`${BASE_URL}/approveGoal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: who, goalId }),
  });
  loadPendingGoals();
  loadSelectedGoals();
  // Not: localStorage'daki user obje puan/level'ı otomatik güncellenmiyor.
  // İstersen burada /users'tan kendi kaydını çekip localStorage'ı güncelleyebilirsin.
}

// --- İlk yüklemeler ---
loadGoals();
loadSelectedGoals();
loadTasks();
loadCompleted();
loadLeaderboard();
loadWeeklyStats();
