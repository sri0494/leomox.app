'use strict';
const express = require('express');
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const router = express.Router();

router.get('/', requireAuth, requirePermission('audit.view'), async (req,res) => {
  try {
    const { module, limit=100, offset=0 } = req.query;
    const rows = module
      ? await sql`SELECT * FROM audit_logs WHERE module=${module} ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`
      : await sql`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;
    res.json(rows);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

module.exports = router;
