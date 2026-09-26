'use strict';
require('dotenv').config();

const express   = require('express');
const path      = require('path');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const { sql }   = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin||allowedOrigins.length===0||allowedOrigins.includes(origin)) cb(null,true);
    else cb(new Error('CORS: origin not allowed'));
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth/login', rateLimit({ windowMs:15*60*1000, max:10, message:{error:'Too many login attempts'} }));
app.use('/api/', rateLimit({ windowMs:60*1000, max:500, message:{error:'Too many requests'} }));

/* ── Routes ── */
app.use('/api/auth',          require('./routes/auth.routes'));
app.use('/api/users',         require('./routes/users.routes'));
app.use('/api/employees',     require('./routes/employees.routes'));
app.use('/api/attendance',    require('./routes/attendance.routes'));
app.use('/api/payroll',       require('./routes/payroll.routes'));
app.use('/api/leave',         require('./routes/leave.routes'));
app.use('/api/invoices',      require('./routes/invoices.routes'));
app.use('/api/contact',       require('./routes/contact.routes'));
app.use('/api/site-content',  require('./routes/siteContent.routes'));
app.use('/api/permissions',   require('./routes/permissions.routes'));
app.use('/api/audit',         require('./routes/audit.routes'));
app.use('/api/notifications', require('./routes/notifications.routes'));

/* ── Bootstrap ── returns all data needed by the HRMS frontend on login ── */
const { requireAuth } = require('./middleware/auth');
const { getUserPermissions } = require('./middleware/permissions');

app.get('/api/bootstrap', requireAuth, async (req, res) => {
  try {
    const [employees, users, invoices, sc, leaveTypes, notifications] = await Promise.all([
      sql`SELECT * FROM employees ORDER BY created_at DESC`,
      sql`SELECT id, name, role, active, created_at FROM users ORDER BY created_at DESC`,
      sql`SELECT * FROM invoices ORDER BY created_at DESC`,
      sql`SELECT value FROM site_content WHERE key = 'main'`,
      sql`SELECT * FROM leave_types WHERE active=TRUE ORDER BY name`,
      sql`SELECT * FROM notifications WHERE user_id=${req.user.id} AND read=FALSE ORDER BY created_at DESC LIMIT 10`,
    ]);

    // Resolve user's effective permissions
    const perms = await getUserPermissions(req.user.id, req.user.role);
    const permsList = perms === null ? ['ALL'] : Array.from(perms);

    res.json({
      employees,
      users,
      invoices,
      siteContent: sc[0] ? sc[0].value : {},
      leaveTypes,
      notifications,
      permissions: permsList,
    });
  } catch (err) {
    console.error('Bootstrap error:', err);
    res.status(500).json({ error: 'Bootstrap failed' });
  }
});

/* ── Static + SPA ── */
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { maxAge: process.env.NODE_ENV==='production'?'1d':0, etag:true }));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use((err, req, res, _next) => { console.error(err.message); res.status(500).json({ error: 'Internal server error' }); });

app.listen(PORT, () => {
  console.log(`🚀 LeoMox HRMS → http://localhost:${PORT}  (${process.env.NODE_ENV||'development'})`);
});
