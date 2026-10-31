const express = require("express");
const authenticate = require("../middleware/authenticate");

const router = express.Router();

router.get("/me", authenticate, (req, res) => {
  res.status(200).json({
    user: req.user
  });
});

module.exports = router;