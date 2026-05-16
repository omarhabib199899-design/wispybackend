// routes/adminRoutes.js
const express = require('express');
const router  = express.Router();
const {
  getPlatformStats,
  getUsers, getUser, updateUser, deleteUser,
  getAllBots,
  getRevenue,
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');

// All admin routes require auth + admin role
router.use(protect, authorize('admin'));

router.get('/stats',    getPlatformStats);
router.get('/revenue',  getRevenue);

router.route('/users')
  .get(getUsers);

router.route('/users/:id')
  .get(getUser)
  .put(updateUser)
  .delete(deleteUser);

router.get('/bots', getAllBots);

module.exports = router;
