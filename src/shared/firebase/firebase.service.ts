import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { Firestore } from 'firebase-admin/firestore';
import { Auth } from 'firebase-admin/auth';
import { Messaging } from 'firebase-admin/messaging';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private app: admin.app.App;
  public firestore: Firestore;
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
      databaseURL: this.configService.get('firebase.databaseURL'),
    };

    this.app = admin.initializeApp(firebaseConfig);
    this.firestore = this.app.firestore();
    this.auth = this.app.auth();
    this.messaging = this.app.messaging();
  }

  getFirestore(): Firestore {
    return this.firestore;
  }

  getAuth(): Auth {
    return this.auth;
  }

  getMessaging(): Messaging {
    return this.messaging;
  }
}
