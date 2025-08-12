// server.js

require("dotenv").config();
const express    = require("express");
const fs         = require("fs");
const path       = require("path");
const cron       = require("node-cron");
const nodemailer = require("nodemailer");
const app        = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const USERS_PATH        = "./data/users.json";
const TASKS_PATH        = "./data/tasks.json";
const GOALS_PATH        = "./data/goals.json";
const USER_GOALS_PATH   = "./data/userGoals.json";
const DAILY_POINTS_PATH = "./data/dailyPoints.json";

// --- Verileri yükle ---
let users      = JSON.parse(fs.readFileSync(USERS_PATH));
let tasks      = JSON.parse(fs.readFileSync(TASKS_PATH));
let goals      = JSON.parse(fs.readFileSync(GOALS_PATH));
let userGoals  = fs.existsSync(USER_GOALS_PATH)
                   ? JSON.parse(fs.readFileSync(USER_GOALS_PATH))
                   : [];

// --- SMTP Transporter ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// === 1) AUTH & USER ENDPOINTS ===

// Login
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (user) res.json({ user });
  else      res.status(401).json({ message: "Geçersiz kullanıcı!" });
});

// Tüm kullanıcılar (admin dropdown için)
app.get("/users", (req, res) => {
  res.json(users.map(u => ({ username: u.username, fullName: u.fullName })));
});

// Leaderboard
app.get("/leaderboard", (req, res) => {
  const lb = users
    .map(u => ({ fullName: u.fullName, points: u.points, level: u.level }))
    .sort((a,b) => b.points - a.points);
  res.json(lb);
});

// === 2) UZUN VADELİ HEDEFLER AKIŞI ===

// Mevcut hedefler listesi
app.get("/goals", (req, res) => {
  res.json(goals);
});

// Kullanıcının seçtiği hedefler (tüm ekip + durumları)
app.get("/selectedGoals", (req, res) => {
  const detailed = userGoals.map(ug => {
    const g = goals.find(goal => goal.id === ug.goalId);
    return {
      username: ug.username,
      goalId:   ug.goalId,
      goal:     g ? g.goal   : "N/A",
      points:   g ? g.points : 0,
      status:   ug.status
    };
  });
  res.json(detailed);
});

// Hedef seç
app.post("/addGoal", (req, res) => {
  const { username, goalId } = req.body;
  userGoals.push({ username, goalId, status: "available" });
  fs.writeFileSync(USER_GOALS_PATH, JSON.stringify(userGoals, null, 2));
  res.json({ message: "Hedef kaydedildi!" });
});

// Hedef başlat
app.post("/startGoal", (req, res) => {
  const { username, goalId } = req.body;
  const g = userGoals.find(x=>x.username===username && x.goalId===goalId);
  if (!g) return res.status(400).json({ message:"Hedef bulunamadı!" });
  g.status = "in-progress";
  fs.writeFileSync(USER_GOALS_PATH, JSON.stringify(userGoals, null, 2));
  res.json({ message:"Hedef başlatıldı!" });
});

// Hedef bitir → onaya gönder
app.post("/finishGoal", (req, res) => {
  const { username, goalId } = req.body;
  const g = userGoals.find(x=>x.username===username && x.goalId===goalId);
  if (!g) return res.status(400).json({ message:"Hedef bulunamadı!" });
  g.status = "pending";
  fs.writeFileSync(USER_GOALS_PATH, JSON.stringify(userGoals, null, 2));
  res.json({ message:"Hedef onaya gönderildi!" });
});

// Admin: onay bekleyen hedefler
app.get("/pendingGoals", (req, res) => {
  const pending = userGoals
    .filter(x => x.status==="pending")
    .map(x => {
      const goal = goals.find(gg => gg.id===x.goalId);
      return { username:x.username, goalId:x.goalId, goal:goal.goal, points:goal.points };
    });
  res.json(pending);
});

// Admin: hedef onayla
app.post("/approveGoal", (req, res) => {
  const { username, goalId } = req.body;
  const g   = userGoals.find(x=>x.username===username && x.goalId===goalId);
  const usr = users.find(u=>u.username===username);
  if (!g || !usr) return res.status(400).json({ message:"Onaylanacak hedef bulunamadı!" });
  g.status = "approved";
  const goal = goals.find(gg=>gg.id===goalId);
  usr.points += goal.points;
  usr.level   = Math.floor(usr.points/50)+1;
  fs.writeFileSync(USER_GOALS_PATH, JSON.stringify(userGoals, null, 2));
  fs.writeFileSync(USERS_PATH,      JSON.stringify(users,     null, 2));
  res.json({ message:"Hedef onaylandı!" });
});

// === 3) GÜNLÜK GÖREV AKIŞI ===

// Atama (admin)

app.post("/assignTask", (req, res) => {
  const { title, points, assignedTo } = req.body;
  const id = Date.now();
  const pts = Number.isFinite(Number(points)) ? Math.trunc(Number(points)) : 0;

  const assignedAt = new Date().toISOString().slice(0, 10); // YYYY-MM-DD formatında tarih

  tasks.push({ id, title, points: pts, assignedTo, status: "available", assignedAt });

  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2));
  res.json({ message: "Görev atandı!" });
});



// Kullanıcının güncel görevleri
app.get("/tasks/:username", (req, res) => {
  res.json(tasks.filter(t=>
    t.assignedTo===req.params.username &&
    ["available","in-progress","pending","approved"].includes(t.status)
  ));
});

// Başla
app.post("/startTask", (req, res) => {
  const { taskId, username } = req.body;
  const t = tasks.find(x=>x.id===taskId && x.assignedTo===username);
  if (!t) return res.status(400).json({ message:"Görev bulunamadı!" });
  t.status = "in-progress";
  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2));
  res.json({ message:"Görev başlatıldı!" });
});

// Bitir → onaya gönder
app.post("/finishTask", (req, res) => {
  const { taskId, username } = req.body;
  const t = tasks.find(x=>x.id===taskId && x.assignedTo===username);
  if (!t) return res.status(400).json({ message:"Görev bulunamadı!" });
  t.status = "pending";
  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2));
  res.json({ message:"Görev onaya gönderildi!" });
});

// Admin: onay bekleyen görevler
app.get("/pendingTasks", (req, res) => {
  res.json(tasks.filter(t=>t.status==="pending"));
});

// Admin: görev onayla
app.post("/approveTask", (req, res) => {
  try {
    const { taskId, username, points } = req.body;

    // Güvenli parse
    const newPoints = Number.isFinite(Number(points)) ? Math.trunc(Number(points)) : 0;
    if (newPoints < 0) return res.status(400).json({ message: "Puan negatif olamaz." });

    // Diskten en güncel veriyi oku
    const tasksRaw = fs.readFileSync(TASKS_PATH, "utf8");
    const usersRaw = fs.readFileSync(USERS_PATH, "utf8");
    const tasksOnDisk = JSON.parse(tasksRaw);
    const usersOnDisk = JSON.parse(usersRaw);

    // task'ı bul
    const task = tasksOnDisk.find(t => String(t.id) === String(taskId) && t.assignedTo === username);
    if (!task) return res.status(400).json({ message: "Onaylanacak görev bulunamadı!" });

    // Önceki durum ve eski puan
    const wasApproved = task.status === "approved";
    const oldPoints = Number.isFinite(Number(task.points)) ? Math.trunc(Number(task.points)) : 0;

    // Görevi güncelle
    task.points = newPoints;
    task.status = "approved";
    task.approvedAt = new Date().toISOString();

    // tasks.json'ı atomik şekilde yaz
    const tmpTasksPath = TASKS_PATH + ".tmp";
    fs.writeFileSync(tmpTasksPath, JSON.stringify(tasksOnDisk, null, 2), "utf8");
    fs.renameSync(tmpTasksPath, TASKS_PATH);

    // Kullanıcıyı bul ve sadece değişikliği uygula (delta)
    const user = usersOnDisk.find(u => u.username === username);
    if (!user) return res.status(400).json({ message: "Kullanıcı bulunamadı!" });

    // Eğer görev daha önce onaylı değilse -> kullanıcıya +newPoints ekle
    // Eğer daha önce onaylıysa -> kullanıcıdan oldPoints çıkarıp newPoints ekle (fark)
    if (!wasApproved) {
      user.points = (Number.isFinite(Number(user.points)) ? Math.trunc(Number(user.points)) : 0) + newPoints;
    } else {
      user.points = (Number.isFinite(Number(user.points)) ? Math.trunc(Number(user.points)) : 0) - oldPoints + newPoints;
    }

    if (user.points < 0) user.points = 0;
    user.level = Math.floor(user.points / 50) + 1;

    // users.json'ı atomik şekilde yaz
    const tmpUsersPath = USERS_PATH + ".tmp";
    fs.writeFileSync(tmpUsersPath, JSON.stringify(usersOnDisk, null, 2), "utf8");
    fs.renameSync(tmpUsersPath, USERS_PATH);

    // Sunucudaki in-memory değişkenleri de senkronize et
    try {
      users = usersOnDisk;
      tasks = tasksOnDisk;
    } catch (e) {
      console.warn("In-memory sync failed (non-fatal):", e);
    }

    return res.json({ message: "✔️ Görev onaylandı!", user: { username: user.username, points: user.points, level: user.level } });
  } catch (err) {
    console.error("approveTask error:", err);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
});


// Kullanıcıya onaylanmış günlük görevler
app.get("/completed/:username", (req, res) => {
  res.json(tasks.filter(t=>
    t.assignedTo===req.params.username && t.status==="approved"
  ));
});

// === 4) HAFTALIK PERFORMANS ENDPOINT’İ ===

// Son 7 günün günlük puan toplamları
app.get("/weeklyStats/:username", (req, res) => {
  const uname = req.params.username;
  const all   = fs.existsSync(DAILY_POINTS_PATH)
              ? JSON.parse(fs.readFileSync(DAILY_POINTS_PATH))
              : [];
  const today = new Date();
  const days  = [];
  for (let i=6; i>=0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate()-i);
    days.push(d.toISOString().slice(0,10));
  }
  const stats = days.map(date => {
    const e = all.find(x=>x.username===uname && x.date===date);
    return e ? e.pointsEarned : 0;
  });
  // döndür: [{ date:"2025-07-01", points: 5 }, … ]
  res.json(days.map((date,i) => ({ date, points: stats[i] })));
});

// === 5) GÜNLÜK E-MAİL & TEMİZLEME CRON’u ===

cron.schedule(
  "00 17 * * *",  // Her gün saat 10:50'de çalışır         
  () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: "Europe/Istanbul" });
    console.log("📬 Cron tetiklendi:", new Date().toString());

    // 1) dailyPoints.json'u oku veya boş liste başlat
    let dailyLocal = fs.existsSync(DAILY_POINTS_PATH)
      ? JSON.parse(fs.readFileSync(DAILY_POINTS_PATH))
      : [];

    // 2) Kullanıcı bazlı mail + puan kaydı
    users.forEach(u => {
      const done = tasks.filter(t =>
        t.assignedTo === u.username &&
        t.status === "approved" &&
        t.approvedAt?.startsWith(today)
      );
      if (!done.length) return;

      // E-posta içeriği oluştur
      const body = done.map(t => `• ${t.title} → ${t.points} puan`).join("\n");

      // Mail gönder
      transporter.sendMail({
        from: `"Görev Takip" <${process.env.EMAIL_USER}>`,
        to: u.email,
        subject: `${today} Günlük Görev Özeti`,
        text: `Merhaba ${u.fullName},\n\nBugün tamamladığın görevler:\n\n${body}`
      }).catch(console.error);

      // Kullanıcının bugünkü toplam puanını hesapla
      const total = done.reduce((s, t) =>
        s + (Number.isFinite(Number(t.points)) ? Math.trunc(Number(t.points)) : 0), 0);

      // dailyPoints array'ine ekle
      dailyLocal.push({ username: u.username, date: today, pointsEarned: total });
    });

    // 3) Adminlere genel rapor maili
    const allDone = tasks.filter(t =>
      t.status === "approved" && t.approvedAt?.startsWith(today)
    );
    const adminEmails = users.filter(u => u.isAdmin).map(u => u.email);
    if (allDone.length && adminEmails.length) {
      const lines = allDone.map(t => {
        const u = users.find(x => x.username === t.assignedTo);
        return `• ${u.fullName}: ${t.title} (${t.points} puan)`;
      }).join("\n");

      transporter.sendMail({
        from: `"Görev Takip" <${process.env.EMAIL_USER}>`,
        to: adminEmails,
        subject: `${today} Tüm Kullanıcıların Günlük Raporu`,
        text: `Merhaba,\n\nBugün tüm kullanıcıların tamamladığı görevler:\n\n${lines}`
      }).catch(console.error);
    }
     console.log("Silindikten sonra görev sayısı:", tasks.length);
     const afterWrite = JSON.parse(fs.readFileSync(TASKS_PATH));
     console.log("Dosyadan okunan görev sayısı:", afterWrite.length);

    // 4) dailyPoints.json'u güncelle
    fs.writeFileSync(DAILY_POINTS_PATH, JSON.stringify(dailyLocal, null, 2));

    // 5) Bugün onaylanan görevleri dosyadan temizle
    tasks = tasks.filter(t =>
      !(t.status === "approved" && t.approvedAt?.startsWith(today))
    );
    fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2));
  },
  { timezone: "Europe/Istanbul" }
);


// === SERVER START ===
//app.listen(3000, () => console.log("Server http://localhost:3000"));
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
