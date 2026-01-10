import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const bookingDuration = new Trend('booking_duration');
const paymentDuration = new Trend('payment_duration');

export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 100 },  // Ramp to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 200 },  // Ramp to 200 users
    { duration: '5m', target: 200 },  // Stay at 200 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(99)<1000'], // 99% of requests under 1s
    http_req_failed: ['rate<0.05'],    // Error rate under 5%
    errors: ['rate<0.05'],
    booking_duration: ['p(95)<500'],    // 95% of bookings under 500ms
    payment_duration: ['p(95)<1000'],   // 95% of payments under 1s
  },
};

const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const tenantId = __ENV.TENANT_ID || 'perf-test-tenant';

// Test data generators
function generateCustomer() {
  const randomId = Math.floor(Math.random() * 100000);
  return {
    name: `Customer ${randomId}`,
    email: `customer${randomId}@example.com`,
    phone: `+23456789${String(randomId).padStart(4, '0')}`
  };
}

function generateBookingPayload() {
  const services = ['Hair Cut', 'Consultation', 'Massage', 'Facial'];
  const staff = ['john-doe', 'jane-smith', 'mike-jones'];
  const customer = generateCustomer();
  
  // Generate future date (1-30 days ahead)
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + Math.floor(Math.random() * 30) + 1);
  
  const hours = Math.floor(Math.random() * 8) + 9; // 9 AM to 5 PM
  const minutes = Math.random() < 0.5 ? '00' : '30';
  
  return {
    service: services[Math.floor(Math.random() * services.length)],
    staff_id: staff[Math.floor(Math.random() * staff.length)],
    customer_name: customer.name,
    customer_email: customer.email,
    customer_phone: customer.phone,
    date: futureDate.toISOString().split('T')[0],
    time: `${hours.toString().padStart(2, '0')}:${minutes}`,
    duration: 60, // minutes
    notes: `Performance test booking ${Math.random()}`
  };
}

export default function () {
  const testIteration = Math.floor(Math.random() * 3);
  
  switch (testIteration) {
    case 0:
      testBookingCreation();
      break;
    case 1:
      testPaymentFlow();
      break;
    case 2:
      testDashboardLoad();
      break;
  }
  
  sleep(Math.random() * 2 + 1); // Random sleep 1-3 seconds
}

function testBookingCreation() {
  const bookingPayload = generateBookingPayload();
  
  const bookingStart = new Date();
  const bookingResponse = http.post(
    `${baseUrl}/api/reservations`,
    JSON.stringify(bookingPayload),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId
      }
    }
  );
  
  const bookingEnd = new Date();
  bookingDuration.add(bookingEnd - bookingStart);
  
  const bookingSuccess = check(bookingResponse, {
    'booking creation status is 200 or 201': (r) => [200, 201].includes(r.status),
    'booking response time < 500ms': (r) => r.timings.duration < 500,
    'booking response has id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.id !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  errorRate.add(!bookingSuccess);
  
  if (bookingSuccess) {
    // Test booking retrieval
    try {
      const booking = JSON.parse(bookingResponse.body);
      const getResponse = http.get(
        `${baseUrl}/api/reservations/${booking.id}`,
        {
          headers: {
            'x-tenant-id': tenantId
          }
        }
      );
      
      check(getResponse, {
        'booking retrieval status is 200': (r) => r.status === 200,
        'booking retrieval time < 200ms': (r) => r.timings.duration < 200,
      });
    } catch (error) {
      console.error('Failed to test booking retrieval:', error);
    }
  }
}

function testPaymentFlow() {
  const paymentPayload = {
    amount: Math.floor(Math.random() * 50000) + 10000, // 10,000 - 60,000 kobo
    currency: 'NGN',
    email: `payment${Math.floor(Math.random() * 100000)}@example.com`,
    callback_url: `${baseUrl}/payment/callback`,
    metadata: {
      booking_id: `booking_${Math.floor(Math.random() * 100000)}`,
      customer_name: `Customer ${Math.floor(Math.random() * 100000)}`
    }
  };
  
  const paymentStart = new Date();
  const paymentResponse = http.post(
    `${baseUrl}/api/payments/deposits`,
    JSON.stringify(paymentPayload),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId
      }
    }
  );
  
  const paymentEnd = new Date();
  paymentDuration.add(paymentEnd - paymentStart);
  
  const paymentSuccess = check(paymentResponse, {
    'payment init status is 200 or 201': (r) => [200, 201].includes(r.status),
    'payment response time < 1000ms': (r) => r.timings.duration < 1000,
    'payment response has authorization_url': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.authorization_url !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  errorRate.add(!paymentSuccess);
}

function testDashboardLoad() {
  const dashboardResponse = http.get(
    `${baseUrl}/api/analytics/dashboard`,
    {
      headers: {
        'x-tenant-id': tenantId,
        'Authorization': 'Bearer mock-token' // Mock authentication
      }
    }
  );
  
  const dashboardSuccess = check(dashboardResponse, {
    'dashboard status is 200': (r) => r.status === 200,
    'dashboard response time < 1000ms': (r) => r.timings.duration < 1000,
    'dashboard has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.totalBookings !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  errorRate.add(!dashboardSuccess);
  
  // Test booking list endpoint
  const bookingsResponse = http.get(
    `${baseUrl}/api/reservations?limit=20`,
    {
      headers: {
        'x-tenant-id': tenantId,
        'Authorization': 'Bearer mock-token'
      }
    }
  );
  
  check(bookingsResponse, {
    'bookings list status is 200': (r) => r.status === 200,
    'bookings list response time < 500ms': (r) => r.timings.duration < 500,
  });
}

// Setup function to run before the test
export function setup() {
  console.log(`🚀 Starting performance test against ${baseUrl}`);
  console.log(`📊 Tenant ID: ${tenantId}`);
  
  // Warmup request
  const warmupResponse = http.get(`${baseUrl}/health`);
  if (warmupResponse.status !== 200) {
    console.warn('⚠️  Warmup request failed, application might not be ready');
  }
  
  return { baseUrl, tenantId };
}

// Teardown function to run after the test
export function teardown(data) {
  console.log('🧹 Performance test completed');
  console.log(`📈 Test completed against: ${data.baseUrl}`);
}