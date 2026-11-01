const pool = require("../config/db");

function inventoryError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function adjustStock({ productId, type, quantity, reason, userId }) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT p.id, p.is_active, i.quantity
       FROM products p
       JOIN inventory i ON i.product_id = p.id
       WHERE p.id = $1
       FOR UPDATE OF p, i`,
      [productId]
    );

    if (result.rows.length === 0) {
      throw inventoryError(404, "NOT_FOUND", "Product not found");
    }

    if (!result.rows[0].is_active) {
      throw inventoryError(409, "INACTIVE_PRODUCT", "Product is inactive");
    }

    const currentStock = result.rows[0].quantity;
    const change = type === "IN" ? quantity : -quantity;
    const newStock = currentStock + change;

    if (newStock < 0) {
      throw inventoryError(
        409,
        "INSUFFICIENT_STOCK",
        "Not enough stock available"
      );
    }

    if (newStock > 2147483647) {
      throw inventoryError(
        409,
        "STOCK_LIMIT_EXCEEDED",
        "Stock quantity exceeds the allowed limit"
      );
    }

    await client.query(
      `UPDATE inventory
       SET quantity = $1, updated_at = NOW()
       WHERE product_id = $2`,
      [newStock, productId]
    );

    const movementType = type === "IN"
      ? "ADJUSTMENT_IN"
      : "ADJUSTMENT_OUT";

    const movement = await client.query(
      `INSERT INTO stock_movements
       (product_id, movement_type, quantity, reference, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [productId, movementType, quantity, reason, userId]
    );

    await client.query("COMMIT");

    return {
      product_id: String(productId),
      available_stock: newStock,
      movement: movement.rows[0]
    };

  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getStockMovements(productId, page, limit) {
  const product = await pool.query(
    "SELECT id FROM products WHERE id = $1",
    [productId]
  );

  if (product.rows.length === 0) {
    throw inventoryError(404, "NOT_FOUND", "Product not found");
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM stock_movements
     WHERE product_id = $1`,
    [productId]
  );

  const total = Number(countResult.rows[0].total);
  const offset = (page - 1) * limit;

  const result = await pool.query(
    `SELECT id, product_id, movement_type, quantity,
            reference, created_by, created_at
     FROM stock_movements
     WHERE product_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [productId, limit, offset]
  );

  return {
    movements: result.rows,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit)
    }
  };
}

module.exports = { adjustStock, getStockMovements };