const { z } = require("zod");
const {
  createOrder,
  getOrderById,
  cancelOrder,
  listOrders
} = require("../services/orderService");

const itemSchema = z.object({
  product_id: z.number().int().positive()
    .max(Number.MAX_SAFE_INTEGER),
  quantity: z.number().int().min(1).max(1000000)
}).strict();

const orderSchema = z.object({
  customer_name: z.string().trim().min(1).max(150),
  items: z.array(itemSchema).min(1).max(50)
}).strict().refine(
  (data) => {
    const ids = data.items.map(item => item.product_id);
    return new Set(ids).size === ids.length;
  },
  { message: "Duplicate products are not allowed" }
);

async function addOrder(req, res, next) {
  const key = req.get("Idempotency-Key");

  if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    return res.status(400).json({
      error: {
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "A valid Idempotency-Key header is required"
      }
    });
  }

  const parsed = orderSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid order data"
      }
    });
  }

  try {
    const result = await createOrder({
      customerName: parsed.data.customer_name,
      items: parsed.data.items,
      key,
      userId: req.user.id
    });

    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
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
}


async function cancelOrderHandler(req, res, next) {
  const id = req.params.id;

  if (
    !/^[1-9]\d*$/.test(id) ||
    !Number.isSafeInteger(Number(id))
  ) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid order ID"
      }
    });
  }

  try {
    const order = await cancelOrder(id, req.user.id);

    return res.status(200).json({ order });
  } catch (error) {
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
}


function isValidOrderId(id) {
  return /^[1-9]\d*$/.test(id) &&
    Number.isSafeInteger(Number(id));
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

const dateSchema = z.string().refine(isValidDate);

const orderListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["CONFIRMED", "CANCELLED"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  from_date: dateSchema.optional(),
  to_date: dateSchema.optional()
}).strict().refine(
  data => !data.from_date ||
    !data.to_date ||
    data.from_date <= data.to_date,
  { message: "Invalid date range" }
);

async function getOrders(req, res, next) {
  const parsed = orderListSchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid order filters"
      }
    });
  }

  try {
    const data = parsed.data;

    const result = await listOrders({
      page: data.page,
      limit: data.limit,
      status: data.status,
      fromDate: data.from_date,
      toDate: data.to_date,
      search: data.search
    });

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function getOrder(req, res, next) {
  if (!isValidOrderId(req.params.id)) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid order ID"
      }
    });
  }

  try {
    const order = await getOrderById(req.params.id);

    if (!order) {
      return res.status(404).json({
        error: {
          code: "ORDER_NOT_FOUND",
          message: "Order not found"
        }
      });
    }

    return res.status(200).json({ order });
  } catch (error) {
    next(error);
  }
}


module.exports = {
  addOrder,
  cancelOrderHandler,
  getOrders,
  getOrder
};