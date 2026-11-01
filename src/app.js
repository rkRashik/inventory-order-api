const express = require("express");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");

const app = express();

app.use(express.json({ limit: "100kb" }));

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Inventory Order API is running"
  });
});

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/products", productRoutes);
app.use("/inventory", inventoryRoutes);

app.use((err, req, res, next) => {
  const status = [400, 413].includes(err.status)
    ? err.status
    : 500;

  if (status === 500) {
    console.error("Request error:", err.message);
  }

  res.status(status).json({
    error: {
      code: status === 400
        ? "BAD_REQUEST"
        : status === 413
          ? "PAYLOAD_TOO_LARGE"
          : "INTERNAL_ERROR",
      message: status === 500
        ? "An unexpected error occurred"
        : "Invalid request"
    }
  });
});

module.exports = app;