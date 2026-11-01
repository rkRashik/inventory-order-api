const express = require("express");
const authenticate = require("../middleware/authenticate");

const {
  createAdjustment,
  listMovements
} = require("../controllers/inventoryController");

const router = express.Router();

router.use(authenticate);

router.post("/adjustments", createAdjustment);

router.get("/:productId/movements", listMovements);

module.exports = router;