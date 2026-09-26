'use strict';
const express = require('express');
const { sql }  = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const audit    = require('../middleware/audit');
const router   = express.Router();

async function scopedEmployees(req) {
  if (req.user.role === 'admin' || req.user.role === 'hr')
    return sql`SELECT * FROM employees ORDER BY created_at DESC`;
  if (req.user.role === 'manager') {
    const [me] = await sql`SELECT id FROM employees WHERE user_id = ${req.user.id}`;
    if (!me) return [];
    return sql`SELECT * FROM employees WHERE manager_id = ${me.id} ORDER BY created_at DESC`;
  }
  return sql`SELECT * FROM employees WHERE user_id = ${req.user.id}`;
}

router.get('/', requireAuth, requirePermission('employee.view'), async (req, res) => {
  try { res.json(await scopedEmployees(req)); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', requireAuth, requirePermission('employee.view'), async (req, res) => {
  try {
    const [emp] = await sql`SELECT * FROM employees WHERE id = ${req.params.id}`;
    if (!emp) return res.status(404).json({ error: 'Not found' });
    const [bank] = await sql`SELECT * FROM employee_bank WHERE employee_id = ${req.params.id}`;
    const [stat] = await sql`SELECT * FROM employee_statutory WHERE employee_id = ${req.params.id}`;
    const salaries = await sql`SELECT * FROM employee_salary WHERE employee_id = ${req.params.id} ORDER BY effective_from DESC`;
    res.json({ ...emp, bank: bank||null, statutory: stat||null, salaries });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', requireAuth, requirePermission('employee.create'), async (req, res) => {
  try {
    const { name, emp_code, first_name, last_name, gender, dob, dept, designation,
      phone, email, personal_email, salary=0, joined, status='Active',
      emp_type, location, work_mode, manager_id,
      perm_address, curr_address, city, state, pincode,
      emg_name, emg_relation, emg_phone, blood_group, marital_status } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const [row] = await sql`
      INSERT INTO employees (name,emp_code,first_name,last_name,gender,dob,dept,designation,
        phone,email,personal_email,salary,joined,status,emp_type,location,work_mode,manager_id,
        perm_address,curr_address,city,state,pincode,emg_name,emg_relation,emg_phone,blood_group,marital_status)
      VALUES (${name},${emp_code||null},${first_name||null},${last_name||null},${gender||null},
        ${dob||null},${dept||null},${designation||null},${phone||null},${email||null},
        ${personal_email||null},${salary||0},${joined||null},${status},
        ${emp_type||'Full Time'},${location||null},${work_mode||'Office'},${manager_id||null},
        ${perm_address||null},${curr_address||null},${city||null},${state||null},${pincode||null},
        ${emg_name||null},${emg_relation||null},${emg_phone||null},${blood_group||null},${marital_status||null})
      RETURNING *`;
    await audit.log(req,{action:'CREATE',module:'employees',recordId:row.id,newValue:{name}});
    res.status(201).json(row);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', requireAuth, requirePermission('employee.edit'), async (req, res) => {
  try {
    const [old] = await sql`SELECT * FROM employees WHERE id = ${req.params.id}`;
    if (!old) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    const [row] = await sql`
      UPDATE employees SET
        name=${b.name||old.name}, emp_code=${b.emp_code||old.emp_code},
        first_name=${b.first_name||old.first_name}, last_name=${b.last_name||old.last_name},
        gender=${b.gender||old.gender}, dob=${b.dob||old.dob},
        dept=${b.dept||old.dept}, designation=${b.designation||old.designation},
        phone=${b.phone||old.phone}, email=${b.email||old.email},
        personal_email=${b.personal_email||old.personal_email},
        salary=${b.salary!=null?b.salary:old.salary},
        joined=${b.joined||old.joined}, status=${b.status||old.status},
        emp_type=${b.emp_type||old.emp_type}, location=${b.location||old.location},
        work_mode=${b.work_mode||old.work_mode}, manager_id=${b.manager_id||old.manager_id},
        perm_address=${b.perm_address||old.perm_address}, curr_address=${b.curr_address||old.curr_address},
        city=${b.city||old.city}, state=${b.state||old.state}, pincode=${b.pincode||old.pincode},
        emg_name=${b.emg_name||old.emg_name}, emg_relation=${b.emg_relation||old.emg_relation},
        emg_phone=${b.emg_phone||old.emg_phone}, blood_group=${b.blood_group||old.blood_group},
        marital_status=${b.marital_status||old.marital_status}
      WHERE id=${req.params.id} RETURNING *`;
    await audit.log(req,{action:'UPDATE',module:'employees',recordId:req.params.id,
      oldValue:{name:old.name,status:old.status},newValue:{name:b.name,status:b.status}});
    res.json(row);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', requireAuth, requirePermission('employee.delete'), async (req, res) => {
  try {
    const [old] = await sql`SELECT name FROM employees WHERE id=${req.params.id}`;
    await sql`DELETE FROM employees WHERE id=${req.params.id}`;
    await audit.log(req,{action:'DELETE',module:'employees',recordId:req.params.id,oldValue:old});
    res.json({ok:true});
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/bulk', requireAuth, requirePermission('employee.import'), async (req, res) => {
  try {
    const { employees } = req.body;
    if (!Array.isArray(employees)||!employees.length) return res.status(400).json({error:'No employees'});
    const results = {success:[],failed:[]};
    for (const emp of employees) {
      try {
        if (!emp.name) throw new Error('name required');
        const [row] = await sql`
          INSERT INTO employees (name,emp_code,dept,designation,phone,email,salary,joined,status)
          VALUES (${emp.name},${emp.emp_code||null},${emp.dept||null},${emp.designation||null},
            ${emp.phone||null},${emp.email||null},${emp.salary||0},${emp.joined||null},${emp.status||'Active'})
          ON CONFLICT DO NOTHING RETURNING id`;
        if (row) results.success.push(emp.name);
        else results.failed.push({name:emp.name,error:'Duplicate'});
      } catch(e){ results.failed.push({name:emp.name||'?',error:e.message}); }
    }
    await audit.log(req,{action:'BULK_IMPORT',module:'employees',
      newValue:{success:results.success.length,failed:results.failed.length}});
    res.json(results);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/salary', requireAuth, requirePermission('salary.view'), async (req,res) => {
  try {
    res.json(await sql`SELECT * FROM employee_salary WHERE employee_id=${req.params.id} ORDER BY effective_from DESC`);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

router.post('/:id/salary', requireAuth, requirePermission('salary.create'), async (req,res) => {
  try {
    const { effective_from, basic=0,hra=0,conveyance=0,medical=0,special=0,
      other_earnings=0,emp_pf=0,emp_esi=0,prof_tax=0,tds=0,lwf=0,other_deductions=0,
      er_pf=0,er_esi=0,gratuity=0,reason } = req.body;
    const [row] = await sql`
      INSERT INTO employee_salary (employee_id,effective_from,basic,hra,conveyance,medical,special,
        other_earnings,emp_pf,emp_esi,prof_tax,tds,lwf,other_deductions,er_pf,er_esi,gratuity,reason,revised_by)
      VALUES (${req.params.id},${effective_from||new Date().toISOString().split('T')[0]},
        ${basic},${hra},${conveyance},${medical},${special},${other_earnings},
        ${emp_pf},${emp_esi},${prof_tax},${tds},${lwf},${other_deductions},
        ${er_pf},${er_esi},${gratuity},${reason||null},${req.user.id}) RETURNING *`;
    await sql`UPDATE employees SET salary=${basic} WHERE id=${req.params.id}`;
    await audit.log(req,{action:'SALARY_REVISION',module:'salary',recordId:req.params.id,newValue:{basic,reason}});
    res.status(201).json(row);
  } catch(err){ console.error(err); res.status(500).json({error:'Server error'}); }
});

router.put('/:id/bank', requireAuth, requirePermission('employee.edit'), async (req,res) => {
  try {
    const b = req.body;
    const [ex] = await sql`SELECT id FROM employee_bank WHERE employee_id=${req.params.id}`;
    const [row] = ex
      ? await sql`UPDATE employee_bank SET holder_name=${b.holder_name},bank_name=${b.bank_name},
          branch=${b.branch},account_no=${b.account_no},ifsc=${b.ifsc},
          account_type=${b.account_type},pay_mode=${b.pay_mode},updated_at=NOW()
          WHERE employee_id=${req.params.id} RETURNING *`
      : await sql`INSERT INTO employee_bank (employee_id,holder_name,bank_name,branch,account_no,ifsc,account_type,pay_mode)
          VALUES (${req.params.id},${b.holder_name},${b.bank_name},${b.branch},${b.account_no},
          ${b.ifsc},${b.account_type},${b.pay_mode||'Bank Transfer'}) RETURNING *`;
    res.json(row);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

router.put('/:id/statutory', requireAuth, requirePermission('employee.edit'), async (req,res) => {
  try {
    const b = req.body;
    const [ex] = await sql`SELECT id FROM employee_statutory WHERE employee_id=${req.params.id}`;
    const [row] = ex
      ? await sql`UPDATE employee_statutory SET pan=${b.pan},aadhaar_ref=${b.aadhaar_ref},
          uan=${b.uan},pf_number=${b.pf_number},esic_number=${b.esic_number},
          pt_applicable=${b.pt_applicable||false},lwf_applicable=${b.lwf_applicable||false},
          tax_regime=${b.tax_regime||'New'},tds_applicable=${b.tds_applicable||false},updated_at=NOW()
          WHERE employee_id=${req.params.id} RETURNING *`
      : await sql`INSERT INTO employee_statutory (employee_id,pan,aadhaar_ref,uan,pf_number,esic_number,pt_applicable,lwf_applicable,tax_regime,tds_applicable)
          VALUES (${req.params.id},${b.pan},${b.aadhaar_ref},${b.uan},${b.pf_number},${b.esic_number},
          ${b.pt_applicable||false},${b.lwf_applicable||false},${b.tax_regime||'New'},${b.tds_applicable||false}) RETURNING *`;
    res.json(row);
  } catch(err){ res.status(500).json({error:'Server error'}); }
});

module.exports = router;
