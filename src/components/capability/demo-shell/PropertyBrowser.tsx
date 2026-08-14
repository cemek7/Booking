'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { PROPERTIES, NEIGHBORHOODS, PROPERTY_TYPES } from '@/showcase/content/haven-properties';

const naira = (n: number) => `₦${n.toLocaleString()}`;

export function PropertyBrowser() {
  const [area, setArea] = useState('All');
  const [type, setType] = useState('All');
  const [maxPrice, setMaxPrice] = useState('Any');

  const priceCap = maxPrice === 'Any' ? Infinity : Number(maxPrice);
  const results = PROPERTIES.filter(
    (p) =>
      (area === 'All' || p.neighborhood === area) &&
      (type === 'All' || p.type === type) &&
      p.priceNaira <= priceCap,
  );

  const selectClass = 'mt-1 w-full rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm';

  return (
    <div>
      <form className="grid gap-4 sm:grid-cols-3" aria-label="Filter properties">
        <label className="text-sm font-medium">
          Neighbourhood
          <select className={selectClass} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="All">All areas</option>
            {NEIGHBORHOODS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Property type
          <select className={selectClass} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="All">All types</option>
            {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Max price
          <select className={selectClass} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}>
            <option value="Any">Any price</option>
            <option value="150000000">Up to ₦150m</option>
            <option value="300000000">Up to ₦300m</option>
            <option value="450000000">Up to ₦450m</option>
          </select>
        </label>
      </form>

      <p className="mt-6 text-sm" style={{ color: 'var(--sc-muted)' }} role="status">
        {results.length} {results.length === 1 ? 'property' : 'properties'} match your filters.
      </p>

      <div className="mt-4 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {results.map((p) => (
          <Link key={p.id} href={`/showcase/demos/haven-realty/properties/${p.id}`} className="sc-surface group overflow-hidden rounded-2xl border border-current/10">
            <div className="relative aspect-[4/3] overflow-hidden">
              <Image src={p.image} alt={`Stock photograph of a property; not a real Haven Realty listing.`} fill sizes="(min-width: 1024px) 30vw, 100vw" className="object-cover transition group-hover:scale-[1.02]" />
            </div>
            <div className="p-5">
              <p className="text-xs uppercase tracking-[.14em]" style={{ color: 'var(--sc-eyebrow)' }}>{p.neighborhood} · {p.type}</p>
              <h3 className="sc-display mt-2 text-xl font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm font-medium" style={{ color: 'var(--sc-primary)' }}>{naira(p.priceNaira)}</p>
              <p className="mt-2 text-sm" style={{ color: 'var(--sc-muted)' }}>
                {p.type === 'Land' ? `${p.areaSqm} sqm plot` : `${p.beds} bed · ${p.baths} bath · ${p.areaSqm} sqm`}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
