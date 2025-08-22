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
    // ✨ assignAt bilgisini ekledim
    const dateText = t.assignedAt ? `📅 ${t.assignedAt.slice(0, 10)}` : "";
    li.innerHTML = `${t.title} (${t.points} puan) ${dateText} ${btn}`;
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

// --- Haftalık Performans Grafiği (sadece hafta içi: Pzt–Cum) ---
function ymdKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function loadWeeklyStats() {
  const canvas = document.getElementById("weeklyChart");
  if (!canvas || typeof Chart === "undefined") return;

  try {
    // Veriyi çek
    const res = await fetch(`${BASE_URL}/weeklyStats/${user.username}`);
    if (!res.ok) throw new Error("Haftalık istatistik alınamadı");
    const stats = normalizeArray(await res.json()) || [];

    // Tarih -> puan haritası (YYYY-MM-DD -> pointsEarned)
    const pointsMap = new Map();
    for (const s of stats) {
      // s.date "YYYY-MM-DD" ise doğrudan anahtar olarak kullan
      const key = String(s.date).slice(0, 10);
      const val = Number(s.pointsEarned ?? s.points ?? 0);
      pointsMap.set(key, (pointsMap.get(key) || 0) + val);
    }

    // Bu haftanın Pazartesisini bul (Pzt=1, JS getDay: Paz=0)
    const today = new Date();
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // 00:00
    const dow = midnight.getDay();              // 0..6  (0=Paz)
    const diffToMonday = (dow + 6) % 7;         // Pzt için 0
    const monday = new Date(midnight);
    monday.setDate(midnight.getDate() - diffToMonday);

    // Pazartesi–Cuma 5 günü üret
    const weekdays = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });

    // Etiketler ve veri
    const labels = weekdays.map(d =>
      d.toLocaleDateString("tr-TR", { weekday: "short" }) // Pzt, Sal, Çar, Per, Cum
    );

    const data = weekdays.map(d => {
      const key = ymdKey(d);
      return pointsMap.get(key) ?? 0;
    });

    // Önceki grafik varsa temizle
    if (window.__weeklyChart) window.__weeklyChart.destroy();

    window.__weeklyChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "Günlük Puan", data, backgroundColor: "#00bfff" }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 2,                 // genişlik/yükseklik oranı
        scales: { y: { beginAtZero: true } },
        plugins: { legend: { display: true } },
      },
    });
  } catch (e) {
    console.error(e);
  }
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
     const active = normalizeArray(await res.json());

    ul.innerHTML = "";
    if (!active.length) {
      ul.innerHTML = "<li>Şu anda aktif görev bulunmuyor.</li>";
      return;
    }

    active.forEach(t => {
      const durum = t.status === "in-progress" ? "Devam Ediyor" : "Başlamadı";
      const li = document.createElement("li");
     // ✨ Tarih eklendi
    const dateText = t.assignedAt ? `📅 ${t.assignedAt.slice(0,10)}` : "";
    li.textContent = `${t.fullName} → ${t.title} (${t.points} puan) [${durum}] ${dateText}`;

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
// --- Onaylanmış Görevler ---
async function loadApprovedTasks() {
  const ul = document.getElementById("loadApprovedTasks");
  if (!ul) return; // sayfada yoksa boş geç

  try {
    const res = await fetch(`${BASE_URL}/approvedTasks`);
    if (!res.ok) throw new Error("Onaylanmış görevler alınamadı");
    const approved = normalizeArray(await res.json());

    console.log("✅ approved verisi:", approved); // Debug için

    ul.innerHTML = "";
    if (!approved.length) {
      ul.innerHTML = "<li>✅ Onaylanmış görev yok.</li>";
      return;
    }

    // Kullanıcıya göre grupla (fullname üzerinden)
    const grouped = {};
    approved.forEach(t => {
      if (!grouped[t.fullname]) grouped[t.fullname] = [];
      grouped[t.fullname].push(t);
    });

    for (const [who, tasks] of Object.entries(grouped)) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${who}</strong><ul>` +
        tasks.map(t => `<li>• ${t.title} (${t.points} puan)</li>`).join("") +
        `</ul>`;
      ul.appendChild(li);
    }
  } catch (e) {
    console.error(e);
    ul.innerHTML = "<li>Hata: Onaylanmış görevler alınamadı.</li>";
  }
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
loadApprovedTasks();

