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
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(client => client.query("SELECT NOW()")
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
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// === AUTH ===
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      `
      SELECT
        username,
        password,
        fullname AS "fullName",   -- tablo: fullname (küçük) → alias ile camelCase
        email,
        points,
        level,
        COALESCE(isadmin, FALSE) AS "isAdmin"  -- tablo: isadmin (küçük) → alias
      FROM users
      WHERE username = $1 AND password = $2
      `,
      [username, password]
    );

    if (result.rows.length > 0) {
      res.json({ user: result.rows[0] });
    } else {
      res.status(401).json({ message: "Geçersiz kullanıcı!" });
    }
  } catch (err) {
    console.error("Login error:", err); // hatayı logla
    res.status(500).json({ message: "Sunucu hatası!" });
  }
});




// === USERS & LEADERBOARD ===
app.get("/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT username, fullName FROM users");
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ message: "DB hatası" });
  }
});

app.get("/leaderboard", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT fullName, points, level FROM users ORDER BY points DESC"
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ message: "DB hatası" });
  }
});

// === GOALS ===
app.get("/goals", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, goal, points
      FROM goals
      ORDER BY id
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ message: "DB hatası" });
  }
});

app.get("/selectedGoals", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ug.username,
        ug.goalid AS "goalId",
        COALESCE(g.goal, '(hedef bulunamadı)') AS goal,
        COALESCE(g.points, 0)                  AS points,
        ug.status
      FROM user_goals ug
      LEFT JOIN goals g ON ug.goalid = g.id
      ORDER BY ug.username, ug.goalid
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ message: "DB hatası" });
  }
});

app.post("/addGoal", async (req, res) => {
  const { username, goalId } = req.body;
  try {
    await pool.query(`
      INSERT INTO user_goals (username, goalid, status)
      VALUES ($1, $2, 'available')
      ON CONFLICT (username, goalid) DO NOTHING
    `, [username, goalId]);
    res.json({ message: "Hedef kaydedildi!" });
  } catch (e) {
    res.status(500).json({ message: "DB hatası" });
  }
});

app.post("/startGoal", async (req, res) => {
  const { username, goalId } = req.body;
  try {
    await pool.query(`
      UPDATE user_goals
      SET status='in-progress'
      WHERE username=$1 AND goalid=$2
    `, [username, goalId]);
    res.json({ message: "Hedef başlatıldı!" });
  } catch (e) {
    res.status(500).json({ message: "DB hatası" });
  }
});

app.post("/finishGoal", async (req, res) => {
  const { username, goalId } = req.body;
  try {
    await pool.query(`
      UPDATE user_goals
      SET status='pending'
      WHERE username=$1 AND goalid=$2
    `, [username, goalId]);
    res.json({ message: "Hedef onaya gönderildi!" });
  } catch (e) {
    res.status(500).json({ message: "DB hatası" });
  }
});

app.get("/pendingGoals", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ug.username,
        ug.goalid AS "goalId",
        COALESCE(g.goal, '(hedef bulunamadı)') AS goal,
        COALESCE(g.points, 0)                  AS points
      FROM user_goals ug
      LEFT JOIN goals g ON ug.goalid = g.id
      WHERE ug.status='pending'
      ORDER BY ug.username, ug.goalid
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ message: "DB hatası" });
  }
});

app.post("/approveGoal", async (req, res) => {
  const { username, goalId } = req.body;
  try {
    // status'u approved yap
    const upd = await pool.query(`
      UPDATE user_goals
      SET status='approved'
      WHERE username=$1 AND goalid=$2
      RETURNING 1
    `, [username, goalId]);

    // (isteğe bağlı güvenlik) kayıt bulunmadıysa:
    if (upd.rowCount === 0) {
      return res.status(404).json({ message: "Kayıt bulunamadı" });
    }

    // puanı çek
    const goalRes = await pool.query(`
      SELECT points FROM goals WHERE id=$1
    `, [goalId]);
    const points = goalRes.rows[0]?.points ?? 0;

    // kullanıcı puan/level güncelle
    await pool.query(`
      UPDATE users
      SET points = points + $1,
          level  = FLOOR((points + $1)/50) + 1
      WHERE username = $2
    `, [points, username]);

    res.json({ message: "Hedef onaylandı!" });
  } catch (e) {
    res.status(500).json({ message: "DB hatası" });
  }
});


// === TASKS ===
// === TASKS ===
app.post("/assignTask", async (req, res) => {
  console.log("assignTask INCOMING body:", req.body);
  const { title, points, assignedTo } = req.body;

  if (!title || !assignedTo) {
    return res.status(400).json({ message: "title ve assignedTo zorunlu" });
  }

  const pts = Number.isFinite(Number(points)) ? Math.trunc(Number(points)) : 0;
  const assignedAt = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    // DİKKAT: DB kolonu assignetat (şu anki şeman böyle)
    const r = await pool.query(
      `
      INSERT INTO tasks (title, points, assignedto, status, assignetat)
      VALUES ($1, $2, $3, 'available', $4)
      RETURNING id
      `,
      [title, pts, assignedTo, assignedAt]
    );
    res.json({ message: "Görev atandı!", id: r.rows[0].id });
  } catch (e) {
    console.error("assignTask hata:", e);
    res.status(500).json({ message:"DB hatası", error: String(e) });
  }
});

app.get("/tasks/:username", async (req, res) => {
  const uname = req.params.username;
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        title,
        points,
        assignedto AS "assignedTo",
        status,
        assignetat AS "assignedAt",
        approvedat AS "approvedAt"
      FROM tasks
      WHERE LOWER(assignedto) = LOWER($1)
        AND status IN ('available','in-progress','pending','approved')
      ORDER BY id DESC
      `,
      [uname]
    );
    res.json(result.rows);
  } catch (e) {
    console.error("tasks hata:", e);
    res.status(500).json({ message: "DB hatası" });
  }
});

app.post("/startTask", async (req, res) => {
  const { taskId, username } = req.body;
  try {
    const r = await pool.query(
      `UPDATE tasks SET status='in-progress' WHERE id=$1 AND LOWER(assignedto)=LOWER($2)`,
      [taskId, username]
    );
    res.json({ message: r.rowCount ? "Görev başlatıldı!" : "Kayıt bulunamadı" });
  } catch (e) {
    console.error("startTask hata:", e);
    res.status(500).json({ message: "DB hatası" });
  }
});

app.post("/finishTask", async (req, res) => {
  const { taskId, username } = req.body;
  try {
    const r = await pool.query(
      `UPDATE tasks SET status='pending' WHERE id=$1 AND LOWER(assignedto)=LOWER($2)`,
      [taskId, username]
    );
    res.json({ message: r.rowCount ? "Görev onaya gönderildi!" : "Kayıt bulunamadı" });
  } catch (e) {
    console.error("finishTask hata:", e);
    res.status(500).json({ message: "DB hatası" });
  }
});

app.get("/pendingTasks", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        title,
        points,
        assignedto AS "assignedTo",
        status,
        assignetat AS "assignedAt",
        approvedat AS "approvedAt"
      FROM tasks
      WHERE status='pending'
      ORDER BY id DESC
    `);
    res.json(result.rows);
  } catch (e) {
    console.error("pendingTasks hata:", e);
    res.status(500).json({ message: "DB hatası" });
  }
});

app.post("/approveTask", async (req, res) => {
  const { taskId, username, points } = req.body;
  const pts = Number.isFinite(Number(points)) ? Math.trunc(Number(points)) : 0;
  try {
    const r1 = await pool.query(
      `UPDATE tasks SET status='approved', points=$1, approvedat=NOW() WHERE id=$2 AND LOWER(assignedto)=LOWER($3)`,
      [pts, taskId, username]
    );
    if (!r1.rowCount) return res.status(404).json({ message: "Kayıt bulunamadı" });

    await pool.query(
      `UPDATE users SET points=points+$1, level=floor((points+$1)/50)+1 WHERE username=$2`,
      [pts, username]
    );
    res.json({ message: "Görev onaylandı!" });
  } catch (e) {
    console.error("approveTask hata:", e);
    res.status(500).json({ message: "DB hatası" });
  }
});

app.get("/completed/:username", async (req, res) => {
  const uname = req.params.username;
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        title,
        points,
        assignedto AS "assignedTo",
        status,
        assignetat AS "assignedAt",
        approvedat AS "approvedAt"
      FROM tasks
      WHERE LOWER(assignedto)=LOWER($1) AND status='approved'
      ORDER BY approvedat DESC NULLS LAST, id DESC
      `,
      [uname]
    );
    res.json(result.rows);
  } catch (e) {
    console.error("completed hata:", e);
    res.status(500).json({ message: "DB hatası" });
  }
});



// === WEEKLY STATS ===
app.get("/weeklyStats/:username", async (req,res)=>{
  const uname = req.params.username;
  try {
    const result = await pool.query(
      "SELECT date, pointsEarned FROM daily_points WHERE username=$1 ORDER BY date ASC",
      [uname]
    );
    res.json(result.rows);
  } catch(e){
    res.status(500).json({ message:"DB hatası" });
  }
});
// === DAILY CRON ADMIN ===
// Her gün 17:00'da Europe/Istanbul saatine göre çalışır
cron.schedule("02 11 * * *", async () => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  console.log("📬 Admin Cron tetiklendi:", today);

  try {
    // 1) BUGÜN onaylanan tüm görevleri çek (İstanbul gününe göre)
    const tasksRes = await pool.query(`
      SELECT id, title, points, assignedto, approvedat
      FROM tasks
      WHERE status = 'approved'
        AND ((approvedat AT TIME ZONE 'Europe/Istanbul')::date = $1::date)
      ORDER BY assignedto, id
    `, [today]);

    if (tasksRes.rows.length === 0) {
      console.log("⚠️ Bugün onaylanan (approved) görev yok");
      return;
    }

    // 2) Kullanıcı bazında grupla
    const grouped = {};
    for (const t of tasksRes.rows) {
      if (!grouped[t.assignedto]) grouped[t.assignedto] = [];
      grouped[t.assignedto].push(t);
    }

    // 3) Mail gövdesini hazırla (her kullanıcı için liste + kişi toplamı + genel toplam)
    let body = `Merhaba Admin,\n\n${today} tarihi itibariyle onaylanan görevler:\n\n`;
    let grandTotal = 0;

    for (const [username, tasks] of Object.entries(grouped)) {
      const userTotal = tasks.reduce((s, t) => s + Number(t.points || 0), 0);
      grandTotal += userTotal;

      body += `👤 ${username} (Toplam: ${userTotal} puan)\n`;
      tasks.forEach(t => {
        body += `   • ${t.title} → ${t.points} puan\n`;
      });
      body += `\n`;
    }

    body += `============================\nGENEL TOPLAM: ${grandTotal} puan\n`;

    // 4) Admin kullanıcılarını bul
    const adminsRes = await pool.query(`
      SELECT username, email, fullname
      FROM users
      WHERE isadmin = true AND username = 'Sinan'
    `);

    if (adminsRes.rows.length === 0) {
      console.log("⚠️ Admin bulunamadı; mail gönderilmeyecek");
      return;
    }

    // 5) Her admin’e mail gönder
    for (const a of adminsRes.rows) {
      try {
        await transporter.sendMail({
          from: `"Görev Takip" <${process.env.EMAIL_USER}>`,
          to: a.email,
          subject: `${today} Onaylanan Görevler Özeti`,
          text: body
        });
        console.log(`📧 Admin mail gönderildi: ${a.username}`);
      } catch (mailErr) {
        console.error(`❌ Admin mail gönderilemedi (${a.username}):`, mailErr);
      }
    }

    console.log("✅ Admin Cron tamamlandı:", today);
  } catch (e) {
    console.error("Admin Cron hatası:", e);
  }
}, { timezone: "Europe/Istanbul" });

// === DAILY CRON ADMIN ===
// Her gün 17.00'da Europe/Istanbul saatine göre çalışır
cron.schedule("00 17 * * *", async () => {
  const today = new Date().toISOString().slice(0, 10);
  console.log("📬 Admin Cron tetiklendi:", today);

  try {
    // 1) Bugün hala 'pending' durumda olan TÜM görevleri çek
    const tasksRes = await pool.query(`
      SELECT id, title, points, assignedto, assignetat
      FROM tasks
      WHERE status = 'pending'
      ORDER BY assignedto, id
    `);

    if (tasksRes.rows.length === 0) {
      console.log("⚠️ Onay bekleyen görev yok");
      return;
    }

    // 2) Onay bekleyen görevleri kullanıcı bazında grupla
    const grouped = {};
    for (const t of tasksRes.rows) {
      if (!grouped[t.assignedto]) grouped[t.assignedto] = [];
      grouped[t.assignedto].push(t);
    }

    // 3) Mail gövdesi hazırla
    let body = `Merhaba Admin,\n\nBugün itibariyle onay bekleyen görevler:\n\n`;
    for (const [username, tasks] of Object.entries(grouped)) {
      body += `👤 ${username}:\n`;
      tasks.forEach(t => {
        body += `   • ${t.title} → ${t.points} puan\n`;
      });
      body += "\n";
    }

    // 4) Admin kullanıcılarını bul
    const adminsRes = await pool.query(`
      SELECT username, email, fullname
      FROM users
      WHERE isadmin = true
    `);

    // 5) Her admin’e mail gönder
    for (const a of adminsRes.rows) {
      try {
        await transporter.sendMail({
          from: `"Görev Takip" <${process.env.EMAIL_USER}>`,
          to: a.email,
          subject: `${today} Onay Bekleyen Görevler`,
          text: body
        });
        console.log(`📧 Admin mail gönderildi: ${a.username}`);
      } catch (mailErr) {
        console.error(`❌ Admin mail gönderilemedi (${a.username}):`, mailErr);
      }
    }

    console.log("✅ Admin Cron tamamlandı:", today);
  } catch (e) {
    console.error("Admin Cron hatası:", e);
  }
}, { timezone: "Europe/Istanbul" });


// === DAILY CRON ===
// Her gün 17:30'te Europe/Istanbul saatine göre çalışır
cron.schedule("30 17 * * *", async () => {
  // Bugünün tarihi (YYYY-MM-DD)
  const today = new Date().toISOString().slice(0, 10);
  console.log("📬 Cron tetiklendi:", today);

  try {
    // 1) Sadece BUGÜN onaylanan görevleri DB'den çek (JS'te string kıyasına gerek kalmasın)
    // approvedat timestamptz ise, Istanbul gününe göre tarih almak için AT TIME ZONE kullanalım:
    const tasksRes = await pool.query(
      `
      SELECT id, title, points, assignedto, approvedat
      FROM tasks
      WHERE status = 'approved'
        AND ((approvedat AT TIME ZONE 'Europe/Istanbul')::date = $1::date)
      `,
      [today]
    );

    // Kullanıcıları çek
    const usersRes = await pool.query("SELECT username, email, fullname FROM users");

    // 2) Kullanıcı bazında e-posta gönder
    for (const u of usersRes.rows) {
      const done = tasksRes.rows.filter(t => t.assignedto === u.username);
      if (!done.length) continue;

      const body = done.map(t => `• ${t.title} → ${t.points} puan`).join("\n");
      const total = done.reduce((s, t) => s + Number(t.points || 0), 0);

      try {
        await transporter.sendMail({
          from: `"Görev Takip" <${process.env.EMAIL_USER}>`,
          to: u.email,
          subject: `${today} Günlük Görev Özeti`,
          text: `Merhaba ${u.fullname},\n\nBugün tamamladığın görevler:\n\n${body}\n\nToplam: ${total} puan`
        });

        // 3) Günlük özet tablosuna yaz
        await pool.query(
          "INSERT INTO daily_points (username, date, pointsEarned) VALUES ($1, $2, $3)",
          [u.username, today, total]
        );
      } catch (mailErr) {
        console.error(`❌ Mail gönderilemedi (${u.username}):`, mailErr);
      }
    }

    // 4) Bugün onaylanan görevleri sil (İstanbul gününe göre)
    await pool.query(
      `
      DELETE FROM tasks
      WHERE status='approved'
        AND ((approvedat AT TIME ZONE 'Europe/Istanbul')::date = $1::date)
      `,
      [today]
    );

    console.log("✅ Cron tamamlandı:", today);
  } catch (e) {
    console.error("Cron hatası:", e);
  }
}, { timezone: "Europe/Istanbul" });
// === SERVER START ===
const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log(`🚀 Server running on port ${port}`));
