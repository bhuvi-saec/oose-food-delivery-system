const CURRENCY = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});
const STORAGE_KEY = "little-leaf-cart";
const ORDER_STATUS_LABELS = {
  queued: "Order received — getting things ready",
  preparing: "Freshly preparing your order",
  "on-the-way": "Your order is on its way",
  delivered: "Delivered. Enjoy every bite!",
  cancelled: "This order was cancelled"
};

const state = {
  menu: [],
  cart: readCart(),
  category: "All",
  query: "",
  activeOrderId: null,
  toastTimer: null,
  orderRefreshTimer: null
};

const elements = {
  grid: document.querySelector("#menu-grid"),
  categories: document.querySelector("#categories"),
  search: document.querySelector("#menu-search"),
  emptySearch: document.querySelector("#empty-search"),
  cartCount: document.querySelector("#cart-count"),
  drawer: document.querySelector("#cart-drawer"),
  backdrop: document.querySelector("#drawer-backdrop"),
  cartContent: document.querySelector("#cart-content"),
  checkoutPanel: document.querySelector("#checkout-panel"),
  checkoutForm: document.querySelector("#checkout-form"),
  checkoutButton: document.querySelector("#checkout-button"),
  formError: document.querySelector("#form-error"),
  toast: document.querySelector("#toast")
};

function readCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return {};
    return Object.fromEntries(stored.filter((item) => (
      typeof item.id === "string" && Number.isInteger(item.quantity) && item.quantity > 0
    )).map((item) => [item.id, Math.min(item.quantity, 10)]));
  } catch (error) {
    console.warn("Could not restore the saved bag:", error);
    return {};
  }
}

function saveCart() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(
      Object.entries(state.cart).map(([id, quantity]) => ({ id, quantity }))
    ));
  } catch (error) {
    console.warn("Could not save your bag on this device:", error);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("We couldn’t reach the kitchen. Please try again.");
  }
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function formatPrice(amount) {
  return CURRENCY.format(amount);
}

function currentMenu() {
  const query = state.query.trim().toLocaleLowerCase();
  return state.menu.filter((dish) => {
    const categoryMatches = state.category === "All" || dish.category === state.category;
    const searchableText = `${dish.name} ${dish.description} ${dish.category} ${dish.tag || ""}`.toLocaleLowerCase();
    return categoryMatches && (!query || searchableText.includes(query));
  });
}

function renderCategories() {
  const categories = ["All", ...new Set(state.menu.map((dish) => dish.category))];
  elements.categories.replaceChildren();
  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-chip${state.category === category ? " is-active" : ""}`;
    button.dataset.category = category;
    button.setAttribute("aria-pressed", String(state.category === category));
    button.textContent = category === "All" ? "A little of everything" : category;
    elements.categories.append(button);
  }
}

function makeDishCard(dish) {
  const card = document.createElement("article");
  card.className = "dish-card";
  const photoWrap = document.createElement("div");
  photoWrap.className = "dish-photo-wrap";
  const photo = document.createElement("img");
  photo.className = "dish-photo";
  photo.src = dish.image;
  photo.alt = dish.imageAlt || dish.name;
  photo.loading = "lazy";
  photo.decoding = "async";
  photo.addEventListener("error", () => {
    photo.hidden = true;
    photoWrap.classList.add("photo-unavailable");
  }, { once: true });
  photoWrap.append(photo);
  if (dish.tag) {
    const tag = document.createElement("span");
    tag.className = "dish-tag";
    tag.textContent = dish.tag;
    photoWrap.append(tag);
  }
  if (dish.vegetarian) {
    const veg = document.createElement("span");
    veg.className = "vegetarian-mark";
    veg.setAttribute("role", "img");
    veg.setAttribute("aria-label", "Vegetarian");
    photoWrap.append(veg);
  }
  const details = document.createElement("div");
  details.className = "dish-details";
  const titleLine = document.createElement("div");
  titleLine.className = "dish-title-line";
  const title = document.createElement("h3");
  title.className = "dish-title";
  title.textContent = dish.name;
  const price = document.createElement("span");
  price.className = "dish-price";
  price.textContent = formatPrice(dish.price);
  titleLine.append(title, price);
  const description = document.createElement("p");
  description.className = "dish-description";
  description.textContent = dish.description;
  const add = document.createElement("button");
  add.className = "add-button";
  add.type = "button";
  add.dataset.add = dish.id;
  add.innerHTML = '<span aria-hidden="true">＋</span> ADD TO BAG';
  details.append(titleLine, description, add);
  card.append(photoWrap, details);
  return card;
}

function renderMenu() {
  const dishes = currentMenu();
  elements.grid.replaceChildren(...dishes.map(makeDishCard));
  elements.emptySearch.hidden = dishes.length !== 0;
  elements.grid.hidden = dishes.length === 0;
}

function cartItems() {
  return Object.entries(state.cart)
    .map(([id, quantity]) => ({ dish: state.menu.find((item) => item.id === id), quantity }))
    .filter((item) => item.dish);
}

function orderTotals(items = cartItems()) {
  const subtotal = items.reduce((total, item) => total + item.dish.price * item.quantity, 0);
  const deliveryFee = subtotal === 0 || subtotal >= 599 ? 0 : 49;
  const tax = Math.round(subtotal * 0.05);
  return { subtotal, deliveryFee, tax, total: subtotal + deliveryFee + tax };
}

function renderCart() {
  const items = cartItems();
  const itemCount = items.reduce((total, item) => total + item.quantity, 0);
  elements.cartCount.textContent = String(itemCount);
  elements.cartCount.setAttribute("aria-label", `${itemCount} items in bag`);
  elements.cartContent.replaceChildren();
  elements.checkoutPanel.hidden = items.length === 0 || Boolean(state.activeOrderId);

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cart-empty";
    empty.innerHTML = "<span aria-hidden='true'>✳</span>Your bag’s having a quiet moment.<br>Let’s find something good to eat.";
    const browse = document.createElement("a");
    browse.className = "text-link";
    browse.href = "#menu";
    browse.textContent = "TAKE A LOOK AT THE MENU ↗";
    browse.addEventListener("click", closeCart);
    elements.cartContent.append(empty, browse);
    return;
  }

  for (const { dish, quantity } of items) {
    const row = document.createElement("div");
    row.className = "cart-row";
    const photo = document.createElement("img");
    photo.src = dish.image;
    photo.alt = "";
    photo.loading = "lazy";
    const details = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = dish.name;
    const unitPrice = document.createElement("p");
    unitPrice.textContent = `${formatPrice(dish.price)} each`;
    const controls = document.createElement("div");
    controls.className = "quantity-controls";
    const decrease = document.createElement("button");
    decrease.type = "button";
    decrease.dataset.quantity = "decrease";
    decrease.dataset.id = dish.id;
    decrease.setAttribute("aria-label", `Remove one ${dish.name}`);
    decrease.textContent = "−";
    const count = document.createElement("span");
    count.textContent = String(quantity);
    const increase = document.createElement("button");
    increase.type = "button";
    increase.dataset.quantity = "increase";
    increase.dataset.id = dish.id;
    increase.setAttribute("aria-label", `Add one ${dish.name}`);
    increase.disabled = quantity >= 10;
    increase.textContent = "+";
    controls.append(decrease, count, increase);
    details.append(title, unitPrice, controls);
    const lineTotal = document.createElement("span");
    lineTotal.className = "cart-row-total";
    lineTotal.textContent = formatPrice(dish.price * quantity);
    row.append(photo, details, lineTotal);
    elements.cartContent.append(row);
  }

  const { subtotal, deliveryFee, tax, total } = orderTotals(items);
  const summary = document.createElement("div");
  summary.className = "cart-summary";
  for (const [label, amount] of [["Your delicious bits", subtotal], ["Delivery", deliveryFee], ["A little tax", tax]]) {
    const line = document.createElement("div");
    line.className = "summary-line";
    const name = document.createElement("span");
    name.textContent = label;
    const value = document.createElement("span");
    value.textContent = amount === 0 && label === "Delivery" ? "On us!" : formatPrice(amount);
    line.append(name, value);
    summary.append(line);
  }
  const totalLine = document.createElement("div");
  totalLine.className = "summary-line total";
  totalLine.innerHTML = `<span>Today’s total</span><span>${formatPrice(total)}</span>`;
  summary.append(totalLine);

  if (deliveryFee > 0) {
    const nudge = document.createElement("p");
    nudge.className = "delivery-nudge";
    nudge.textContent = `A little more to go — add ${formatPrice(599 - subtotal)} for free delivery.`;
    summary.append(nudge);
  } else {
    const nudge = document.createElement("p");
    nudge.className = "delivery-nudge";
    nudge.textContent = "Lovely choice — delivery is on us!";
    summary.append(nudge);
  }
  elements.cartContent.append(summary);
}

function setQuantity(id, quantity) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 10) return;
  if (quantity === 0) delete state.cart[id];
  else state.cart[id] = quantity;
  saveCart();
  renderCart();
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2700);
}

function openCart() {
  elements.drawer.classList.add("is-open");
  elements.drawer.setAttribute("aria-hidden", "false");
  elements.drawer.inert = false;
  elements.backdrop.hidden = false;
  document.body.classList.add("drawer-open");
  elements.drawer.querySelector("#close-cart").focus();
}

function closeCart() {
  elements.drawer.classList.remove("is-open");
  elements.drawer.setAttribute("aria-hidden", "true");
  elements.drawer.inert = true;
  elements.backdrop.hidden = true;
  document.body.classList.remove("drawer-open");
  document.querySelector("#open-cart").focus();
}

function showOrderConfirmation(order, originalItems) {
  state.activeOrderId = order.id;
  elements.checkoutPanel.hidden = true;
  elements.cartContent.replaceChildren();
  const confirmation = document.createElement("div");
  confirmation.className = "success-order";
  const mark = document.createElement("span");
  mark.className = "success-mark";
  mark.textContent = "✓";
  const title = document.createElement("h3");
  title.textContent = "Well, this is exciting!";
  const reference = document.createElement("p");
  reference.textContent = "Your order number";
  const referenceNumber = document.createElement("div");
  referenceNumber.className = "order-reference";
  referenceNumber.textContent = `#${order.reference}`;
  const description = document.createElement("p");
  description.textContent = `We’ve got ${originalItems.reduce((total, item) => total + item.quantity, 0)} freshly made ${originalItems.length === 1 ? "dish" : "dishes"} for you. Pay ${formatPrice(order.total)} when your order arrives.`;
  const progress = document.createElement("div");
  progress.className = "order-progress";
  const trackOrder = document.createElement("p");
  trackOrder.className = "delivery-nudge";
  trackOrder.textContent = ORDER_STATUS_LABELS[order.status] || ORDER_STATUS_LABELS.queued;
  const done = document.createElement("button");
  done.className = "checkout-button";
  done.type = "button";
  done.innerHTML = 'LOVELY. THANK YOU! <span aria-hidden="true">♡</span>';
  done.addEventListener("click", closeCart);
  confirmation.append(mark, title, reference, referenceNumber, description, progress, trackOrder, done);
  elements.cartContent.append(confirmation);
  saveCart();
  pollOrderStatus(order.id, trackOrder);
}

async function pollOrderStatus(orderId, statusElement) {
  clearTimeout(state.orderRefreshTimer);
  if (state.activeOrderId !== orderId) return;
  try {
    const order = await api(`/api/orders/${encodeURIComponent(orderId)}`);
    if (state.activeOrderId !== orderId) return;
    statusElement.textContent = ORDER_STATUS_LABELS[order.status] || "Order received.";
    if (order.status === "delivered" || order.status === "cancelled") return;
  } catch (error) {
    console.warn("Could not refresh order tracking:", error);
  }
  state.orderRefreshTimer = setTimeout(() => pollOrderStatus(orderId, statusElement), 30_000);
}

async function placeOrder(event) {
  event.preventDefault();
  if (!elements.checkoutForm.reportValidity()) return;
  const formData = new FormData(elements.checkoutForm);
  const items = cartItems();
  elements.formError.hidden = true;
  elements.checkoutButton.disabled = true;
  elements.checkoutButton.firstChild.textContent = "SENDING TO THE KITCHEN… ";
  try {
    const order = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        phone: formData.get("phone"),
        address: formData.get("address"),
        instructions: formData.get("instructions"),
        paymentMethod: "cod",
        items: items.map(({ dish, quantity }) => ({ id: dish.id, quantity }))
      })
    });
    state.cart = {};
    saveCart();
    renderCart();
    showOrderConfirmation(order, items);
  } catch (error) {
    elements.formError.textContent = error.message;
    elements.formError.hidden = false;
  } finally {
    elements.checkoutButton.disabled = false;
    elements.checkoutButton.firstChild.textContent = "PLACE MY ORDER ";
  }
}

async function loadMenu() {
  try {
    const data = await api("/api/menu");
    state.menu = data.items;
    renderCategories();
    renderMenu();
    renderCart();
  } catch (error) {
    elements.grid.replaceChildren();
    elements.grid.hidden = false;
    elements.grid.innerHTML = "";
    const message = document.createElement("p");
    message.className = "menu-message";
    message.textContent = `We couldn’t bring up the menu. ${error.message}`;
    elements.grid.append(message);
  }
}

elements.grid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (!button) return;
  const dish = state.menu.find((item) => item.id === button.dataset.add);
  if (!dish) return;
  if (state.cart[dish.id] >= 10) {
    showToast("You’ve reached the limit of 10 of this dish.");
    return;
  }
  setQuantity(dish.id, (state.cart[dish.id] || 0) + 1);
  showToast(`${dish.name} added to your bag ♡`);
});

elements.categories.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  renderCategories();
  renderMenu();
});

elements.search.addEventListener("input", () => {
  state.query = elements.search.value;
  renderMenu();
});

elements.cartContent.addEventListener("click", (event) => {
  const button = event.target.closest("[data-quantity]");
  if (!button) return;
  const { id } = button.dataset;
  setQuantity(id, (state.cart[id] || 0) + (button.dataset.quantity === "increase" ? 1 : -1));
});

document.querySelector("#open-cart").addEventListener("click", openCart);
document.querySelector("#close-cart").addEventListener("click", closeCart);
elements.backdrop.addEventListener("click", closeCart);
elements.checkoutForm.addEventListener("submit", placeOrder);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.drawer.classList.contains("is-open")) closeCart();
});

loadMenu();
