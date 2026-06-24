const express = require('express');
const router  = express.Router();
const Order   = require('../models/Order');
const Product = require('../models/Product');
const Wallet  = require('../models/Wallet');
const User    = require('../models/User');
const { protect, requireRole } = require('../middleware/auth');

// GET /api/orders – role-aware listing
router.get('/', protect, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'customer') filter.userId = req.user._id;
    // vendors see orders that contain their products (simplified: all orders for now, filtered client-side)
    // admin sees all

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate('userId', 'name email phone');

    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/orders/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('userId', 'name email phone');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Customers can only view their own orders
    if (req.user.role === 'customer' && String(order.userId._id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/orders – place order (customer)
router.post('/', protect, requireRole('customer'), async (req, res) => {
  try {
    const { items, deliveryName, deliveryPhone, address, slot, payMethod, instructions } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    // Validate stock & calculate totals
    const products = await Product.find({ _id: { $in: items.map(i => i.productId).filter(Boolean) } });
    const lowStockAlerts = [];

    for (const item of items) {
      const prod = products.find(p => String(p._id) === String(item.productId));
      if (prod) {
        if (prod.stock < item.quantity) {
          return res.status(400).json({ success: false, message: `Insufficient stock for ${prod.name}` });
        }
      }
    }

    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const gstAmt   = Math.floor(subtotal * 0.05);
    const delivery = subtotal >= 500 ? 0 : 50;
    const total    = subtotal + gstAmt + delivery;

    // Wallet payment check
    if (payMethod === 'wallet') {
      const wallet = await Wallet.findOne({ userId: req.user._id });
      if (!wallet || wallet.balance < total) {
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
      }
      // Debit customer wallet
      wallet.balance -= total;
      wallet.transactions.push({ type: 'debit', amount: total, desc: `Order payment` });
      await wallet.save();
    }

    // Create order
    const order = await Order.create({
      userId: req.user._id,
      items,
      subtotal, gstAmt, delivery, total,
      deliveryName, deliveryPhone, address, slot, payMethod, instructions,
    });

    // Deduct stock
    for (const item of items) {
      if (item.productId) {
        const prod = await Product.findByIdAndUpdate(
          item.productId,
          { $inc: { stock: -item.quantity } },
          { new: true }
        );
        if (prod && prod.stock <= (prod.lowStockAlert || 30)) {
          lowStockAlerts.push(`${prod.name}: only ${prod.stock} left`);
        }
      }
    }

    // Credit admin wallet with revenue
    const adminUser = await User.findOne({ role: 'admin' });
    if (adminUser) {
      await Wallet.findOneAndUpdate(
        { userId: adminUser._id },
        { $inc: { balance: total }, $push: { transactions: { type: 'credit', amount: total, desc: `Revenue: ${order.orderId}` } } },
        { upsert: true, new: true }
      );
    }

    // Award loyalty points (1 pt per ₹10) + 2% cashback
    const pointsEarned = Math.floor(subtotal / 10);
    const cashback     = Math.floor(total * 0.02);

    await User.findByIdAndUpdate(req.user._id, { $inc: { points: pointsEarned } });

    const custWallet = await Wallet.findOneAndUpdate(
      { userId: req.user._id },
      {
        $inc: { balance: cashback },
        $push: { transactions: { type: 'credit', amount: cashback, desc: `Cashback from ${order.orderId}` } },
      },
      { new: true, upsert: true }
    );

    await Order.findByIdAndUpdate(order._id, {
      cashbackAwarded: cashback,
      pointsAwarded: pointsEarned,
    });

    res.status(201).json({
      success: true, order,
      pointsEarned, cashback, lowStockAlerts,
    });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/orders/:id/cancel – customer can cancel their own pending order
router.patch('/:id/cancel', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Customers can only cancel their own orders
    if (req.user.role === 'customer' && String(order.userId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Cannot cancel order with status: ${order.status}. Only pending orders can be cancelled.` });
    }

    order.status = 'cancelled';
    await order.save();

    // Restore stock
    for (const item of order.items) {
      if (item.productId) {
        await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.quantity } });
      }
    }

    // Refund wallet payment if applicable
    if (order.payMethod === 'wallet') {
      await Wallet.findOneAndUpdate(
        { userId: order.userId },
        {
          $inc: { balance: order.total },
          $push: { transactions: { type: 'credit', amount: order.total, desc: `Refund: ${order.orderId} cancelled` } },
        },
        { upsert: true }
      );
    }

    res.json({ success: true, order, message: 'Order cancelled successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/orders/:id/status – vendor or admin
router.patch('/:id/status', protect, requireRole('vendor', 'admin'), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending','confirmed','processing','in-transit','delivered','cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
