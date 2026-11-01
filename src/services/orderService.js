const { randomUUID, createHash } = require("node:crypto");
const pool = require("../config/db");

function orderError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function toCents(price) {
  const [whole, fraction = ""] = String(price).split(".");

  return BigInt(whole) * 100n +
    BigInt(fraction.padEnd(2, "0"));
}

function toMoney(cents) {
  const whole = cents / 100n;
  const fraction = String(cents % 100n).padStart(2, "0");

  return `${whole}.${fraction}`;
}

async function getOrderById(id, client = pool) {
  const result = await client.query(
    `SELECT id, order_number, customer_name, status,
       total_amount, created_by, cancelled_by,
       cancelled_at, created_at
     FROM orders
     WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const items = await client.query(
    `SELECT product_id, quantity, unit_price, line_total
     FROM order_items
     WHERE order_id = $1
     ORDER BY id`,
    [id]
  );

  return {
    ...result.rows[0],
    items: items.rows
  };
}

async function createOrder({ customerName, items, key, userId }) {
  const sortedItems = [...items].sort(
    (a, b) => a.product_id - b.product_id
  );

  const requestHash = createHash("sha256")
    .update(JSON.stringify({
      customer_name: customerName,
      items: sortedItems
    }))
    .digest("hex");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialize requests using the same idempotency key.
    await client.query(
      "SELECT pg_advisory_xact_lock(7341, hashtext($1::text))",
      [key]
    );

    const existing = await client.query(
      `SELECT id, request_hash
       FROM orders
       WHERE idempotency_key = $1`,
      [key]
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].request_hash !== requestHash) {
        throw orderError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key already used for a different request"
        );
      }

      const order = await getOrderById(
        existing.rows[0].id,
        client
      );

      await client.query("COMMIT");
      return { order, replayed: true };
    }

    const preparedItems = [];
    let totalCents = 0n;

    for (const item of sortedItems) {
      const result = await client.query(
        `SELECT p.id, p.is_active, p.unit_price,
                i.quantity AS stock
         FROM products p
         JOIN inventory i ON i.product_id = p.id
         WHERE p.id = $1
         FOR UPDATE OF p, i`,
        [item.product_id]
      );

      if (result.rows.length === 0) {
        throw orderError(
          404,
          "PRODUCT_NOT_FOUND",
          "Product not found"
        );
      }

      const product = result.rows[0];

      if (!product.is_active) {
        throw orderError(
          409,
          "INACTIVE_PRODUCT",
          "Cannot order an inactive product"
        );
      }

      if (product.stock < item.quantity) {
        throw orderError(
          409,
          "INSUFFICIENT_STOCK",
          "Not enough stock available"
        );
      }

      const lineCents =
        toCents(product.unit_price) * BigInt(item.quantity);

      totalCents += lineCents;

      if (totalCents > 999999999999n) {
        throw orderError(
          400,
          "ORDER_TOTAL_EXCEEDED",
          "Order total exceeds the allowed limit"
        );
      }

      preparedItems.push({
        productId: item.product_id,
        quantity: item.quantity,
        unitPrice: product.unit_price,
        lineTotal: toMoney(lineCents)
      });
    }

    const orderNumber = `ORD-${randomUUID()}`;

    const orderResult = await client.query(
      `INSERT INTO orders
       (order_number, customer_name, status,
        total_amount, idempotency_key,
        request_hash, created_by)
       VALUES ($1, $2, 'CONFIRMED', $3, $4, $5, $6)
       RETURNING id`,
      [
        orderNumber,
        customerName,
        toMoney(totalCents),
        key,
        requestHash,
        userId
      ]
    );

    const orderId = orderResult.rows[0].id;

    for (const item of preparedItems) {
      const stockUpdate = await client.query(
        `UPDATE inventory
         SET quantity = quantity - $1,
             updated_at = NOW()
         WHERE product_id = $2 AND quantity >= $1
         RETURNING quantity`,
        [item.quantity, item.productId]
      );

      if (stockUpdate.rowCount !== 1) {
        throw orderError(
          409,
          "INSUFFICIENT_STOCK",
          "Not enough stock available"
        );
      }

      await client.query(
        `INSERT INTO order_items
         (order_id, product_id, quantity,
          unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          orderId,
          item.productId,
          item.quantity,
          item.unitPrice,
          item.lineTotal
        ]
      );

      await client.query(
        `INSERT INTO stock_movements
         (product_id, movement_type, quantity,
          reference, created_by)
         VALUES ($1, 'ORDER', $2, $3, $4)`,
        [
          item.productId,
          item.quantity,
          orderNumber,
          userId
        ]
      );
    }

    const order = await getOrderById(orderId, client);

    await client.query("COMMIT");

    return { order, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


async function cancelOrder(id, userId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      `SELECT id, order_number, status
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (orderResult.rows.length === 0) {
      throw orderError(
        404,
        "ORDER_NOT_FOUND",
        "Order not found"
      );
    }

    const currentOrder = orderResult.rows[0];

    if (currentOrder.status !== "CONFIRMED") {
      throw orderError(
        409,
        "ORDER_ALREADY_CANCELLED",
        "Only confirmed orders can be cancelled"
      );
    }

    const itemsResult = await client.query(
      `SELECT product_id, quantity
       FROM order_items
       WHERE order_id = $1
       ORDER BY product_id`,
      [id]
    );

    for (const item of itemsResult.rows) {
      const result = await client.query(
        `UPDATE inventory
         SET quantity = quantity + $1,
             updated_at = NOW()
         WHERE product_id = $2
           AND quantity <= 2147483647 - $1
         RETURNING quantity`,
        [item.quantity, item.product_id]
      );

      if (result.rowCount !== 1) {
        throw orderError(
          409,
          "STOCK_RESTORE_FAILED",
          "Unable to restore product stock"
        );
      }

      await client.query(
        `INSERT INTO stock_movements
         (product_id, movement_type, quantity,
          reference, created_by)
         VALUES ($1, 'CANCELLATION', $2, $3, $4)`,
        [
          item.product_id,
          item.quantity,
          currentOrder.order_number,
          userId
        ]
      );
    }

    await client.query(
      `UPDATE orders
       SET status = 'CANCELLED',
           cancelled_by = $1,
           cancelled_at = NOW()
       WHERE id = $2`,
      [userId, id]
    );

    const order = await getOrderById(id, client);

    await client.query("COMMIT");

    return order;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


async function listOrders({ page, limit, status, fromDate, toDate }) {
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (fromDate) {
    params.push(fromDate);
    conditions.push(`created_at >= $${params.length}::date`);
  }

  if (toDate) {
    params.push(toDate);
    conditions.push(
      `created_at < ($${params.length}::date + INTERVAL '1 day')`
    );
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total FROM orders ${where}`,
    params
  );

  const total = Number(countResult.rows[0].total);
  const offset = (page - 1) * limit;

  const result = await pool.query(
    `SELECT id, order_number, customer_name, status,
            total_amount, created_by, cancelled_by,
            cancelled_at, created_at
     FROM orders
     ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    orders: result.rows,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit)
    }
  };
}


module.exports = {
  createOrder,
  getOrderById,
  cancelOrder,
  listOrders
};