import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { Firestore } from 'firebase-admin/firestore';
import { Auth } from 'firebase-admin/auth';
import { Messaging } from 'firebase-admin/messaging';
import { getDatabase, Database } from 'firebase-admin/database';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private app: admin.app.App;
  public firestore: Firestore;
  public auth: Auth;
  public messaging: Messaging;
  private rtdb: Database;

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
    this.rtdb = getDatabase();
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

  /**
   * Write or overwrite a member's current position in RTDB.
   * Replaces any previous position — RTDB is not a history store.
   */
  async setMemberPosition(
    journeyId: string,
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.rtdb.ref(`journeys/${journeyId}/members/${userId}`).set(payload);
  }

  /**
   * Remove a member's position node from RTDB.
   * Called when a member leaves a journey or disconnects.
   */
  async removeMemberPosition(journeyId: string, userId: string): Promise<void> {
    await this.rtdb.ref(`journeys/${journeyId}/members/${userId}`).remove();
  }

  /**
   * Remove all member positions for a journey from RTDB.
   * Called after a journey ends — with a short delay to allow in-flight reads to complete.
   */
  async clearJourneyPositions(journeyId: string): Promise<void> {
    await this.rtdb.ref(`journeys/${journeyId}`).remove();
  }
}
