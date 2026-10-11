const http = require("node:http");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const ROOT = __dirname;
const MENU_FILE = path.join(ROOT, "data", "menu.json");
const ORDERS_FILE = process.env.ORDERS_FILE || path.join(ROOT, "data", "orders.json");
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const FREE_DELIVERY_THRESHOLD = 599;
const DELIVERY_FEE = 49;
const TAX_RATE = 0.05;
const ORDER_STATUSES = ["queued", "preparing", "on-the-way", "delivered", "cancelled"];
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

let menu;
let orderMutationQueue = Promise.resolve();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk.toString();
    if (raw.length > 16_384) throw new HttpError(413, "Your request is too large.");
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "Please send valid JSON.");
  }
}

async function readOrders() {
  try {
    const contents = await fs.readFile(ORDERS_FILE, "utf8");
    const orders = JSON.parse(contents);
    if (!Array.isArray(orders)) throw new Error("The orders file must contain a JSON array.");
    return orders;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeOrders(orders) {
  const temporaryFile = `${ORDERS_FILE}.tmp`;
  await fs.mkdir(path.dirname(ORDERS_FILE), { recursive: true });
  await fs.writeFile(temporaryFile, JSON.stringify(orders, null, 2), "utf8");
  await fs.rename(temporaryFile, ORDERS_FILE);
}

function mutateOrders(mutation) {
  const operation = orderMutationQueue.then(async () => {
    const orders = await readOrders();
    const result = mutation(orders);
    if (result.changed) await writeOrders(orders);
    return result.value;
  });
  orderMutationQueue = operation.catch(() => {});
  return operation;
}

function calculateOrder(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new HttpError(400, "Please add between 1 and 20 different dishes.");
  }

  const menuById = new Map(menu.map((dish) => [dish.id, dish]));
  const normalizedItems = items.map((item) => {
    const dish = menuById.get(item?.id);
    if (!dish) throw new HttpError(400, "One of those dishes is no longer on the menu.");
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) {
      throw new HttpError(400, `Please choose a valid quantity for ${dish.name}.`);
    }
    return {
      id: dish.id,
      name: dish.name,
      quantity: item.quantity,
      unitPrice: dish.price,
      lineTotal: dish.price * item.quantity
    };
  });
  const subtotal = normalizedItems.reduce((total, item) => total + item.lineTotal, 0);
  const deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
  const tax = Math.round(subtotal * TAX_RATE);
  return {
    items: normalizedItems,
    subtotal,
    deliveryFee,
    tax,
    total: subtotal + deliveryFee + tax
  };
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(ROOT, "public", `.${decodeURIComponent(requestedPath)}`);
  const publicRoot = path.resolve(ROOT, "public");
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) {
    throw new HttpError(404, "That page could not be found.");
  }
  let contents;
  try {
    contents = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      throw new HttpError(404, "That page could not be found.");
    }
    throw error;
  }
  const extension = path.extname(filePath);
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  response.end(contents);
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/health" && request.method === "GET") {
    return sendJson(response, 200, { status: "ok" });
  }
  if ((pathname === "/admin" || pathname === "/admin/") && request.method === "GET") {
    return serveStatic("/admin.html", response);
  }
  if (pathname === "/api/menu" && request.method === "GET") {
    return sendJson(response, 200, { items: menu });
  }
  if (pathname === "/api/orders" && request.method === "POST") {
    const body = await readBody(request);
    const customerName = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
    if (customerName.length < 2 || customerName.length > 80) {
      throw new HttpError(400, "Please enter your name (2–80 characters).");
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      throw new HttpError(400, "Please enter a valid 10-digit Indian mobile number.");
    }
    if (address.length < 10 || address.length > 300) {
      throw new HttpError(400, "Please enter a delivery address (10–300 characters).");
    }
    if (instructions.length > 240) {
      throw new HttpError(400, "Delivery notes must be 240 characters or fewer.");
    }
    if (body.paymentMethod !== "cod") {
      throw new HttpError(400, "Cash on delivery is the only available payment method.");
    }
    const pricing = calculateOrder(body.items);
    const order = {
      id: randomUUID(),
      reference: randomUUID().slice(0, 8).toUpperCase(),
      status: "queued",
      createdAt: new Date().toISOString(),
      customer: { name: customerName, phone, address, instructions },
      paymentMethod: "cod",
      ...pricing
    };
    await mutateOrders((orders) => {
      orders.push(order);
      return { changed: true, value: order };
    });
    return sendJson(response, 201, {
      id: order.id,
      reference: order.reference,
      status: order.status,
      items: order.items,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      tax: order.tax,
      total: order.total,
      createdAt: order.createdAt
    });
  }

  const customerOrderMatch = pathname.match(/^\/api\/orders\/([0-9a-f-]{36})$/i);
  if (customerOrderMatch && request.method === "GET") {
    const orders = await readOrders();
    const order = orders.find((item) => item.id === customerOrderMatch[1]);
    if (!order) throw new HttpError(404, "We couldn’t find that order. Please check your order link.");
    return sendJson(response, 200, {
      id: order.id,
      reference: order.reference,
      status: order.status,
      items: order.items,
      total: order.total,
      createdAt: order.createdAt
    });
  }

  if (pathname.startsWith("/api/admin/")) {
    if (!ADMIN_API_KEY) throw new HttpError(503, "Restaurant management is not configured.");
    if (request.headers.authorization !== `Bearer ${ADMIN_API_KEY}`) {
      throw new HttpError(401, "A valid restaurant admin API key is required.");
    }
    if (pathname === "/api/admin/orders" && request.method === "GET") {
      const orders = await readOrders();
      orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return sendJson(response, 200, { orders });
    }
    const adminOrderMatch = pathname.match(/^\/api\/admin\/orders\/([0-9a-f-]{36})$/i);
    if (adminOrderMatch && request.method === "PATCH") {
      const body = await readBody(request);
      if (!ORDER_STATUSES.includes(body.status)) {
        throw new HttpError(400, `Choose an order status: ${ORDER_STATUSES.join(", ")}.`);
      }
      const order = await mutateOrders((orders) => {
        const found = orders.find((item) => item.id === adminOrderMatch[1]);
        if (!found) throw new HttpError(404, "That order could not be found.");
        if (found.status === "delivered" || found.status === "cancelled") {
          throw new HttpError(409, "Delivered and cancelled orders cannot be changed.");
        }
        found.status = body.status;
        found.updatedAt = new Date().toISOString();
        return { changed: true, value: found };
      });
      return sendJson(response, 200, { order });
    }
    throw new HttpError(404, "That restaurant management endpoint could not be found.");
  }

  if (pathname.startsWith("/api/")) {
    throw new HttpError(404, "That API endpoint could not be found.");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new HttpError(405, "That method is not allowed.");
  }
  return serveStatic(pathname, response);
}

async function start() {
  menu = JSON.parse(await fs.readFile(MENU_FILE, "utf8"));
  if (!Array.isArray(menu) || menu.length === 0) {
    throw new Error("The menu file must contain at least one dish.");
  }
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (!(error instanceof HttpError)) {
        console.error("Request failed:", error);
      }
      sendJson(response, error instanceof HttpError ? error.status : 500, {
        error: error instanceof HttpError ? error.message : "Something went wrong. Please try again."
      });
    });
  });
  server.listen(PORT, HOST, () => {
    console.log(`Little Leaf is serving on http://${HOST}:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Unable to start Little Leaf:", error);
  process.exitCode = 1;
});
