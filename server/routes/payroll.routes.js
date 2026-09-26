'use strict';
const express = require('express');
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const audit = require('../middleware/audit');
const router = express.Router();

/* GET /api/payroll?month=M&year=Y */
router.get('/', requireAuth, requirePermission('payroll.view'), async (req, res) => {
  try {
    const { month, year } = req.query;
    let rows;
    if (month && year) {
      rows = await sql`SELECT p.*,e.name AS employee_name,e.dept,e.designation
        FROM payroll p JOIN employees e ON e.id=p.employee_id
        WHERE p.month=${parseInt(month)} AND p.year=${parseInt(year)} ORDER BY e.name`;
    } else {
      rows = await sql`SELECT p.*,e.name AS employee_name FROM payroll p
        JOIN employees e ON e.id=p.employee_id ORDER BY p.year DESC,p.month DESC LIMIT 200`;
    }
    res.json(rows);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

/* POST /api/payroll/generate — generate payroll for a month */
router.post('/generate', requireAuth, requirePermission('payroll.create'), async (req, res) => {
  try {
    const { month, year, employee_ids } = req.body;
    if (!month||!year) return res.status(400).json({error:'month and year required'});

    const emps = employee_ids?.length
      ? await sql`SELECT e.*,es.basic,es.hra,es.conveyance,es.medical,es.special,
          es.other_earnings,es.emp_pf,es.emp_esi,es.prof_tax,es.tds,es.lwf,es.other_deductions,
          es.er_pf,es.er_esi,es.gratuity
          FROM employees e
          LEFT JOIN LATERAL (SELECT * FROM employee_salary WHERE employee_id=e.id ORDER BY effective_from DESC LIMIT 1) es ON TRUE
          WHERE e.id=ANY(${employee_ids}) AND e.status='Active'`
      : await sql`SELECT e.*,es.basic,es.hra,es.conveyance,es.medical,es.special,
          es.other_earnings,es.emp_pf,es.emp_esi,es.prof_tax,es.tds,es.lwf,es.other_deductions,
          es.er_pf,es.er_esi,es.gratuity
          FROM employees e
          LEFT JOIN LATERAL (SELECT * FROM employee_salary WHERE employee_id=e.id ORDER BY effective_from DESC LIMIT 1) es ON TRUE
          WHERE e.status='Active'`;

    const results = [];
    for (const e of emps) {
      const basic       = parseFloat(e.basic||e.salary||0);
      const hra         = parseFloat(e.hra||0);
      const conveyance  = parseFloat(e.conveyance||0);
      const medical     = parseFloat(e.medical||0);
      const special     = parseFloat(e.special||0);
      const other_earn  = parseFloat(e.other_earnings||0);
      const gross       = basic+hra+conveyance+medical+special+other_earn;
      const emp_pf      = parseFloat(e.emp_pf||0)||Math.round(basic*0.12);
      const emp_esi     = parseFloat(e.emp_esi||0)||Math.round(gross<=21000?gross*0.0075:0);
      const prof_tax    = parseFloat(e.prof_tax||0)||200;
      const tds         = parseFloat(e.tds||0);
      const other_ded   = parseFloat(e.other_deductions||0);
      const total_ded   = emp_pf+emp_esi+prof_tax+tds+other_ded;
      const net_pay     = gross-total_ded;
      const er_pf       = parseFloat(e.er_pf||0)||Math.round(basic*0.1367);
      const er_esi      = parseFloat(e.er_esi||0)||Math.round(gross<=21000?gross*0.0325:0);
      const gratuity    = parseFloat(e.gratuity||0)||Math.round(basic*0.0481);
      const daysInMonth = new Date(year, month, 0).getDate();

      const [row] = await sql`
        INSERT INTO payroll (employee_id,month,year,paid_days,lop_days,basic,hra,conveyance,medical,special,other_earn,gross,emp_pf,emp_esi,prof_tax,tds,other_ded,total_ded,net_pay,er_pf,er_esi,gratuity,status,created_by)
        VALUES (${e.id},${parseInt(month)},${parseInt(year)},${daysInMonth},0,${basic},${hra},${conveyance},${medical},${special},${other_earn},${gross},${emp_pf},${emp_esi},${prof_tax},${tds},${other_ded},${total_ded},${net_pay},${er_pf},${er_esi},${gratuity},'Generated',${req.user.id})
        ON CONFLICT (employee_id,month,year) DO UPDATE SET
          basic=EXCLUDED.basic,gross=EXCLUDED.gross,net_pay=EXCLUDED.net_pay,status='Generated'
        RETURNING *`;
      results.push(row);
    }
    await audit.log(req,{action:'GENERATE',module:'payroll',newValue:{month,year,count:results.length}});
    res.json({generated:results.length, records:results});
  } catch(err){ console.error(err); res.status(500).json({error:'Server error'}); }
});

/* PUT /api/payroll/:id — edit payroll (with reason, audit) */
router.put('/:id', requireAuth, requirePermission('payroll.edit'), async (req, res) => {
  try {
    const [old] = await sql`SELECT * FROM payroll WHERE id=${req.params.id}`;
    if (!old) return res.status(404).json({error:'Not found'});
    if (old.status==='Locked') return res.status(403).json({error:'Payroll is locked'});
    const { basic,hra,conveyance,medical,special,other_earn,
      emp_pf,emp_esi,prof_tax,tds,other_ded,er_pf,er_esi,gratuity,
      paid_days,lop_days,reason } = req.body;
    if (!reason) return res.status(400).json({error:'Edit reason is required'});
    const gross    = (basic||0)+(hra||0)+(conveyance||0)+(medical||0)+(special||0)+(other_earn||0);
    const total_ded= (emp_pf||0)+(emp_esi||0)+(prof_tax||0)+(tds||0)+(other_ded||0);
    const net_pay  = gross-total_ded;
    const [row] = await sql`UPDATE payroll SET
      basic=${basic},hra=${hra},conveyance=${conveyance},medical=${medical},
      special=${special},other_earn=${other_earn},gross=${gross},
      emp_pf=${emp_pf},emp_esi=${emp_esi},prof_tax=${prof_tax},tds=${tds},
      other_ded=${other_ded},total_ded=${total_ded},net_pay=${net_pay},
      er_pf=${er_pf},er_esi=${er_esi},gratuity=${gratuity},
      paid_days=${paid_days},lop_days=${lop_days},status='Generated'
      WHERE id=${req.params.id} RETURNING *`;
    await audit.log(req,{action:'EDIT',module:'payroll',recordId:req.params.id,
      oldValue:{net_pay:old.net_pay,gross:old.gross},
      newValue:{net_pay,gross},reason});
    res.json(row);
  } catch(err){ console.error(err); res.status(500).json({error:'Server error'}); }
});

/* POST /api/payroll/:id/lock */
router.post('/:id/lock', requireAuth, requirePermission('payroll.lock'), async (req, res) => {
  try {
    const [row] = await sql`UPDATE payroll SET status='Locked',locked_by=${req.user.id},locked_at=NOW()
      WHERE id=${req.params.id} RETURNING *`;
    await audit.log(req,{action:'LOCK',module:'payroll',recordId:req.params.id});
    res.json(row);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

/* POST /api/payroll/:id/unlock — admin only */
router.post('/:id/unlock', requireAuth, async (req, res) => {
  try {
    if (req.user.role!=='admin') return res.status(403).json({error:'Only admin can unlock payroll'});
    const { reason } = req.body;
    if (!reason) return res.status(400).json({error:'Unlock reason is required'});
    const [row] = await sql`UPDATE payroll SET status='Generated',locked_by=NULL,locked_at=NULL
      WHERE id=${req.params.id} RETURNING *`;
    await audit.log(req,{action:'UNLOCK',module:'payroll',recordId:req.params.id,reason});
    res.json(row);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

module.exports = router;
