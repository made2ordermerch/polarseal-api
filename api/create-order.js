// PolarSeal Draft Order API — Vercel Serverless Function v6
// Line item properties + file URL support
// File: api/create-order.js

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(store, clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  const data = await res.json();
  console.log('Token response:', res.status, JSON.stringify(data));
  if (!res.ok || !data.access_token) {
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
      skus, totalPrice, depositAmount, notes,
      logoUrls, refUrls, artworkStatus, designNotes
    } = req.body;

    const SHOPIFY_STORE  = process.env.SHOPIFY_STORE_DOMAIN;
    const CLIENT_ID      = process.env.SHOPIFY_CLIENT_ID;
    const CLIENT_SECRET  = process.env.SHOPIFY_CLIENT_SECRET;

    console.log('Store:', SHOPIFY_STORE, '| Client ID set:', !!CLIENT_ID, '| Secret set:', !!CLIENT_SECRET);

    const accessToken = await getAccessToken(SHOPIFY_STORE, CLIENT_ID, CLIENT_SECRET);

    const nameParts = (customerName || '').trim().split(' ');
    const firstName = nameParts[0] || 'Customer';
    const lastName  = nameParts.slice(1).join(' ') || '';

    // ── Build line item properties (shows in cart/checkout like M2OM) ──
    const properties = [
      { name: 'Package',           value: packageType },
      { name: 'Brand',             value: brandName },
      { name: 'Bag Size',          value: bagSize },
      { name: 'Finish',            value: finish },
      { name: 'Hanghole',          value: hanghole ? 'Yes' : 'No' },
      { name: 'Window',            value: hasWindow ? 'Yes' : 'No' },
      { name: 'Full Order Total',  value: `$${Number(totalPrice).toFixed(2)} USD` },
      { name: 'Deposit (50%)',     value: `$${Number(depositAmount).toFixed(2)} USD` },
      { name: 'Remaining Balance', value: `$${(Number(totalPrice) - Number(depositAmount)).toFixed(2)} USD` },
      { name: 'Balance Due',       value: 'After production, before shipping' },
      { name: 'Artwork Status',    value: artworkStatus || 'Not specified' },
    ];

    // Add SKU details as properties
    (skus || []).forEach((s, i) => {
      properties.push({ name: `SKU ${i+1} Name`,     value: s.name });
      properties.push({ name: `SKU ${i+1} Flavor`,   value: s.flavor });
      properties.push({ name: `SKU ${i+1} Weight`,   value: s.weight });
      properties.push({ name: `SKU ${i+1} Quantity`, value: `${s.quantity} bags` });
    });

    // Add file URLs as properties
    if (logoUrls && logoUrls.length) {
      logoUrls.forEach((url, i) => {
        properties.push({ name: `Logo File ${i+1}`, value: url });
      });
    }
    if (refUrls && refUrls.length) {
      refUrls.forEach((url, i) => {
        properties.push({ name: `Reference Image ${i+1}`, value: url });
      });
    }

    // ── Notes (full summary in draft order notes) ──
    const skuLines = (skus || []).map((s, i) =>
      `SKU ${i+1}: ${s.name} | ${s.flavor} | ${s.quantity} bags | ${s.weight}`
    ).join('\n');

    const orderNotes = [
      `POLARSEAL ORDER — ${packageType}`,
      `Brand: ${brandName}`,
      `Contact: ${customerName} | ${customerEmail}${customerPhone ? ' | ' + customerPhone : ''}`,
      ``,
      `BAG CONFIGURATION`,
      `Size: ${bagSize} | Finish: ${finish} | Hanghole: ${hanghole ? 'Yes' : 'No'} | Window: ${hasWindow ? 'Yes' : 'No'}`,
      ``,
      `SKU DETAILS`,
      skuLines,
      ``,
      `DESIGN BRIEF`,
      `Artwork Status: ${artworkStatus || 'Not specified'}`,
      designNotes ? `Design Notes: ${designNotes}` : '',
      logoUrls && logoUrls.length ? `Logo Files: ${logoUrls.join(', ')}` : '',
      refUrls && refUrls.length ? `Reference Images: ${refUrls.join(', ')}` : '',
      ``,
      `PRICING`,
      `Full Order Total: $${Number(totalPrice).toFixed(2)} USD`,
      `50% Deposit (paid): $${Number(depositAmount).toFixed(2)} USD`,
      `Remaining Balance: $${(Number(totalPrice) - Number(depositAmount)).toFixed(2)} USD`,
      `Balance due after production, before bags ship.`,
      notes ? `\nAdditional Notes: ${notes}` : '',
    ].filter(s => s !== undefined && s !== null).join('\n');

    const payload = {
      draft_order: {
        line_items: [{
          title: `${packageType} - 50% Deposit`,
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
        send_receipt: true,
        tags: `polarseal,deposit,${(packageType || '').toLowerCase().replace(/\s+/g, '-')}`,
      }
    };

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
      return res.status(500).json({ error: 'Shopify API error', status: shopifyRes.status, details: shopifyData });
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
