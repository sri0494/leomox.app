'use strict';
const express = require('express');
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const router = express.Router();

/* GET /api/leave/types */
router.get('/types', requireAuth, async (req,res) => {
  try { res.json(await sql`SELECT * FROM leave_types WHERE active=TRUE ORDER BY name`); }
  catch(err){ res.status(500).json({error:'Server error'}); }
});

/* POST /api/leave/types — admin */
router.post('/types', requireAuth, requirePermission('leave.manage_policy'), async (req,res) => {
  try {
    const { name, annual_days=0, carry_forward=false, max_carry=0, half_day=true, paid=true } = req.body;
    const [row] = await sql`INSERT INTO leave_types (name,annual_days,carry_forward,max_carry,half_day,paid)
      VALUES (${name},${annual_days},${carry_forward},${max_carry},${half_day},${paid}) RETURNING *`;
    res.status(201).json(row);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

/* GET /api/leave/balance?employee_id=X&year=Y */
router.get('/balance', requireAuth, requirePermission('leave.view'), async (req,res) => {
  try {
    const { employee_id, year=new Date().getFullYear() } = req.query;
    const empId = employee_id || (await sql`SELECT id FROM employees WHERE user_id=${req.user.id}`)[0]?.id;
    if (!empId) return res.json([]);
    const rows = await sql`SELECT lb.*,lt.name AS leave_name,lt.annual_days
      FROM leave_balances lb JOIN leave_types lt ON lt.id=lb.leave_type_id
      WHERE lb.employee_id=${empId} AND lb.year=${parseInt(year)} ORDER BY lt.name`;
    res.json(rows);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

/* GET /api/leave/requests */
router.get('/requests', requireAuth, requirePermission('leave.view'), async (req,res) => {
  try {
    let rows;
    if (req.user.role==='employee') {
      const [me] = await sql`SELECT id FROM employees WHERE user_id=${req.user.id}`;
      rows = me ? await sql`SELECT lr.*,lt.name AS leave_name,e.name AS employee_name
        FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id
        JOIN employees e ON e.id=lr.employee_id WHERE lr.employee_id=${me.id} ORDER BY lr.created_at DESC` : [];
    } else if (req.user.role==='manager') {
      const [me] = await sql`SELECT id FROM employees WHERE user_id=${req.user.id}`;
      rows = me ? await sql`SELECT lr.*,lt.name AS leave_name,e.name AS employee_name
        FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id
        JOIN employees e ON e.id=lr.employee_id WHERE e.manager_id=${me.id} ORDER BY lr.created_at DESC` : [];
    } else {
      rows = await sql`SELECT lr.*,lt.name AS leave_name,e.name AS employee_name
        FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id
        JOIN employees e ON e.id=lr.employee_id ORDER BY lr.created_at DESC LIMIT 200`;
    }
    res.json(rows);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

/* POST /api/leave/requests — apply leave */
router.post('/requests', requireAuth, requirePermission('leave.apply'), async (req,res) => {
  try {
    const [emp] = await sql`SELECT id FROM employees WHERE user_id=${req.user.id}`;
    if (!emp) return res.status(403).json({error:'No employee record found'});
    const { leave_type_id, from_date, to_date, days=1, half_day=false, reason } = req.body;
    const [row] = await sql`INSERT INTO leave_requests
      (employee_id,leave_type_id,from_date,to_date,days,half_day,reason,status)
      VALUES (${emp.id},${leave_type_id},${from_date},${to_date},${days},${half_day},${reason},'Submitted')
      RETURNING *`;
    res.status(201).json(row);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

/* PUT /api/leave/requests/:id/action — approve/reject */
router.put('/requests/:id/action', requireAuth, requirePermission('leave.approve'), async (req,res) => {
  try {
    const { action, remark } = req.body;
    const [old] = await sql`SELECT * FROM leave_requests WHERE id=${req.params.id}`;
    if (!old) return res.status(404).json({error:'Not found'});
    let newStatus;
    if (req.user.role==='manager') {
      newStatus = action==='approve' ? 'Manager Approved' : 'Rejected';
      await sql`UPDATE leave_requests SET status=${newStatus},manager_action=${action},
        manager_remark=${remark||null},manager_at=NOW(),actioned_by=${req.user.id}
        WHERE id=${req.params.id}`;
    } else {
      newStatus = action==='approve' ? 'HR Approved' : 'Rejected';
      await sql`UPDATE leave_requests SET status=${newStatus},hr_action=${action},
        hr_remark=${remark||null},hr_at=NOW(),actioned_by=${req.user.id}
        WHERE id=${req.params.id}`;
    }
    if (action==='approve' && newStatus==='HR Approved') {
      await sql`INSERT INTO leave_balances (employee_id,leave_type_id,year,used)
        VALUES (${old.employee_id},${old.leave_type_id},${new Date().getFullYear()},${old.days})
        ON CONFLICT (employee_id,leave_type_id,year) DO UPDATE SET used=leave_balances.used+EXCLUDED.used`;
    }
    res.json({ok:true,status:newStatus});
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

module.exports = router;
