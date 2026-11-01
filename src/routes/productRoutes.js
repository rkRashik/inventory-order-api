const express = require("express");
const authenticate = require("../middleware/authenticate");
const authorizeRole = require("../middleware/authorizeRole");

const {
  addProduct,
  getProducts,
  getProduct,
  editProduct,
  disableProduct
} = require("../controllers/productController");

const router = express.Router();

router.get("/", authenticate, getProducts);

router.get("/:id", authenticate, getProduct);

router.post(
  "/",
  authenticate,
  authorizeRole("ADMIN"),
  addProduct
);

router.patch(
  "/:id",
  authenticate,
  authorizeRole("ADMIN"),
  editProduct
);

router.patch(
  "/:id/deactivate",
  authenticate,
  authorizeRole("ADMIN"),
  disableProduct
);

module.exports = router;