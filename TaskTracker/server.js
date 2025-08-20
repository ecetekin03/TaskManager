require("dotenv").config();
const express = require("express");
const path = require("path");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(cors({ origin: "*", methods: ["GET","POST","PUT","DELETE"] }));

// --- DB Bağlantısı ---
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASS,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: false
    }
});
pool.connect()
  .then(client => client.query("SELECT NOW()")
    .then(res => { console.log("✅ DB bağlantısı başarılı:", res.rows[0]); client.release(); })
    .catch(err => { console.error("❌ DB sorgu hatası:", err.stack); client.release(); })
  ).catch(err => console.error("❌ DB bağlantı hatası:", err.stack));

// --- SMTP ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// === 1) AUTH & USER ENDPOINTS ===

// Login
app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        // DB'den kullanıcıyı sorgula
        const result = await pool.query(
            "SELECT * FROM users WHERE username = $1 AND password = $2",
            [username, password]
        );

        if (result.rows.length > 0) {
            // Kullanıcı bulundu
            res.json({ user: result.rows[0] });
        } else {
            // Kullanıcı yok veya şifre yanlış
            res.status(401).json({ message: "Geçersiz kullanıcı!" });
        }
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ message: "Sunucu hatası!" });
    }
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
app.post("/approveTask", async (req, res) => {
  const { taskId, username, points } = req.body;
  const pts = Number.isFinite(Number(points)) ? Math.trunc(Number(points)) : 0;

  try {
    await pool.query(
      "UPDATE tasks SET status='approved', points=$1, approvedAt=NOW() WHERE id=$2 AND assignedTo=$3",
      [pts, taskId, username]
    );
    await pool.query(
      "UPDATE users SET points=points+$1, level=floor((points+$1)/50)+1 WHERE username=$2",
      [pts, username]
    );
    res.json({ message:"Görev onaylandı!" });
  } catch(e) {
    res.status(500).json({ message:"DB hatası" });
  }
});

app.get("/users", async (req,res)=>{
  try {
    const result = await pool.query("SELECT username, fullName FROM users");
    res.json(result.rows);
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.get("/leaderboard", async (req,res)=>{
  try {
    const result = await pool.query("SELECT fullName, points, level FROM users ORDER BY points DESC");
    res.json(result.rows);
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

// === 2) GOALS ===
app.get("/goals", async (req,res)=>{
  try { const result = await pool.query("SELECT * FROM goals"); res.json(result.rows); }
  catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.get("/selectedGoals", async (req,res)=>{
  try {
    const result = await pool.query(
      `SELECT ug.username, ug.goalId, g.goal, g.points, ug.status
       FROM user_goals ug
       JOIN goals g ON ug.goalId=g.id`
    );
    res.json(result.rows);
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.post("/addGoal", async (req,res)=>{
  const { username, goalId } = req.body;
  try {
    await pool.query("INSERT INTO user_goals(username,goalId,status) VALUES($1,$2,'available')",
      [username,goalId]
    );
    res.json({ message:"Hedef kaydedildi!" });
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.post("/startGoal", async (req,res)=>{
  const { username, goalId } = req.body;
  try {
    await pool.query(
      "UPDATE user_goals SET status='in-progress' WHERE username=$1 AND goalId=$2",
      [username, goalId]
    );
    res.json({ message:"Hedef başlatıldı!" });
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.post("/finishGoal", async (req,res)=>{
  const { username, goalId } = req.body;
  try {
    await pool.query(
      "UPDATE user_goals SET status='pending' WHERE username=$1 AND goalId=$2",
      [username, goalId]
    );
    res.json({ message:"Hedef onaya gönderildi!" });
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.get("/pendingGoals", async (req,res)=>{
  try {
    const result = await pool.query(
      `SELECT ug.username, ug.goalId, g.goal, g.points
       FROM user_goals ug
       JOIN goals g ON ug.goalId=g.id
       WHERE ug.status='pending'`
    );
    res.json(result.rows);
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.post("/approveGoal", async (req,res)=>{
  const { username, goalId } = req.body;
  try {
    await pool.query("UPDATE user_goals SET status='approved' WHERE username=$1 AND goalId=$2",
      [username, goalId]
    );
    const goalRes = await pool.query("SELECT points FROM goals WHERE id=$1",[goalId]);
    const points = goalRes.rows[0]?.points || 0;
    await pool.query(
      "UPDATE users SET points=points+$1, level=floor((points+$1)/50)+1 WHERE username=$2",
      [points, username]
    );
    res.json({ message:"Hedef onaylandı!" });
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

// === 3) TASKS ===
app.post("/assignTask", async (req,res)=>{
  const { title, points, assignedTo } = req.body;
  const pts = Number.isFinite(Number(points)) ? Math.trunc(Number(points)) : 0;
  const assignedAt = new Date().toISOString().slice(0,10);
  try {
    await pool.query(
      "INSERT INTO tasks(title,points,assignedTo,status,assignedAt) VALUES($1,$2,$3,'available',$4)",
      [title,pts,assignedTo,assignedAt]
    );
    res.json({ message:"Görev atandı!" });
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.get("/tasks/:username", async (req,res)=>{
  const uname = req.params.username;
  try {
    const result = await pool.query(
      "SELECT * FROM tasks WHERE assignedTo=$1 AND status IN ('available','in-progress','pending','approved')",
      [uname]
    );
    res.json(result.rows);
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.post("/startTask", async (req,res)=>{
  const { taskId, username } = req.body;
  try {
    await pool.query(
      "UPDATE tasks SET status='in-progress' WHERE id=$1 AND assignedTo=$2",
      [taskId, username]
    );
    res.json({ message:"Görev başlatıldı!" });
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.post("/finishTask", async (req,res)=>{
  const { taskId, username } = req.body;
  try {
    await pool.query(
      "UPDATE tasks SET status='pending' WHERE id=$1 AND assignedTo=$2",
      [taskId, username]
    );
    res.json({ message:"Görev onaya gönderildi!" });
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.get("/pendingTasks", async (req,res)=>{
  try {
    const result = await pool.query("SELECT * FROM tasks WHERE status='pending'");
    res.json(result.rows);
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.post("/approveTask", async (req,res)=>{
  const { taskId, username, points } = req.body;
  const pts = Number.isFinite(Number(points)) ? Math.trunc(Number(points)) : 0;
  try {
    await pool.query(
      "UPDATE tasks SET status='approved', points=$1, approvedAt=NOW() WHERE id=$2 AND assignedTo=$3",
      [pts, taskId, username]
    );
    await pool.query(
      "UPDATE users SET points=points+$1, level=floor((points+$1)/50)+1 WHERE username=$2",
      [pts, username]
    );
    res.json({ message:"Görev onaylandı!" });
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

app.get("/completed/:username", async (req,res)=>{
  const uname = req.params.username;
  try {
    const result = await pool.query(
      "SELECT * FROM tasks WHERE assignedTo=$1 AND status='approved'",
      [uname]
    );
    res.json(result.rows);
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

// === 4) WEEKLY STATS ===
app.get("/weeklyStats/:username", async (req,res)=>{
  const uname = req.params.username;
  try {
    const result = await pool.query(
      "SELECT date, pointsEarned FROM daily_points WHERE username=$1 ORDER BY date ASC",
      [uname]
    );
    res.json(result.rows);
  } catch(e){ res.status(500).json({ message:"DB hatası" }); }
});

// === 5) DAILY CRON ===
cron.schedule("0 17 * * *", async ()=>{
  const today = new Date().toISOString().slice(0,10);
  console.log("📬 Cron tetiklendi:", today);

  try {
    const usersRes = await pool.query("SELECT * FROM users");
    const tasksRes = await pool.query("SELECT * FROM tasks WHERE status='approved'");
    for(const u of usersRes.rows){
      const done = tasksRes.rows.filter(t=>t.assignedto===u.username && t.approvedat?.startsWith(today));
      if(!done.length) continue;

      const body = done.map(t=>`• ${t.title} → ${t.points} puan`).join("\n");
      await transporter.sendMail({
        from: `"Görev Takip" <${process.env.EMAIL_USER}>`,
        to: u.email,
        subject: `${today} Günlük Görev Özeti`,
        text: `Merhaba ${u.fullname},\n\nBugün tamamladığın görevler:\n\n${body}`
      });

      const total = done.reduce((s,t)=>s+t.points,0);
      await pool.query(
        "INSERT INTO daily_points(username,date,pointsEarned) VALUES($1,$2,$3)",
        [u.username,today,total]
      );
    }

    // Onaylanan görevleri temizle
    await pool.query("DELETE FROM tasks WHERE status='approved' AND approvedAt LIKE $1", [`${today}%`]);
  } catch(e){ console.error("Cron hatası:", e); }
},{ timezone:"Europe/Istanbul" });

// === SERVER START ===
const port = process.env.PORT || 3000;
app.listen(port,()=>console.log(`Server running on port ${port}`));

