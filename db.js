// Database adapter boundary.
// The current GitHub Pages demo keeps localStorage as its fallback.
// Replace these methods with authenticated API calls when the server is connected.

const DB = {
  async createOrder(order) {
    return order;
  },
  async getOrder(orderId) {
    return read('doe_orders', []).find(o => o.id === orderId) || null;
  },
  async listOrders() {
    return read('doe_orders', []);
  },
  async listCustomers() {
    const orders = await this.listOrders();
    const map = new Map();
    orders.forEach(o => {
      const key = String(o.phone || '').replace(/\D/g, '') || String(o.email || '').toLowerCase();
      if (key && !map.has(key)) map.set(key, {name:o.customer, phone:o.phone, email:o.email});
    });
    return [...map.values()];
  }
};
