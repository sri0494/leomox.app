'use strict';
const express = require('express');
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const audit = require('../middleware/audit');
const router = express.Router();

router.get('/', requireAuth, requirePermission('attendance.view'), async (req, res) => {
  try {
    const { month, employee_id } = req.query;
    let rows;
    if (req.user.role === 'employee') {
      const [me] = await sql`SELECT id FROM employees WHERE user_id=${req.user.id}`;
      if (!me) return res.json([]);
      rows = await sql`SELECT a.*,e.name AS employee_name FROM attendance a
        JOIN employees e ON e.id=a.employee_id
        WHERE a.employee_id=${me.id} ORDER BY a.date DESC LIMIT 90`;
    } else if (month) {
      rows = await sql`SELECT a.*,e.name AS employee_name,e.dept FROM attendance a
        JOIN employees e ON e.id=a.employee_id
        WHERE TO_CHAR(a.date,'YYYY-MM')=${month} ORDER BY a.date DESC,e.name`;
    } else {
      rows = await sql`SELECT a.*,e.name AS employee_name,e.dept FROM attendance a
        JOIN employees e ON e.id=a.employee_id ORDER BY a.date DESC LIMIT 500`;
    }
    res.json(rows);
  } catch(err){ console.error(err); res.status(500).json({error:'Server error'}); }
});

router.post('/mark', requireAuth, requirePermission('attendance.create'), async (req, res) => {
  try {
    const { employeeId, date, status, check_in, check_out, overtime=0, remarks } = req.body;
    if (!employeeId||!date||!status) return res.status(400).json({error:'employeeId, date and status required'});
    const [row] = await sql`
      INSERT INTO attendance (employee_id,date,status,check_in,check_out,overtime,remarks,marked_by)
      VALUES (${employeeId},${date},${status},${check_in||null},${check_out||null},${overtime},${remarks||null},${req.user.id})
      ON CONFLICT (employee_id,date) DO UPDATE SET
        status=EXCLUDED.status, check_in=EXCLUDED.check_in, check_out=EXCLUDED.check_out,
        overtime=EXCLUDED.overtime, remarks=EXCLUDED.remarks, marked_by=EXCLUDED.marked_by
      RETURNING *`;
    res.json(row);
  } catch(err){ console.error(err); res.status(500).json({error:'Server error'}); }
});

router.post('/bulk', requireAuth, requirePermission('attendance.import'), async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records)||!records.length) return res.status(400).json({error:'No records'});
    const results={success:0,failed:[]};
    for(const r of records){
      try{
        await sql`INSERT INTO attendance (employee_id,date,status,check_in,check_out,overtime,remarks,marked_by)
          VALUES (${r.employee_id},${r.date},${r.status||'Present'},${r.check_in||null},${r.check_out||null},
          ${r.overtime||0},${r.remarks||null},${req.user.id})
          ON CONFLICT (employee_id,date) DO UPDATE SET status=EXCLUDED.status`;
        results.success++;
      } catch(e){ results.failed.push({row:r.employee_id,error:e.message}); }
    }
    res.json(results);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

module.exports = router;
