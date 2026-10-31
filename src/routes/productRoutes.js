const express = require("express");
const authenticate = require("../middleware/authenticate");
const authorizeRole = require("../middleware/authorizeRole");

const {
  addProduct,
  getProducts
} = require("../controllers/productController");

const router = express.Router();

router.get("/", authenticate, getProducts);

router.post("/", authenticate, authorizeRole("ADMIN"), addProduct);

module.exports = router;