// routes/botRoutes.js
const express = require('express');
const router  = express.Router();
const {
  getBots, createBot, getBot, updateBot, deleteBot,
  getEmbedCode,
  addQA, addText, scrapeUrl, deleteKnowledge, toggleKnowledge,
  getBotStats,
} = require('../controllers/botController');
const { protect, requireVerified, requireActivePlan } = require('../middleware/auth');
const { apiLimit, scrapeLimit }                        = require('../middleware/rateLimiter');

router.use(protect, requireVerified, requireActivePlan, apiLimit);

router.route('/')
  .get(getBots)
  .post(createBot);

router.route('/:id')
  .get(getBot)
  .put(updateBot)
  .delete(deleteBot);

router.get('/:id/embed',  getEmbedCode);
router.get('/:id/stats',  getBotStats);

// Knowledge base
router.post('/:id/knowledge/qa',    addQA);
router.post('/:id/knowledge/text',  addText);
router.post('/:id/knowledge/url',   scrapeLimit, scrapeUrl);

router.route('/:id/knowledge/:knowledgeId')
  .delete(deleteKnowledge);

router.put('/:id/knowledge/:knowledgeId/toggle', toggleKnowledge);

module.exports = router;
