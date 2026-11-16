# Bharat Makaan Enterprise

**AI-powered real estate management for builders, agents and channel partners.**

> Manage properties, projects, towers, apartments, pricing, bookings, leads and channel partners from one intelligent platform.

---

## Overview

**Bharat Makaan** is a production-oriented, multi-tenant enterprise real estate management SaaS platform and public property discovery portal built from the ground up on a unified Firebase + TypeScript monorepo.

It delivers two connected products backed by one shared, permission-isolated backend:
1. **Enterprise Real Estate Management Platform** (`apps/web` & `apps/mobile`): Multi-builder tenant isolation, 13 roles with granular permission matrices, hierarchical project/phase/tower/floor/unit visual inventory (supporting apartments, plotted developments, villas, and commercial spaces), independent physical parking inventory, versioned dynamic price books with editable cost-sheet labels, deterministic Indian GST & Construction-Linked Payment (CLP) cost-sheet generator with PDF export, floor plan version mapping, channel partner portal with lead-protection conflict resolution, Meta WhatsApp Cloud API shared inbox, drag-and-drop lead form builder, site visit scheduling, controlled bookings & customer collections with server-side Razorpay HMAC verification, 16 operational reports & immutable audit explorer, Super Admin console, and SaaS subscription billing.
2. **Public Property Portal** (`apps/web`): Crawlable, SEO-structured buyer discovery portal (`/`, `/buy`, `/rent`, `/projects`, `/compare`, `/book-visit`, `/for-professionals`, `/pricing`, `/about`, `/contact`) displaying strictly approved (`isPublicPublished == true`) listings with side-by-side real-data comparisons.

---

## Monorepo Architecture

```text
bharat-makaan/
├── apps/
│   ├── web/            # React 18 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui
│   └── mobile/         # React Native + Expo SDK 52 + TypeScript + NativeWind + React Navigation
├── functions/          # Firebase Cloud Functions v2 (18 domain modules, Node 22, Admin SDK)
├── packages/
│   ├── config/         # Brand identity, design system tokens, SaaS plan catalog, nav specs
│   ├── shared/         # 36 Firestore entity types, RBAC engine, state machines, pricing math
│   └── validation/     # Shared Zod schemas for Web, Mobile, Callables & Webhooks
├── firebase/           # firestore.rules, firestore.indexes.json, storage.rules
├── docs/               # Architecture, Data Model, Setup, API/Integrations, Feature & QA reports
├── scripts/            # Secure Super Admin provisioning (`prateek.parts@gmail.com`) & Sitemap generator
└── tests/              # Vitest unit, C-704 regression, concurrency & Firebase Emulator suites
```

---

## Quick Start

### 1. Prerequisites
- **Node.js** `>= 20.0.0` (verified on `v22.14.0`)
- **pnpm** `>= 10.0.0`
- **Firebase CLI** (`firebase-tools`) & **Java 17+** (for local Firebase Emulator Suite)

### 2. Install & Build Shared Packages
```bash
pnpm install
pnpm build:packages
```

### 3. Configure Environment Variables
Copy `.env.example` to `apps/web/.env.local`, `apps/mobile/.env.local`, and `functions/.env` (or Firebase Secret Manager in production). Never place backend API keys in `VITE_*` or `EXPO_PUBLIC_*` variables.

### 4. Provision Initial Platform Super Admin
```bash
SUPER_ADMIN_INITIAL_PASSWORD="<StrongPasswordMin14Chars!>" pnpm provision:super-admin
```
Provisions `prateek.parts@gmail.com` with `platformRole: "PLATFORM_SUPER_ADMIN"` and `requireMfa: true`. Enroll your TOTP second factor immediately upon first sign-in under **Settings → Security & MFA**.

### 5. Run Development Servers
```bash
# Start Web Application (http://localhost:5173)
pnpm dev:web

# Start React Native Expo Mobile Application
pnpm dev:mobile
```

### 6. Run Quality Gate, Tests & Production Builds
```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

---

## Documentation Index
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)
- [Dependency Map](docs/DEPENDENCY_MAP.md)
- [Firestore 36-Entity Data Model & Storage Layout](docs/DATA_MODEL.md)
- [Complete Web & Mobile Page Inventory](docs/PAGE_INVENTORY.md)
- [Setup & Deployment Guide](docs/SETUP_GUIDE.md)
- [API & External Integrations Reference](docs/API_AND_INTEGRATIONS.md)
- [Feature Coverage Report](docs/FEATURE_COVERAGE.md)
- [Known Limitations & Live Credential Checklist](docs/KNOWN_LIMITATIONS.md)
