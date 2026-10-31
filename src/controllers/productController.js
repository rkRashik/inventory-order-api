const { z } = require("zod");
const { createProduct, listProducts } = require("../services/productService");


const productSchema = z.object({
  sku: z.string().trim().min(1).max(100)
    .regex(/^[A-Za-z0-9_-]+$/)
    .transform((value) => value.toUpperCase()),

  name: z.string().trim().min(1).max(200),

  description: z.string().trim().max(2000).optional(),

  unit_price: z.string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/)
}).strict();

async function addProduct(req, res, next) {
  const parsed = productSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid product data"
      }
    });
  }

  try {
    const product = await createProduct(parsed.data);

    return res.status(201).json({ product });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: {
          code: "SKU_EXISTS",
          message: "A product with this SKU already exists"
        }
      });
    }

    next(error);
  }
}


const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  is_active: z.enum(["true", "false"]).optional()
}).strict();

async function getProducts(req, res, next) {
  const parsed = listSchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters"
      }
    });
  }

  try {
    const { page, limit, search, is_active } = parsed.data;

    const result = await listProducts({
      page,
      limit,
      search,
      isActive: is_active === undefined
        ? undefined
        : is_active === "true"
    });

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = { addProduct, getProducts };