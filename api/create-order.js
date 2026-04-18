// PolarSeal Draft Order API — Vercel Serverless Function v3
// File: api/create-order.js

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

    const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
    const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;

    // Log env vars exist (not values)
    console.log('Store configured:', !!SHOPIFY_STORE, '| Token configured:', !!SHOPIFY_TOKEN);
    console.log('Store:', SHOPIFY_STORE);

    const nameParts = (customerName || '').trim().split(' ');
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || '';

    const skuLines = (skus || []).map((s, i) =>
      `SKU ${i+1}: ${s.name} | ${s.flavor} | ${s.quantity} bags | ${s.weight}`
    ).join('\n');

    const orderNotes = [
      `Package: ${packageType}`,
      `Brand: ${brandName}`,
      `Bag: ${bagSize} | ${finish} | Hanghole: ${hanghole ? 'Yes' : 'No'} | Window: ${hasWindow ? 'Yes' : 'No'}`,
      skuLines,
      `Total: $${Number(totalPrice).toFixed(2)} | Deposit: $${Number(depositAmount).toFixed(2)} | Balance: $${(Number(totalPrice) - Number(depositAmount)).toFixed(2)}`,
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
        note: orderNotes,
        send_receipt: true,
        tags: 'polarseal,deposit',
      }
    };

    // Add customer only if email provided
    if (customerEmail) {
      payload.draft_order.customer = {
        first_name: firstName,
        last_name: lastName,
        email: customerEmail,
      };
    }

    console.log('Sending to Shopify:', JSON.stringify(payload, null, 2));

    const shopifyRes = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2024-01/draft_orders.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        },
        body: JSON.stringify(payload),
      }
    );

    const shopifyData = await shopifyRes.json();
    console.log('Shopify response status:', shopifyRes.status);
    console.log('Shopify response:', JSON.stringify(shopifyData, null, 2));

    if (!shopifyRes.ok) {
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
    return res.status(500).json({ error: 'Server error', message: err.message, stack: err.stack });
  }
};
