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

  /**
   * Read all member positions for a journey from RTDB.
   * Returns real-time location data for all participants.
   */
  async getJourneyRTDBSnapshot(
    journeyId: string,
  ): Promise<Record<string, Record<string, unknown>> | null> {
    try {
      const snapshot = await this.rtdb
        .ref(`journeys/${journeyId}/members`)
        .once('value');
      return snapshot.exists()
        ? (snapshot.val() as Record<string, Record<string, unknown>>)
        : null;
    } catch (error) {
      console.error(
        `Failed to read RTDB snapshot for journey ${journeyId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Read a specific member's position from RTDB.
   * Returns real-time location data for a single participant.
   */
  async getMemberRTDBSnapshot(
    journeyId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const snapshot = await this.rtdb
        .ref(`journeys/${journeyId}/members/${userId}`)
        .once('value');
      return snapshot.exists()
        ? (snapshot.val() as Record<string, unknown>)
        : null;
    } catch (error) {
      console.error(
        `Failed to read RTDB snapshot for user ${userId} in journey ${journeyId}:`,
        error,
      );
      return null;
    }
  }
}
