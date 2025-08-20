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

// --- DB BAĞLANTISI ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(client =>
    client.query("SELECT NOW() AS now")
      .then(res => {
        console.log("✅ DB bağlantısı başarılı:", res.rows[0]);
        client.release();
      })
      .catch(err => {
        console.error("❌ DB sorgu hatası:", err.stack);
        client.release();
      })
  )
  .catch(err => console.error("❌ DB bağlantı hatası:", err.stack));

// --- SMTP ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- HEALTH ---
app.get("/health/db", async (_req, res) => {
  try { const r = await pool.query("SELECT NOW() AS now"); res.json({ ok:true, now:r.rows[0].now }); }
  catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

// === AUTH ===
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1 AND password = $2",
      [username, password]
    );
    if (result.rows.length > 0) {
      const user = result.rows[0];
      delete user.password; // güvenlik
      res.json({ user });
    } else {
      res.status(401).json({ message: "Geçersiz kullanıcı!" });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Sunucu hatası!" });
  }
});

// === USERS & LEADERBOARD ===
app.get("/users", async (_req, res) => {
  try {
    const q = `SELECT username, "fullName" FROM users`;
    const result = await pool.query(q);
    res.json(result.rows);
  } catch (e) { console.error(e); res.status(500).json({ message: "DB hatası" }); }
});

app.get("/leaderboard", async (_req, res) => {
  try {
    const q = `SELECT "fullName", points, level FROM users ORDER BY points DESC`;
    const result = await pool.query(q);
    res.json(result.rows);
  } catch (e) { console.error(e); res.status(500).json({ message: "DB hatası" }); }
});

// === GOALS ===
app.get("/goals", async (_req,res)=>{
  try { const result = await pool.query("SELECT * FROM goals"); res.json(result.rows); }
  catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.get("/selectedGoals", async (_req,res)=>{
  try {
    const q = `SELECT ug.username,
                      ug."goalId",
                      g.goal,
                      g.points,
                      ug.status
                 FROM user_goals ug
                 JOIN goals g ON ug."goalId" = g.id`;
    const result = await pool.query(q);
    res.json(result.rows);
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.post("/addGoal", async (req,res)=>{
  const { username, goalId } = req.body;
  try {
    await pool.query(
      "INSERT INTO user_goals(username, \"goalId\", status) VALUES($1,$2,'available')",
      [username, goalId]
    );
    res.json({ message:"Hedef kaydedildi!" });
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.post("/startGoal", async (req,res)=>{
  const { username, goalId } = req.body;
  try {
    await pool.query(
      "UPDATE user_goals SET status='in-progress' WHERE username=$1 AND \"goalId\"=$2",
      [username, goalId]
    );
    res.json({ message:"Hedef başlatıldı!" });
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.post("/finishGoal", async (req,res)=>{
  const { username, goalId } = req.body;
  try {
    await pool.query(
      "UPDATE user_goals SET status='pending' WHERE username=$1 AND \"goalId\"=$2",
      [username, goalId]
    );
    res.json({ message:"Hedef onaya gönderildi!" });
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.get("/pendingGoals", async (_req,res)=>{
  try {
    const q = `SELECT ug.username, ug."goalId", g.goal, g.points
                 FROM user_goals ug JOIN goals g ON ug."goalId"=g.id
                WHERE ug.status='pending'`;
    const result = await pool.query(q);
    res.json(result.rows);
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.post("/approveGoal", async (req,res)=>{
  const { username, goalId } = req.body;
  try {
    await pool.query(
      "UPDATE user_goals SET status='approved' WHERE username=$1 AND \"goalId\"=$2",
      [username, goalId]
    );
    const goalRes = await pool.query("SELECT points FROM goals WHERE id=$1", [goalId]);
    const points = goalRes.rows[0]?.points || 0;
    await pool.query(
      "UPDATE users SET points=points+$1, level=floor((points+$1)/50)+1 WHERE username=$2",
      [points, username]
    );
    res.json({ message:"Hedef onaylandı!" });
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

// === TASKS ===
app.post("/assignTask", async (req,res)=>{
  const { title, points, assignedTo } = req.body;
  const pts = Number.isFinite(Number(points)) ? Math.trunc(Number(points)) : 0;
  const assignedAt = new Date().toISOString().slice(0,10);
  // DİKKAT: tasks.id BIGINT ve auto-increment yok → id üretelim
  const id = Date.now() + Math.floor(Math.random()*1000); // çakışma ihtimali çok düşük
  try {
    await pool.query(
      `INSERT INTO tasks(id, title, points, "assignedTo", status, "assignedAt")
       VALUES($1,$2,$3,$4,'available',$5)`,
      [id, title, pts, assignedTo, assignedAt]
    );
    res.json({ message:"Görev atandı!", id });
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.get("/tasks/:username", async (req,res)=>{
  const uname = req.params.username;
  try {
    const q = `SELECT id, title, points, "assignedTo", status, "assignedAt", "approvedAt"
                 FROM tasks WHERE "assignedTo"=$1
                   AND status IN ('available','in-progress','pending','approved')`;
    const result = await pool.query(q, [uname]);
    res.json(result.rows);
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.post("/startTask", async (req,res)=>{
  const { taskId, username } = req.body;
  try {
    await pool.query(
      "UPDATE tasks SET status='in-progress' WHERE id=$1 AND \"assignedTo\"=$2",
      [taskId, username]
    );
    res.json({ message:"Görev başlatıldı!" });
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.post("/finishTask", async (req,res)=>{
  const { taskId, username } = req.body;
  try {
    await pool.query(
      "UPDATE tasks SET status='pending' WHERE id=$1 AND \"assignedTo\"=$2",
      [taskId, username]
    );
    res.json({ message:"Görev onaya gönderildi!" });
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.get("/pendingTasks", async (_req,res)=>{
  try {
    const result = await pool.query(
      `SELECT id, title, points, "assignedTo", status, "assignedAt", "approvedAt"
         FROM tasks WHERE status='pending'`
    );
    res.json(result.rows);
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.post("/approveTask", async (req,res)=>{
  const { taskId, username, points } = req.body;
  const pts = Number.isFinite(Number(points)) ? Math.trunc(Number(points)) : 0;
  try {
    await pool.query(
      "UPDATE tasks SET status='approved', points=$1, \"approvedAt\"=NOW() WHERE id=$2 AND \"assignedTo\"=$3",
      [pts, taskId, username]
    );
    await pool.query(
      "UPDATE users SET points=points+$1, level=floor((points+$1)/50)+1 WHERE username=$2",
      [pts, username]
    );
    res.json({ message:"Görev onaylandı!" });
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

app.get("/completed/:username", async (req,res)=>{
  const uname = req.params.username;
  try {
    const result = await pool.query(
      `SELECT id, title, points, "assignedTo", status, "assignedAt", "approvedAt"
         FROM tasks WHERE "assignedTo"=$1 AND status='approved'`,
      [uname]
    );
    res.json(result.rows);
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

// === WEEKLY STATS ===
app.get("/weeklyStats/:username", async (req,res)=>{
  const uname = req.params.username;
  try {
    const result = await pool.query(
      `SELECT date, "pointsEarned" FROM daily_points WHERE username=$1 ORDER BY date ASC`,
      [uname]
    );
    res.json(result.rows);
  } catch(e){ console.error(e); res.status(500).json({ message:"DB hatası" }); }
});

// === DAILY CRON ===
cron.schedule("0 17 * * *", async ()=>{
  const today = new Date().toISOString().slice(0,10); // YYYY-MM-DD
  console.log("📬 Cron tetiklendi:", today);
  try {
    const usersRes = await pool.query("SELECT * FROM users");

    // Bugün onaylanan görevleri SQL tarafında filtrele
    const tasksTodayRes = await pool.query(
      `SELECT id, title, points, "assignedTo" FROM tasks WHERE status='approved' AND "approvedAt"::date = $1::date`,
      [today]
    );

    for (const u of usersRes.rows) {
      const done = tasksTodayRes.rows.filter(t => t.assignedTo === u.username);
      if (!done.length) continue;

      const body = done.map(t=>`• ${t.title} → ${t.points} puan`).join("
");

      await transporter.sendMail({
        from: `"Görev Takip" <${process.env.EMAIL_USER}>`,
        to: u.email,
        subject: `${today} Günlük Görev Özeti`,
        text: `Merhaba ${u."fullName"},

Bugün tamamladığın görevler:

${body}`
      });

      const total = done.reduce((s,t)=>s + (t.points||0), 0);
      await pool.query(
        "INSERT INTO daily_points(username, date, \"pointsEarned\") VALUES($1,$2,$3)",
        [u.username, today, total]
      );
    }

    // Bugün onaylanan görevleri temizle (opsiyonel)
    await pool.query(
      `DELETE FROM tasks WHERE status='approved' AND "approvedAt"::date = $1::date`,
      [today]
    );
  } catch(e){ console.error("Cron hatası:", e); }
},{ timezone:"Europe/Istanbul" });

// === SERVER START ===
const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log(`🚀 Server running on port ${port}`));
