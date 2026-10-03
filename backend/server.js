const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// 1. Socket.io Setup for Real-Time Inventory Updates
const io = new Server(server, { cors: { origin: '*' } });
io.on('connection', (socket) => {
  console.log('Socket Client Connected:', socket.id);
});

const emitInventory = (event, data) => {
  io.emit(event, data);
  console.log(`[Socket.io Broadcast] ${event}:`, data);
};

// 2. Middlewares
app.use(cors());
app.use(express.json());
// Serve frontend directly from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// 3. MongoDB Connection
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/shopeasy';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected to Atlas ShopEasy DB'))
  .catch((err) => console.log('MongoDB Connection Failed:', err.message));

// 4. Mongoose Models
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true },
  category: { type: String, required: true },
  stock: { type: Number, default: 0 },
  imageUrl: { type: String, default: 'https://placehold.co/300' }
}, { timestamps: true });
const Product = mongoose.model('Product', productSchema);

const cartSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    quantity: { type: Number, default: 1 }
  }]
}, { timestamps: true });
const Cart = mongoose.model('Cart', cartSchema);

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    price: Number,
    quantity: Number
  }],
  totalAmount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'shipped', 'delivered'], default: 'pending' }
}, { timestamps: true });
const Order = mongoose.model('Order', orderSchema);

// 5. Auth Middleware
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. No token.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  next();
};

// ========================
// 6. AUTH ROUTES
// ========================

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'All fields required' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ success: false, message: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword, role: role || 'user' });

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, message: 'Registered successfully', token, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, message: 'Login successful', token, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Social Login (Google / Facebook)
const socialLogin = async (req, res, provider) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });

    let user = await User.findOne({ email });
    if (!user) {
      const dummyPassword = await bcrypt.hash(Math.random().toString(), 10);
      user = await User.create({ name: name || `${provider} User`, email, password: dummyPassword, role: 'user' });
    }

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, message: `${provider} Auth Successful`, token, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
app.post('/api/auth/google', (req, res) => socialLogin(req, res, 'Google'));
app.post('/api/auth/facebook', (req, res) => socialLogin(req, res, 'Facebook'));

// ========================
// 7. PRODUCT ROUTES (CRUD & Search/Filter)
// ========================

// GET /api/products (Keyword search, category filter, price filter)
app.get('/api/products', async (req, res) => {
  try {
    const { keyword, category, minPrice, maxPrice } = req.query;
    let filter = {};

    if (keyword) filter.name = { $regex: keyword, $options: 'i' };
    if (category) filter.category = category;
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: products.length, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/products/:id
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/products (Admin)
app.post('/api/products', auth, adminOnly, async (req, res) => {
  try {
    const { name, description, price, category, stock, imageUrl } = req.body;
    const product = await Product.create({ name, description, price, category, stock, imageUrl });
    emitInventory('inventoryUpdate', { type: 'PRODUCT_CREATED', product });
    res.status(201).json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/products/:id (Admin)
app.put('/api/products/:id', auth, adminOnly, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    emitInventory('inventoryUpdate', { type: 'PRODUCT_UPDATED', product });
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/products/:id (Admin)
app.delete('/api/products/:id', auth, adminOnly, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    emitInventory('inventoryUpdate', { type: 'PRODUCT_DELETED', productId: req.params.id });
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========================
// 8. CART ROUTES
// ========================

// GET /api/cart
app.get('/api/cart', auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id }).populate('items.product');
    res.json({ success: true, cart: cart || { user: req.user.id, items: [] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/cart (Add product)
app.post('/api/cart', auth, async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;
    const product = await Product.findById(productId);
    if (!product || product.stock < quantity) {
      return res.status(400).json({ success: false, message: 'Product out of stock or insufficient quantity' });
    }

    let cart = await Cart.findOne({ user: req.user.id });
    if (!cart) cart = new Cart({ user: req.user.id, items: [] });

    const item = cart.items.find(i => i.product.toString() === productId);
    if (item) item.quantity += Number(quantity);
    else cart.items.push({ product: productId, quantity: Number(quantity) });

    await cart.save();
    emitInventory('inventoryUpdate', { type: 'CART_UPDATED', productId, stock: product.stock });
    res.json({ success: true, cart });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/cart/:id (Update quantity)
app.put('/api/cart/:id', auth, async (req, res) => {
  try {
    const { quantity } = req.body;
    const cart = await Cart.findOne({ user: req.user.id });
    const item = cart?.items.find(i => i.product.toString() === req.params.id || i._id.toString() === req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not in cart' });

    item.quantity = Number(quantity);
    await cart.save();
    res.json({ success: true, cart });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/cart/:id (Remove item)
app.delete('/api/cart/:id', auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });
    if (cart) {
      cart.items = cart.items.filter(i => i.product.toString() !== req.params.id && i._id.toString() !== req.params.id);
      await cart.save();
    }
    res.json({ success: true, message: 'Item removed from cart', cart });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========================
// 9. ORDERS ROUTES (Checkout & Aggregation)
// ========================

// POST /api/orders (Checkout)
app.post('/api/orders', auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id }).populate('items.product');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    let totalAmount = 0;
    const orderItems = [];

    for (const item of cart.items) {
      const prod = await Product.findById(item.product._id);
      if (!prod || prod.stock < item.quantity) {
        return res.status(400).json({ success: false, message: `Insufficient stock for ${prod?.name || 'item'}` });
      }
      prod.stock -= item.quantity;
      await prod.save();

      emitInventory('inventoryUpdate', { type: 'STOCK_DEDUCTED', productId: prod._id, newStock: prod.stock });

      totalAmount += prod.price * item.quantity;
      orderItems.push({
        product: prod._id,
        name: prod.name,
        price: prod.price,
        quantity: item.quantity
      });
    }

    const order = await Order.create({
      user: req.user.id,
      items: orderItems,
      totalAmount,
      status: 'pending'
    });

    cart.items = [];
    await cart.save();

    res.status(201).json({ success: true, message: 'Order placed successfully', order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/orders (Aggregation Pipeline)
app.get('/api/orders', auth, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(String(req.user.id));
    const orders = await Order.aggregate([
      { $match: { user: userId } },
      { $sort: { createdAt: -1 } },
      { $project: { items: 1, totalAmount: 1, status: 1, createdAt: 1, itemsCount: { $size: '$items' } } }
    ]);
    res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/orders/:id
app.get('/api/orders/:id', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/orders/:id/status (Admin)
app.put('/api/orders/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, message: 'Order status updated', order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========================
// 10. NOTIFICATIONS ROUTE (FCM)
// ========================
app.post('/api/notifications/send', auth, (req, res) => {
  const { title, body } = req.body;
  res.json({
    success: true,
    message: 'Firebase push notification simulated successfully',
    data: { title, body, timestamp: new Date() }
  });
});

// Start Server
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Backend Server running on http://localhost:${PORT}`);
});
