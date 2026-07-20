require('dotenv').config();

const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

if (!PAYSTACK_SECRET_KEY) {
    console.log('Warning: PAYSTACK_SECRET_KEY is not set. Payment routes will fail.');
}

exports.PAYSTACK_BASE_URL = PAYSTACK_BASE_URL;
exports.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET_KEY;
