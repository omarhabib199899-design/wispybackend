// routes/analyticsRoutes.js
const express = require('express');
const router  = express.Router();
const {
  getOverview,
  getChart,
  getTopQuestions,
} = require('../controllers/analyticsController');
const { protect, requireVerified }  = require('../middleware/auth');
const { apiLimit }                   = require('../middleware/rateLimiter');

router.use(protect, requireVerified, apiLimit);

router.get('/overview',       getOverview);
router.get('/chart',          getChart);
router.get('/top-questions',  getTopQuestions);

module.exports = router;
