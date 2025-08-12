// admin.js – sadece admin.html sayfası tarafından kullanılır

// Sayfa açıldığında kullanıcı ve görev listelerini doldur
window.addEventListener("DOMContentLoaded", async () => {
  await loadUsersAndTasks();
  await loadPendingTasks();
});

// Kullanıcı ve görev listelerini doldur
async function loadUsersAndTasks() {
  try {
    const [usersRes, tasksRes] = await Promise.all([
      fetch("/users"),
      fetch("/tasks")
    ]);
    const users = await usersRes.json();
    const tasks = await tasksRes.json();

    const userSel = document.getElementById("adminGoalUser");
    const taskSel = document.getElementById("adminTaskSelect");

    users.forEach(user => {
      const opt = document.createElement("option");
      opt.value = user.username;
      opt.textContent = user.fullName;
      userSel.appendChild(opt);
    });

    tasks.forEach(task => {
      const opt = document.createElement("option");
      opt.value = task.id;
      opt.textContent = `${task.description} (${task.points} puan)`;
      taskSel.appendChild(opt);
    });
  } catch (err) {
    console.error("Veri yükleme hatası:", err);
  }
}

// Admin görev atama fonksiyonu
async function assignTaskToUser() {
  const username = document.getElementById("adminGoalUser").value;
  const taskId = parseInt(document.getElementById("adminTaskSelect").value);
  const msg = document.getElementById("assignMsg");
  try {
    const res = await fetch("/assign-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, taskId })
    });
    const data = await res.json();
    msg.innerText = data.message || "✔️ Görev başarıyla atandı.";
  } catch (err) {
    msg.innerText = "❌ Hata oluştu.";
    console.error("Görev atama hatası:", err);
  }
}

// Onay bekleyen görevleri yükle ve listele
async function loadPendingTasks() {
  const list = document.getElementById("pendingList");
  list.innerHTML = "";
  try {
    const res = await fetch("/pending");
    const pending = await res.json();
    pending.forEach(item => {
      const li = document.createElement("li");
      li.textContent = `${item.username} → ${item.task.description}`;

      const btn = document.createElement("button");
      btn.innerText = "✅ Onayla";
      btn.onclick = () => approveTask(item.username, item.task.id);

      li.appendChild(btn);
      list.appendChild(li);
    });
  } catch (err) {
    console.error("Onay görevleri yüklenemedi:", err);
  }
}

// Admin onaylama işlemi
async function approveTask(username, taskId) {
  try {
    const res = await fetch("/approve-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, taskId })
    });
    const data = await res.json();
    alert(data.message || "✔️ Görev onaylandı.");
    await loadPendingTasks();
  } catch (err) {
    alert("❌ Onaylama işlemi başarısız oldu.");
    console.error("Onay hatası:", err);
  }
}
