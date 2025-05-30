require("dotenv").config();
const express = require("express");
const app = express();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const cors = require("cors");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

// Environment variables
const port = process.env.PORT || 4000;
const mongoUri = process.env.MONGO_URI;

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer + Cloudinary storage config
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'products',
    allowed_formats: ['jpg', 'jpeg', 'png'],
    public_id: (req, file) => `product_${Date.now()}`,
  },
});
const upload = multer({ storage });

// CORS configuration
let allowedOrigins = [];
if (process.env.ALLOWED_ORIGINS) {
  allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
} else {
  console.warn("⚠️ No ALLOWED_ORIGINS set in environment. All CORS requests will be blocked.");
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

app.use(express.json());

// Connect to MongoDB
mongoose.connect(mongoUri)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

// Default route
app.get("/", (req, res) => {
  res.send("Express App is Running");
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", environment: process.env.NODE_ENV || "development" });
});

// ✅ Cloudinary image upload endpoint
app.post("/upload", upload.single('product'), (req, res) => {
  res.json({
    success: 1,
    image_url: req.file.path, // Cloudinary URL
  });
});

// Product schema
const Product = mongoose.model("Product", {
  id: { type: Number, required: true },
  name: { type: String, required: true },
  image: { type: String, required: true },
  category: { type: String, required: true },
  new_price: { type: Number, required: true },
  old_price: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  available: { type: Boolean, default: true }
});

// Add product
app.post('/addproduct', async (req, res) => {
  let products = await Product.find({});
  let id = products.length > 0 ? products[products.length - 1].id + 1 : 1;
  const product = new Product({
    id,
    name: req.body.name,
    image: req.body.image,
    category: req.body.category,
    new_price: req.body.new_price,
    old_price: req.body.old_price
  });
  await product.save();
  res.json({ success: true, name: req.body.name });
});

// Delete product
app.post('/removeproduct', async (req, res) => {
  await Product.findOneAndDelete({ id: req.body.id });
  res.json({ success: true, name: req.body.name });
});

// Get all products
app.get('/allproducts', async (req, res) => {
  try {
    let products = await Product.find({});
    console.log("All Products Fetched");
    res.send(products);
  } catch (error) {
    console.error("Error fetching all products:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// User model
const Users = mongoose.model("Users", {
  name: String,
  email: { type: String, unique: true },
  password: String,
  cartData: Object,
  date: { type: Date, default: Date.now }
});

// Signup
app.post('/signup', async (req, res) => {
  let check = await Users.findOne({ email: req.body.email });
  if (check) {
    return res.status(400).json({ success: false, errors: "Existing user found with same email address" });
  }

  let cart = {};
  for (let i = 0; i < 300; i++) cart[i] = 0;

  const user = new Users({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    cartData: cart
  });

  await user.save();
  const data = { user: { id: user.id } };
  const token = jwt.sign(data, 'secret_ecom');
  res.json({ success: true, token });
});

// Login
app.post('/login', async (req, res) => {
  let user = await Users.findOne({ email: req.body.email });
  if (user && req.body.password === user.password) {
    const data = { user: { id: user.id } };
    const token = jwt.sign(data, 'secret_ecom');
    res.json({ success: true, token });
  } else {
    res.json({ success: false, errors: "Invalid email or password" });
  }
});

// New collections
app.get('/newcollections', async (req, res) => {
  let products = await Product.find({});
  let newcollections = products.slice(-8);
  res.json(newcollections);
});

// Popular products
app.get('/popularproducts', async (req, res) => {
  let products = await Product.find({ category: "tea" });
  res.json(products.slice(0, 4));
});

// Middleware: fetch user from token
const fetchUser = async (req, res, next) => {
  const token = req.header('auth-token');
  if (!token) return res.status(401).send({ errors: "Please authenticate using a valid token" });

  try {
    const data = jwt.verify(token, 'secret_ecom');
    req.user = data.user;
    next();
  } catch (error) {
    res.status(401).send({ errors: "Please authenticate using a valid token" });
  }
};

// Add to cart
app.post('/addtocart', fetchUser, async (req, res) => {
  let userData = await Users.findOne({ _id: req.user.id });
  userData.cartData[req.body.itemId] += 1;
  await Users.findOneAndUpdate({ _id: req.user.id }, { cartData: userData.cartData });
  res.json({ success: true, message: "Added to cart" });
});

// Remove from cart
app.post('/removefromcart', fetchUser, async (req, res) => {
  let userData = await Users.findOne({ _id: req.user.id });
  if (userData.cartData[req.body.itemId] > 0)
    userData.cartData[req.body.itemId] -= 1;
  await Users.findOneAndUpdate({ _id: req.user.id }, { cartData: userData.cartData });
  res.json({ success: true, message: "Removed from cart" });
});

// Get cart data
app.post('/getcart', fetchUser, async (req, res) => {
  let userData = await Users.findOne({ _id: req.user.id });
  res.json(userData.cartData);
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
