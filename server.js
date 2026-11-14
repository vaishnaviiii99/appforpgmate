const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const db = new Database(process.env.DB_FILE || 'pgmate.db');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS pgs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, pg_id INTEGER NOT NULL REFERENCES pgs(id), name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, room TEXT);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY, pg_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY, pg_id INTEGER NOT NULL, user_id INTEGER NOT NULL, category TEXT NOT NULL,
  description TEXT NOT NULL, status TEXT DEFAULT 'Open', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS menu (
  pg_id INTEGER NOT NULL, date TEXT NOT NULL, breakfast TEXT, lunch TEXT, dinner TEXT, PRIMARY KEY (pg_id, date));
CREATE TABLE IF NOT EXISTS skips (
  user_id INTEGER NOT NULL, date TEXT NOT NULL, meal TEXT NOT NULL, PRIMARY KEY (user_id, date, meal));
CREATE TABLE IF NOT EXISTS rents (
  id INTEGER PRIMARY KEY, pg_id INTEGER NOT NULL, user_id INTEGER NOT NULL, month TEXT NOT NULL,
  amount INTEGER NOT NULL, status TEXT DEFAULT 'Pending', paid_at TEXT, UNIQUE (user_id, month));
`);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MEALS = ['breakfast', 'lunch', 'dinner'];
const sign = (id) => jwt.sign({ id }, SECRET, { expiresIn: '30d' });
const fail = (res, code, error) => res.status(code).json({ error });

function auth(req, res, next) {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    const { id } = jwt.verify(t, SECRET);
    const u = db.prepare('SELECT id, pg_id, name, email, role, room FROM users WHERE id = ?').get(id);
    if (!u) throw new Error('no user');
    req.user = u;
    next();
  } catch {
    fail(res, 401, 'Please log in again');
  }
}
const owner = (req, res, next) =>
  req.user.role === 'owner' ? next() : fail(res, 403, 'Only the PG owner can do this');

// ---------- Auth ----------
app.post('/api/register-owner', (req, res) => {
  const { name, email, password, pgName } = req.body;
  if (!name || !email || !pgName || !password || password.length < 6)
    return fail(res, 400, 'Fill all fields. Password needs 6+ characters.');
  const mail = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) return fail(res, 409, 'This email is already registered');
  const id = db.transaction(() => {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const pg = db.prepare('INSERT INTO pgs (name, code) VALUES (?, ?)').run(pgName.trim(), code);
    return db.prepare('INSERT INTO users (pg_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(pg.lastInsertRowid, name.trim(), mail, bcrypt.hashSync(password, 10), 'owner').lastInsertRowid;
  })();
  res.json({ token: sign(id) });
});

app.post('/api/join', (req, res) => {
  const { name, email, password, code, room } = req.body;
  if (!name || !email || !code || !password || password.length < 6)
    return fail(res, 400, 'Fill all fields. Password needs 6+ characters.');
  const pg = db.prepare('SELECT id FROM pgs WHERE code = ?').get(code.trim().toUpperCase());
  if (!pg) return fail(res, 404, 'Invalid PG code. Ask your owner for the code.');
  const mail = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) return fail(res, 409, 'This email is already registered');
  const r = db.prepare('INSERT INTO users (pg_id, name, email, password_hash, role, room) VALUES (?, ?, ?, ?, ?, ?)')
    .run(pg.id, name.trim(), mail, bcrypt.hashSync(password, 10), 'resident', room || '');
  res.json({ token: sign(r.lastInsertRowid) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) return fail(res, 401, 'Wrong email or password');
  res.json({ token: sign(u.id) });
});

app.get('/api/me', auth, (req, res) => {
  const pg = db.prepare('SELECT name, code FROM pgs WHERE id = ?').get(req.user.pg_id);
  res.json({ ...req.user, pgName: pg.name, code: req.user.role === 'owner' ? pg.code : undefined });
});

app.get('/api/residents', auth, owner, (req, res) => {
  res.json(db.prepare("SELECT id, name, email, room FROM users WHERE pg_id = ? AND role = 'resident' ORDER BY room, name").all(req.user.pg_id));
});

// ---------- Notices ----------
app.get('/api/notices', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM notices WHERE pg_id = ? ORDER BY id DESC LIMIT 50').all(req.user.pg_id));
});
app.post('/api/notices', auth, owner, (req, res) => {
  const { title, body } = req.body;
  if (!title) return fail(res, 400, 'Add a title');
  db.prepare('INSERT INTO notices (pg_id, title, body) VALUES (?, ?, ?)').run(req.user.pg_id, title, body || '');
  res.json({ ok: true });
});

// ---------- Complaints ----------
app.get('/api/complaints', auth, (req, res) => {
  const sql = `SELECT c.*, u.name AS user_name, u.room FROM complaints c JOIN users u ON u.id = c.user_id
               WHERE c.pg_id = ? ${req.user.role === 'owner' ? '' : 'AND c.user_id = ?'} ORDER BY c.id DESC`;
  const args = req.user.role === 'owner' ? [req.user.pg_id] : [req.user.pg_id, req.user.id];
  res.json(db.prepare(sql).all(...args));
});
app.post('/api/complaints', auth, (req, res) => {
  const { category, description } = req.body;
  if (!category || !description) return fail(res, 400, 'Choose a category and describe the problem');
  db.prepare('INSERT INTO complaints (pg_id, user_id, category, description) VALUES (?, ?, ?, ?)')
    .run(req.user.pg_id, req.user.id, category, description);
  res.json({ ok: true });
});
app.patch('/api/complaints/:id', auth, owner, (req, res) => {
  if (!['Open', 'In progress', 'Fixed'].includes(req.body.status)) return fail(res, 400, 'Invalid status');
  db.prepare('UPDATE complaints SET status = ? WHERE id = ? AND pg_id = ?').run(req.body.status, req.params.id, req.user.pg_id);
  res.json({ ok: true });
});

// ---------- Mess menu and meal skips ----------
app.get('/api/menu', auth, (req, res) => {
  res.json(db.prepare('SELECT breakfast, lunch, dinner FROM menu WHERE pg_id = ? AND date = ?').get(req.user.pg_id, req.query.date) || {});
});
app.put('/api/menu', auth, owner, (req, res) => {
  const { date, breakfast, lunch, dinner } = req.body;
  if (!date) return fail(res, 400, 'Date missing');
  db.prepare(`INSERT INTO menu (pg_id, date, breakfast, lunch, dinner) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (pg_id, date) DO UPDATE SET breakfast = excluded.breakfast, lunch = excluded.lunch, dinner = excluded.dinner`)
    .run(req.user.pg_id, date, breakfast || '', lunch || '', dinner || '');
  res.json({ ok: true });
});
app.post('/api/skips', auth, (req, res) => {
  const { date, meal } = req.body;
  if (!MEALS.includes(meal) || !date) return fail(res, 400, 'Invalid meal');
  const del = db.prepare('DELETE FROM skips WHERE user_id = ? AND date = ? AND meal = ?').run(req.user.id, date, meal);
  if (!del.changes) db.prepare('INSERT INTO skips (user_id, date, meal) VALUES (?, ?, ?)').run(req.user.id, date, meal);
  res.json({ skipped: !del.changes });
});
app.get('/api/skips', auth, (req, res) => {
  const date = req.query.date;
  const mine = db.prepare('SELECT meal FROM skips WHERE user_id = ? AND date = ?').all(req.user.id, date).map((r) => r.meal);
  const out = { mine };
  if (req.user.role === 'owner') {
    out.residents = db.prepare("SELECT COUNT(*) n FROM users WHERE pg_id = ? AND role = 'resident'").get(req.user.pg_id).n;
    out.counts = {};
    db.prepare(`SELECT s.meal, COUNT(*) n FROM skips s JOIN users u ON u.id = s.user_id
                WHERE u.pg_id = ? AND s.date = ? GROUP BY s.meal`).all(req.user.pg_id, date).forEach((r) => (out.counts[r.meal] = r.n));
  }
  res.json(out);
});

// ---------- Rent ----------
app.get('/api/rents', auth, (req, res) => {
  const sql = `SELECT r.*, u.name AS user_name, u.room FROM rents r JOIN users u ON u.id = r.user_id
               WHERE r.pg_id = ? ${req.user.role === 'owner' ? '' : 'AND r.user_id = ?'} ORDER BY r.month DESC, u.room`;
  const args = req.user.role === 'owner' ? [req.user.pg_id] : [req.user.pg_id, req.user.id];
  res.json(db.prepare(sql).all(...args));
});
app.post('/api/rents', auth, owner, (req, res) => {
  const { month, amount } = req.body;
  if (!/^\d{4}-\d{2}$/.test(month || '') || !(amount > 0)) return fail(res, 400, 'Enter a month and a rent amount');
  const residents = db.prepare("SELECT id FROM users WHERE pg_id = ? AND role = 'resident'").all(req.user.pg_id);
  const ins = db.prepare('INSERT OR IGNORE INTO rents (pg_id, user_id, month, amount) VALUES (?, ?, ?, ?)');
  db.transaction(() => residents.forEach((r) => ins.run(req.user.pg_id, r.id, month, Math.round(amount))))();
  res.json({ created: residents.length });
});
app.patch('/api/rents/:id', auth, owner, (req, res) => {
  const paid = req.body.paid;
  db.prepare('UPDATE rents SET status = ?, paid_at = ? WHERE id = ? AND pg_id = ?')
    .run(paid ? 'Paid' : 'Pending', paid ? new Date().toISOString() : null, req.params.id, req.user.pg_id);
  res.json({ ok: true });
});

app.use('/api', (req, res) => fail(res, 404, 'Not found'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PG Mate running on http://localhost:${PORT}`));
