// routes/leadRoutes.js
const express = require('express');
const router  = express.Router();
const {
  getLeads, getLead, updateLead, deleteLead, archiveLead, exportLeads,
} = require('../controllers/leadController');
const { protect, requireVerified, requireActivePlan } = require('../middleware/auth');
const { apiLimit }                                     = require('../middleware/rateLimiter');

router.use(protect, requireVerified, requireActivePlan, apiLimit);

router.get('/export/csv', exportLeads);   // before /:id to avoid conflict

router.route('/')
  .get(getLeads);

router.route('/:id')
  .get(getLead)
  .put(updateLead)
  .delete(deleteLead);

router.put('/:id/archive', archiveLead);

module.exports = router;
