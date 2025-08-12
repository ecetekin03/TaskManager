// === script.js ===

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
}

// --- Uzun Vadeli Hedefler ---

async function loadGoals() {
  const res   = await fetch("/goals");
  const goals = await res.json();
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
  await fetch("/addGoal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, goalId }),
  });
  loadSelectedGoals();
}

async function loadSelectedGoals() {
  const res      = await fetch("/selectedGoals");
  const allGoals = await res.json();
  const myList   = document.getElementById("myGoals");
  const teamList = document.getElementById("teamGoals");
  myList.innerHTML   = "";
  teamList.innerHTML = "";

  allGoals.forEach(g => {
    if (g.username === user.username) {
      // Kendi hedefin
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
      // Ekiptekilerin hedefi
      const li = document.createElement("li");
      li.innerText = `${g.goal} — ${g.username} — ${statusText(g.status)}`;
      teamList.appendChild(li);
    }
  });
}

async function startGoal(goalId) {
  await fetch("/startGoal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, goalId }),
  });
  loadSelectedGoals();
}

async function finishGoal(goalId) {
  await fetch("/finishGoal", {
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
  const res   = await fetch(`/tasks/${user.username}`);
  const tasks = await res.json();
  const ul    = document.getElementById("personalTasks");
  ul.innerHTML = "";
  tasks.forEach(t => {
    const li = document.createElement("li");
    let btn = "";
    switch (t.status) {
      case "available":
        btn = `
          <span style="display:flex; justify-content:flex-end; gap:6px;">
            <button onclick="startTask(${t.id})">Başla</button>
          </span>
        `;
        break;
      case "in-progress":
        btn = `
          <span style="display:flex; justify-content:flex-end; gap:6px;">
            <button onclick="finishTask(${t.id})">Bitir</button>
          </span>
        `;
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





async function devretTask(taskId, btn) {
  if (!confirm("Bu görevi devretmek istediğinize emin misiniz?")) return;

  // Buton yazısını değiştir
  btn.textContent = "Devredildi";
  // İstersen butonu devre dışı bırakabilirsin:
  // btn.disabled = true;

  await fetch("/devretTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, taskId }),
  });

  // loadTasks();  // Bu satırı kaldır veya yoruma al, çünkü buton yazısı değişimini bozuyor
}
async function startTask(id) {
  await fetch("/startTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, taskId: id }),
  });
  loadTasks();
}


async function finishTask(id) {
  await fetch("/finishTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, taskId: id }),
  });
  loadTasks();
}

// --- Tamamlananlar & Lider Tablosu ---

async function loadCompleted() {
  const res  = await fetch(`/completed/${user.username}`);
  const done = await res.json();
  const ul   = document.getElementById("dailyDone");
  ul.innerHTML = "";
  done.forEach(t => {
    const li = document.createElement("li");
    li.innerText = `✔️ ${t.title} (${t.points} puan)`;
    ul.appendChild(li);
  });
}

async function loadLeaderboard() {
  const res = await fetch("/leaderboard");
  const data = await res.json();
  const ol = document.getElementById("leaderboard");
  ol.innerHTML = "";

  data.forEach((u, idx) => {
    // 0 → 🥇, 1 → 🥈, 2 → 🥉, diğerleri boş
    const medal = idx === 0
      ? "🥇"
      : idx === 1
        ? "🥈"
        : idx === 2
          ? "🥉"
          : "";

    const li = document.createElement("li");
    li.textContent = `${idx + 1}. ${u.fullName} ${medal} – ${u.points} puan (Seviye ${u.level})`;
    ol.appendChild(li);
  });
}

// --- Haftalık Performans Grafiği ---
async function loadWeeklyStats() {
  const res   = await fetch(`/weeklyStats/${user.username}`);
  const stats = await res.json(); // [{date, points}, ...]
  const labels = stats.map(s => {
    const d = new Date(s.date);
    return ["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"][d.getDay()-1] || "Paz";
  });
  const data = stats.map(s => s.points);

  new Chart(
    document.getElementById("weeklyChart").getContext("2d"),
    {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Günlük Puan",
          data,
          backgroundColor: "#00bfff"
        }]
      },
      options: {
        scales: { y: { beginAtZero: true } }
      }
    }
  );
}

// --- Admin: Görev Atama & Onaylar ---

async function loadUserOptions() {
  const res  = await fetch("/users");
  const list = await res.json();
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
  await fetch("/assignTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, points, assignedTo }),
  });
  document.getElementById("assignMessage").innerText = "✔️ Görev atandı";
  loadTasks();
}

async function loadPendingTasks() {
  const res  = await fetch("/pendingTasks");
  const pend = await res.json();
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

    // Görev metni
    const spanText = document.createElement("span");
    spanText.textContent = `${t.title}  — ${t.assignedTo}`;
    spanText.style.flexGrow = "1";

    // Sağ taraf: puan kutusu + onay butonu
    const rightControls = document.createElement("div");
    rightControls.style.display = "flex";
    rightControls.style.alignItems = "center";
    rightControls.style.gap = "6px";

    // Puan inputu
    const pointsInput = document.createElement("input");
    pointsInput.type = "number";
    pointsInput.min = "0";
    pointsInput.placeholder = "Puan";
    pointsInput.style.width = "60px";
    pointsInput.style.height = "30px";
    pointsInput.style.textAlign = "center";
    pointsInput.value = t.points ?? "";

    // Onayla butonu
    const btn = document.createElement("button");
    btn.innerText = "Onayla";
    btn.style.height = "34px";
    btn.style.backgroundColor = "#00bfff";
    btn.style.color = "white";
    btn.style.border = "none";
    btn.style.borderRadius = "4px";
    btn.style.cursor = "pointer";
    btn.onclick = () => approveTask(t.id, t.assignedTo, parseInt(pointsInput.value) || 0);

    // Eklemeler
    rightControls.appendChild(pointsInput);
    rightControls.appendChild(btn);
    li.appendChild(spanText);
    li.appendChild(rightControls);
    ul.appendChild(li);
  });
}

// Onay fonksiyonu
async function approveTask(id, username, points) {
  await fetch("/approveTask", {  // endpoint'i backend'e göre düzenle
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: id, username, points })
  });
  loadPendingTasks();
  loadTasks();
  loadCompleted();
  loadLeaderboard();
}


// === script.js ===

async function assignTaskToUser2() {
  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) {
    alert("Kullanıcı bulunamadı, lütfen giriş yapın.");
    return;
  }
  const username = user.username;
  const taskTitle = document.getElementById("adminTaskSelect").value.trim();

  if (!taskTitle) {
    alert("Lütfen görev girin!");
    return;
  }

  try {
    const res = await fetch("/assignTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedTo: username, title: taskTitle, points: 0 }), // Buradaki `points` değerini sabit 0 olarak gönderiyor
    });
    const data = await res.json();
    document.getElementById("assignMsg").innerText = data.message || "Görev atandı.";
    document.getElementById("adminTaskSelect").value = "";
    loadTasks();
  } catch (error) {
    document.getElementById("assignMsg").innerText = "Görev atanırken hata oluştu.";
    console.error(error);
  }
}



// --- Admin: Hedef Onayı ---

async function loadPendingGoals() {
  const res  = await fetch("/pendingGoals");
  const pend = await res.json();
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
  await fetch("/approveGoal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: who, goalId }),
  });
  loadPendingGoals();
  loadSelectedGoals();
  // puan ve seviye tazele
  const updated = JSON.parse(localStorage.getItem("user"));
  document.getElementById("points").innerText = updated.points;
  document.getElementById("level").innerText  = updated.level;
}

// --- İlk yüklemeler ---
loadGoals();
loadSelectedGoals();
loadTasks();
loadCompleted();
loadLeaderboard();
loadWeeklyStats();
