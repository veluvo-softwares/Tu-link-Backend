# Tu-link - Convoy Coordination Backend 🚀

Real-time convoy coordination platform built with NestJS, featuring WebSocket support, Firebase integration, and Uber-inspired real-time patterns.

## Features ✨

- **Real-Time Location Tracking**: WebSocket-based with <150ms latency
- **Lag Detection**: Automatic alerts with WARNING/CRITICAL severity
- **Arrival Detection**: Smart destination arrival detection
- **Journey Management**: Complete lifecycle management (PENDING → ACTIVE → COMPLETED)
- **Hybrid Architecture**: WebSocket primary + Firebase fallback
- **Priority-Based Delivery**: Uber-inspired HIGH/MEDIUM/LOW message prioritization
- **Sequence Numbering**: Guaranteed message ordering
- **Acknowledgment System**: Retry logic with exponential backoff
- **Redis Caching**: High-performance data caching
- **Google Maps Integration**: Geocoding, routing, and distance calculations
- **Firebase Security**: Complete Firestore security rules
- **Swagger Documentation**: Auto-generated API docs

## Tech Stack 🛠️

- **Framework**: NestJS (TypeScript)
- **Database**: Firebase Firestore
- **Real-Time**: Socket.io (WebSocket)
- **Caching**: Redis
- **Maps**: Google Maps Platform
- **Auth**: Firebase Auth
- **API Docs**: Swagger/OpenAPI

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
# - Redis connection (optional if using Docker)
```

**Required Firebase Variables:**
- `FIREBASE_PROJECT_ID` - From Firebase Console
- `FIREBASE_CLIENT_EMAIL` - From service account JSON
- `FIREBASE_PRIVATE_KEY` - From service account JSON
- `FIREBASE_DATABASE_URL` - Your Firestore URL
- `FIREBASE_API_KEY` - Web API Key (for authentication) **⚠️ Required for login**

### 3. Start Redis
```bash
docker-compose up -d
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
# Development mode (with hot-reload)
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
- `POST /auth/register` - Register new user (returns auth token)
- `POST /auth/login` - Login with credentials (returns auth token)
- `POST /auth/refresh` - Refresh authentication token
- `POST /auth/logout` - Logout and revoke tokens
- `GET /auth/profile` - Get user profile (protected)
- `PUT /auth/profile` - Update profile (protected)

**🔐 [Complete Authentication Guide](./docs/AUTHENTICATION_FLOW.md)** | **[Quick Start](./docs/AUTH_QUICK_START.md)**

### Journeys
- `POST /journeys` - Create journey
- `GET /journeys/active` - Get active journeys
- `GET /journeys/:id` - Get journey details
- `POST /journeys/:id/start` - Start journey
- `POST /journeys/:id/end` - End journey
- `POST /journeys/:id/invite` - Invite participant
- `POST /journeys/:id/accept` - Accept invitation

### Locations
- `POST /locations` - Send location update (REST fallback)
- `GET /locations/journeys/:id/history` - Get location history
- `GET /locations/journeys/:id/latest` - Get latest locations

### Notifications
- `GET /notifications` - Get user notifications
- `GET /notifications/unread-count` - Get unread count
- `PUT /notifications/:journeyId/:id/read` - Mark as read

### Analytics
- `GET /analytics/journeys/:id` - Get journey statistics
- `GET /analytics/user` - Get user journey history

**Full API Documentation**: http://localhost:3000/api

## WebSocket Events 🔌

### Client → Server
- `join-journey` - Join a journey room
- `location-update` - Send location update
- `heartbeat` - Send heartbeat
- `acknowledge` - Acknowledge message
- `request-resync` - Request missing messages

### Server → Client
- `location-update` - Receive location updates
- `lag-alert` - Lag alert notification
- `journey-started` - Journey started
- `participant-joined` - Participant joined
- `arrival-detected` - Arrival notification
- `connection-status` - Connection status update

## Testing 🧪

```bash
# unit tests
npm run test

# e2e tests
npm run test:e2e

# test coverage
npm run test:cov
```

## Firebase Setup 🔥

### 1. Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable Firestore Database
4. Enable Authentication (Email/Password)

### 2. Get Service Account Key
1. Go to Project Settings → Service Accounts
2. Click "Generate New Private Key"
3. Save the JSON file
4. Extract values for `.env`:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`

### 3. Deploy Security Rules
```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase in project
firebase init firestore

# Deploy rules
firebase deploy --only firestore:rules
```

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

### Prerequisites
- Node.js 18+ runtime
- Redis instance
- Firebase project
- Environment variables configured

### Build for Production
```bash
npm run build
npm run start:prod
```

### Docker Deployment (Optional)
```dockerfile
# Dockerfile example
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/main"]
```

### Environment Configuration
Ensure all environment variables from `.env.example` are set in your production environment.

## Key Technologies 🔧

- [NestJS](https://nestjs.com/) - Progressive Node.js framework
- [Socket.io](https://socket.io/) - Real-time WebSocket library
- [Firebase](https://firebase.google.com/) - Backend-as-a-Service
- [Redis](https://redis.io/) - In-memory data store
- [Google Maps Platform](https://developers.google.com/maps) - Location services
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript

## Contributing 🤝

Contributions are welcome! Please feel free to submit a Pull Request.

## Support 💬

For issues or questions:
1. Check the [documentation](./PROJECT_STATUS.md)
2. Review [Swagger API docs](http://localhost:3000/api)
3. Open an issue in the repository

## License 📄

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments 🙏

- Built with [NestJS](https://nestjs.com/)
- Inspired by Uber's RAMEN real-time architecture
- Firebase for backend infrastructure
- Google Maps for location services

---

**Status**: ✅ Production Ready | **Build**: ✅ Passing | **Version**: 1.0.0
# Tu-link-Backend
