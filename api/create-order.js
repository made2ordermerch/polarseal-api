// PolarSeal Draft Order API — Vercel Serverless Function
// Uses Client ID + Secret OAuth (same pattern as Made2Order)
// File: api/create-order.js

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(store, clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  const data = await res.json();
  console.log('Token response:', res.status, JSON.stringify(data));

  if (!res.ok || !data.access_token) {
    // Fall back to using secret directly as token
    console.log('OAuth failed, using secret as token');
    return clientSecret;
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000 - 60000;
  return cachedToken;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      packageType, customerName, customerEmail, customerPhone,
      brandName, bagSize, finish, hanghole, window: hasWindow,
      skus, totalPrice, depositAmount, notes
    } = req.body;

    const SHOPIFY_STORE   = process.env.SHOPIFY_STORE_DOMAIN;
    const CLIENT_ID       = process.env.SHOPIFY_CLIENT_ID;
    const CLIENT_SECRET   = process.env.SHOPIFY_CLIENT_SECRET;

    console.log('Store:', SHOPIFY_STORE, '| Client ID set:', !!CLIENT_ID, '| Secret set:', !!CLIENT_SECRET);

    const accessToken = await getAccessToken(SHOPIFY_STORE, CLIENT_ID, CLIENT_SECRET);

    const nameParts = (customerName || '').trim().split(' ');
    const firstName = nameParts[0] || 'Customer';
    const lastName  = nameParts.slice(1).join(' ') || '';

    const skuLines = (skus || []).map((s, i) =>
      `SKU ${i+1}: ${s.name} | ${s.flavor} | ${s.quantity} bags | ${s.weight}`
    ).join('\n');

    const orderNotes = [
      `Package: ${packageType}`,
      `Brand: ${brandName}`,
      `Bag: ${bagSize} | ${finish} | Hanghole: ${hanghole ? 'Yes' : 'No'} | Window: ${hasWindow ? 'Yes' : 'No'}`,
      skuLines,
      `Total: $${Number(totalPrice).toFixed(2)} | Deposit: $${Number(depositAmount).toFixed(2)} | Balance: $${(Number(totalPrice) - Number(depositAmount)).toFixed(2)}`,
      'Balance due after production, before bags ship.',
      notes || ''
    ].filter(Boolean).join('\n');

    const payload = {
      draft_order: {
        line_items: [{
          title: `${packageType} - 50% Deposit`,
          price: Number(depositAmount).toFixed(2),
          quantity: 1,
          requires_shipping: false,
        }],
        customer: {
          first_name: firstName,
          last_name: lastName,
          email: customerEmail,
          ...(customerPhone && { phone: customerPhone }),
        },
        note: orderNotes,
        send_receipt: true,
        tags: 'polarseal,deposit',
      }
    };

    console.log('Calling Shopify...');

    const shopifyRes = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2024-01/draft_orders.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify(payload),
      }
    );

    const shopifyData = await shopifyRes.json();
    console.log('Shopify status:', shopifyRes.status);
    console.log('Shopify response:', JSON.stringify(shopifyData));

    if (!shopifyRes.ok) {
      if (shopifyRes.status === 401) cachedToken = null;
      return res.status(500).json({
        error: 'Shopify API error',
        status: shopifyRes.status,
        details: shopifyData
      });
    }

    const order = shopifyData.draft_order;
    return res.status(200).json({
      success: true,
      orderId: order.id,
      orderName: order.name,
      checkoutUrl: order.invoice_url,
      totalPrice: Number(totalPrice),
      depositAmount: Number(depositAmount),
      remainingBalance: Number(totalPrice) - Number(depositAmount),
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
};
