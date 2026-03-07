# Tu-Link Backend API

A real-time convoy coordination platform backend built with NestJS, providing location tracking, journey management, and Firebase authentication.

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Firebase project
- Google Maps API key

### Setup

1. **Clone and Install**
   ```bash
   git clone <your-repo>
   cd tulink-backend
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Firebase and API credentials
   ```

3. **Start Development Environment**
   ```bash
   # Using Docker (Recommended)
   npm run docker:dev
   
   # OR run manually
   npm run start:dev
   ```

4. **Access Application**
   - API Health: http://localhost:3000/health
   - Swagger Docs: http://localhost:3000/api
   - Redis: localhost:6380

### Deploy Updates
```bash
./deploy.sh
```

## 📋 Core Features

- **Real-Time Location Tracking** - WebSocket-based with <150ms latency
- **Journey Management** - Complete convoy lifecycle
- **Firebase Authentication** - Secure user auth with refresh tokens
- **Google Maps Integration** - Geocoding and routing
- **Redis Caching** - High-performance data layer
- **Swagger Documentation** - Auto-generated API docs

## 🛠️ Tech Stack

- **Framework**: NestJS (TypeScript)
- **Database**: Firebase Firestore
- **Real-Time**: Socket.io WebSockets
- **Cache**: Redis
- **Maps**: Google Maps Platform + Mapbox
- **Auth**: Firebase Auth

## Description

Production-ready backend for the "Tu-link" mobile app - a real-time convoy coordination system enabling groups to track locations during travel with lag alerts and arrival detection.

## Quick Start 🚀

### 1. Prerequisites
- Node.js 18+
- Redis (via Docker)
- Firebase project with Firestore
- Google Maps API key

### 2. Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your credentials:
# - Firebase credentials (Admin SDK + API Key)
# - Google Maps API key
# - Mapbox tokens
# - Redis connection (optional if using Docker)
```

**Required Firebase Variables:**
- `FIREBASE_PROJECT_ID` - From Firebase Console
- `FIREBASE_CLIENT_EMAIL` - From service account JSON
- `FIREBASE_PRIVATE_KEY` - From service account JSON
- `FIREBASE_DATABASE_URL` - Your Firestore URL
- `FIREBASE_API_KEY` - Web API Key (for authentication) **⚠️ Required for login**

### 3. Start Development Environment
```bash
# Using Docker (Recommended - includes Redis)
npm run docker:dev

# OR manually start Redis and run app
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

### 4. Install Dependencies
```bash
npm install
```

### 5. Setup Firestore Indexes
```bash
# Deploy required indexes for queries
firebase login
firebase use tulink-app-1a942
firebase deploy --only firestore:indexes

# OR click the index creation URL when you first encounter the error
# See docs/FIRESTORE_INDEX_SETUP.md for detailed instructions
```

### 6. Build Project
```bash
npm run build
```

### 7. Run Application
```bash
# Using Docker (Recommended)
npm run docker:dev

# OR local development mode (requires Redis running)
npm run start:dev

# Production mode
npm run start:prod
```

### 8. Access Application
- **API**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/api
- **WebSocket**: ws://localhost:3000/location

### 9. Test with Postman 📮
```bash
# Import the Postman collection
1. Open Postman
2. Import: Tu-Link-Backend.postman_collection.json
3. Follow the testing guide: README_POSTMAN.md

# Quick test (5 minutes)
- Register users
- Create journey
- Send location updates
- View analytics

See: README_POSTMAN.md for complete testing guide
```

## API Endpoints 📡

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login with credentials
- `POST /auth/refresh` - Refresh authentication token
- `GET /auth/profile` - Get user profile

### Journeys
- `POST /journeys` - Create journey
- `GET /journeys/active` - Get active journeys
- `POST /journeys/:id/start` - Start journey
- `POST /journeys/:id/invite` - Invite participant

### Locations
- `POST /locations` - Send location update
- `GET /locations/journeys/:id/latest` - Get latest locations

## 🔧 Development Commands

```bash
# Start development server
npm run start:dev

# Build application
npm run build

# Run tests
npm run test

# Lint code
npm run lint

# Docker development environment
npm run docker:dev
npm run docker:down
```

## 🌐 Deployment

The application is containerized and ready for deployment:

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Set Firebase project (if not already configured)
firebase use tulink-app-1a942

# Deploy security rules and indexes
firebase deploy --only firestore
```

### 4. Firebase Configuration Files
These files are **version controlled** and should NOT be in `.gitignore`:
- `firebase.json` - Firebase project configuration
- `config/firebase/firestore.rules` - Database security rules
- `firestore.indexes.json` - Query optimization indexes

**Why tracked in Git:**
- Team collaboration and consistency
- Deployment automation
- Security rule auditing

## Project Structure 📁

```
src/
├── config/              # Configuration modules
├── common/              # Shared utilities, guards, filters
├── shared/              # Shared modules (Firebase, Redis)
├── modules/
│   ├── auth/           # Authentication
│   ├── journey/        # Journey management
│   ├── location/       # Real-time location tracking ⭐
│   ├── notification/   # Notifications
│   ├── maps/           # Google Maps integration
│   └── analytics/      # Journey analytics
└── types/              # Type definitions
```

## Architecture Highlights 🏗️

### Hybrid Real-Time Strategy
- **Primary**: WebSocket for <150ms updates
- **Fallback**: Firebase listeners for offline sync
- **Persistence**: Firestore for all data
- **Cache**: Redis for hot data & sequences

### Uber-Inspired Patterns
- Priority-based message delivery (HIGH/MEDIUM/LOW)
- Sequence numbering for guaranteed ordering
- Acknowledgment system with retry logic
- Connection health monitoring (4s heartbeat)
- Exponential backoff reconnection

### Key Features
- ✅ Real-time location tracking
- ✅ Lag detection with severity levels
- ✅ Arrival detection
- ✅ Battery-aware throttling
- ✅ Rate limiting (60 req/min)
- ✅ Message gap detection & resync
- ✅ Firebase security rules

## Performance Targets 🎯

- WebSocket latency: <150ms (p95)
- Location update delivery: <200ms end-to-end
- Lag alert generation: <500ms
- Connection establishment: <2s
- Reconnection time: <3s
- Throughput: 10,000 updates/min

## Documentation 📚

### API & Testing
- **Swagger API Docs**: http://localhost:3000/api (Interactive)
- **Postman Collection**: `Tu-Link-Backend.postman_collection.json` - 40+ endpoints
- **Postman Quick Start**: [README_POSTMAN.md](./README_POSTMAN.md) - 5-minute setup
- **Testing Guide**: [docs/POSTMAN_TESTING_GUIDE.md](./docs/POSTMAN_TESTING_GUIDE.md) - Complete testing scenarios

### Learning & Development
- **Learning Guide**: [docs/LEARNING_GUIDE.md](./docs/LEARNING_GUIDE.md) - Deep dive into architecture
- **Project Status**: [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md) - Implementation status
- **Completion Summary**: [COMPLETION_SUMMARY.md](./COMPLETION_SUMMARY.md) - Feature overview

## Deployment 🚢

### ✅ Production Ready
This app is **deployment-ready** for DigitalOcean droplets and other cloud providers.

### Prerequisites
- Node.js 20+ runtime
- Redis instance
- Firebase project with valid credentials
- Environment variables configured

### Quick Deployment
```bash
# Simple deployment script (development environment)
./deploy.sh

# Build and run manually
npm run build
npm run start:prod
```

### Docker Deployment (Recommended)
```bash
# Development environment with Docker
npm run docker:dev

# Production Docker build
docker build -f config/docker/Dockerfile -t tulink-backend .
docker run -p 3000:3000 --env-file .env tulink-backend
```

### DigitalOcean Droplet Setup
1. Create droplet with Node.js 20+
2. Copy `.env.example` to `.env` and configure
3. Run `./deploy.sh` or use Docker
4. Configure reverse proxy (nginx) for SSL
5. Set up Redis instance

### Environment Configuration
Ensure all environment variables from `.env.example` are set in your production environment.

# Check application health
curl http://localhost:3000/health
```

## 📊 Environment Variables

Required environment variables (see `.env.example`):

- `FIREBASE_PROJECT_ID` - Firebase project ID
- `FIREBASE_API_KEY` - Firebase Web API key
- `FIREBASE_PRIVATE_KEY` - Service account private key
- `GOOGLE_MAPS_API_KEY` - Google Maps API key
- `JWT_SECRET` - JWT signing secret

## 🔍 Troubleshooting

### Common Issues

**Application won't start:**
```bash
# Check Docker containers
docker compose -f config/docker/docker-compose.dev.yml ps

# Check logs
docker compose -f config/docker/docker-compose.dev.yml logs -f
```

**Authentication errors:**
- Verify Firebase configuration in `.env`
- Check Firebase API key permissions

**Database connection issues:**
- Ensure Redis is running
- Check Redis connection settings

## 📄 License

This project is licensed under the MIT License.


**Status**: ✅ Production Ready | **Build**: ✅ Passing | **Version**: 1.0.0
# Tu-link-Backend
