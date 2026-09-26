'use strict';
const express = require('express');
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, async (req,res) => {
  try {
    const rows = await sql`SELECT * FROM notifications WHERE user_id=${req.user.id} ORDER BY created_at DESC LIMIT 30`;
    res.json(rows);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

router.post('/:id/read', requireAuth, async (req,res) => {
  try {
    await sql`UPDATE notifications SET read=TRUE WHERE id=${req.params.id} AND user_id=${req.user.id}`;
    res.json({ok:true});
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

module.exports = router;
