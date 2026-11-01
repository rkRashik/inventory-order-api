const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const app = require("../src/app");
const pool = require("../src/config/db");

const runId = randomUUID().slice(0, 12);
const password = "LocalTestPass123!";

const adminEmail = `admin-${runId}@example.test`;
const staffEmail = `staff-${runId}@example.test`;

let adminToken;
let staffToken;
let productId;
let orderId;

const orderKey = `order-${randomUUID()}`;

const orderBody = () => ({
  customer_name: "Test Customer",
  items: [{ product_id: productId, quantity: 2 }]
});

async function stockOf(id) {
  const result = await pool.query(
    "SELECT quantity FROM inventory WHERE product_id = $1",
    [id]
  );

  return result.rows[0].quantity;
}

before(async () => {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.DB_NAME !== "inventory_order_test_db"
  ) {
    throw new Error("Tests must use the dedicated test database");
  }

  const database = await pool.query(
    "SELECT current_database() AS name"
  );

  if (database.rows[0].name !== "inventory_order_test_db") {
    throw new Error("Incorrect database connection");
  }

  const hash = await bcrypt.hash(password, 10);

  for (const [email, role] of [
    [adminEmail, "ADMIN"],
    [staffEmail, "STAFF"]
  ]) {
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)`,
      [role, email, hash, role]
    );
  }

  const adminLogin = await request(app)
    .post("/auth/login")
    .send({ email: adminEmail, password });

  const staffLogin = await request(app)
    .post("/auth/login")
    .send({ email: staffEmail, password });

  assert.equal(adminLogin.status, 200);
  assert.equal(staffLogin.status, 200);

  adminToken = adminLogin.body.accessToken;
  staffToken = staffLogin.body.accessToken;
});

after(async () => {
  await pool.end();
});

test("Critical API integration tests", async (t) => {
  await t.test("Authentication and role permissions", async () => {
    const unauthorized = await request(app).get("/users/me");

    assert.equal(unauthorized.status, 401);

    const staff = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        sku: `TEST-${runId}`,
        name: "Test Mouse",
        unit_price: "800.00"
      });

    assert.equal(staff.status, 403);
  });

  await t.test("Create product and add stock", async () => {
    const created = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        sku: `TEST-${runId}`,
        name: "Test Mouse",
        unit_price: "800.00"
      });

    assert.equal(created.status, 201);

    productId = Number(created.body.product.id);

    const adjustment = await request(app)
      .post("/inventory/adjustments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        product_id: productId,
        type: "IN",
        quantity: 10,
        reason: "Test stock receipt"
      });

    assert.equal(adjustment.status, 201);
    assert.equal(await stockOf(productId), 10);
  });

  await t.test("Order reduces stock and saves price snapshot", async () => {
    const created = await request(app)
      .post("/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", orderKey)
      .send(orderBody());

    assert.equal(created.status, 201);
    assert.equal(created.body.replayed, false);

    orderId = created.body.order.id;

    assert.equal(created.body.order.total_amount, "1600.00");
    assert.equal(await stockOf(productId), 8);

    const updated = await request(app)
      .patch(`/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ unit_price: "900.00" });

    assert.equal(updated.status, 200);

    const details = await request(app)
      .get(`/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(details.status, 200);
    assert.equal(details.body.order.items[0].unit_price, "800.00");
  });

  await t.test("Idempotency prevents duplicate orders", async () => {
    const repeated = await request(app)
      .post("/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", orderKey)
      .send(orderBody());

    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.replayed, true);
    assert.equal(repeated.body.order.id, orderId);
    assert.equal(await stockOf(productId), 8);

    const conflict = await request(app)
      .post("/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", orderKey)
      .send({
        customer_name: "Different Customer",
        items: [{ product_id: productId, quantity: 1 }]
      });

    assert.equal(conflict.status, 409);
  });

  await t.test("Insufficient stock leaves no partial order", async () => {
    const key = `insufficient-${randomUUID()}`;
    const beforeStock = await stockOf(productId);

    const beforeMovements = await pool.query(
      `SELECT COUNT(*) AS total
       FROM stock_movements
       WHERE product_id = $1`,
      [productId]
    );

    const failed = await request(app)
      .post("/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", key)
      .send({
        customer_name: "Insufficient Stock Test",
        items: [{ product_id: productId, quantity: 100 }]
      });

    assert.equal(failed.status, 409);
    assert.equal(await stockOf(productId), beforeStock);

    const orders = await pool.query(
      "SELECT id FROM orders WHERE idempotency_key = $1",
      [key]
    );

    assert.equal(orders.rowCount, 0);

    const afterMovements = await pool.query(
      `SELECT COUNT(*) AS total
       FROM stock_movements
       WHERE product_id = $1`,
      [productId]
    );

    assert.equal(
      afterMovements.rows[0].total,
      beforeMovements.rows[0].total
    );
  });


    await t.test("Database failure rolls back order changes", async () => {
    const created = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        sku: `FAIL-${runId}`,
        name: "Rollback Test Product",
        unit_price: "300.00"
      });

    assert.equal(created.status, 201);

    const id = Number(created.body.product.id);

    const stocked = await request(app)
      .post("/inventory/adjustments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        product_id: id,
        type: "IN",
        quantity: 5,
        reason: "Rollback test stock"
      });

    assert.equal(stocked.status, 201);

    const key = `rollback-${randomUUID()}`;
    const constraint = `reject_order_${runId.replace(/-/g, "")}`;

    // Test-only constraint: reject the ORDER movement.
    await pool.query(
      `ALTER TABLE stock_movements
       ADD CONSTRAINT ${constraint}
       CHECK (NOT (
         movement_type = 'ORDER' AND product_id = ${id}
       ))`
    );

    try {
      const response = await request(app)
        .post("/orders")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("Idempotency-Key", key)
        .send({
          customer_name: "Rollback Test",
          items: [{ product_id: id, quantity: 2 }]
        });

      assert.equal(response.status, 500);

      // Stock must remain unchanged.
      assert.equal(await stockOf(id), 5);

      // The failed order must not exist.
      const orders = await pool.query(
        "SELECT id FROM orders WHERE idempotency_key = $1",
        [key]
      );

      assert.equal(orders.rowCount, 0);

      // No partial order items may remain.
      const items = await pool.query(
        "SELECT id FROM order_items WHERE product_id = $1",
        [id]
      );

      assert.equal(items.rowCount, 0);

      // Only the original stock receipt should exist.
      const movements = await pool.query(
        `SELECT movement_type
         FROM stock_movements
         WHERE product_id = $1
         ORDER BY id`,
        [id]
      );

      assert.deepEqual(
        movements.rows.map(row => row.movement_type),
        ["ADJUSTMENT_IN"]
      );
    } finally {
      await pool.query(
        `ALTER TABLE stock_movements
         DROP CONSTRAINT IF EXISTS ${constraint}`
      );
    }
  });

  
  await t.test("Concurrent orders cannot oversell", async () => {
    const created = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        sku: `RACE-${runId}`,
        name: "Limited Stock Item",
        unit_price: "500.00"
      });

    assert.equal(created.status, 201);

    const limitedProductId = Number(created.body.product.id);

    const stocked = await request(app)
      .post("/inventory/adjustments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        product_id: limitedProductId,
        type: "IN",
        quantity: 1,
        reason: "Concurrency test stock"
      });

    assert.equal(stocked.status, 201);

    const placeOrder = (key) =>
      request(app)
        .post("/orders")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("Idempotency-Key", key)
        .send({
          customer_name: "Concurrent Customer",
          items: [{ product_id: limitedProductId, quantity: 1 }]
        });

    const results = await Promise.all([
      placeOrder(`race-${randomUUID()}`),
      placeOrder(`race-${randomUUID()}`)
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort(),
      [201, 409]
    );

    assert.equal(await stockOf(limitedProductId), 0);
  });

  await t.test("Cancellation restores stock only once", async () => {
    const first = await request(app)
      .post(`/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(first.status, 200);
    assert.equal(first.body.order.status, "CANCELLED");
    assert.equal(await stockOf(productId), 10);

    const second = await request(app)
      .post(`/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(second.status, 409);
    assert.equal(await stockOf(productId), 10);

    const reversals = await pool.query(
      `SELECT COUNT(*) AS total
       FROM stock_movements
       WHERE product_id = $1
         AND movement_type = 'CANCELLATION'`,
      [productId]
    );

    assert.equal(Number(reversals.rows[0].total), 1);
  });
});