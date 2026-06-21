import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { Auth } from 'firebase-admin/auth';
import { Messaging } from 'firebase-admin/messaging';

// Persistence moved to Postgres; this service now only exposes Firebase Auth
// and FCM (messaging). Firestore has been removed.
@Injectable()
export class FirebaseService implements OnModuleInit {
  private app: admin.app.App;
  public auth: Auth;
  public messaging: Messaging;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const firebaseConfig: admin.AppOptions = {
      credential: admin.credential.cert({
        projectId: this.configService.get('firebase.projectId'),
        clientEmail: this.configService.get('firebase.clientEmail'),
        privateKey: this.configService.get('firebase.privateKey'),
      }),
    };

    this.app = admin.initializeApp(firebaseConfig);
    this.auth = this.app.auth();
    this.messaging = this.app.messaging();
  }

  getAuth(): Auth {
    return this.auth;
  }

  getMessaging(): Messaging {
    return this.messaging;
  }
}
