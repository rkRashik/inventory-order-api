const express = require("express");
const authenticate = require("../middleware/authenticate");

const {
  addOrder,
  cancelOrderHandler,
  getOrders,
  getOrder
} = require("../controllers/orderController");

const router = express.Router();

router.use(authenticate);

router.get("/", getOrders);
router.get("/:id", getOrder);

router.post("/", addOrder);
router.post("/:id/cancel", cancelOrderHandler);

module.exports = router;