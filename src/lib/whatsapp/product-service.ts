import { defaultLogger } from '@/lib/logger';
import { Product, ProductCategory } from '@/types/product-catalogue';
import type {
  InteractiveButtonMessage,
  InteractiveListMessage,
  InteractiveMessagePayload,
} from '@/lib/whatsapp/providers/types';
import { getWhatsAppGraphApiVersion } from '@/lib/whatsapp/metaApiConfig';

interface WhatsAppMessage {
  to: string;
  type: 'text' | 'image' | 'template' | 'interactive';
  text?: {
    body: string;
  };
  image?: {
    link: string;
    caption?: string;
  };
  interactive?: InteractiveMessagePayload;
}

export function buildProductCatalogMessage(categories: ProductCategory[]): InteractiveListMessage {
  return {
    type: 'list',
    header: {
      type: 'text',
      text: '💄 Our Product Catalog'
    },
    body: {
      text: 'Browse our collection and pick a category to explore.'
    },
    footer: {
      text: 'Powered by Booka AI Front Desk'
    },
    action: {
      button: 'Browse categories',
      sections: [
        {
          title: 'Product Categories',
          rows: categories.map(category => ({
            id: `category_${category.id}`,
            title: category.name,
            description: category.description || `Browse ${category.name.toLowerCase()}`
          }))
        }
      ]
    }
  };
}

export function buildProductListMessage(
  products: Product[],
  categoryName?: string,
  page?: { index: number; total: number }
): InteractiveListMessage {
  const footerText = page && page.total > 1 ? `Page ${page.index} of ${page.total}` : null;

  return {
    type: 'list',
    header: {
      type: 'text',
      text: categoryName ? `${categoryName} Products` : '🛍️ Products'
    },
    body: {
      text: `Here are ${products.length} products ${categoryName ? `from ${categoryName}` : 'for you'}. Tap any item to view details.`
    },
    footer: footerText ? { text: footerText } : undefined,
    action: {
      button: 'View products',
      sections: [
        {
          title: 'Available Products',
          rows: products.map(product => ({
            id: `product_${product.id}`,
            title: truncateTitle(product.name),
            description: formatProductDescription(product)
          }))
        }
      ]
    }
  };
}

export function buildProductDetailsMessage(
  product: Product,
  includeRecommendations = true
): InteractiveButtonMessage {
  const stockInfo = getStockInfo(product);
  const priceInfo = `💰 Price: ${formatCurrency(product.price_cents)}`;

  let description = `${product.description || product.short_description || 'No description available'}`;
  if (product.tags && product.tags.length > 0) {
    description += `\n\n🏷️ Tags: ${product.tags.join(', ')}`;
  }

  return {
    type: 'button',
    header: product.images && product.images.length > 1 ? {
      type: 'text',
      text: `📸 ${product.images.length} photos available`
    } : undefined,
    body: {
      text: `*${product.name}*\n\n${description}\n\n${priceInfo}\n${stockInfo}`
    },
    footer: {
      text: 'What would you like to do next?'
    },
    action: {
      buttons: [
        {
          type: 'reply',
          reply: {
            id: `book_${product.id}`,
            title: '📅 Book with Product'
          }
        },
        {
          type: 'reply',
          reply: {
            id: `more_images_${product.id}`,
            title: product.images && product.images.length > 1 ? '📸 More Photos' : '🔄 Back to List'
          }
        },
        {
          type: 'reply',
          reply: {
            id: includeRecommendations ? `similar_${product.id}` : 'main_menu',
            title: includeRecommendations ? '💡 Similar Products' : '🏠 Main Menu'
          }
        }
      ]
    }
  };
}

export function buildProductImageFollowupMessage(product: Product, imageCount: number): InteractiveButtonMessage {
  return {
    type: 'button',
    body: {
      text: `Showing ${imageCount} more image${imageCount === 1 ? '' : 's'} of ${product.name}`
    },
    action: {
      buttons: [
        {
          type: 'reply',
          reply: {
            id: `book_${product.id}`,
            title: '📅 Book Now'
          }
        },
        {
          type: 'reply',
          reply: {
            id: `product_${product.id}`,
            title: '📋 Product Details'
          }
        },
        {
          type: 'reply',
          reply: {
            id: 'main_menu',
            title: '🏠 Main Menu'
          }
        }
      ]
    }
  };
}

export function buildRecommendationsMessage(recommendations: Product[]): InteractiveListMessage {
  return {
    type: 'list',
    header: {
      type: 'text',
      text: '💡 You Might Also Like'
    },
    body: {
      text: `Based on your interest, here are ${recommendations.length} products we think you'll love:`
    },
    footer: {
      text: 'Personalized just for you'
    },
    action: {
      button: 'View recommendations',
      sections: [
        {
          title: 'Recommended Products',
          rows: recommendations.slice(0, 10).map(product => ({
            id: `product_${product.id}`,
            title: truncateTitle(product.name),
            description: formatProductDescription(product)
          }))
        }
      ]
    }
  };
}

export function buildMainMenuMessage(customerName?: string): InteractiveButtonMessage {
  const greeting = customerName ? `Hi ${customerName}! 👋` : 'Welcome! 👋';

  return {
    type: 'button',
    body: {
      text: `${greeting}\n\nI can help you browse products, get recommendations, or book a service. What would you like to do today?`
    },
    footer: {
      text: 'Your AI Front Desk'
    },
    action: {
      buttons: [
        {
          type: 'reply',
          reply: {
            id: 'browse_catalog',
            title: '🛍️ Browse Products'
          }
        },
        {
          type: 'reply',
          reply: {
            id: 'book_service',
            title: '📅 Book Service'
          }
        },
        {
          type: 'reply',
          reply: {
            id: 'get_help',
            title: '❓ Get Help'
          }
        }
      ]
    }
  };
}

export function buildSearchResultsMessage(query: string, products: Product[]): InteractiveListMessage {
  return {
    type: 'list',
    header: {
      type: 'text',
      text: '🔍 Search Results'
    },
    body: {
      text: `Found ${products.length} products for "${query}":`
    },
    action: {
      button: 'View matches',
      sections: [
        {
          title: 'Matching Products',
          rows: products.slice(0, 10).map(product => ({
            id: `product_${product.id}`,
            title: truncateTitle(product.name),
            description: formatProductDescription(product)
          }))
        }
      ]
    }
  };
}

function truncateTitle(value: string): string {
  return value.length > 24 ? `${value.substring(0, 21)}...` : value;
}

function formatCurrency(priceCents?: number): string {
  return `₦${Math.round((priceCents ?? 0) / 100).toLocaleString()}`;
}

function formatProductDescription(product: Product): string {
  const price = formatCurrency(product.price_cents);
  const stockInfo = getStockInfo(product, true);
  return `${price} • ${stockInfo}`;
}

function getStockInfo(product: Product, short = false): string {
  if (!product.track_inventory) {
    return short ? 'Available' : '✅ Available';
  }

  if ((product.stock_quantity ?? 0) <= 0) {
    return short ? 'Out of stock' : '❌ Out of stock';
  }

  if ((product.stock_quantity ?? 0) <= (product.low_stock_threshold ?? 0)) {
    return short ? 'Low stock' : '⚠️ Low stock - order soon!';
  }

  return short ? 'In stock' : '✅ In stock';
}

export class WhatsAppProductService {
  private accessToken: string;
  private phoneNumberId: string;
  private baseUrl: string;

  constructor(config?: { accessToken?: string; phoneNumberId?: string; baseUrl?: string }) {
    this.accessToken = config?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '';
    this.phoneNumberId = config?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const rootBaseUrl = (
      config?.baseUrl || `https://graph.facebook.com/${getWhatsAppGraphApiVersion()}`
    ).replace(/\/+$/, '');
    this.baseUrl = `${rootBaseUrl}/${this.phoneNumberId}/messages`;
  }

  async sendMessage(message: WhatsAppMessage): Promise<boolean> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      const result = await response.json();
      
      if (!response.ok) {
        defaultLogger.error('WhatsApp API error:', result);
        return false;
      }

      return true;
    } catch (error) {
      defaultLogger.error('Error sending WhatsApp message:', error);
      return false;
    }
  }

  async sendProductCatalog(customerPhone: string, categories: ProductCategory[]): Promise<boolean> {
    const message: WhatsAppMessage = {
      to: customerPhone,
      type: 'interactive',
      interactive: buildProductCatalogMessage(categories),
    };

    return await this.sendMessage(message);
  }

  async sendProductList(customerPhone: string, products: Product[], categoryName?: string): Promise<boolean> {
    const maxProductsPerMessage = 10;
    const productChunks = this.chunkArray(products, maxProductsPerMessage);
    
    for (let i = 0; i < productChunks.length; i++) {
      const chunk = productChunks[i];
      
      const message: WhatsAppMessage = {
        to: customerPhone,
        type: 'interactive',
        interactive: buildProductListMessage(chunk, categoryName, { index: i + 1, total: productChunks.length })
      };

      const success = await this.sendMessage(message);
      if (!success) return false;

      // Add small delay between messages to avoid rate limiting
      if (i < productChunks.length - 1) {
        await this.delay(1000);
      }
    }

    return true;
  }

  async sendProductDetails(customerPhone: string, product: Product, includeRecommendations: boolean = true): Promise<boolean> {
    // First, send product image if available
    if (product.images && product.images.length > 0) {
      const imageMessage: WhatsAppMessage = {
        to: customerPhone,
        type: 'image',
        image: {
          link: product.images[0],
          caption: `✨ ${product.name}`
        }
      };
      
      await this.sendMessage(imageMessage);
      await this.delay(500);
    }

    // Then send product details with action buttons
    const detailsMessage: WhatsAppMessage = {
      to: customerPhone,
      type: 'interactive',
      interactive: buildProductDetailsMessage(product, includeRecommendations),
    };

    return await this.sendMessage(detailsMessage);
  }

  async sendProductImages(customerPhone: string, product: Product, startIndex: number = 1): Promise<boolean> {
    if (!product.images || product.images.length <= 1) {
      return await this.sendTextMessage(customerPhone, 'No additional images available for this product.');
    }

    const imagesToSend = product.images.slice(startIndex, startIndex + 3); // Send max 3 additional images
    
    for (let i = 0; i < imagesToSend.length; i++) {
      const imageMessage: WhatsAppMessage = {
        to: customerPhone,
        type: 'image',
        image: {
          link: imagesToSend[i],
          caption: `${product.name} - Image ${startIndex + i + 1}`
        }
      };
      
      await this.sendMessage(imageMessage);
      
      if (i < imagesToSend.length - 1) {
        await this.delay(500);
      }
    }

    // Send action buttons after images
    const actionMessage: WhatsAppMessage = {
      to: customerPhone,
      type: 'interactive',
      interactive: buildProductImageFollowupMessage(product, imagesToSend.length),
    };

    return await this.sendMessage(actionMessage);
  }

  async sendRecommendations(customerPhone: string, recommendations: Product[]): Promise<boolean> {
    if (recommendations.length === 0) {
      return await this.sendTextMessage(customerPhone, 'No similar products found at the moment.');
    }

    const message: WhatsAppMessage = {
      to: customerPhone,
      type: 'interactive',
      interactive: buildRecommendationsMessage(recommendations),
    };

    return await this.sendMessage(message);
  }

  async sendTextMessage(customerPhone: string, text: string): Promise<boolean> {
    const message: WhatsAppMessage = {
      to: customerPhone,
      type: 'text',
      text: {
        body: text
      }
    };

    return await this.sendMessage(message);
  }

  async sendMainMenu(customerPhone: string, customerName?: string): Promise<boolean> {
    const message: WhatsAppMessage = {
      to: customerPhone,
      type: 'interactive',
      interactive: buildMainMenuMessage(customerName),
    };

    return await this.sendMessage(message);
  }

  async sendSearchResults(customerPhone: string, query: string, products: Product[]): Promise<boolean> {
    if (products.length === 0) {
      return await this.sendTextMessage(
        customerPhone, 
        `Sorry, I couldn't find any products matching "${query}". Try a different search term or browse our categories.`
      );
    }

    const message: WhatsAppMessage = {
      to: customerPhone,
      type: 'interactive',
      interactive: buildSearchResultsMessage(query, products),
    };

    return await this.sendMessage(message);
  }

  private formatProductDescription(product: Product): string {
    const price = `$${(product.price_cents / 100).toFixed(2)}`;
    const stockInfo = this.getStockInfo(product, true);
    return `${price} • ${stockInfo}`;
  }

  private getStockInfo(product: Product, short: boolean = false): string {
    if (!product.track_inventory) {
      return short ? 'Available' : '✅ Available';
    }

    if ((product.stock_quantity ?? 0) <= 0) {
      return short ? 'Out of stock' : '❌ Out of stock';
    }

    if ((product.stock_quantity ?? 0) <= (product.low_stock_threshold ?? 0)) {
      return short ? 'Low stock' : '⚠️ Low stock - order soon!';
    }

    return short ? 'In stock' : '✅ In stock';
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default WhatsAppProductService;
