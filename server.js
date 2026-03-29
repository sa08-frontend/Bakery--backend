import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import Razorpay from 'razorpay';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(__dirname));

// NEW: Multi-business Razorpay key configs
const BUSINESS_RAZORPAY_CONFIG = {
  bakery: {
    keyId: process.env.RAZORPAY_KEY_ID?.trim(),
    keySecret: process.env.RAZORPAY_KEY_SECRET?.trim(),
  },
  fashion: {
    keyId: process.env.RAZORPAY_KEY_ID1?.trim(),
    keySecret: process.env.RAZORPAY_KEY_SECRET1?.trim(),
  },
};

// NEW: Supported business types
const ALLOWED_BUSINESS_TYPES = Object.keys(BUSINESS_RAZORPAY_CONFIG);

// NEW: Normalize businessType and default to bakery
function normalizeBusiness(businessType) {
  if (!businessType || typeof businessType !== 'string' || !businessType.trim()) {
    return 'bakery';
  }
  return businessType.trim().toLowerCase();
}

// NEW: Validate businessType
function validateBusiness(businessType) {
  return ALLOWED_BUSINESS_TYPES.includes(businessType);
}

// NEW: Get business config, throw if invalid
function getBusinessConfig(businessType) {
  const normalized = normalizeBusiness(businessType);
  if (!validateBusiness(normalized)) {
    throw new Error(`Invalid business type: ${businessType}`);
  }
  const config = BUSINESS_RAZORPAY_CONFIG[normalized];
  if (!config || !config.keyId || !config.keySecret) {
    throw new Error(`Razorpay keys not found for business type: ${normalized}`);
  }
  return { businessType: normalized, ...config };
}

// NEW: Create Razorpay instance dynamically per business
function getRazorpayInstance(businessType) {
  const { keyId, keySecret } = getBusinessConfig(businessType);
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// NEW: /api/config returns business-specific key_id only
app.get('/api/config', (req, res) => {
  try {
    const businessType = normalizeBusiness(req.query.businessType);
    if (!validateBusiness(businessType)) {
      return res.status(400).json({ error: 'Invalid businessType' });
    }

    const { keyId } = getBusinessConfig(businessType);
    return res.json({ razorpayKeyId: keyId, businessType });
  } catch (error) {
    console.error('Config Error:', error.message);
    return res.status(500).json({ error: 'Failed to get Razorpay config' });
  }
});

app.post('/api/create-order', async (req, res) => {
  const { amount, currency = 'INR', businessType: rawBusinessType } = req.body;
  const businessType = normalizeBusiness(rawBusinessType);

  console.log('create-order businessType:', businessType); // NEW logging

  if (!validateBusiness(businessType)) {
    return res.status(400).json({ error: 'Invalid businessType' });
  }

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    const razorpay = getRazorpayInstance(businessType);
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency,
      receipt: `${businessType}_${Date.now()}`, // UPDATED
    });

    return res.json({
      ...order,
      businessType,
      razorpayKeyId: BUSINESS_RAZORPAY_CONFIG[businessType].keyId, // NEW: send key_id only
    });
  } catch (error) {
    console.error('create-order Error:', error);
    return res.status(500).json({ error: 'Failed to create order' });
  }
});

app.post('/api/verify-payment', (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    businessType: rawBusinessType,
  } = req.body;

  const businessType = normalizeBusiness(rawBusinessType);
  console.log('verify-payment businessType:', businessType); // NEW logging

  if (!validateBusiness(businessType)) {
    return res.status(400).json({ error: 'Invalid businessType' });
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification data' });
  }

  try {
    const { keySecret } = getBusinessConfig(businessType);

    const sign = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(sign)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid signature', businessType });
    }

    return res.json({ success: true, message: 'Payment verified successfully', businessType });
  } catch (error) {
    console.error('verify-payment Error:', error);
    return res.status(500).json({ error: 'Failed to verify payment' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is busy. Set PORT env var or free the port.`);
    process.exit(1);
  }
  console.error('Server startup error:', err);
  process.exit(1);
});
