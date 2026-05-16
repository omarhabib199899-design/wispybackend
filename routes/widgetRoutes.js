// routes/widgetRoutes.js  — public chat endpoints
const express = require('express');
const router  = express.Router();
const {
  initWidget,
  sendMessage,
  endSession,
  captureLead,
} = require('../controllers/widgetController');
const { widgetLimit } = require('../middleware/rateLimiter');

router.post('/init',    widgetLimit, initWidget);
router.post('/message', widgetLimit, sendMessage);
router.post('/end',     widgetLimit, endSession);
router.post('/lead',    widgetLimit, captureLead);  // structured lead form (no AI parsing)

module.exports = router;
