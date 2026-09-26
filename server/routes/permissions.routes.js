'use strict';
const express = require('express');
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

/* GET /api/permissions — list all permission definitions */
router.get('/', requireAuth, async (req,res) => {
  try { res.json(await sql`SELECT * FROM permissions ORDER BY category,id`); }
  catch(err){ res.status(500).json({error:'Server error'}); }
});

/* GET /api/permissions/:userId */
router.get('/:userId', requireAuth, async (req,res) => {
  try {
    if (req.user.role!=='admin') return res.status(403).json({error:'Admin only'});
    const rows = await sql`SELECT * FROM user_permissions WHERE user_id=${req.params.userId}`;
    res.json(rows);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

/* PUT /api/permissions/:userId — set permissions for a user */
router.put('/:userId', requireAuth, async (req,res) => {
  try {
    if (req.user.role!=='admin') return res.status(403).json({error:'Admin only'});
    const { permissions } = req.body; // [{id, granted}]
    if (!Array.isArray(permissions)) return res.status(400).json({error:'permissions array required'});
    await sql`DELETE FROM user_permissions WHERE user_id=${req.params.userId}`;
    for (const p of permissions) {
      await sql`INSERT INTO user_permissions (user_id,permission_id,granted,granted_by)
        VALUES (${req.params.userId},${p.id},${p.granted!==false},${req.user.id})
        ON CONFLICT (user_id,permission_id) DO UPDATE SET granted=EXCLUDED.granted`;
    }
    res.json({ok:true});
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

module.exports = router;
