# Direct Ordering Engine — Prototype

A reusable ordering engine designed to plug into custom-designed business websites.

## Prototype flow

Customer website → product/menu → product options → cart → checkout → simulated payment → order tracking.

The demo also includes a small restaurant dashboard so we can see how a business receives and updates orders.

## Architecture

- Vanilla HTML/CSS/JavaScript for the demo frontend
- A reusable `order-system.js` integration layer
- Browser storage for prototype persistence
- Product data exposed through the demo catalog
- Simulated M-Pesa, card, and PayPal choices

The storage layer will later be replaced by a real API/database without changing the customer-facing integration concept.

## Integration idea

A custom website can mark an orderable product with:

```html
<button data-order-product="classic-burger">Order</button>
```

The reusable integration script detects the action and opens the product configuration flow. A product can therefore be ordered from a homepage card, special offer, blog section, or menu — not only from a dedicated Order page.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Prototype status

This is a learning/proof-of-concept build. Payments are simulated and no real customer/payment data should be used.
