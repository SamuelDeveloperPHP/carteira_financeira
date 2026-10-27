# Carteira financeira — execução no Docker

A aplicação operacional está em `frontend/` (Next.js) e `backend/` (NestJS), com TypeScript e PostgreSQL. O template original abaixo e em `src/` foi preservado; suas páginas e autenticação simulada não são usadas pelos containers. Bootstrap e fontes locais foram reaproveitados.

**Somente valores simulados.** Integração com dinheiro real é uma evolução futura, não implementada.

## Iniciar

Com Docker Desktop aberto, execute no PowerShell a partir deste diretório:

```powershell
.\scripts\setup.ps1
```

Abra **http://localhost:3080**. O projeto no Docker Desktop chama-se `carteira_financeira`.

- Crie uma conta pela interface. Ela começa com saldo zero.
- Faça login e cadastre um aplicativo autenticador pelo QR Code. Guarde os códigos de recuperação.
- O master usa o e-mail e a senha aleatória de `.local/master.json`. Seu primeiro login também exige configurar o autenticador. Não compartilhe esse arquivo.
- `.docker.env` contém segredos locais gerados pelo instalador. Não publique esse arquivo nem o conteúdo de `.local/`.

## Acessar PostgreSQL pelo DBeaver

Host `127.0.0.1`, porta `5433`, banco `carteira`, usuário `postgres`. A senha é o valor de `POSTGRES_PASSWORD` em `.docker.env`. A porta é publicada somente neste computador. A conexão local de demonstração não exige SSL.

## Adicionar saldo de demonstração

Após cadastrar o destinatário, execute como operador local:

```powershell
docker compose --env-file .docker.env exec api node dist/operator.js deposit usuario@example.com 10000 deposito-demo-001
```

`10000` significa R$ 100,00. Repita a mesma referência apenas para repetir a mesma operação; ela não será creditada duas vezes. Uma nova entrada exige outra referência. Não há endpoint público de depósito e o master não pode criar depósitos pela sessão administrativa.

## Verificar e operar

```powershell
docker compose --env-file .docker.env ps
docker compose --env-file .docker.env --profile test run --rm tests
docker compose --env-file .docker.env logs --tail 50 api
docker compose --env-file .docker.env stop
docker compose --env-file .docker.env up -d
```

Os testes usam banco separado `carteira_test`; os dados da demonstração ficam em volume persistente. Não use `down -v` para interromper a aplicação, pois isso apaga seu volume.

## Documentação da entrega

- [Contrato da API e exemplos](docs/API.md)
- [Arquitetura, segurança e limitações](docs/ARQUITETURA.md)
- [Roteiro de demonstração e validação](docs/ENTREGA.md)
- [Backlog](BACKLOG.md)

---

## Documentação original do template preservado

# 🚀 Velzon - Next.js TypeScript Admin Dashboard

[![Next.js](https://img.shields.io/badge/Next.js-15.1.8-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.1.0-blue)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Redux Toolkit](https://img.shields.io/badge/Redux%20Toolkit-2.8.2-purple)](https://redux-toolkit.js.org/)
[![Bootstrap](https://img.shields.io/badge/Bootstrap-5.3.6-blue)](https://getbootstrap.com/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

> **Velzon** is a modern, feature-rich admin dashboard template built with Next.js 15, TypeScript,
> Redux Toolkit, and Bootstrap 5. It provides a comprehensive solution for building enterprise-level
> web applications with multiple dashboard variants, advanced UI components, and extensive
> functionality.

## 📋 Table of Contents

- [✨ Features](#-features)
- [🎯 Dashboard Variants](#-dashboard-variants)
- [🏗️ Project Structure](#️-project-structure)
- [🚀 Quick Start](#-quick-start)
- [📦 Installation](#-installation)
- [⚙️ Configuration](#️-configuration)
- [🔧 Available Scripts](#-available-scripts)
- [📁 Directory Structure](#-directory-structure)
- [🎨 UI Components](#-ui-components)
- [📊 Charts & Analytics](#-charts--analytics)
- [🔐 Authentication](#-authentication)
- [📱 Responsive Design](#-responsive-design)
- [🌐 Internationalization](#-internationalization)
- [🧪 Testing](#-testing)
- [📈 Performance](#-performance)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## ✨ Features

### 🎨 **Modern UI/UX**

- **Bootstrap 5.3.6** - Latest responsive framework
- **Multiple Layout Options** - Vertical, Horizontal, Two-column layouts
- **Dark/Light Themes** - Customizable theme system
- **Responsive Design** - Mobile-first approach
- **Modern Icons** - Feather Icons integration

### 📊 **Dashboard Variants**

- **Analytics Dashboard** - Business metrics and KPIs
- **CRM Dashboard** - Customer relationship management
- **E-commerce Dashboard** - Online store management
- **Crypto Dashboard** - Cryptocurrency tracking
- **NFT Dashboard** - NFT marketplace management
- **Job Dashboard** - Recruitment and HR management
- **Project Dashboard** - Project management and tracking

### 🔧 **Advanced Functionality**

- **Redux Toolkit** - State management with persistence
- **TypeScript** - Full type safety
- **Form Handling** - Formik with Yup validation
- **File Upload** - FilePond integration
- **Rich Text Editor** - CKEditor 5 and Quill
- **Calendar** - FullCalendar integration
- **Charts** - ApexCharts, Chart.js, ECharts
- **Data Tables** - React Table with advanced features
- **Maps** - Google Maps integration
- **Chat System** - Real-time messaging
- **Email System** - Mailbox functionality

### 🚀 **Performance & SEO**

- **Next.js 15** - App Router and Server Components
- **Image Optimization** - Next.js Image component
- **Code Splitting** - Automatic route-based splitting
- **SEO Optimized** - Meta tags and structured data
- **PWA Ready** - Progressive Web App capabilities

## 🎯 Dashboard Variants

### 📈 Analytics Dashboard

- Real-time analytics and metrics
- Interactive charts and graphs
- KPI monitoring
- Data visualization

### 👥 CRM Dashboard

- Customer management
- Lead tracking
- Deal pipeline
- Contact management
- Company profiles

### 🛒 E-commerce Dashboard

- Product management
- Order tracking
- Customer analytics
- Sales reports
- Inventory management

### 💰 Crypto Dashboard

- Cryptocurrency tracking
- Wallet management
- Trading interface
- KYC verification
- ICO management

### 🎨 NFT Dashboard

- NFT marketplace
- Collection management
- Wallet integration
- Auction system
- Creator profiles

### 💼 Job Dashboard

- Job listings
- Candidate management
- Application tracking
- Company profiles
- Recruitment analytics

### 📋 Project Dashboard

- Project management
- Task tracking
- Team collaboration
- Timeline management
- Resource allocation

## 🏗️ Project Structure

```
velzon-next-ts/
├── 📁 src/
│   ├── 📁 app/                    # Next.js App Router
│   │   ├── 📁 (auth)/            # Authentication routes
│   │   ├── 📁 (with-layout)/     # Main application routes
│   │   └── 📁 (with-nonlayout)/  # Landing pages
│   ├── 📁 components/            # Reusable components
│   ├── 📁 layouts/               # Layout components
│   ├── 📁 slices/                # Redux Toolkit slices
│   ├── 📁 providers/             # Context providers
│   ├── 📁 hooks/                 # Custom React hooks
│   ├── 📁 utils/                 # Utility functions
│   ├── 📁 types/                 # TypeScript type definitions
│   └── 📁 assets/                # Static assets
├── 📁 public/                    # Public assets
├── 📁 config/                    # Configuration files
└── 📁 docs/                      # Documentation
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** 22.0 or higher
- **npm** or **yarn** package manager
- **Git** for version control

### System Requirements

- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 2GB free space
- **Browser**: Chrome, Firefox, Safari, Edge (latest versions)

## 📦 Installation

1. **Clone from Velzon the repository or download from website**

   ```bash
   git clone https://github.com/themesbrand/velzon
   cd next-ts or relavent folder
   ```

2. **Install dependencies**

   ```bash
   yarn install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env.local
   ```

4. **Start development server**

   ```bash
   npm run dev
   # or
   yarn dev
   ```

5. **Open your browser** Navigate to [http://localhost:3000](http://localhost:3000)

## ⚙️ Configuration

### Environment Variables

Create a `.env.local` file in the root directory:

```env
# Next.js Configuration
NEXT_PUBLIC_APP_NAME=Velzon
NEXT_PUBLIC_APP_URL=http://localhost:3000

# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:8000/api

# Authentication
NEXT_PUBLIC_AUTH_SECRET=your-auth-secret

# Google Maps (Optional)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-google-maps-api-key

# Firebase (Optional)
NEXT_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-firebase-auth-domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-firebase-project-id
```

### Redux Store Configuration

The Redux store is configured with persistence for essential data:

```typescript
// src/slices/store.ts
const persistConfig = {
  key: "root",
  storage,
  whitelist: ["Login", "Profile", "Layout"], // Only persist essential data
};
```

## 🔧 Available Scripts

| Script                 | Description                  |
| ---------------------- | ---------------------------- |
| `npm run dev`          | Start development server     |
| `npm run build`        | Build for production         |
| `npm run start`        | Start production server      |
| `npm run lint`         | Run ESLint                   |
| `npm run lint:fix`     | Fix ESLint errors            |
| `npm run format`       | Format code with Prettier    |
| `npm run format:check` | Check code formatting        |
| `npm run type-check`   | Run TypeScript type checking |

## 📁 Directory Structure

### Core Directories

```
src/
├── app/                          # Next.js App Router pages
│   ├── (auth)/                   # Authentication pages
│   │   ├── login/               # Login page
│   │   └── register/            # Registration page
│   ├── (with-layout)/           # Main application pages
│   │   ├── dashboard/           # Dashboard variants
│   │   ├── apps/                # Application modules
│   │   ├── ui/                  # UI components
│   │   └── forms/               # Form components
│   └── (with-nonlayout)/        # Landing pages
├── components/                   # Reusable components
│   ├── Common/                  # Common UI components
│   ├── Dashboard/               # Dashboard-specific components
│   ├── layout/                  # Layout components
│   └── providers/               # Context providers
├── layouts/                     # Layout definitions
│   ├── VerticalLayout.tsx       # Vertical sidebar layout
│   ├── HorizontalLayout.tsx     # Horizontal top navigation
│   └── AuthLayout.tsx           # Authentication layout
├── slices/                      # Redux Toolkit slices
│   ├── auth/                    # Authentication state
│   ├── dashboard/               # Dashboard data
│   ├── apps/                    # Application state
│   └── store.ts                 # Store configuration
└── assets/                      # Static assets
    ├── scss/                    # SCSS stylesheets
    ├── images/                  # Image assets
    └── fonts/                   # Font files
```

## 🛣️ Route Documentation

### Authentication Routes (`/auth`)

| Route           | Path                    | Description            | Access |
| --------------- | ----------------------- | ---------------------- | ------ |
| Login           | `/auth/login`           | User login page        | Public |
| Register        | `/auth/register`        | User registration page | Public |
| Forgot Password | `/auth/forgot-password` | Password recovery page | Public |
| Reset Password  | `/auth/reset-password`  | Password reset page    | Public |

### Dashboard Routes (`/dashboard`)

| Route      | Path                   | Description                      | Features                       |
| ---------- | ---------------------- | -------------------------------- | ------------------------------ |
| Analytics  | `/dashboard-analytics` | Main analytics dashboard         | Charts, KPIs, Metrics          |
| CRM        | `/dashboard-crm`       | Customer relationship management | Leads, Deals, Contacts         |
| E-commerce | `/dashboard-ecommerce` | Online store dashboard           | Sales, Products, Orders        |
| Crypto     | `/dashboard-crypto`    | Cryptocurrency dashboard         | Wallet, Trading, Charts        |
| NFT        | `/dashboard-nft`       | NFT marketplace dashboard        | Collections, Auctions          |
| Job        | `/dashboard-job`       | Job portal dashboard             | Jobs, Candidates, Applications |
| Project    | `/dashboard-projects`  | Project management dashboard     | Projects, Tasks, Timeline      |

### E-commerce Application (`/apps-ecommerce-*`)

| Route           | Path                              | Description                | Features                        |
| --------------- | --------------------------------- | -------------------------- | ------------------------------- |
| Products        | `/apps-ecommerce-products`        | Product catalog management | CRUD, Categories, Images        |
| Product Details | `/apps-ecommerce-product-details` | Individual product view    | Details, Reviews, Related       |
| Orders          | `/apps-ecommerce-orders`          | Order management           | Status, Tracking, History       |
| Order Details   | `/apps-ecommerce-order-details`   | Order information          | Items, Shipping, Payment        |
| Customers       | `/apps-ecommerce-customers`       | Customer management        | Profiles, Orders, Analytics     |
| Cart            | `/apps-ecommerce-cart`            | Shopping cart              | Items, Quantity, Pricing        |
| Checkout        | `/apps-ecommerce-checkout`        | Checkout process           | Payment, Shipping, Confirmation |
| Add Product     | `/apps-ecommerce-add-product`     | Product creation           | Form, Images, Categories        |
| Sellers         | `/apps-ecommerce-sellers`         | Seller management          | Profiles, Performance           |
| Seller Details  | `/apps-ecommerce-seller-details`  | Seller information         | Stats, Products, Reviews        |

### CRM Application (`/apps-crm-*`)

| Route     | Path                  | Description        | Features                         |
| --------- | --------------------- | ------------------ | -------------------------------- |
| Companies | `/apps-crm-companies` | Company management | Profiles, Contacts, Deals        |
| Contacts  | `/apps-crm-contacts`  | Contact management | Profiles, Communication, History |
| Leads     | `/apps-crm-leads`     | Lead management    | Pipeline, Conversion, Tracking   |
| Deals     | `/apps-crm-deals`     | Deal management    | Pipeline, Stages, Revenue        |

### Crypto Application (`/apps-crypto-*`)

| Route        | Path                        | Description           | Features                         |
| ------------ | --------------------------- | --------------------- | -------------------------------- |
| Wallet       | `/apps-crypto-wallet`       | Cryptocurrency wallet | Balance, Transactions, Addresses |
| Buy/Sell     | `/apps-crypto-buy-sell`     | Trading interface     | Orders, Charts, History          |
| Orders       | `/apps-crypto-orders`       | Order management      | Buy/Sell orders, Status          |
| Transactions | `/apps-crypto-transactions` | Transaction history   | Details, Status, Fees            |
| KYC          | `/apps-crypto-kyc`          | Know Your Customer    | Verification, Documents          |
| ICO          | `/apps-crypto-ico`          | Initial Coin Offering | Projects, Investment             |

### NFT Application (`/apps-nft-*`)

| Route        | Path                     | Description      | Features                  |
| ------------ | ------------------------ | ---------------- | ------------------------- |
| Marketplace  | `/apps-nft-marketplace`  | NFT marketplace  | Browse, Search, Filter    |
| Collections  | `/apps-nft-collections`  | NFT collections  | Gallery, Stats, Details   |
| Explore      | `/apps-nft-explore`      | NFT discovery    | Trending, Categories      |
| Item Details | `/apps-nft-item-details` | Individual NFT   | Details, History, Bids    |
| Create       | `/apps-nft-create`       | NFT creation     | Upload, Metadata, Pricing |
| Wallet       | `/apps-nft-wallet`       | NFT wallet       | Holdings, Transactions    |
| Ranking      | `/apps-nft-ranking`      | NFT rankings     | Top collections, Artists  |
| Creators     | `/apps-nft-creators`     | Creator profiles | Portfolios, Stats         |
| Auction      | `/apps-nft-auction`      | Auction system   | Bidding, Time limits      |

### Job Portal (`/apps-job-*`)

| Route           | Path                        | Description          | Features                     |
| --------------- | --------------------------- | -------------------- | ---------------------------- |
| Job Lists       | `/apps-job-lists`           | Job listings         | Search, Filter, Apply        |
| Job Grid        | `/apps-job-grid-lists`      | Grid view jobs       | Visual layout, Quick apply   |
| Job Details     | `/apps-job-details`         | Job information      | Description, Requirements    |
| Job Categories  | `/apps-job-categories`      | Job categories       | Browse by category           |
| Companies       | `/apps-job-companies-lists` | Company listings     | Profiles, Open positions     |
| Candidates      | `/apps-job-candidate-lists` | Candidate management | Profiles, Skills, Experience |
| Candidate Grid  | `/apps-job-candidate-grid`  | Grid view candidates | Visual profiles              |
| Job Application | `/apps-job-application`     | Application form     | Resume, Cover letter         |
| Job Statistics  | `/apps-job-statistics`      | Analytics dashboard  | Metrics, Trends              |
| New Job         | `/apps-job-new`             | Job creation         | Form, Requirements, Benefits |

### Project Management (`/apps-projects-*`)

| Route             | Path                      | Description       | Features               |
| ----------------- | ------------------------- | ----------------- | ---------------------- |
| Projects List     | `/apps-projects-list`     | Project catalog   | Status, Progress, Team |
| Projects Overview | `/apps-projects-overview` | Project dashboard | Analytics, Timeline    |
| Projects Create   | `/apps-projects-create`   | Project creation  | Form, Team, Timeline   |

### Task Management (`/apps-tasks-*`)

| Route         | Path                    | Description      | Features                     |
| ------------- | ----------------------- | ---------------- | ---------------------------- |
| Tasks List    | `/apps-tasks-list-view` | Task list view   | Status, Priority, Assignee   |
| Tasks Kanban  | `/apps-tasks-kanban`    | Kanban board     | Drag & drop, Columns         |
| Tasks Details | `/apps-tasks-details`   | Task information | Description, Comments, Files |

### Communication (`/apps-*`)

| Route            | Path                        | Description          | Features                   |
| ---------------- | --------------------------- | -------------------- | -------------------------- |
| Chat             | `/apps-chat`                | Real-time chat       | Messages, Groups, Files    |
| Calendar         | `/apps-calendar`            | Calendar application | Events, Reminders, Sharing |
| Calendar Month   | `/apps-calendar-month-grid` | Month view calendar  | Grid layout, Events        |
| Email Basic      | `/apps-email-basic`         | Basic email client   | Inbox, Compose, Folders    |
| Email E-commerce | `/apps-email-ecommerce`     | E-commerce emails    | Templates, Automation      |
| Mailbox          | `/apps-mailbox`             | Advanced mailbox     | Filters, Labels, Search    |

### Business Tools (`/apps-*`)

| Route            | Path                     | Description         | Features                      |
| ---------------- | ------------------------ | ------------------- | ----------------------------- |
| File Manager     | `/apps-file-manager`     | File management     | Upload, Organize, Share       |
| Invoices List    | `/apps-invoices-list`    | Invoice management  | Status, Payment, History      |
| Invoices Details | `/apps-invoices-details` | Invoice information | Items, Payment, PDF           |
| Invoices Create  | `/apps-invoices-create`  | Invoice creation    | Form, Items, Tax              |
| Tickets List     | `/apps-tickets-list`     | Support tickets     | Status, Priority, Assignee    |
| Tickets Details  | `/apps-tickets-details`  | Ticket information  | Thread, Attachments, Status   |
| Todo             | `/apps-todo`             | Todo application    | Tasks, Categories, Reminders  |
| API Keys         | `/apps-api-key`          | API key management  | Generate, Revoke, Permissions |

### UI Components (`/ui-*`)

| Route        | Path               | Description            | Components                   |
| ------------ | ------------------ | ---------------------- | ---------------------------- |
| Alerts       | `/ui-alerts`       | Alert components       | Success, Error, Warning      |
| Buttons      | `/ui-buttons`      | Button components      | Variants, Sizes, States      |
| Cards        | `/ui-cards`        | Card components        | Headers, Footers, Actions    |
| Carousel     | `/ui-carousel`     | Carousel components    | Slides, Navigation, Autoplay |
| Dropdowns    | `/ui-dropdowns`    | Dropdown components    | Menus, Items, States         |
| Grid         | `/ui-grid`         | Grid system            | Responsive, Columns          |
| Images       | `/ui-images`       | Image components       | Responsive, Lazy loading     |
| Lightbox     | `/ui-lightbox`     | Lightbox gallery       | Modal, Navigation, Zoom      |
| Modals       | `/ui-modals`       | Modal components       | Sizes, Backdrop, Animation   |
| Offcanvas    | `/ui-offcanvas`    | Offcanvas components   | Side panels, Navigation      |
| Placeholders | `/ui-placeholders` | Placeholder components | Loading states, Skeleton     |
| Progress     | `/ui-progress`     | Progress components    | Bars, Circles, States        |
| Spinners     | `/ui-spinners`     | Spinner components     | Loading indicators           |
| Tabs         | `/ui-tabs`         | Tab components         | Navigation, Content          |
| Toasts       | `/ui-toasts`       | Toast notifications    | Success, Error, Info         |
| Tooltips     | `/ui-tooltips`     | Tooltip components     | Positioning, Content         |

### Forms (`/forms-*`)

| Route            | Path                      | Description            | Features                      |
| ---------------- | ------------------------- | ---------------------- | ----------------------------- |
| Basic Elements   | `/forms-basic-elements`   | Basic form elements    | Inputs, Labels, Validation    |
| Form Select      | `/forms-form-select`      | Select components      | Options, Search, Multi-select |
| Form Editor      | `/forms-form-editor`      | Rich text editor       | WYSIWYG, Formatting           |
| Checkbox & Radio | `/forms-checkbox-radio`   | Checkbox and radio     | Groups, States, Validation    |
| Input Groups     | `/forms-input-groups`     | Input group components | Prefixes, Suffixes, Addons    |
| Form Validation  | `/forms-form-validation`  | Form validation        | Rules, Messages, States       |
| Form Wizard      | `/forms-form-wizard`      | Multi-step forms       | Steps, Progress, Navigation   |
| Form Mask        | `/forms-form-mask`        | Input masking          | Phone, Date, Currency         |
| Form File Upload | `/forms-form-file-upload` | File upload            | Drag & drop, Preview          |
| Form Layouts     | `/forms-form-layouts`     | Form layouts           | Horizontal, Vertical, Inline  |

### Tables (`/tables-*`)

| Route        | Path                   | Description            | Features                       |
| ------------ | ---------------------- | ---------------------- | ------------------------------ |
| Basic Tables | `/tables-basic-tables` | Basic table components | Rows, Columns, Styling         |
| Table Grid   | `/tables-table-grid`   | Grid table             | Sorting, Filtering, Pagination |
| Table List   | `/tables-table-list`   | List table             | Actions, Status, Details       |

### Charts (`/charts-*`)

| Route       | Path                  | Description        | Charts                  |
| ----------- | --------------------- | ------------------ | ----------------------- |
| Apex Charts | `/charts-apex-charts` | ApexCharts library | Line, Bar, Area, Pie    |
| Chart.js    | `/charts-chartjs`     | Chart.js library   | Doughnut, Radar, Polar  |
| ECharts     | `/charts-echarts`     | ECharts library    | Advanced visualizations |

### Maps (`/maps-*`)

| Route       | Path           | Description             | Features                     |
| ----------- | -------------- | ----------------------- | ---------------------------- |
| Google Maps | `/maps-google` | Google Maps integration | Markers, Routes, Street View |

### Icons (`/icons-*`)

| Route           | Path                     | Description           | Icons                     |
| --------------- | ------------------------ | --------------------- | ------------------------- |
| Feather Icons   | `/icons-feather`         | Feather icon set      | 1000+ icons               |
| Boxicons        | `/icons-boxicons`        | Boxicons set          | Regular, Solid, Logos     |
| Material Design | `/icons-material-design` | Material Design icons | Filled, Outlined, Rounded |

### Pages (`/pages-*`)

| Route       | Path                 | Description           | Features               |
| ----------- | -------------------- | --------------------- | ---------------------- |
| Starter     | `/pages-starter`     | Starter page template | Basic layout           |
| Profile     | `/pages-profile`     | User profile page     | Information, Settings  |
| Maintenance | `/pages-maintenance` | Maintenance page      | Status, Updates        |
| Coming Soon | `/pages-coming-soon` | Coming soon page      | Countdown, Newsletter  |
| 404 Error   | `/pages-404`         | 404 error page        | Navigation, Search     |
| 500 Error   | `/pages-500`         | 500 error page        | Error details, Support |

### Landing Pages (`/(with-nonlayout)/*`)

| Route       | Path           | Description             | Features                    |
| ----------- | -------------- | ----------------------- | --------------------------- |
| Landing     | `/landing`     | Main landing page       | Hero, Features, Pricing     |
| NFT Landing | `/nft-landing` | NFT marketplace landing | Collections, Artists        |
| Job Landing | `/job-landing` | Job portal landing      | Jobs, Companies             |
| Pricing     | `/pricing`     | Pricing page            | Plans, Features, Comparison |
| Auth Inner  | `/authinner`   | Inner authentication    | Login, Register forms       |

### Advanced UI (`/advance-ui-*`)

| Route         | Path                        | Description       | Components                   |
| ------------- | --------------------------- | ----------------- | ---------------------------- |
| Sweet Alerts  | `/advance-ui-sweet-alerts`  | SweetAlert2       | Custom alerts, Confirmations |
| Nestable List | `/advance-ui-nestable-list` | Nested lists      | Drag & drop, Hierarchy       |
| Scrollbar     | `/advance-ui-scrollbar`     | Custom scrollbars | Styling, Behavior            |
| Animation     | `/advance-ui-animation`     | CSS animations    | Transitions, Keyframes       |
| Tour          | `/advance-ui-tour`          | User tour         | Step-by-step guidance        |
| Swiper Slider | `/advance-ui-swiper-slider` | Swiper.js         | Carousel, Gallery            |
| Ratting       | `/advance-ui-ratting`       | Rating components | Stars, Reviews               |
| Highlight     | `/advance-ui-highlight`     | Code highlighting | Syntax, Themes               |
| Scrollspy     | `/advance-ui-scrollspy`     | Scroll spy        | Navigation, Sections         |

### Widgets (`/widgets-*`)

| Route   | Path       | Description       | Widgets              |
| ------- | ---------- | ----------------- | -------------------- |
| Widgets | `/widgets` | Dashboard widgets | Charts, Stats, Feeds |

### Profile (`/profile-*`)

| Route   | Path       | Description  | Features                      |
| ------- | ---------- | ------------ | ----------------------------- |
| Profile | `/profile` | User profile | Information, Settings, Avatar |

## 🧭 Route Navigation Guide

### Quick Navigation

#### 🔐 Authentication

- **Login**: `/auth/login` - User authentication
- **Register**: `/auth/register` - New user registration

#### 📊 Dashboards

- **Analytics**: `/dashboard-analytics` - Business metrics
- **CRM**: `/dashboard-crm` - Customer management
- **E-commerce**: `/dashboard-ecommerce` - Store analytics
- **Crypto**: `/dashboard-crypto` - Cryptocurrency tracking
- **NFT**: `/dashboard-nft` - NFT marketplace
- **Job**: `/dashboard-job` - Recruitment analytics
- **Projects**: `/dashboard-projects` - Project management

#### 🛒 E-commerce Flow

1. **Products**: `/apps-ecommerce-products` - Browse catalog
2. **Product Details**: `/apps-ecommerce-product-details` - View item
3. **Cart**: `/apps-ecommerce-cart` - Shopping cart
4. **Checkout**: `/apps-ecommerce-checkout` - Purchase process
5. **Orders**: `/apps-ecommerce-orders` - Order management

#### 👥 CRM Flow

1. **Leads**: `/apps-crm-leads` - Lead management
2. **Contacts**: `/apps-crm-contacts` - Contact database
3. **Companies**: `/apps-crm-companies` - Company profiles
4. **Deals**: `/apps-crm-deals` - Sales pipeline

#### 💰 Crypto Flow

1. **Wallet**: `/apps-crypto-wallet` - Digital wallet
2. **Buy/Sell**: `/apps-crypto-buy-sell` - Trading interface
3. **Orders**: `/apps-crypto-orders` - Trade orders
4. **Transactions**: `/apps-crypto-transactions` - Transaction history

#### 🎨 NFT Flow

1. **Marketplace**: `/apps-nft-marketplace` - Browse NFTs
2. **Collections**: `/apps-nft-collections` - NFT collections
3. **Create**: `/apps-nft-create` - Mint new NFT
4. **Wallet**: `/apps-nft-wallet` - NFT holdings

#### 💼 Job Portal Flow

1. **Job Lists**: `/apps-job-lists` - Browse jobs
2. **Job Details**: `/apps-job-details` - Job information
3. **Application**: `/apps-job-application` - Apply for job
4. **Candidates**: `/apps-job-candidate-lists` - Manage candidates

### Route Parameters

#### Dynamic Routes

- **Product Details**: `/apps-ecommerce-product-details?id={productId}`
- **Order Details**: `/apps-ecommerce-order-details?id={orderId}`
- **Job Details**: `/apps-job-details?id={jobId}`
- **NFT Details**: `/apps-nft-item-details?id={nftId}`
- **Contact Details**: `/apps-crm-contacts?id={contactId}`

#### Query Parameters

- **Search**: `?search={keyword}` - Search functionality
- **Filter**: `?filter={category}` - Category filtering
- **Sort**: `?sort={field}&order={asc|desc}` - Sorting options
- **Page**: `?page={number}` - Pagination
- **Status**: `?status={active|inactive}` - Status filtering

### Route Guards & Permissions

#### Public Routes

- Authentication pages (`/auth/*`)
- Landing pages (`/landing`, `/pricing`)
- Error pages (`/pages-404`, `/pages-500`)

#### Protected Routes

- All dashboard routes require authentication
- Application routes require specific permissions
- Admin routes require admin role

#### Role-based Access

- **User**: Basic dashboard access
- **Manager**: Team management, reports
- **Admin**: Full system access
- **Super Admin**: System configuration

## 🔌 API Documentation

### Authentication Endpoints

```typescript
// Login
POST /api/auth/login
Body: { email: string, password: string }
Response: { token: string, user: User }

// Register
POST /api/auth/register
Body: { name: string, email: string, password: string }
Response: { token: string, user: User }

// Logout
POST /api/auth/logout
Headers: { Authorization: Bearer {token} }
Response: { message: string }

// Refresh Token
POST /api/auth/refresh
Headers: { Authorization: Bearer {token} }
Response: { token: string }
```

### Dashboard Endpoints

```typescript
// Analytics Dashboard
GET /api/dashboard/analytics
Headers: { Authorization: Bearer {token} }
Response: { metrics: Metrics, charts: ChartData[] }

// CRM Dashboard
GET /api/dashboard/crm
Headers: { Authorization: Bearer {token} }
Response: { leads: Lead[], deals: Deal[], contacts: Contact[] }

// E-commerce Dashboard
GET /api/dashboard/ecommerce
Headers: { Authorization: Bearer {token} }
Response: { sales: SalesData, products: Product[], orders: Order[] }
```

### E-commerce Endpoints

```typescript
// Products
GET /api/ecommerce/products
Query: { page?: number, limit?: number, category?: string, search?: string }
Response: { products: Product[], total: number, pages: number }

POST /api/ecommerce/products
Body: ProductData
Response: { product: Product }

PUT /api/ecommerce/products/:id
Body: ProductData
Response: { product: Product }

DELETE /api/ecommerce/products/:id
Response: { message: string }

// Orders
GET /api/ecommerce/orders
Response: { orders: Order[] }

POST /api/ecommerce/orders
Body: OrderData
Response: { order: Order }
```

### CRM Endpoints

```typescript
// Leads
GET /api/crm/leads
Response: { leads: Lead[] }

POST /api/crm/leads
Body: LeadData
Response: { lead: Lead }

// Contacts
GET /api/crm/contacts
Response: { contacts: Contact[] }

POST /api/crm/contacts
Body: ContactData
Response: { contact: Contact }

// Deals
GET /api/crm/deals
Response: { deals: Deal[] }

POST /api/crm/deals
Body: DealData
Response: { deal: Deal }
```

### File Upload Endpoints

```typescript
// Upload File
POST /api/upload
Headers: { Authorization: Bearer {token} }
Body: FormData
Response: { url: string, filename: string }

// Upload Image
POST /api/upload/image
Headers: { Authorization: Bearer {token} }
Body: FormData
Response: { url: string, thumbnail: string }
```

### Error Responses

```typescript
// 400 Bad Request
{
  error: "Validation Error",
  message: "Invalid input data",
  details: ValidationError[]
}

// 401 Unauthorized
{
  error: "Unauthorized",
  message: "Invalid or missing token"
}

// 403 Forbidden
{
  error: "Forbidden",
  message: "Insufficient permissions"
}

// 404 Not Found
{
  error: "Not Found",
  message: "Resource not found"
}

// 500 Internal Server Error
{
  error: "Internal Server Error",
  message: "Something went wrong"
}
```

### Application Modules

```
apps/
├── calendar/                    # Calendar application
├── chat/                       # Chat system
├── crm/                        # Customer relationship management
├── crypto/                     # Cryptocurrency management
├── ecommerce/                  # E-commerce platform
├── email/                      # Email system
├── file-manager/               # File management
├── invoice/                    # Invoice management
├── job/                        # Job portal
├── mailbox/                    # Mailbox system
├── nft/                        # NFT marketplace
├── projects/                   # Project management
├── tasks/                      # Task management
├── tickets/                    # Support tickets
└── todo/                       # Todo application
```

## 🎨 UI Components

### Core Components

- **Layout Components**
  - `VerticalLayout` - Sidebar navigation layout
  - `HorizontalLayout` - Top navigation layout
  - `TwoColumnLayout` - Two-column layout
  - `AuthLayout` - Authentication layout

- **Common Components**
  - `Button` - Customizable button component
  - `Card` - Card container component
  - `Modal` - Modal dialog component
  - `Table` - Data table component
  - `Form` - Form components with validation

- **Dashboard Components**
  - `AnalyticsWidget` - Analytics display widgets
  - `ChartComponent` - Chart visualization
  - `StatCard` - Statistics cards
  - `ActivityFeed` - Activity timeline

### Advanced UI Features

- **Theme System** - Dark/light theme switching
- **Responsive Design** - Mobile-first approach
- **Accessibility** - WCAG 2.1 compliant
- **Animation** - Smooth transitions and animations
- **Loading States** - Skeleton loaders and spinners

## 📊 Charts & Analytics

### Chart Libraries

- **ApexCharts** - Interactive charts and graphs
- **Chart.js** - Simple and flexible charts
- **ECharts** - Powerful charting library

### Analytics Features

- **Real-time Data** - Live data updates
- **Interactive Charts** - Zoom, pan, and drill-down
- **Export Options** - PDF, PNG, CSV export
- **Custom Dashboards** - Configurable widgets
- **Data Filtering** - Advanced filtering options

## 🔐 Authentication

### Authentication Features

- **JWT Authentication** - Secure token-based auth
- **Role-based Access** - User role management
- **Session Management** - Persistent sessions
- **Password Reset** - Secure password recovery
- **Social Login** - OAuth integration (configurable)

### Security Features

- **CSRF Protection** - Cross-site request forgery protection
- **XSS Prevention** - Cross-site scripting prevention
- **Input Validation** - Server-side validation
- **Rate Limiting** - API rate limiting
- **Secure Headers** - Security headers configuration

## 📱 Responsive Design

### Breakpoints

- **Mobile**: < 576px
- **Tablet**: 576px - 991px
- **Desktop**: ≥ 992px
- **Large Desktop**: ≥ 1200px

### Responsive Features

- **Mobile Navigation** - Collapsible sidebar
- **Touch-friendly** - Touch-optimized interactions
- **Adaptive Layouts** - Layout adjustments per screen
- **Responsive Tables** - Scrollable tables on mobile
- **Flexible Grid** - Bootstrap grid system

## 🌐 Internationalization

### i18n Features

- **Multi-language Support** - Multiple language support
- **RTL Support** - Right-to-left language support
- **Dynamic Translation** - Runtime language switching
- **Locale Detection** - Automatic language detection
- **Translation Management** - Centralized translation files

### Supported Languages

- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Arabic (ar) - RTL support
- Chinese (zh)
- Japanese (ja)

## 🧪 Testing

### Testing Strategy

- **Unit Testing** - Component and utility testing
- **Integration Testing** - API integration testing
- **E2E Testing** - End-to-end testing
- **Performance Testing** - Load and stress testing

### Testing Tools

- **Jest** - Unit testing framework
- **React Testing Library** - Component testing
- **Cypress** - E2E testing
- **Lighthouse** - Performance testing

## 📈 Performance

### Optimization Features

- **Code Splitting** - Automatic route-based splitting
- **Image Optimization** - Next.js Image optimization
- **Bundle Analysis** - Webpack bundle analyzer
- **Caching Strategy** - Efficient caching
- **Lazy Loading** - Component lazy loading

### Performance Metrics

- **First Contentful Paint**: < 1.5s
- **Largest Contentful Paint**: < 2.5s
- **Cumulative Layout Shift**: < 0.1
- **First Input Delay**: < 100ms

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**
4. **Run tests**
   ```bash
   npm run test
   ```
5. **Commit your changes**
   ```bash
   git commit -m "feat: add your feature description"
   ```
6. **Push to the branch**
   ```bash
   git push origin feature/your-feature-name
   ```
7. **Create a Pull Request**

### Development Guidelines

- Follow **TypeScript** best practices
- Use **ESLint** and **Prettier** for code formatting
- Write **comprehensive tests**
- Follow **conventional commits** format
- Update **documentation** for new features

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Getting Help

- **Documentation**: Check the [docs](./docs) folder
- **Issues**: Report bugs on [GitHub Issues](https://github.com/your-username/velzon-next-ts/issues)
- **Discussions**: Join our
  [GitHub Discussions](https://github.com/your-username/velzon-next-ts/discussions)
- **Email**: support@velzon.com

### Community

- **Discord**: Join our [Discord server](https://discord.gg/velzon)
- **Twitter**: Follow us on [Twitter](https://twitter.com/velzon)
- **Blog**: Read our [blog](https://blog.velzon.com)

---

<div align="center">

**Made with ❤️ by the Velzon Team**

[![GitHub stars](https://img.shields.io/github/stars/your-username/velzon-next-ts?style=social)](https://github.com/your-username/velzon-next-ts/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/your-username/velzon-next-ts?style=social)](https://github.com/your-username/velzon-next-ts/network)
[![GitHub issues](https://img.shields.io/github/issues/your-username/velzon-next-ts)](https://github.com/your-username/velzon-next-ts/issues)

</div>
