# Little Leaf

A responsive food-delivery storefront with a real Node.js REST API, server-validated checkout, order tracking, and protected restaurant-management endpoints. No runtime packages or build step are required. Orders use cash on delivery; connect a payment provider before accepting online payments.

## Run it locally

1. Install [Node.js 20 or newer](https://nodejs.org/).
2. From the project directory, run `npm start`.
3. Open [http://localhost:3000](http://localhost:3000).

The menu lives in `data/menu.json`. The server calculates prices, delivery, and tax itself, so changing browser-side prices cannot change an order total. Orders are written to `data/orders.json`. For restaurant-management access, set `ADMIN_API_KEY` to a long, private value before starting the server. Open `/admin` on your published site and enter this private key to view and update orders. The dashboard holds the key in memory only; it is never stored in the browser.

```powershell
$env:ADMIN_API_KEY = "use-a-long-random-secret-here"
npm start
```

## Publish on Render

1. Put the project in a GitHub repository and push the changes.
2. In [Render](https://render.com), create a **Blueprint** and select the repository.
3. Review the `render.yaml` settings and deploy the `little-leaf-delivery` service.
4. The blueprint configures a persistent disk for orders and generates a private `ADMIN_API_KEY`. In the service's environment settings, reveal and save that key somewhere secure; do not put it in the browser or commit it to GitHub.
5. Open the public `.onrender.com` URL after the deployment health check succeeds. Render's persistent disk requires the paid Starter instance configured in the blueprint.

The app listens on the hosting provider's `PORT` and `0.0.0.0`; the `/api/health` endpoint is its deployment health check. Local orders are stored in `data/orders.json`. In production, the Render disk stores them in `/var/data/orders.json`, so redeployments do not remove them.

## REST API

All responses are JSON. Failed requests return an explanatory `{ "error": "..." }` body.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Hosting health check |
| `GET` | `/api/menu` | Read the published menu |
| `POST` | `/api/orders` | Place and persist a validated cash-on-delivery order |
| `GET` | `/api/orders/:id` | Check the status of a specific order |
| `GET` | `/api/admin/orders` | List all orders (requires `Authorization: Bearer <ADMIN_API_KEY>`) |
| `PATCH` | `/api/admin/orders/:id` | Update an order (requires the admin key; JSON body: `{"status":"preparing"}`) |

Order statuses are `queued`, `preparing`, `on-the-way`, `delivered`, and `cancelled`. Delivered and cancelled orders are final. Each order lookup ID is randomly generated; share an order's tracking link only with its customer.

Example order:

```json
{
  "name": "Asha",
  "phone": "9876543210",
  "address": "12 Example Lane, Koregaon Park, Pune",
  "instructions": "Please call when you arrive.",
  "paymentMethod": "cod",
  "items": [{ "id": "green-goddess", "quantity": 2 }]
}
```

The API accepts Indian mobile numbers, limits each basket to 20 dishes and 10 of each dish, charges ₹49 delivery below ₹599, and calculates 5% tax. The `/admin` dashboard displays active orders and lets authenticated staff mark orders as preparing, on the way, delivered, or cancelled. This demo intentionally does not collect payment-card details or charge payments.

## Before taking real orders

Check that the menu, availability, delivery area, tax settings, and customer-facing contact details match your business. Configure your domain, privacy/terms information, operational monitoring, database backups, and payment provider as needed for your launch. The included persistent JSON store is suitable for a small starter deployment; move to a managed database before running multiple server instances or expecting substantial order volume.
