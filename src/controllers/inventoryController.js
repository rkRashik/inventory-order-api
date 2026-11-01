const { z } = require("zod");
const {
  adjustStock,
  getStockMovements
} = require("../services/inventoryService");
const { logEvent } = require("../middleware/requestLogger");


const adjustmentSchema = z.object({
  product_id: z.number().int().positive()
    .max(Number.MAX_SAFE_INTEGER),
  type: z.enum(["IN", "OUT"]),
  quantity: z.number().int().min(1).max(1000000),
  reason: z.string().trim().min(3).max(500)
}).strict();

const historySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict();

function handleInventoryError(error, res, next) {
  if (error.status) {
    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }

  next(error);
}

async function createAdjustment(req, res, next) {
  const parsed = adjustmentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid stock adjustment"
      }
    });
  }

  try {
    const result = await adjustStock({
      productId: parsed.data.product_id,
      type: parsed.data.type,
      quantity: parsed.data.quantity,
      reason: parsed.data.reason,
      userId: req.user.id
    });

    logEvent("inventory.adjusted", {
      product_id: result.product_id,
      type: parsed.data.type,
      quantity: parsed.data.quantity,
      user_id: req.user.id
    });

    return res.status(201).json(result);
  } catch (error) {
    return handleInventoryError(error, res, next);
  }
}

async function listMovements(req, res, next) {
  const productId = req.params.productId;

  if (
    !/^[1-9]\d*$/.test(productId) ||
    !Number.isSafeInteger(Number(productId))
  ) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid product ID"
      }
    });
  }

  const parsed = historySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid pagination parameters"
      }
    });
  }

  try {
    const result = await getStockMovements(
      productId,
      parsed.data.page,
      parsed.data.limit
    );

    return res.status(200).json(result);
  } catch (error) {
    return handleInventoryError(error, res, next);
  }
}

module.exports = { createAdjustment, listMovements };