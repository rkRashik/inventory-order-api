const express = require("express");

const app = express();

app.use(express.json({ limit: "100kb" }));

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Inventory Order API is running"
  });
});

module.exports = app;