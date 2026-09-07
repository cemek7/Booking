// Static, illustrative property listings for the Haven Realty demonstrator.
// Fictional properties — no real address, price, or listing is represented.

export interface Property {
  id: string;
  title: string;
  neighborhood: string;
  type: 'Apartment' | 'House' | 'Land';
  priceNaira: number;
  beds: number;
  baths: number;
  areaSqm: number;
  image: string;
  summary: string;
}

export const PROPERTIES: Property[] = [
  { id: 'ikoyi-terrace', title: 'Garden Terrace Apartment', neighborhood: 'Ikoyi', type: 'Apartment', priceNaira: 180_000_000, beds: 3, baths: 3, areaSqm: 210, image: '/images/haven-realty/property-1.jpg', summary: 'A calm three-bedroom apartment with a shaded terrace and open living space.' },
  { id: 'lekki-villa', title: 'Palm Court Family Villa', neighborhood: 'Lekki', type: 'House', priceNaira: 320_000_000, beds: 5, baths: 5, areaSqm: 480, image: '/images/haven-realty/property-2.jpg', summary: 'A five-bedroom family home arranged around a courtyard and garden.' },
  { id: 'vi-penthouse', title: 'Harbour View Penthouse', neighborhood: 'Victoria Island', type: 'Apartment', priceNaira: 410_000_000, beds: 4, baths: 4, areaSqm: 300, image: '/images/haven-realty/property-3.jpg', summary: 'A top-floor apartment with wide water-facing glazing and a private lift lobby.' },
  { id: 'ikeja-house', title: 'Maple Street House', neighborhood: 'Ikeja', type: 'House', priceNaira: 145_000_000, beds: 4, baths: 3, areaSqm: 360, image: '/images/haven-realty/property-4.jpg', summary: 'A quiet four-bedroom home on a mature, tree-lined street.' },
  { id: 'lekki-land', title: 'Coastal Plot', neighborhood: 'Lekki', type: 'Land', priceNaira: 95_000_000, beds: 0, baths: 0, areaSqm: 800, image: '/images/haven-realty/property-1.jpg', summary: 'A serviced plot suited to a bespoke build, with documented access.' },
  { id: 'ikoyi-duplex', title: 'Cedar Lane Duplex', neighborhood: 'Ikoyi', type: 'House', priceNaira: 275_000_000, beds: 4, baths: 4, areaSqm: 400, image: '/images/haven-realty/property-2.jpg', summary: 'A bright semi-detached duplex with a compact garden and study.' },
];

export const NEIGHBORHOODS = ['Ikoyi', 'Lekki', 'Victoria Island', 'Ikeja'] as const;
export const PROPERTY_TYPES = ['Apartment', 'House', 'Land'] as const;

export function findProperty(id: string): Property | undefined {
  return PROPERTIES.find((p) => p.id === id);
}
