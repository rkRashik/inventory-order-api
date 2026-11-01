const express = require("express");
const authenticate = require("../middleware/authenticate");

const {
  addOrder,
  cancelOrderHandler
} = require("../controllers/orderController");

const router = express.Router();

router.use(authenticate);

router.post("/", addOrder);
router.post("/:id/cancel", cancelOrderHandler);

module.exports = router;