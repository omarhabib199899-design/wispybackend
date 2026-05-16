// routes/conversationRoutes.js — authenticated dashboard endpoints
const express = require('express');
const router  = express.Router();
const {
  getConversations,
  getConversation,
  deleteConversation,
} = require('../controllers/widgetController');
const { protect, requireVerified }  = require('../middleware/auth');
const { apiLimit }                   = require('../middleware/rateLimiter');

router.use(protect, requireVerified, apiLimit);

router.route('/')
  .get(getConversations);

router.route('/:id')
  .get(getConversation)
  .delete(deleteConversation);

module.exports = router;
