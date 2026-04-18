// PolarSeal Draft Order API — Vercel Serverless Function
// File: api/create-order.js

module.exports = async function handler(req, res) {
  // CORS — allow requests from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      packageType,
      customerName,
      customerEmail,
      customerPhone,
      brandName,
      bagSize,
      finish,
      hanghole,
      window: hasWindow,
      skus,
      totalPrice,
      depositAmount,
      notes
    } = req.body;

    const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'polarsealpackaging.myshopify.com';
    const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN || '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';

    const skuLines = (skus || []).map((s, i) =>
      `SKU ${i+1}: ${s.name} | Flavor: ${s.flavor} | Qty: ${s.quantity} bags | Net Weight: ${s.weight}`
    ).join('\n');

    const orderNotes = `POLARSEAL ORDER — ${packageType}
Brand: ${brandName}
Contact: ${customerName} | ${customerEmail}${customerPhone ? ' | ' + customerPhone : ''}

BAG CONFIGURATION
Size: ${bagSize} | Finish: ${finish} | Hanghole: ${hanghole ? 'Yes' : 'No'} | Window: ${hasWindow ? 'Yes' : 'No'}

SKU DETAILS
${skuLines}

PRICING
Full Order Total: $${Number(totalPrice).toFixed(2)} USD
50% Deposit (paid now): $${Number(depositAmount).toFixed(2)} USD
Remaining Balance: $${(Number(totalPrice) - Number(depositAmount)).toFixed(2)} USD
Balance due after production, before bags ship.

${notes ? 'NOTES: ' + notes : ''}`.trim();

    const properties = [
      { name: 'Package', value: packageType },
      { name: 'Bag Size', value: bagSize },
      { name: 'Finish', value: finish },
      { name: 'Hanghole', value: hanghole ? 'Yes' : 'No' },
      { name: 'Window', value: hasWindow ? 'Yes' : 'No' },
      { name: 'Full Order Total', value: `$${Number(totalPrice).toFixed(2)} USD` },
      { name: 'Deposit 50%', value: `$${Number(depositAmount).toFixed(2)} USD` },
      { name: 'Remaining Balance', value: `$${(Number(totalPrice) - Number(depositAmount)).toFixed(2)} USD` },
      { name: 'Balance Due', value: 'After production, before shipping' },
    ];

    (skus || []).forEach((s, i) => {
      properties.push({ name: `SKU ${i+1} Name`, value: s.name });
      properties.push({ name: `SKU ${i+1} Flavor`, value: s.flavor });
      properties.push({ name: `SKU ${i+1} Weight`, value: s.weight });
      properties.push({ name: `SKU ${i+1} Quantity`, value: `${s.quantity} bags` });
    });

    const nameParts = (customerName || '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const payload = {
      draft_order: {
        line_items: [{
          title: `${packageType} — 50% Deposit`,
          price: Number(depositAmount).toFixed(2),
          quantity: 1,
          requires_shipping: false,
          properties,
        }],
        customer: {
          first_name: firstName,
          last_name: lastName,
          email: customerEmail,
          ...(customerPhone && { phone: customerPhone }),
        },
        note: orderNotes,
        note_attributes: [
          { name: 'brand_name', value: brandName },
          { name: 'package_type', value: packageType },
          { name: 'full_order_total', value: `$${Number(totalPrice).toFixed(2)}` },
          { name: 'deposit_paid', value: `$${Number(depositAmount).toFixed(2)}` },
          { name: 'remaining_balance', value: `$${(Number(totalPrice) - Number(depositAmount)).toFixed(2)}` },
        ],
        send_receipt: true,
        send_payment_receipt: true,
        tags: `polarseal,${(packageType || '').toLowerCase().replace(/\s+/g, '-')},deposit`,
      }
    };

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

    if (!shopifyRes.ok) {
      console.error('Shopify error:', JSON.stringify(shopifyData));
      return res.status(500).json({ error: 'Shopify API error', details: shopifyData });
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
