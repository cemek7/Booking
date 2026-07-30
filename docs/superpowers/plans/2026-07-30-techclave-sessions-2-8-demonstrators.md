# TechClave Demonstrators — Sessions 2–8 (Deltas)

> **For agentic workers:** Each section below is one session = one complete demonstrator. Execute it by running the **reusable template** (`2026-07-30-techclave-demonstrator-template.md`, Tasks A–F) with the DELTA values here. Build order is top-to-bottom. Truthfulness/disclosure/no-backend/quarantine constraints from the template apply to all.

---

## Session 2 — Northstar Clinic  (industry: Private healthcare · conversion: Appointment request)
**Theme** (`northstar`): bg `#f7fafc` · fg `#0f2231` · muted `#5b7183` · surface `#ffffff` · primary `#2f6fed` · primaryForeground `#ffffff` · accent `#34c3a0` · border `#dce6ee` · display `Manrope` · body `Inter` · radius `large` · density `spacious` · motion `minimal`.
**Pages:** Home, Services, Doctors, Patient Information, Contact.
**Features:** service directory, doctor profiles, **appointment-request form (local mock)**, insurance/payment info, FAQ, emergency disclaimer (non-emergency notice), locations & hours.
**Illustrative widget:** none (or an "estimated wait/next availability" illustrative note).
**Content notes:** calm/trustworthy; NO medical outcome claims; add a visible "for emergencies call local services" disclaimer.
**Images:** clinic/reception/medical-team royalty-free → `public/images/northstar-clinic/`.
**Case study:** emphasize trust-building IA, appointment funnel, accessibility; `designedImpact` = reduced friction to booking (Designed outcome); limitations = illustrative content, no live scheduling backend.

---

## Session 3 — Ember Table  (industry: Premium restaurant · conversion: Reservations)
**Theme** (`ember`): bg `#140f0c` · fg `#f4ece2` · muted `#a68f7d` · surface `#211812` · primary `#c8542b` · primaryForeground `#f4ece2` · accent `#e0a458` · border `#35271d` · display `Playfair Display` · body `Inter` · radius `small` · density `balanced` · motion `subtle`.
**Pages:** Home, Menu, Private Dining, About, Contact/Reservation.
**Features:** **reservation form (local mock)**, menu sections, chef story, gallery, location & hours, private-event CTA, dietary information, mobile sticky CTA.
**Content notes:** warm dark editorial; premium serif display; restrained motion.
**Images:** plated food / interior / chef royalty-free → `public/images/ember-table/`.
**Case study:** editorial design system, reservation conversion, sticky mobile CTA; limitations = no live table inventory.

---

## Session 4 — Haven Realty  (industry: Real estate · conversion: Buyer & seller lead)
**Theme** (`haven`): bg `#fbfaf7` · fg `#1c2530` · muted `#6c7684` · surface `#ffffff` · primary `#14212e` · primaryForeground `#ffffff` · accent `#b08d57` · border `#e6e2d9` · display `Cormorant Garamond` · body `Inter` · radius `medium` · density `spacious` · motion `subtle`.
**Pages:** Home, Properties, Property Detail, Sell With Us, Contact.
**Features:** local-data filters (client-side over a static property list), property cards, property gallery, agent profile, inquiry form (local mock), **illustrative mortgage estimator**, neighborhoods.
**Illustrative widget:** `src/showcase/lib/haven-mortgage.ts` — pure `estimateMonthlyPayment({principal, ratePct, years})` (tested), labeled Illustrative.
**Images:** property exteriors/interiors royalty-free → `public/images/haven-realty/`.
**Case study:** data-rich listing UX + filters + estimator; limitations = static listings, illustrative finance math.

---

## Session 5 — Meridian Legal  (industry: Corporate law · conversion: Consultation inquiry)
**Theme** (`meridian`): bg `#f6f4ee` · fg `#14243a` · muted `#5d6b7d` · surface `#ffffff` · primary `#1f3a5f` · primaryForeground `#ffffff` · accent `#9c7b4d` · border `#dcd6c8` · display `Libre Baskerville` · body `Source Sans 3` · radius `none` · density `balanced` · motion `minimal`.
**Pages:** Home, Practice Areas, Team, Insights, Contact.
**Features:** practice areas, attorney profiles, article cards (Insights), consultation form (local mock), credentials, jurisdiction & conflict-check notices.
**Content notes:** conservative, typography-led; NO case-win claims; include "not legal advice / no attorney-client relationship formed" notice.
**Images:** office/boardroom/city royalty-free → `public/images/meridian-legal/`.
**Case study:** authority-led design, consultation funnel, compliance notices; limitations = illustrative firm.

---

## Session 6 — Forge Build  (industry: Construction & contracting · conversion: Quote request)
**Theme** (`forge`): bg `#12140f` · fg `#f2f3ee` · muted `#9aa08f` · surface `#1c1f18` · primary `#f2a900` · primaryForeground `#12140f` · accent `#3d5a45` · border `#2c3126` · display `Archivo` · body `Inter` · radius `none` · density `compact` · motion `subtle`.
**Pages:** Home, Services, Projects, Process, Contact.
**Features:** portfolio, project-detail template, **quote-request form (local mock)**, capability matrix, process timeline, safety & quality section, service area.
**Images:** construction sites / equipment / completed builds royalty-free → `public/images/forge-build/`.
**Case study:** industrial design system, project portfolio + quote funnel; limitations = illustrative projects.

---

## Session 7 — Crestfield Academy  (industry: Private education · conversion: Admission inquiry)
**Theme** (`crestfield`): bg `#fdf9f3` · fg `#23324a` · muted `#64748b` · surface `#ffffff` · primary `#2b5fa5` · primaryForeground `#ffffff` · accent `#e2954a` · border `#e7ddcc` · display `Bricolage Grotesque` · body `Inter` · radius `large` · density `balanced` · motion `subtle`.
**Pages:** Home, About, Academics, Admissions, School Life, Contact.
**Features:** admissions steps, programs, calendar preview, FAQ, **inquiry form (local mock)**, safeguarding section, news/events.
**Content notes:** warm, optimistic, parent-friendly; include a safeguarding statement.
**Images:** campus/classroom/students (consented-stock style) royalty-free → `public/images/crestfield-academy/`.
**Case study:** admissions funnel + trust/safeguarding; limitations = illustrative institution.

---

## Session 8 — Atelier Soso  (industry: Fashion & lifestyle retail · conversion: Product inquiry)
**Theme** (`atelier`): bg `#f4f1ec` · fg `#17130f` · muted `#6f665c` · surface `#ffffff` · primary `#17130f` · primaryForeground `#f4f1ec` · accent `#c2410c` · border `#ddd6cc` · display `Syne` · body `Inter` · radius `none` · density `spacious` · motion `expressive`.
**Pages:** Home, Collections, Product Detail, Lookbook, About, Contact.
**Features:** collection cards, product gallery, size guide, **local wishlist interaction** (client state, no backend), WhatsApp inquiry CTA (mailto/`wa.me` link — no Booka API), lookbook, shipping/returns copy.
**Content notes:** editorial fashion, expressive typography, mobile-commerce aware; respect reduced-motion despite `expressive`.
**Images:** apparel/lookbook/editorial royalty-free → `public/images/atelier-soso/`.
**Case study:** expressive editorial system + product-inquiry funnel + wishlist; limitations = no cart/checkout (by design).

---

## After Session 8
All 8 demonstrators `published`; `/showcase/work` fully linked. Proceed to Session 9 (corporate pages), then 10 (exports), 11 (deck), 12 (screenshots + audit + final QA).
