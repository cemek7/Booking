import crypto from 'crypto';

function sign(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return hmac.digest('hex');
}

function test() {
  const secret = 'super-secret';
  const payload = JSON.stringify({ from: '+123', body: 'Hi I need a haircut' });
  const sig = sign(payload, secret);
  console.log('payload:', payload);
  console.log('signature:', sig);
  // Simulate verify in the API
  const h2 = sign(payload, secret);
  console.log('verify equality:', sig === h2);
}

if (typeof require !== 'undefined' && require.main === module) test();
