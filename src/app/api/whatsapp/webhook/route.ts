import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import WhatsAppProductService from '@/lib/whatsapp/product-service';
import { Product, ProductCategory } from '@/types/product-catalogue';

interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          text?: { body: string };
          interactive?: {
            type: string;
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string };
          };
          type: string;
        }>;
      };
      field: string;
    }>;
  }>;
}

interface ConversationState {
  customer_phone: string;
  current_context: 'main_menu' | 'browsing_categories' | 'browsing_products' | 'viewing_product' | 'search';
  tenant_id?: string;
  selected_category?: string;
  selected_product?: string;
  search_query?: string;
  last_action?: string;
  created_at: Date;
}

const conversationStates = new Map<string, ConversationState>();

// Public webhook verification - no auth required
export async function GET(request: NextRequest) {
  // Webhook verification
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge);
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// Public webhook handler - no auth required
export async function POST(request: NextRequest) {
  try {
    const payload: WhatsAppWebhookPayload = await request.json();
    
    if (payload.object !== 'whatsapp_business_account') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const whatsAppService = new WhatsAppProductService();
    
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field === 'messages' && change.value.messages) {
          for (const message of change.value.messages) {
            await handleMessage(message, whatsAppService);
          }
        }
      }
    }

    return NextResponse.json({ status: 'success' });

  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleMessage(
  message: any,
  whatsAppService: WhatsAppProductService
) {
  const customerPhone = message.from;
  
  // Get or create conversation state
  let state = conversationStates.get(customerPhone);
  if (!state) {
    state = {
      customer_phone: customerPhone,
      current_context: 'main_menu',
      created_at: new Date()
    };
    conversationStates.set(customerPhone, state);
  }

  // Extract message content
  let messageContent = '';
  let actionId = '';

  if (message.type === 'text') {
    messageContent = message.text.body.toLowerCase().trim();
  } else if (message.type === 'interactive') {
    if (message.interactive.button_reply) {
      actionId = message.interactive.button_reply.id;
    } else if (message.interactive.list_reply) {
      actionId = message.interactive.list_reply.id;
    }
  }

  // Determine tenant from phone number (you might want to implement a lookup)
  const tenantId = await getTenantIdFromPhone(customerPhone);
  if (!tenantId) {
    await whatsAppService.sendTextMessage(
      customerPhone,
      'Sorry, I cannot find your salon information. Please contact support.'
    );
    return;
  }

  state.tenant_id = tenantId;

  // Route message based on content or action
  if (messageContent || actionId) {
    await routeMessage(customerPhone, messageContent, actionId, state, whatsAppService);
  }
}

async function routeMessage(
  customerPhone: string,
  messageContent: string,
  actionId: string,
  state: ConversationState,
  whatsAppService: WhatsAppProductService
) {
  // Handle text-based commands
  if (messageContent) {
    if (messageContent.includes('hi') || messageContent.includes('hello') || messageContent.includes('start')) {
      await handleMainMenu(customerPhone, whatsAppService);
      state.current_context = 'main_menu';
      return;
    }
    
    if (messageContent.includes('help') || messageContent.includes('support')) {
      await handleHelp(customerPhone, whatsAppService);
      return;
    }

    // Search functionality
    if (state.current_context === 'search' || messageContent.includes('search ')) {
      const query = messageContent.replace('search ', '').trim();
      await handleSearch(customerPhone, query, state, whatsAppService);
      return;
    }

    // General search (if not in a specific context)
    if (state.current_context === 'main_menu' && messageContent.length > 3) {
      await handleSearch(customerPhone, messageContent, state, whatsAppService);
      return;
    }
  }

  // Handle action-based interactions
  if (actionId) {
    await handleAction(customerPhone, actionId, state, whatsAppService);
  }

  // Update conversation state
  conversationStates.set(customerPhone, state);
}

async function handleMainMenu(customerPhone: string, whatsAppService: WhatsAppProductService) {
  const customerName = await getCustomerName(customerPhone);
  await whatsAppService.sendMainMenu(customerPhone, customerName);
}

async function handleAction(
  customerPhone: string,
  actionId: string,
  state: ConversationState,
  whatsAppService: WhatsAppProductService
) {
  const [action, id] = actionId.split('_');

  switch (action) {
    case 'browse':
      if (id === 'catalog') {
        await handleBrowseCatalog(customerPhone, state, whatsAppService);
      }
      break;

    case 'category':
      await handleCategorySelection(customerPhone, id, state, whatsAppService);
      break;

    case 'product':
      await handleProductSelection(customerPhone, id, state, whatsAppService);
      break;

    case 'book':
      await handleBookingRequest(customerPhone, id, state, whatsAppService);
      break;

    case 'more':
      if (id.startsWith('images')) {
        const productId = id.split('_')[1];
        await handleMoreImages(customerPhone, productId, state, whatsAppService);
      }
      break;

    case 'similar':
      await handleSimilarProducts(customerPhone, id, state, whatsAppService);
      break;

    case 'main':
      if (id === 'menu') {
        await handleMainMenu(customerPhone, whatsAppService);
        state.current_context = 'main_menu';
      }
      break;

    case 'search':
      await whatsAppService.sendTextMessage(
        customerPhone, 
        'What product are you looking for? Type the product name or description.'
      );
      state.current_context = 'search';
      break;

    default:
      await whatsAppService.sendTextMessage(
        customerPhone,
        'Sorry, I didn\'t understand that. Type "help" for assistance or "menu" to go back to the main menu.'
      );
  }
}

async function handleBrowseCatalog(
  customerPhone: string,
  state: ConversationState,
  whatsAppService: WhatsAppProductService
) {
  if (!state.tenant_id) return;

  const supabase = createClient();
  
  const { data: categories } = await supabase
    .from('categories')
    .select('*')
    .eq('tenant_id', state.tenant_id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (categories && categories.length > 0) {
    await whatsAppService.sendProductCatalog(customerPhone, categories);
    state.current_context = 'browsing_categories';
  } else {
    await whatsAppService.sendTextMessage(
      customerPhone,
      'Sorry, no product categories are available at the moment.'
    );
  }
}

async function handleCategorySelection(
  customerPhone: string,
  categoryId: string,
  state: ConversationState,
  whatsAppService: WhatsAppProductService
) {
  if (!state.tenant_id) return;

  const supabase = createClient();
  
  // Get category details
  const { data: category } = await supabase
    .from('categories')
    .select('*')
    .eq('id', categoryId)
    .eq('tenant_id', state.tenant_id)
    .single();

  // Get products in this category
  const { data: products } = await supabase
    .from('products')
    .select(`
      *,
      category:categories(name),
      variants:product_variants(*)
    `)
    .eq('tenant_id', state.tenant_id)
    .eq('category_id', categoryId)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (products && products.length > 0) {
    await whatsAppService.sendProductList(customerPhone, products, category?.name);
    state.current_context = 'browsing_products';
    state.selected_category = categoryId;
  } else {
    await whatsAppService.sendTextMessage(
      customerPhone,
      `Sorry, no products are available in ${category?.name || 'this category'} at the moment.`
    );
  }
}

async function handleProductSelection(
  customerPhone: string,
  productId: string,
  state: ConversationState,
  whatsAppService: WhatsAppProductService
) {
  if (!state.tenant_id) return;

  const supabase = createClient();
  
  const { data: product } = await supabase
    .from('products')
    .select(`
      *,
      category:categories(name),
      variants:product_variants(*)
    `)
    .eq('id', productId)
    .eq('tenant_id', state.tenant_id)
    .single();

  if (product) {
    await whatsAppService.sendProductDetails(customerPhone, product, true);
    state.current_context = 'viewing_product';
    state.selected_product = productId;
  } else {
    await whatsAppService.sendTextMessage(
      customerPhone,
      'Sorry, this product is no longer available.'
    );
  }
}

async function handleMoreImages(
  customerPhone: string,
  productId: string,
  state: ConversationState,
  whatsAppService: WhatsAppProductService
) {
  if (!state.tenant_id) return;

  const supabase = createClient();
  
  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('tenant_id', state.tenant_id)
    .single();

  if (product) {
    await whatsAppService.sendProductImages(customerPhone, product, 1);
  }
}

async function handleSimilarProducts(
  customerPhone: string,
  productId: string,
  state: ConversationState,
  whatsAppService: WhatsAppProductService
) {
  if (!state.tenant_id) return;

  try {
    // Get recommendations from AI service
    const recommendationsResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/products/recommendations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': state.tenant_id,
      },
      body: JSON.stringify({
        context: 'product_view',
        product_ids: [productId],
        max_recommendations: 5
      })
    });

    if (recommendationsResponse.ok) {
      const data = await recommendationsResponse.json();
      const recommendations = data.recommendations?.map((r: any) => r.product) || [];
      await whatsAppService.sendRecommendations(customerPhone, recommendations);
    } else {
      await whatsAppService.sendTextMessage(
        customerPhone,
        'Sorry, I couldn\'t find similar products at the moment.'
      );
    }
  } catch (error) {
    console.error('Error getting recommendations:', error);
    await whatsAppService.sendTextMessage(
      customerPhone,
      'Sorry, there was an error getting recommendations.'
    );
  }
}

async function handleSearch(
  customerPhone: string,
  query: string,
  state: ConversationState,
  whatsAppService: WhatsAppProductService
) {
  if (!state.tenant_id) return;

  const supabase = createClient();
  
  // Search products
  const { data: products } = await supabase
    .from('products')
    .select(`
      *,
      category:categories(name)
    `)
    .eq('tenant_id', state.tenant_id)
    .eq('is_active', true)
    .or(`name.ilike.%${query}%,description.ilike.%${query}%,tags.cs.{${query}}`)
    .order('name', { ascending: true })
    .limit(10);

  if (products) {
    await whatsAppService.sendSearchResults(customerPhone, query, products);
    state.current_context = 'browsing_products';
    state.search_query = query;
  }
}

async function handleBookingRequest(
  customerPhone: string,
  productId: string,
  state: ConversationState,
  whatsAppService: WhatsAppProductService
) {
  // Integration with booking system
  const bookingUrl = `${process.env.NEXT_PUBLIC_APP_URL}/book?product=${productId}&phone=${encodeURIComponent(customerPhone)}`;
  
  await whatsAppService.sendTextMessage(
    customerPhone,
    `Great choice! 🎉\n\nTo book a service with this product, please use this link:\n${bookingUrl}\n\nOur team will help you schedule your appointment and prepare your selected product.`
  );
}

async function handleHelp(customerPhone: string, whatsAppService: WhatsAppProductService) {
  const helpText = `I'm here to help you explore our products! 🤖\n\nHere's what you can do:\n\n` +
    `• Type "menu" - Go to main menu\n` +
    `• Type "catalog" - Browse product categories\n` +
    `• Type product name - Search for products\n` +
    `• Type "book" - Get booking information\n` +
    `• Type "help" - Show this help message\n\n` +
    `You can also use the interactive buttons I send you to navigate easily!`;

  await whatsAppService.sendTextMessage(customerPhone, helpText);
}

async function getTenantIdFromPhone(customerPhone: string): Promise<string | null> {
  // This is a simplified implementation
  // In a real app, you'd look up the tenant based on the WhatsApp business account
  // or have customers registered with their phone numbers
  
  const supabase = createClient();
  
  // Try to find customer by phone number
  const { data: customer } = await supabase
    .from('customers')
    .select('tenant_id')
    .eq('phone', customerPhone)
    .single();

  if (customer) {
    return customer.tenant_id;
  }

  // Fallback: use default tenant ID from environment
  return process.env.DEFAULT_TENANT_ID || null;
}

async function getCustomerName(customerPhone: string): Promise<string | undefined> {
  const supabase = createClient();
  
  const { data: customer } = await supabase
    .from('customers')
    .select('first_name')
    .eq('phone', customerPhone)
    .single();

  return customer?.first_name;
}