const STATUS_LABELS = {
  queued: "New order",
  preparing: "Preparing",
  "on-the-way": "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled"
};
const STATUS_OPTIONS = ["queued", "preparing", "on-the-way", "delivered", "cancelled"];
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

let adminKey = "";
let refreshTimer;

const loginForm = document.querySelector("#admin-login-form");
const loginButton = loginForm.querySelector("button[type=submit]");
const keyInput = document.querySelector("#admin-key");
const loginError = document.querySelector("#login-error");
const dashboard = document.querySelector("#admin-dashboard");
const refreshButton = document.querySelector("#refresh-orders");
const dashboardMessage = document.querySelector("#dashboard-message");
const ordersList = document.querySelector("#orders-list");

function showLoginError(message) {
  loginError.textContent = message;
  loginError.hidden = false;
}

async function adminApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${adminKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("We couldn’t reach the kitchen. Please try again.");
  }
  if (!response.ok) throw new Error(payload.error || "Something went wrong. Please try again.");
  return payload;
}

function renderOrders(orders) {
  const active = orders.filter((order) => order.status !== "delivered" && order.status !== "cancelled");
  const queued = orders.filter((order) => order.status === "queued");
  const today = new Date().toDateString();
  const todayCount = orders.filter((order) => new Date(order.createdAt).toDateString() === today).length;
  document.querySelector("#active-count").textContent = String(active.length);
  document.querySelector("#queued-count").textContent = String(queued.length);
  document.querySelector("#today-count").textContent = String(todayCount);
  ordersList.replaceChildren();
  if (orders.length === 0) {
    ordersList.append(createElement("p", "no-orders", "Nothing on the pass yet. New orders will appear here as soon as they come in."));
  } else {
    ordersList.append(...orders.map(makeOrderCard));
  }
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeOrderCard(order) {
  const card = createElement("article", "order-card");
  const heading = createElement("div", "order-card-heading");
  const identity = createElement("div", "order-identity");
  const title = createElement("h3", "", `Order #${order.reference}`);
  const details = createElement("p", "", `${order.customer.name} · ${order.customer.phone}`);
  const date = new Date(order.createdAt);
  const dateLabel = createElement("p", "order-date", Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }));
  const status = createElement("span", "order-status", STATUS_LABELS[order.status] || order.status);
  identity.append(title, details, dateLabel);
  heading.append(identity, status);

  const body = createElement("div", "order-card-body");
  const delivery = createElement("div");
  const itemSummary = (order.items || [])
    .map((item) => `${item.quantity} × ${item.name}`)
    .join(" · ");
  delivery.append(createElement("p", "order-items", itemSummary));
  delivery.append(createElement("p", "order-delivery", `Deliver to: ${order.customer.address}`));
  if (order.customer.instructions) {
    const notes = createElement("p", "order-notes");
    const label = createElement("strong", "", "Delivery note: ");
    notes.append(label, document.createTextNode(order.customer.instructions));
    delivery.append(notes);
  }
  const total = createElement("div", "order-total");
  total.append(createElement("strong", "", money.format(order.total)));
  total.append(createElement("span", "", "Cash on delivery"));
  body.append(delivery, total);
  card.append(heading, body);

  const controls = createElement("div", "order-controls");
  if (order.status === "delivered" || order.status === "cancelled") {
    controls.append(createElement("span", "order-date", "This order is complete."));
  } else {
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Set delivery status for order ${order.reference}`);
    for (const value of STATUS_OPTIONS) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = STATUS_LABELS[value];
      option.selected = value === order.status;
      select.append(option);
    }
    const update = createElement("button", "", "UPDATE STATUS");
    update.type = "button";
    update.addEventListener("click", async () => {
      if (select.value === order.status) return;
      update.disabled = true;
      dashboardMessage.textContent = "";
      try {
        await adminApi(`/api/admin/orders/${encodeURIComponent(order.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: select.value })
        });
        await loadOrders();
      } catch (error) {
        dashboardMessage.textContent = error.message;
        update.disabled = false;
      }
    });
    controls.append(select, update);
  }
  card.append(controls);
  return card;
}

async function loadOrders() {
  refreshButton.disabled = true;
  dashboardMessage.textContent = "";
  try {
    const { orders } = await adminApi("/api/admin/orders");
    renderOrders(orders);
  } catch (error) {
    dashboardMessage.textContent = error.message;
    if (/admin API key/i.test(error.message)) {
      adminKey = "";
      clearInterval(refreshTimer);
      dashboard.hidden = true;
      loginForm.hidden = false;
      showLoginError("That key wasn’t accepted. Check your hosting settings and try again.");
      keyInput.focus();
    }
  } finally {
    refreshButton.disabled = false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminKey = keyInput.value.trim();
  if (!adminKey) {
    showLoginError("Please enter your private admin key.");
    return;
  }
  loginButton.disabled = true;
  loginError.hidden = true;
  try {
    const { orders } = await adminApi("/api/admin/orders");
    loginForm.hidden = true;
    dashboard.hidden = false;
    renderOrders(orders);
    clearInterval(refreshTimer);
    refreshTimer = setInterval(loadOrders, 60_000);
  } catch (error) {
    adminKey = "";
    showLoginError(error.message);
  } finally {
    loginButton.disabled = false;
  }
});

refreshButton.addEventListener("click", loadOrders);
