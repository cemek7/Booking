'use client';
import { useState } from 'react'; export function WishlistButton({ item }: { item: string }) { const [saved, setSaved] = useState(false); return <button type="button" onClick={() => setSaved(!saved)} aria-pressed={saved} className="border border-current/30 px-4 py-2 text-sm font-medium">{saved ? `Saved: ${item}` : 'Save to local wishlist'}</button>; }
