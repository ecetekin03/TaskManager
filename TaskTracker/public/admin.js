// admin.js – sadece admin.html sayfası tarafından kullanılır

// === BASE URL ===
const BASE_URL = "https://taskmanager-m90d.onrender.com";

// === KEY NORMALIZATION ===
// pg'nin küçük harfe döndürdüğü anahtarları UI'nin beklediği camelCase'e çevirir
function normalizeKeys(row) {
  if (!row || typeof row !== "object") return row;
  const map = {
    fullname: "fullName",
    isadmin: "isAdmin",
    assignedto: "assignedTo",
    approvedat: "approvedAt",
    assignedat: "assignedAt",
    pointsearned: "pointsEarned",
    goalid: "goalId",
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

// === AUTH GUARD (sadece admin girsin) ===
let rawUser = JSON.parse(localStorage.getItem("user"));
if (!rawUser) location.href = "login.html";
const user = { ...rawUser, isAdmin: rawUser.isAdmin ?? rawUser.isadmin };
if (!user.isAdmin) location.href = "index.html";

// Sayfa açıldığında kullanıcı ve bekleyen görevleri yükle
window.addEventListener("DOMContentLoaded", async () => {
  await loadUsers();
  await loadPendingTasks();
  await loadAllUserTasks();
});

// Kullanıcı listesini doldur (görev atamak için)
async function loadUsers() {
  try {
    const res = await fetch(`${BASE_URL}/users`);
    const users = normalizeArray(await res.json());

    const userSel = document.getElementById("adminGoalUser");
    userSel.innerHTML = "";
    users.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.username;
      opt.textContent = u.fullName;
      userSel.appendChild(opt);
    });
  } catch (err) {
    console.error("Kullanıcılar yüklenemedi:", err);
  }
}

// Admin → Kullanıcıya yeni görev atama (backend: POST /assignTask)
async function assignTaskToUser() {
  const username = document.getElementById("adminGoalUser").value;
  const title    = document.getElementById("adminTaskTitle")?.value
                ?? document.getElementById("newTaskTitle")?.value
                ?? "";
  const points   = parseInt(
                    (document.getElementById("adminTaskPoints")?.value
                    ?? document.getElementById("newTaskPoints")?.value
                    ?? "10"),
                    10
                  ) || 10;

  const msg = document.getElementById("assignMsg");

  if (!username || !title) {
    if (msg) msg.innerText = "Lütfen kullanıcı ve başlık girin.";
    alert("Lütfen kullanıcı ve başlık girin.");
    return;
  }

  try {
    const res = await fetch(`${BASE_URL}/assignTask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, points, assignedTo: username }),
    });
    const data = await res.json();
    if (msg) msg.innerText = data.message || "✔️ Görev başarıyla atandı.";
  } catch (err) {
    if (msg) msg.innerText = "❌ Hata oluştu.";
    console.error("Görev atama hatası:", err);
  }
}

// Onay bekleyen görevleri yükle (backend: GET /pendingTasks)
// Admin burada puanı isterse düzeltebilir ve onaylayabilir (backend: POST /approveTask)
async function loadPendingTasks() {
  const list = document.getElementById("pendingList");
  if (!list) return;
  list.innerHTML = "";

  try {
    const res = await fetch(`${BASE_URL}/pendingTasks`);
    const pending = normalizeArray(await res.json());

    pending.forEach(t => {
      const li = document.createElement("li");
      li.style.display = "flex";
      li.style.alignItems = "center";
      li.style.justifyContent = "space-between";
      li.style.marginBottom = "10px";
      li.style.padding = "8px";
      li.style.background = "#eaf6ff";
      li.style.borderRadius = "6px";

      const left = document.createElement("span");
      left.textContent = `${t.title} — ${t.assignedTo}`;
      left.style.flexGrow = "1";

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.alignItems = "center";
      right.style.gap = "6px";

      const pointsInput = document.createElement("input");
      pointsInput.type = "number";
      pointsInput.min = "0";
      pointsInput.placeholder = "Puan";
      pointsInput.style.width = "64px";
      pointsInput.style.height = "30px";
      pointsInput.style.textAlign = "center";
      pointsInput.value = t.points ?? "";

      const btn = document.createElement("button");
      btn.innerText = "✅ Onayla";
      btn.style.height = "34px";
      btn.style.backgroundColor = "#00bfff";
      btn.style.color = "white";
      btn.style.border = "none";
      btn.style.borderRadius = "4px";
      btn.style.cursor = "pointer";
      btn.onclick = () =>
        approveTask(t.id, t.assignedTo, parseInt(pointsInput.value, 10) || 0);

      right.appendChild(pointsInput);
      right.appendChild(btn);
      li.appendChild(left);
      li.appendChild(right);
      list.appendChild(li);
    });
  } catch (err) {
    console.error("Onay bekleyen görevler yüklenemedi:", err);
  }
}
// Küçük yardımcı: tarih biçimleme
const fmtDate = (d) => {
  if (!d) return "-";
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString("tr-TR");
};

// Kullanıcıların TÜM görevlerini ve durumlarını getirir
async function loadAllUserTasks() {
  const list = document.getElementById("allTasksList");
  if (!list) return; // admin.html'de kart yoksa sessizce çık
  list.innerHTML = "";

  try {
    const res = await fetch(`${BASE_URL}/allTasks`);
    const rows = normalizeArray(await res.json());

    // Basit bir sıralama: pending → in-progress → available → approved
    const order = (s) =>
      s === "pending" ? 0 :
      s === "in-progress" ? 1 :
      s === "available" ? 2 :
      s === "approved" ? 3 : 9;

    rows.sort((a, b) => order(a.status) - order(b.status));

    rows.forEach(t => {
      const li = document.createElement("li");
      li.style.display = "flex";
      li.style.alignItems = "center";
      li.style.justifyContent = "space-between";
      li.style.marginBottom = "8px";
      li.style.padding = "8px";
      li.style.background = "#f0f9f0";
      li.style.borderRadius = "6px";

      // Sol taraf: Kullanıcı → Başlık (Puan)
      const left = document.createElement("div");
      left.style.flex = "1";
      left.textContent = `${t.assignedTo ?? "-"} → ${t.title} (${t.points ?? 0} puan)`;

      // Sağ taraf: Tarihler + statü rozeti
      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.alignItems = "center";
      right.style.gap = "8px";

      const meta = document.createElement("span");
      meta.style.fontSize = "12px";
      meta.style.color = "#666";
      meta.textContent = `Atandı: ${fmtDate(t.assignedAt)} · Onay: ${fmtDate(t.approvedAt)}`;

      const badge = document.createElement("span");
      badge.textContent = (t.status || "-");
      badge.style.padding = "4px 8px";
      badge.style.borderRadius = "12px";
      badge.style.fontSize = "12px";
      badge.style.background = "#e8f5e9";
      badge.style.border = "1px solid #c8e6c9";
      badge.style.textTransform = "capitalize";

      right.appendChild(meta);
      right.appendChild(badge);
      li.appendChild(left);
      li.appendChild(right);
      list.appendChild(li);
    });
  } catch (err) {
    console.error("Tüm görevler yüklenemedi:", err);
    const li = document.createElement("li");
    li.textContent = "❌ Görev listesi yüklenirken bir hata oluştu.";
    list.appendChild(li);
  }
}


// Admin onaylama işlemi (backend: POST /approveTask)
async function approveTask(taskId, username, points) {
  try {
    const res = await fetch(`${BASE_URL}/approveTask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, username, points }),
    });
    const data = await res.json();
    alert(data.message || "✔️ Görev onaylandı.");
    await loadPendingTasks();
    await loadAllUserTasks();
  } catch (err) {
    alert("❌ Onaylama işlemi başarısız oldu.");
    console.error("Onay hatası:", err);
  }
}
